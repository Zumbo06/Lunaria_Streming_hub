// External VLC discovery and launch (SRS 4.4, REQ-4.2 / REQ-4.3).
//
// Orion decodes nothing itself: every resolved source is handed to the host's
// own VLC install as a detached process.

const { spawn, execFile } = require('child_process')
const fs = require('fs')
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
 * Launches VLC on the resolved URL and detaches, so quitting Orion never kills
 * playback and VLC's stdio never blocks the main process (REQ-4.3).
 */
function launch(streamUrl, { vlcPath, networkCaching = 3000, extraArgs = '' } = {}) {
  if (!isExecutableFile(vlcPath)) {
    return Promise.reject(new Error(`VLC executable not found at: ${vlcPath || '(unset)'}`))
  }
  if (!streamUrl) return Promise.reject(new Error('No stream URL to play'))

  const args = [streamUrl, `--network-caching=${Number(networkCaching) || 3000}`, ...tokenizeArgs(extraArgs)]

  return new Promise((resolve, reject) => {
    const child = spawn(vlcPath, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolve({ pid: child.pid, vlcPath, args })
    })
  })
}

function invalidateCache() {
  cachedPath = null
}

module.exports = {
  findVlc,
  launch,
  isExecutableFile,
  normalizeCandidate,
  tokenizeArgs,
  invalidateCache,
}
