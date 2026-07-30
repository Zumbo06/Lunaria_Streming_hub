// External VLC discovery and launch (SRS 4.4, REQ-4.2 / REQ-4.3).
//
// Orion decodes nothing itself: every resolved source is handed to the host's
// own VLC install as a detached process.

const { spawn, execFile } = require('child_process')
const crypto = require('crypto')
const fs = require('fs')
const http = require('http')
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

/** `/Applications/VLC.app` is a bundle — the binary lives inside it. */
function normalizeCandidate(candidate) {
  if (!candidate) return null
  if (process.platform === 'darwin' && candidate.endsWith('.app')) {
    return path.join(candidate, 'Contents', 'MacOS', 'VLC')
  }
  return candidate
}

function standardCandidates() {
  const home = os.homedir()

  if (process.platform === 'win32') {
    return [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'VideoLAN', 'VLC', 'vlc.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'VideoLAN', 'VLC', 'vlc.exe'),
      process.env.ProgramW6432 && path.join(process.env.ProgramW6432, 'VideoLAN', 'VLC', 'vlc.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'VideoLAN', 'VLC', 'vlc.exe'),
      'C:\\Program Files\\VideoLAN\\VLC\\vlc.exe',
      'C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe',
    ].filter(Boolean)
  }

  if (process.platform === 'darwin') {
    return [
      '/Applications/VLC.app/Contents/MacOS/VLC',
      path.join(home, 'Applications', 'VLC.app', 'Contents', 'MacOS', 'VLC'),
      '/usr/local/bin/vlc',
      '/opt/homebrew/bin/vlc',
    ]
  }

  return [
    '/usr/bin/vlc',
    '/usr/local/bin/vlc',
    '/bin/vlc',
    '/snap/bin/vlc',
    '/var/lib/flatpak/exports/bin/org.videolan.VLC',
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'bin', 'org.videolan.VLC'),
  ]
}

/** Windows installers record the install directory in the registry. */
function fromWindowsRegistry() {
  if (process.platform !== 'win32') return Promise.resolve(null)

  const keys = ['HKLM\\SOFTWARE\\VideoLAN\\VLC', 'HKLM\\SOFTWARE\\WOW6432Node\\VideoLAN\\VLC']

  const queryKey = (key) =>
    new Promise((resolve) => {
      execFile('reg', ['query', key, '/v', 'InstallDir'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(null)
        const match = stdout.match(/InstallDir\s+REG_SZ\s+(.+)/i)
        if (!match) return resolve(null)
        resolve(path.join(match[1].trim(), 'vlc.exe'))
      })
    })

  return keys
    .reduce(
      (chain, key) => chain.then((found) => (found ? found : queryKey(key))),
      Promise.resolve(null),
    )
    .then((found) => (isExecutableFile(found) ? found : null))
}

/** Last resort: whatever is on PATH. */
function fromPath() {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which'
    execFile(finder, ['vlc'], { windowsHide: true }, (err, stdout) => {
      if (err || !stdout) return resolve(null)
      const first = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      resolve(isExecutableFile(first) ? first : null)
    })
  })
}

/**
 * Resolution order: the user's explicit override, then the standard install
 * locations for this platform, then the registry, then PATH.
 */
async function findVlc(overridePath) {
  const override = normalizeCandidate(overridePath)
  if (isExecutableFile(override)) return override

  if (cachedPath && isExecutableFile(cachedPath)) return cachedPath

  for (const candidate of standardCandidates()) {
    if (isExecutableFile(candidate)) {
      cachedPath = candidate
      return candidate
    }
  }

  const registryHit = await fromWindowsRegistry()
  if (registryHit) {
    cachedPath = registryHit
    return registryHit
  }

  const pathHit = await fromPath()
  if (pathHit) {
    cachedPath = pathHit
    return pathHit
  }

  return null
}

/** Splits a user-supplied extra-args string, honouring quoted segments. */
function tokenizeArgs(input) {
  if (!input || typeof input !== 'string') return []
  const matches = input.match(/"[^"]*"|'[^']*'|\S+/g) || []
  return matches.map((token) => token.replace(/^["']|["']$/g, ''))
}

/**
 * VLC 3's HDR story is passthrough-only: there are no tone-mapping controls,
 * and HDR reaches the panel only when the Direct3D11 output is used *and* the
 * Windows desktop is already in HDR mode. These flags select that path and the
 * matching hardware decoder; they do not create HDR where the display has none.
 * mpv is the better choice when real colour management is wanted.
 */
function hdrArgs() {
  if (process.platform !== 'win32') return []
  return ['--vout=direct3d11', '--avcodec-hw=d3d11va']
}

function findFreePort(preferred) {
  return new Promise((resolve) => {
    const tester = net.createServer()
    tester.once('error', () => resolve(preferred + Math.floor(Math.random() * 500) + 1))
    tester.once('listening', () => {
      const { port } = tester.address()
      tester.close(() => resolve(port))
    })
    tester.listen(0, '127.0.0.1')
  })
}

/**
 * Launches VLC on the resolved URL and detaches, so quitting Orion never kills
 * playback and VLC's stdio never blocks the main process (REQ-4.3).
 *
 * VLC's HTTP control interface is enabled on a loopback-bound random port with
 * a random per-session password. That is the only way to learn the real
 * playback position — Orion never decodes the media, so without it there is
 * nothing to resume from.
 */
async function launch(
  streamUrl,
  {
    vlcPath,
    networkCaching = 3000,
    extraArgs = '',
    startTimeSeconds = 0,
    enableControl = true,
    subtitleFile = null,
    hdr = null,
    audioLanguages = [],
    subtitleLanguages = [],
  } = {},
) {
  if (!isExecutableFile(vlcPath)) {
    throw new Error(`VLC executable not found at: ${vlcPath || '(unset)'}`)
  }
  if (!streamUrl) throw new Error('No stream URL to play')

  const args = [streamUrl, `--network-caching=${Number(networkCaching) || 3000}`]

  // Picks the matching track out of a multi-audio file rather than track one.
  if (audioLanguages.length > 0) args.push(`--audio-language=${audioLanguages.join(',')}`)
  if (subtitleLanguages.length > 0) args.push(`--sub-language=${subtitleLanguages.join(',')}`)

  if (hdr?.isHdr) args.push(...hdrArgs())

  let control = null
  if (enableControl) {
    control = {
      port: await findFreePort(18080),
      password: crypto.randomBytes(16).toString('hex'),
    }
    args.push(
      '--extraintf', 'http',
      '--http-host', '127.0.0.1',
      '--http-port', String(control.port),
      '--http-password', control.password,
    )
  }

  if (startTimeSeconds > 0) args.push(`--start-time=${Math.floor(startTimeSeconds)}`)

  // --sub-file takes a local path only, and --sub-autodetect-file would
  // otherwise pull in unrelated .srt files sitting in the download folder.
  if (subtitleFile && fs.existsSync(subtitleFile)) {
    args.push(`--sub-file=${subtitleFile}`, '--no-sub-autodetect-file')
  }

  args.push(...tokenizeArgs(extraArgs))

  return new Promise((resolve, reject) => {
    const child = spawn(vlcPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ pid: child.pid, vlcPath, args, control })
    })
  })
}

/**
 * Reads VLC's playback state. Resolves null whenever the interface is not
 * answering — VLC closed, still starting, or built without the http module —
 * so callers treat "unknown" and "stopped" distinctly.
 */
function readStatus(control, timeoutMs = 2500) {
  if (!control) return Promise.resolve(null)

  return new Promise((resolve) => {
    const req = http.get(
      {
        host: '127.0.0.1',
        port: control.port,
        path: '/requests/status.xml',
        auth: `:${control.password}`,
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          return resolve(null)
        }

        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          body += chunk
          if (body.length > 512 * 1024) req.destroy()
        })
        res.on('end', () => resolve(parseStatus(body)))
      },
    )

    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
  })
}

/** VLC's status.xml is small and fixed-shape; a parser dependency is overkill. */
function parseStatus(xml) {
  const pick = (tag) => {
    const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)
    return match ? match[1].trim() : null
  }

  const state = pick('state')
  if (!state) return null

  const time = Number(pick('time'))
  const length = Number(pick('length'))
  const position = Number(pick('position'))

  return {
    state, // playing | paused | stopped
    timeSeconds: Number.isFinite(time) && time >= 0 ? time : 0,
    lengthSeconds: Number.isFinite(length) && length > 0 ? length : 0,
    position: Number.isFinite(position) ? position : 0,
  }
}

function invalidateCache() {
  cachedPath = null
}

module.exports = {
  findVlc,
  launch,
  readStatus,
  parseStatus,
  hdrArgs,
  isExecutableFile,
  normalizeCandidate,
  tokenizeArgs,
  invalidateCache,
}
