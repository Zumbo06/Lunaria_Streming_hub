const { app, safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

// Addon manifest URLs routinely carry Debrid API tokens in the path itself
// (Torrentio encodes the key as a URL segment), so the addon list is encrypted
// at rest through the OS keychain whenever one is reachable. Non-sensitive
// settings stay in plain config.json so they remain hand-editable.
const DEFAULT_SETTINGS = {
  vlcPath: null,
  networkCaching: 3000,
  vlcExtraArgs: '',
  enginePort: 8080,
  downloadDir: null,
  keepDownloads: false,
  addonTimeoutMs: 8000,
  trackProgress: true,
  resumePlayback: true,
  preferredSubtitleLanguages: ['English'],
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
  return { ...DEFAULT_SETTINGS, ...stored, version: undefined }
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
