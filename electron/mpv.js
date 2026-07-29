// mpv player driver.
//
// mpv is the better target for HDR: unlike VLC 3, it exposes real control over
// colour management and tone mapping through libplacebo, so a Dolby Vision or
// HDR10+ release can be passed through to an HDR display or tone-mapped down
// to SDR deliberately rather than by accident.
//
// Playback position comes from mpv's JSON IPC over a Windows named pipe (a unix
// socket elsewhere), which is the equivalent of VLC's HTTP interface.

const { spawn, execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')

let cachedPath = null

function isExecutableFile(candidate) {
  try {
    return Boolean(candidate) && fs.statSync(candidate).isFile()
  } catch {
    return false
  }
}

const BINARY = process.platform === 'win32' ? 'mpv.exe' : 'mpv'

/**
 * Portable builds ship as a versioned folder (`mpv-x86_64-20260728-git-…`)
 * dropped wherever the user keeps programs, so there is no fixed path to look
 * up. Windows builds also include `mpv.com`, a console wrapper that opens a
 * stray terminal window — `mpv.exe` is always the one to launch.
 */
function normalizeCandidate(candidate) {
  if (!candidate) return null

  if (process.platform === 'win32' && candidate.toLowerCase().endsWith('mpv.com')) {
    const sibling = path.join(path.dirname(candidate), 'mpv.exe')
    if (isExecutableFile(sibling)) return sibling
  }

  if (process.platform === 'darwin' && candidate.endsWith('.app')) {
    return path.join(candidate, 'Contents', 'MacOS', 'mpv')
  }

  return candidate
}

// Directories never worth walking into while hunting for a portable build.
const SKIP_DIRS = new Set([
  'windows', '$recycle.bin', 'system volume information', 'node_modules',
  'appdata', 'onedrive', '.git', 'perflogs',
])

function portableRoots() {
  const home = os.homedir()
  const roots = [
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Documents'),
    home,
    // Beside Orion itself, so the whole thing can live on a stick.
    path.join(__dirname, '..'),
    path.join(__dirname, '..', 'players'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs'),
  ]

  if (process.platform === 'win32') roots.push('C:\\')
  return roots.filter(Boolean)
}

function exeIn(dir) {
  const candidate = path.join(dir, BINARY)
  return isExecutableFile(candidate) ? candidate : null
}

/**
 * Looks for `mpv*` folders holding the binary, checking each root's children
 * and their children — enough to find `Desktop/Programlar/mpv-x86_64-…/mpv.exe`
 * without walking the whole disk.
 */
function scanPortable() {
  const found = []

  for (const root of portableRoots()) {
    let entries
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue

      const dir = path.join(root, entry.name)

      if (/^mpv/i.test(entry.name)) {
        const direct = exeIn(dir)
        if (direct) found.push(direct)
        continue
      }

      let children
      try {
        children = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const child of children) {
        if (!child.isDirectory() || !/^mpv/i.test(child.name)) continue
        const nested = exeIn(path.join(dir, child.name))
        if (nested) found.push(nested)
      }
    }
  }

  return found
}

/** Confirms a path really is mpv, and reports its version. */
function verify(candidate) {
  return new Promise((resolve) => {
    if (!isExecutableFile(candidate)) return resolve({ ok: false, error: 'No executable at that path' })

    execFile(candidate, ['--no-config', '--version'], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      const output = String(stdout || '')
      const match = /^mpv\s+(v?[\w.\-+]+)/im.exec(output)

      if (err && !match) return resolve({ ok: false, error: err.message })
      if (!match) return resolve({ ok: false, error: 'That executable did not identify itself as mpv' })

      const placebo = /libplacebo version:\s*(\S+)/i.exec(output)
      resolve({ ok: true, version: match[1], libplacebo: placebo ? placebo[1] : null })
    })
  })
}

function standardCandidates() {
  const home = os.homedir()

  if (process.platform === 'win32') {
    return [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'mpv', 'mpv.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'mpv', 'mpv.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'mpv', 'mpv.exe'),
      // scoop, chocolatey and winget all park a shim somewhere different.
      path.join(home, 'scoop', 'apps', 'mpv', 'current', 'mpv.exe'),
      path.join(home, 'scoop', 'shims', 'mpv.exe'),
      process.env.ProgramData && path.join(process.env.ProgramData, 'chocolatey', 'bin', 'mpv.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'mpv.exe'),
      'C:\\mpv\\mpv.exe',
    ].filter(Boolean)
  }

  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin/mpv',
      '/usr/local/bin/mpv',
      '/Applications/mpv.app/Contents/MacOS/mpv',
      path.join(home, 'Applications', 'mpv.app', 'Contents', 'MacOS', 'mpv'),
    ]
  }

  return [
    '/usr/bin/mpv',
    '/usr/local/bin/mpv',
    '/snap/bin/mpv',
    '/var/lib/flatpak/exports/bin/io.mpv.Mpv',
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'bin', 'io.mpv.Mpv'),
  ]
}

function fromPath() {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    execFile(finder, ['mpv'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      resolve(isExecutableFile(first) ? first : null)
    })
  })
}

async function findMpv(overridePath) {
  const override = normalizeCandidate(overridePath)
  if (isExecutableFile(override)) return override

  if (cachedPath && isExecutableFile(cachedPath)) return cachedPath

  for (const candidate of standardCandidates()) {
    if (isExecutableFile(candidate)) {
      cachedPath = candidate
      return candidate
    }
  }

  const onPath = await fromPath()
  if (onPath) {
    cachedPath = onPath
    return onPath
  }

  // Nothing installed the usual way — look for an extracted portable build.
  const [portable] = scanPortable()
  if (portable) {
    cachedPath = portable
    return portable
  }

  return null
}

function invalidateCache() {
  cachedPath = null
}

function tokenizeArgs(input) {
  if (!input || typeof input !== 'string') return []
  const matches = input.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map((token) => token.replace(/^["']|["']$/g, ''))
}

// ---- HDR ----

/**
 * mpv's HDR arguments. `gpu-next` is libplacebo-backed and handles Dolby Vision
 * and HDR10+ dynamic metadata far better than the older `gpu` output, so it is
 * preferred; mpv falls back on its own if the build lacks it.
 *
 * passthrough  — send HDR to the display untouched. Correct on an HDR monitor.
 * tone-mapped  — map HDR down to SDR with a named curve, for an SDR display.
 */
function hdrArgs({ hdrFormat, toneMap = 'passthrough' }) {
  // mpv decodes in software unless told otherwise, which is punishing for the
  // 4K HEVC that HDR releases almost always are.
  const args = ['--vo=gpu-next', '--hwdec=auto-safe']

  if (process.platform === 'win32') args.push('--gpu-api=d3d11')

  if (toneMap === 'passthrough') {
    // Hands the display the source colorimetry and HDR metadata as-is.
    args.push('--target-colorspace-hint=yes')
  } else {
    args.push(`--tone-mapping=${toneMap}`, '--hdr-compute-peak=yes')
  }

  // Dolby Vision deliberately gets no extra flag: libplacebo applies the
  // dynamic metadata itself under gpu-next, and mpv exposes no DV-specific
  // option to set. Selecting gpu-next above is what enables it.
  void hdrFormat

  return args
}

// ---- Launch ----

function ipcPipePath() {
  const id = crypto.randomBytes(8).toString('hex')
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\orion-mpv-${id}`
    : path.join(os.tmpdir(), `orion-mpv-${id}.sock`)
}

async function launch(
  streamUrl,
  {
    mpvPath,
    networkCaching = 3000,
    extraArgs = '',
    startTimeSeconds = 0,
    enableControl = true,
    subtitleFile = null,
    hdr = null,
    hdrToneMap = 'passthrough',
    title = null,
  } = {},
) {
  if (!isExecutableFile(mpvPath)) throw new Error(`mpv executable not found at: ${mpvPath || '(unset)'}`)
  if (!streamUrl) throw new Error('No stream URL to play')

  const args = [
    streamUrl,
    // mpv takes its network buffer in seconds, not milliseconds.
    `--cache-secs=${Math.max(1, Math.round(Number(networkCaching) / 1000) || 3)}`,
    '--cache=yes',
    '--force-seekable=yes',
  ]

  if (hdr?.isHdr) args.push(...hdrArgs({ hdrFormat: hdr.format, toneMap: hdrToneMap }))
  if (startTimeSeconds > 0) args.push(`--start=${Math.floor(startTimeSeconds)}`)
  if (subtitleFile && fs.existsSync(subtitleFile)) args.push(`--sub-file=${subtitleFile}`, '--sub-auto=no')
  if (title) args.push(`--force-media-title=${title}`)

  let control = null
  if (enableControl) {
    control = { pipe: ipcPipePath() }
    args.push(`--input-ipc-server=${control.pipe}`)
  }

  args.push(...tokenizeArgs(extraArgs))

  return new Promise((resolve, reject) => {
    const child = spawn(mpvPath, args, { detached: true, stdio: 'ignore', windowsHide: false })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ pid: child.pid, playerPath: mpvPath, args, control })
    })
  })
}

// ---- Status over JSON IPC ----

/**
 * Asks mpv for the current position and duration. Resolves null when the pipe
 * is not answering — mpv closed, or still starting — so the caller can tell
 * "gone" from "paused".
 */
function readStatus(control, timeoutMs = 2500) {
  if (!control?.pipe) return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {
        /* already gone */
      }
      resolve(value)
    }

    const socket = net.connect({ path: control.pipe })
    const timer = setTimeout(() => finish(null), timeoutMs)

    const wanted = ['time-pos', 'duration', 'pause']
    const answers = {}
    let buffer = ''

    socket.on('connect', () => {
      wanted.forEach((property, index) => {
        socket.write(`${JSON.stringify({ command: ['get_property', property], request_id: index })}\n`)
      })
    })

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')

      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (!line) continue

        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }

        // Property change events also arrive here; only replies carry request_id.
        if (typeof message.request_id !== 'number') continue
        answers[wanted[message.request_id]] = message.error === 'success' ? message.data : null

        if (Object.keys(answers).length === wanted.length) {
          clearTimeout(timer)
          const time = Number(answers['time-pos'])
          const length = Number(answers.duration)

          finish({
            state: answers.pause === true ? 'paused' : 'playing',
            timeSeconds: Number.isFinite(time) && time >= 0 ? time : 0,
            lengthSeconds: Number.isFinite(length) && length > 0 ? length : 0,
            position: Number.isFinite(time) && Number.isFinite(length) && length > 0 ? time / length : 0,
          })
        }
      }
    })

    socket.on('error', () => {
      clearTimeout(timer)
      finish(null)
    })
    socket.on('close', () => {
      clearTimeout(timer)
      finish(null)
    })
  })
}

module.exports = {
  findMpv,
  launch,
  readStatus,
  hdrArgs,
  verify,
  scanPortable,
  normalizeCandidate,
  isExecutableFile,
  tokenizeArgs,
  invalidateCache,
}
