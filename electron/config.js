const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

// Addon manifest URLs routinely carry Debrid API tokens in the path itself
// (Torrentio encodes the key as a URL segment), so the addon list is encrypted
// at rest through the OS keychain whenever one is reachable. Non-sensitive
// settings stay in plain config.json so they remain hand-editable.
const DEFAULT_SETTINGS = {
  // 'midnight' (default blue-grey) or 'oled' (true black, lifted contrast).
  theme: 'midnight',
  // VLC by default: it is the assumed dependency in the spec, and mpv is only
  // selectable once it is actually installed.
  player: 'vlc',
  vlcPath: null,
  mpvPath: null,
  // auto applies HDR arguments only to releases that advertise HDR.
  hdrMode: 'auto',
  // Announce HDR to the display. Independent of the curve below.
  hdrPassthrough: true,
  // Curve applied to whatever mapping is still needed. `clip` leaves it to the
  // display; a named curve (bt.2446a, st2094-40, …) has mpv do the work.
  hdrToneMap: 'clip',
  // Extra mpv.conf lines kept inside the managed HDR block across rewrites.
  mpvHdrOptions: '',
  networkCaching: 3000,
  vlcExtraArgs: '',
  mpvExtraArgs: '',
  enginePort: 8080,
  downloadDir: null,
  keepDownloads: false,
  addonTimeoutMs: 8000,
  trackProgress: true,
  resumePlayback: true,
  // What clicking a Continue watching card does: 'play' starts the release that
  // was watched last time, 'highlight' opens the title with it marked.
  resumeAction: 'play',
  // Start the next episode when one finishes, after a cancellable countdown.
  autoPlayNext: true,
  preferredSubtitleLanguages: ['English'],
  // Ordered: sources carrying the first available language rank highest, and
  // the detail panel filters to it when anything matches.
  preferredAudioLanguages: [],
  // Keep `lunaria-config.json` in the userData folder up to date, so a fresh
  // install can be handed one and come up as this one. It holds profiles,
  // watch history and addon URLs in clear text — see transfer.js.
  autoBackup: true,
  headBufferBytes: 4 * 1024 * 1024,
  tailBufferBytes: 8 * 1024 * 1024,
  readaheadBytes: 24 * 1024 * 1024,
  bufferTimeoutMs: 120000,
}

const DEFAULT_ADDONS = [
  { manifestUrl: 'https://v3-cinemeta.strem.io/manifest.json', enabled: true },
  { manifestUrl: 'https://torrentio.strem.fun/manifest.json', enabled: true },
]

function userDataDir() {
  return app.getPath('userData')
}

function settingsPath() {
  return path.join(userDataDir(), 'config.json')
}

function addonsEncPath() {
  return path.join(userDataDir(), 'addons.enc')
}

function addonsPlainPath() {
  return path.join(userDataDir(), 'addons.json')
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    console.error(`[config] Unreadable ${path.basename(file)}, using defaults:`, err.message)
    return fallback
  }
}

// ---- Settings ----

function getSettings() {
  const stored = readJson(settingsPath(), {})
  const merged = { ...DEFAULT_SETTINGS, ...stored, version: undefined }

  // `hdrToneMap: 'passthrough'` used to mean both "announce HDR" and "no
  // curve". Those are separate settings now.
  if (merged.hdrToneMap === 'passthrough') {
    merged.hdrPassthrough = true
    merged.hdrToneMap = 'clip'
  }

  return merged
}

function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch }
  delete merged.version
  fs.writeFileSync(settingsPath(), JSON.stringify({ version: 1, ...merged }, null, 2), 'utf8')
  return merged
}

// ---- Addons ----

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function getAddons() {
  if (encryptionAvailable() && fs.existsSync(addonsEncPath())) {
    try {
      const decrypted = safeStorage.decryptString(fs.readFileSync(addonsEncPath()))
      return JSON.parse(decrypted)
    } catch (err) {
      console.error('[config] Could not decrypt addons.enc:', err.message)
      return [...DEFAULT_ADDONS]
    }
  }

  if (fs.existsSync(addonsPlainPath())) {
    return readJson(addonsPlainPath(), [...DEFAULT_ADDONS])
  }

  // First run.
  return [...DEFAULT_ADDONS]
}

function saveAddons(addons) {
  const payload = JSON.stringify(addons, null, 2)

  if (encryptionAvailable()) {
    fs.writeFileSync(addonsEncPath(), safeStorage.encryptString(payload))
    // Drop any plaintext left behind by an earlier run without a keychain.
    if (fs.existsSync(addonsPlainPath())) fs.unlinkSync(addonsPlainPath())
  } else {
    fs.writeFileSync(addonsPlainPath(), payload, 'utf8')
  }

  return addons
}

/**
 * Hide credential-looking path segments before a manifest URL reaches the UI or
 * a log line. Torrentio's configured URLs look like
 *   https://torrentio.strem.fun/realdebrid=AB12CD.../manifest.json
 * so any segment holding a long token or a `key=value` pair is masked.
 */
function maskUrl(url) {
  if (typeof url !== 'string') return ''
  try {
    const parsed = new URL(url)
    const masked = parsed.pathname
      .split('/')
      .map((segment) => {
        if (!segment || segment === 'manifest.json') return segment
        return segment.replace(/([^|=,]{0,24}=)?([A-Za-z0-9_-]{16,})/g, (_, prefix = '') => `${prefix}••••••`)
      })
      .join('/')
    return `${parsed.origin}${masked}`
  } catch {
    return url
  }
}

function hasSecret(url) {
  return maskUrl(url) !== url
}

module.exports = {
  DEFAULT_SETTINGS,
  DEFAULT_ADDONS,
  getSettings,
  saveSettings,
  getAddons,
  saveAddons,
  maskUrl,
  hasSecret,
  encryptionAvailable,
  userDataDir,
}
