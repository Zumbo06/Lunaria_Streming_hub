// Sequential BitTorrent streaming engine (SRS 4.3, REQ-3.1 / REQ-3.2 / REQ-3.3).
//
// Runs as a forked child process: swarm I/O and piece hashing never share an
// event loop with the UI (NFR 5.1), and the parent can hard-kill the whole
// engine — sockets, temp files and all — in one call (NFR 5.2).
//
// The HTTP gateway is hand-rolled rather than WebTorrent's `createServer()`.
// Players ask for open-ended ranges (`bytes=N-`), and WebTorrent answers those
// by selecting every piece from N to EOF, which quietly turns a stream into a
// full download. Serving the body as a series of bounded reads keeps only a
// window selected at any moment.
//
// Protocol with the parent, over process.send/message:
//   in  { cmd: 'start', magnetUri, infoHash, fileIdx, port, downloadDir, ... }
//   in  { cmd: 'stop' } | { cmd: 'shutdown' }
//   out { type: 'metadata' | 'buffering' | 'ready' | 'progress' | 'stopped' | 'error' }

import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import WebTorrent from 'webtorrent'

const DEBUG = Boolean(process.env.ORION_DEBUG)

const VIDEO_EXTENSIONS = [
  '.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm',
  '.ts', '.m2ts', '.mpg', '.mpeg', '.wmv', '.flv', '.ogv',
]

const MIME_TYPES = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.ts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.flv': 'video/x-flv',
  '.wmv': 'video/x-ms-asf',
  '.ogv': 'video/ogg',
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
}

// Container indexes live at the end of the file as often as the start. An MP4
// with a trailing `moov` atom and a Matroska file's Cues/SeekHead are both
// unplayable until the tail is on disk, and that is the first thing VLC goes
// looking for after opening byte 0 — measured identically for both containers.
const DEFAULT_TAIL_BUFFER_BYTES = 8 * 1024 * 1024

const client = new WebTorrent()

let server = null
let serverPort = null
let activeTorrent = null
let activeFile = null
let progressTimer = null
let tempDir = null
let ownsTempDir = false

// Largest span handed to a single bounded read, i.e. how far ahead of the
// player the swarm may run.
let readaheadBytes = 24 * 1024 * 1024

// When set, the finished file survives `stop` instead of being wiped.
let keepFiles = false

function send(message) {
  if (process.send) process.send(message)
}

function debug(...args) {
  if (DEBUG) console.log('[gateway]', ...args)
}

client.on('error', (err) => {
  send({ type: 'error', message: `Torrent client error: ${err?.message || err}` })
})

// ---- HTTP loopback gateway (REQ-3.3) ----

function mimeFor(name) {
  return MIME_TYPES[path.extname(name).toLowerCase()] || 'application/octet-stream'
}

function parseRange(header, size) {
  if (!header) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null

  let start
  let end

  if (match[1] === '') {
    // Suffix form: `bytes=-N` means the last N bytes.
    const suffix = Number(match[2])
    if (!suffix) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start, end }
}

/**
 * Writes [start, end] to the response as a run of bounded reads. Each
 * `createReadStream` call selects only its own slice and deselects it on
 * completion or client abort, so the download tracks playback instead of
 * racing to the end of the file (REQ-3.2).
 */
async function pipeBounded(file, start, end, res) {
  let cursor = start

  try {
    while (cursor <= end && !res.destroyed && !res.writableEnded) {
      const chunkEnd = Math.min(cursor + readaheadBytes - 1, end)
      const source = file.createReadStream({ start: cursor, end: chunkEnd })

      // end:false so consecutive slices concatenate into one response body.
      await pipeline(source, res, { end: false })
      cursor = chunkEnd + 1
    }
    if (!res.destroyed && !res.writableEnded) res.end()
  } catch (err) {
    // Players abort mid-response on every seek; that is normal, not a fault.
    debug('response aborted:', err?.code || err?.message)
    if (!res.destroyed) res.destroy()
  }
}

function handleRequest(req, res) {
  const torrent = activeTorrent
  const file = activeFile

  debug(
    `${req.method} ${req.headers.range || '(no range)'}` +
      ` host=${req.headers.host} ua="${(req.headers['user-agent'] || '?').slice(0, 40)}"`,
  )

  // Deny cross-origin hosts to block DNS-rebinding against the gateway.
  if (!req.headers.host || !req.headers.host.startsWith('127.0.0.1')) {
    res.writeHead(403)
    return res.end()
  }

  if (!torrent || !file) {
    res.writeHead(503)
    return res.end()
  }

  if (!req.url || !decodeURIComponent(req.url).includes(torrent.infoHash)) {
    res.writeHead(404)
    return res.end()
  }

  const size = file.length
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', mimeFor(file.name))
  // One request per connection: each body is assembled from several bounded
  // reads, and a reused socket only invites framing bugs for no gain locally.
  res.setHeader('Connection', 'close')

  if (req.method === 'HEAD') {
    res.writeHead(200, { 'Content-Length': size })
    return res.end()
  }

  if (req.method !== 'GET') {
    res.writeHead(405)
    return res.end()
  }

  const range = parseRange(req.headers.range, size)

  if (!range && req.headers.range) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` })
    return res.end()
  }

  const start = range ? range.start : 0
  const end = range ? range.end : size - 1

  res.writeHead(range ? 206 : 200, {
    'Content-Length': end - start + 1,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
  })

  return pipeBounded(file, start, end, res)
}

/**
 * Probes for a free port up front so the server is bound exactly once.
 */
function findFreePort(preferredPort, maxAttempts = 20) {
  return new Promise((resolve, reject) => {
    let port = preferredPort
    let attemptsLeft = maxAttempts

    const probe = () => {
      const tester = net.createServer()

      tester.once('error', (err) => {
        tester.close()
        if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
          attemptsLeft -= 1
          port += 1
          probe()
          return
        }
        reject(err)
      })

      tester.once('listening', () => tester.close(() => resolve(port)))
      tester.listen(port, '127.0.0.1')
    }

    probe()
  })
}

async function ensureServer(preferredPort) {
  if (server) return serverPort

  const port = await findFreePort(preferredPort || 8080)
  server = http.createServer(handleRequest)
  server.on('clientError', (err, socket) => {
    debug('client error:', err.message)
    socket.destroy()
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.once('listening', resolve)
    server.listen(port, '127.0.0.1')
  })

  serverPort = port
  return port
}

function streamUrlFor(torrent, file, port) {
  const encoded = file.path.split(/[\\/]/).map(encodeURIComponent).join('/')
  return `http://127.0.0.1:${port}/webtorrent/${torrent.infoHash}/${encoded}`
}

// ---- File selection ----

function pickFile(torrent, fileIdx) {
  if (Number.isInteger(fileIdx) && torrent.files[fileIdx]) return torrent.files[fileIdx]

  const videos = torrent.files.filter((file) =>
    VIDEO_EXTENSIONS.includes(path.extname(file.name).toLowerCase()),
  )
  const pool = videos.length > 0 ? videos : torrent.files
  return pool.reduce((biggest, file) => (file.length > biggest.length ? file : biggest), pool[0])
}

function pieceRangeOf(torrent, file) {
  const pieceLength = torrent.pieceLength || 0
  if (!pieceLength) return null
  return {
    pieceLength,
    first: Math.floor(file.offset / pieceLength),
    last: Math.floor((file.offset + file.length - 1) / pieceLength),
  }
}

function piecesPresent(torrent, from, to) {
  for (let index = from; index <= to; index += 1) {
    if (!torrent.bitfield.get(index)) return false
  }
  return true
}

/**
 * Queues the head (so playback can start) and the tail (so the container index
 * is parseable) before the player is ever pointed at the gateway.
 */
function prebuffer(torrent, file, headBytes, tailBytes) {
  const range = pieceRangeOf(torrent, file)
  if (!range) return null

  const { pieceLength, first, last } = range

  const headEnd = Math.min(first + Math.max(1, Math.ceil(headBytes / pieceLength)) - 1, last)
  torrent.select(first, headEnd, 1)
  torrent.critical(first, Math.min(first + 1, headEnd))

  const tailStart = Math.max(headEnd + 1, last - Math.ceil(tailBytes / pieceLength) + 1)
  const hasTail = tailStart <= last
  if (hasTail) {
    torrent.select(tailStart, last, 1)
    torrent.critical(tailStart, last)
  }

  return { head: [first, headEnd], tail: hasTail ? [tailStart, last] : null }
}

/**
 * Resolves only once the opening and the container index are both on disk.
 * Reports live counts while it waits, so a starving swarm is visible in the UI
 * rather than looking like the app has hung.
 */
function waitForPrebuffer(torrent, file, windows, headBytes, timeoutMs) {
  const headTarget = Math.min(headBytes, file.length)
  const tail = windows?.tail || null

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    let lastEmit = 0

    const poll = () => {
      let tailPresent = 0
      let tailTotal = 0
      if (tail) {
        tailTotal = tail[1] - tail[0] + 1
        for (let index = tail[0]; index <= tail[1]; index += 1) {
          if (torrent.bitfield.get(index)) tailPresent += 1
        }
      }

      const status = {
        headDone: Math.min(file.downloaded, headTarget),
        headTarget,
        tailPresent,
        tailTotal,
        numPeers: torrent.numPeers,
        downloadSpeed: torrent.downloadSpeed,
      }

      const now = Date.now()
      if (now - lastEmit >= 1000) {
        lastEmit = now
        send({ type: 'buffering', infoHash: torrent.infoHash, ...status })
      }

      if (file.downloaded >= headTarget && tailPresent === tailTotal) {
        return resolve({ ok: true, ...status })
      }
      if (now > deadline) return resolve({ ok: false, ...status })
      setTimeout(poll, 250)
    }

    poll()
  })
}

/** Releases the prebuffer selections; serving drives everything from here. */
function releasePrebuffer(torrent, windows) {
  if (!windows) return
  try {
    torrent.deselect(windows.head[0], windows.head[1])
    if (windows.tail) torrent.deselect(windows.tail[0], windows.tail[1])
  } catch {
    /* torrent already gone */
  }
}

function startProgress(torrent, file) {
  clearInterval(progressTimer)
  progressTimer = setInterval(() => {
    if (!activeTorrent) return
    send({
      type: 'progress',
      infoHash: torrent.infoHash,
      progress: file.progress,
      downloaded: file.downloaded,
      length: file.length,
      downloadSpeed: torrent.downloadSpeed,
      uploadSpeed: torrent.uploadSpeed,
      numPeers: torrent.numPeers,
      timeRemaining: torrent.timeRemaining,
    })
  }, 1000)
}

// ---- Lifecycle ----

function cleanupTempDir() {
  const removable = tempDir && ownsTempDir && !keepFiles
  if (removable) {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch (err) {
      console.error('[engine] Could not remove temp dir:', err.message)
    }
  }
  tempDir = null
  ownsTempDir = false
}

function stop() {
  clearInterval(progressTimer)
  progressTimer = null

  const torrent = activeTorrent
  const keeping = keepFiles
  const keptPath = keeping && activeFile && tempDir ? path.join(tempDir, activeFile.path) : null
  const completed = keeping && activeFile ? activeFile.progress >= 1 : false

  activeTorrent = null
  activeFile = null

  if (!torrent) {
    cleanupTempDir()
    return Promise.resolve(null)
  }

  return new Promise((resolve) => {
    // destroyStore deletes the media off disk. It is skipped only when the user
    // asked to keep downloads; otherwise every byte goes when the stream does.
    torrent.destroy({ destroyStore: !keeping }, () => {
      cleanupTempDir()
      resolve(keptPath ? { path: keptPath, complete: completed } : null)
    })
  })
}

async function start(payload) {
  const {
    magnetUri,
    fileIdx,
    port,
    downloadDir,
    headBufferBytes = 4 * 1024 * 1024,
    tailBufferBytes = DEFAULT_TAIL_BUFFER_BYTES,
    readaheadBytes: requestedReadahead = 24 * 1024 * 1024,
    keepDownloads = false,
    metadataTimeoutMs = 60000,
    bufferTimeoutMs = 120000,
  } = payload

  // One torrent at a time: a previous swarm is torn down before a new one
  // starts, which is the "isolated process tracking" of NFR 5.2.
  await stop()

  readaheadBytes = requestedReadahead
  keepFiles = Boolean(keepDownloads)

  tempDir = downloadDir || fs.mkdtempSync(path.join(os.tmpdir(), 'orion-'))
  ownsTempDir = !downloadDir
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

  // `deselect: true` suppresses WebTorrent's default "select the whole torrent"
  // on ready. Without it every piece is queued the moment metadata lands and
  // the film downloads in full behind the player's back.
  const torrent = client.add(magnetUri, {
    path: tempDir,
    strategy: 'sequential',
    deselect: true,
  })
  activeTorrent = torrent

  torrent.on('error', (err) => {
    send({ type: 'error', message: `Torrent error: ${err?.message || err}` })
  })

  if (!torrent.ready) {
    const gotMetadata = await Promise.race([
      new Promise((resolve) => torrent.once('ready', () => resolve(true))),
      new Promise((resolve) => setTimeout(() => resolve(false), metadataTimeoutMs)),
    ])
    if (!gotMetadata) {
      await stop()
      throw new Error('Timed out fetching torrent metadata — no peers responded')
    }
  }

  // `stop` may have run while we were waiting for metadata.
  if (activeTorrent !== torrent) return

  const file = pickFile(torrent, fileIdx)
  if (!file) throw new Error('Torrent contains no files')

  activeFile = file

  if (keepFiles) {
    // Keeping a file only makes sense if it ends up complete, so the rest of it
    // is queued at low priority. Serving reads sit at priority 1 and still win,
    // so playback stays ahead while the gaps fill in behind.
    file.select(0)
  }

  const windows = prebuffer(torrent, file, headBufferBytes, tailBufferBytes)

  const listenPort = await ensureServer(port)
  const url = streamUrlFor(torrent, file, listenPort)

  send({
    type: 'metadata',
    infoHash: torrent.infoHash,
    name: torrent.name,
    file: { name: file.name, path: file.path, length: file.length },
    url,
    port: listenPort,
  })

  startProgress(torrent, file)
  send({ type: 'buffering', infoHash: torrent.infoHash, target: Math.min(headBufferBytes, file.length) })

  // Hand the player a URL only once the head is on disk and the container index
  // at the tail is readable; otherwise it opens, finds no index, and gives up.
  const status = await waitForPrebuffer(torrent, file, windows, headBufferBytes, bufferTimeoutMs)
  if (activeTorrent !== torrent) return

  if (!status.ok) {
    // Reporting ready here is what makes VLC open onto a dead stream, so the
    // failure is surfaced instead of being handed to the player.
    const headMb = (status.headDone / (1024 * 1024)).toFixed(1)
    const targetMb = (status.headTarget / (1024 * 1024)).toFixed(1)
    const speedKb = Math.round(status.downloadSpeed / 1024)
    await stop()
    throw new Error(
      `Not enough of this torrent arrived to start playback: ${headMb}/${targetMb} MB of the opening and ` +
        `${status.tailPresent}/${status.tailTotal} tail pieces after ${Math.round(bufferTimeoutMs / 1000)}s ` +
        `(${status.numPeers} peers, ${speedKb} KB/s). Pick a source with more seeders, or raise the ` +
        `buffer timeout in Settings.`,
    )
  }

  releasePrebuffer(torrent, windows)

  send({
    type: 'ready',
    infoHash: torrent.infoHash,
    url,
    port: listenPort,
    name: torrent.name,
    file: { name: file.name, path: file.path, length: file.length },
  })
}

async function shutdown() {
  await stop()
  if (server) {
    try {
      server.closeAllConnections?.()
      server.close()
    } catch {
      /* already closed */
    }
    server = null
  }
  await new Promise((resolve) => client.destroy(() => resolve()))
  process.exit(0)
}

process.on('message', async (message) => {
  try {
    switch (message?.cmd) {
      case 'start':
        await start(message)
        break
      case 'stop': {
        const kept = await stop()
        send({ type: 'stopped', kept })
        break
      }
      case 'shutdown':
        await shutdown()
        break
      default:
        send({ type: 'error', message: `Unknown engine command: ${message?.cmd}` })
    }
  } catch (err) {
    send({ type: 'error', message: err?.message || String(err) })
  }
})

// The parent went away — never leave a swarm running headless.
process.on('disconnect', () => {
  shutdown().catch(() => process.exit(1))
})

send({ type: 'engine-online', pid: process.pid })
