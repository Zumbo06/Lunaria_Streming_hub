// Portable snapshot of an install: profiles, their watchlists and history, the
// settings, and the addon list.
//
// It exists because none of that survives a copy on its own. Settings live in
// plain `config.json`, but the addon list is sealed into `addons.enc` and every
// library payload is sealed too — both through the OS keychain, which is bound
// to one user on one machine. `library.db` carried to a new install decrypts to
// nothing. So the transfer file holds decrypted values, and that is the whole
// point of it: it is readable anywhere.
//
// The cost of that is real and worth stating plainly. This file contains, in
// clear text, what has been watched and how far, and the addon manifest URLs —
// which for Torrentio and friends carry a Debrid API token in the path. It is
// written inside the app's own userData folder, no worse protected than the
// rest of it, but it is the one artefact here designed to be copied around.
// `autoBackup: false` in settings turns the automatic writing off.

const { app } = require('electron')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const config = require('./config')
const library = require('./library')

const FILE_NAME = 'lunaria-config.json'
const FORMAT_VERSION = 1

// Progress is written every few seconds while something plays, and each write
// would otherwise re-serialise the whole history. Coalescing to one write per
// quarter-minute keeps the file current without turning playback into disk
// churn; a flush on quit closes the remaining gap.
const IDLE_MS = 15000

let timer = null
let dirty = false
let lastDigest = null
let lastSavedAt = null

function defaultPath() {
  return path.join(app.getPath('userData'), FILE_NAME)
}

/** True on an install that has never written settings — a genuinely fresh one. */
function isFreshInstall() {
  return !fs.existsSync(path.join(app.getPath('userData'), 'config.json'))
}

// ---- Building ----

function buildSnapshot() {
  const profiles = library.listProfiles().map((profile) => ({
    name: profile.name,
    avatar: profile.avatar,
    avatarImage: profile.avatarImage,
    color: profile.color,
    createdAt: profile.createdAt,
    lastUsedAt: profile.lastUsedAt,
    watchlist: library.exportWatchlist(profile.id),
    progress: library.exportProgress(profile.id),
  }))

  return {
    app: 'Lunaria',
    version: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: app.getVersion(),
    platform: process.platform,
    settings: config.getSettings(),
    addons: config.getAddons().map((addon) => ({
      manifestUrl: addon.manifestUrl,
      name: addon.name || null,
      enabled: addon.enabled !== false,
    })),
    profiles,
  }
}

/** What the UI reports about a snapshot without having to show its contents. */
function describe(snapshot) {
  return {
    exportedAt: snapshot?.exportedAt || null,
    appVersion: snapshot?.appVersion || null,
    platform: snapshot?.platform || null,
    addonCount: (snapshot?.addons || []).length,
    profiles: (snapshot?.profiles || []).map((profile) => ({
      name: profile.name,
      watchlistCount: (profile.watchlist || []).length,
      progressCount: (profile.progress || []).length,
    })),
  }
}

// ---- Writing ----

/**
 * Written through a temp file: a crash mid-write cannot then leave a truncated
 * config where a valid one used to be, which for the one file meant to rescue
 * an install would be a poor way to fail.
 */
function atomicWrite(target, json) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const scratch = `${target}.tmp`
  fs.writeFileSync(scratch, json, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(scratch, target)
  return { path: target, bytes: Buffer.byteLength(json) }
}

/** Writes a copy wherever the caller asks, outside the auto-save bookkeeping. */
function writeTo(target) {
  const snapshot = buildSnapshot()
  return { ...atomicWrite(target, JSON.stringify(snapshot, null, 2)), snapshot }
}

function saveNow({ force = false } = {}) {
  if (!force && config.getSettings().autoBackup === false) return null

  try {
    const snapshot = buildSnapshot()

    // `exportedAt` changes on every build, so the digest deliberately ignores
    // it — otherwise nothing would ever look unchanged and an idle app would
    // rewrite the file forever.
    const { exportedAt, ...stable } = snapshot
    const digest = crypto.createHash('sha1').update(JSON.stringify(stable)).digest('hex')
    if (!force && digest === lastDigest) {
      dirty = false
      return null
    }

    const written = atomicWrite(defaultPath(), JSON.stringify(snapshot, null, 2))
    lastDigest = digest
    lastSavedAt = Date.now()
    dirty = false
    return written
  } catch (err) {
    console.error('[transfer] Could not write the transfer file:', err.message)
    return null
  }
}

/** Marks the snapshot stale; the write itself happens once things go quiet. */
function scheduleSave() {
  dirty = true
  if (timer) return

  timer = setTimeout(() => {
    timer = null
    if (dirty) saveNow()
  }, IDLE_MS)
}

function flush() {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (dirty) saveNow()
}

function status() {
  const target = defaultPath()
  let exists = false
  let bytes = 0
  let modifiedAt = null

  try {
    const info = fs.statSync(target)
    exists = true
    bytes = info.size
    modifiedAt = info.mtimeMs
  } catch {
    /* never written yet */
  }

  return {
    path: target,
    exists,
    bytes,
    modifiedAt,
    lastSavedAt,
    autoBackup: config.getSettings().autoBackup !== false,
  }
}

// ---- Reading ----

function read(file) {
  const source = file || defaultPath()
  const raw = fs.readFileSync(source, 'utf8')

  let snapshot
  try {
    snapshot = JSON.parse(raw)
  } catch (err) {
    throw new Error(`That file is not valid JSON: ${err.message}`)
  }

  if (!snapshot || typeof snapshot !== 'object') throw new Error('That file does not hold a config object')
  if (snapshot.app && snapshot.app !== 'Lunaria') throw new Error(`That config was written by ${snapshot.app}`)
  if (Number(snapshot.version) > FORMAT_VERSION) {
    throw new Error(`That config is version ${snapshot.version}; this build understands up to ${FORMAT_VERSION}`)
  }
  if (!Array.isArray(snapshot.profiles) && !Array.isArray(snapshot.addons) && !snapshot.settings) {
    throw new Error('That config holds no profiles, addons or settings')
  }

  return snapshot
}

/**
 * Settings that describe *this machine* rather than the user's preferences.
 * Carrying an mpv path or a download folder from another computer would point
 * the app at something that is not there, so they are dropped on import and the
 * local values kept.
 */
const MACHINE_SETTINGS = ['vlcPath', 'mpvPath', 'downloadDir', 'enginePort']

function importableSettings(incoming) {
  const settings = { ...(incoming || {}) }
  for (const key of MACHINE_SETTINGS) delete settings[key]
  delete settings.version
  return settings
}

/**
 * Writes a snapshot into this install.
 *
 * `merge` (the default) keeps what is already here: profiles are matched by
 * name and their history unioned, and an addon already installed is left alone.
 * `replace` is for a fresh install adopting a config wholesale — every profile
 * in the snapshot is created and any profile already here is removed once they
 * exist, so the auto-created "Me" does not linger beside the real ones.
 */
function applySnapshot(snapshot, { mode = 'merge' } = {}) {
  const summary = { profiles: 0, watchlist: 0, progress: 0, addons: 0, settings: false, removedProfiles: 0 }
  const existingIds = library.listProfiles().map((profile) => profile.id)

  if (snapshot.settings) {
    config.saveSettings(importableSettings(snapshot.settings))
    summary.settings = true
  }

  if (Array.isArray(snapshot.addons) && snapshot.addons.length > 0) {
    // Stored as bare records: the next hydrate fetches the real manifests and
    // fills in resources, catalogs and types.
    const incoming = snapshot.addons
      .filter((addon) => addon?.manifestUrl)
      .map((addon) => ({
        manifestUrl: addon.manifestUrl,
        name: addon.name || null,
        enabled: addon.enabled !== false,
      }))

    if (mode === 'replace') {
      // `getAddons` answers a fresh install with the stock defaults, so merging
      // here would leave the plain Torrentio sitting beside the user's
      // configured one — two entries for the same addon, one of them useless.
      // A replace takes the snapshot's list as the whole truth, in its order.
      config.saveAddons(incoming)
      summary.addons = incoming.length
    } else {
      const current = config.getAddons()
      const known = new Set(current.map((addon) => addon.manifestUrl))

      for (const addon of incoming) {
        if (known.has(addon.manifestUrl)) continue
        current.push(addon)
        known.add(addon.manifestUrl)
        summary.addons += 1
      }

      if (summary.addons > 0) config.saveAddons(current)
    }
  }

  for (const incoming of snapshot.profiles || []) {
    if (!incoming?.name) continue

    const existing = mode === 'merge' ? library.findProfileByName(incoming.name) : null
    const profile =
      existing ||
      library.createProfile({
        name: incoming.name,
        avatar: incoming.avatar,
        color: incoming.color,
        avatarImage: incoming.avatarImage || null,
      })

    if (existing) {
      library.updateProfile(existing.id, {
        avatar: incoming.avatar,
        color: incoming.color,
        avatarImage: incoming.avatarImage || existing.avatarImage,
      })
    }

    summary.profiles += 1
    summary.watchlist += library.importWatchlist(profile.id, incoming.watchlist)
    summary.progress += library.importProgress(profile.id, incoming.progress)
  }

  if (mode === 'replace' && summary.profiles > 0) {
    for (const id of existingIds) {
      try {
        library.deleteProfile(id)
        summary.removedProfiles += 1
      } catch {
        // `deleteProfile` refuses to remove the last one, which is the right
        // answer if the snapshot turned out to carry no usable profiles.
      }
    }
  }

  // The install now differs from whatever is on disk.
  saveNow({ force: true })
  return summary
}

/**
 * A fresh install that finds a transfer file beside it adopts it. This is what
 * makes the file worth having: drop it into the userData folder before first
 * launch and the new machine comes up as the old one. Anything with settings
 * already written is left strictly alone.
 */
function adoptIfFresh() {
  if (!isFreshInstall()) return null

  const target = defaultPath()
  if (!fs.existsSync(target)) return null

  try {
    const snapshot = read(target)
    const summary = applySnapshot(snapshot, { mode: 'replace' })
    console.log(
      `[transfer] Fresh install adopted ${FILE_NAME}: ` +
        `${summary.profiles} profiles, ${summary.addons} addons, ${summary.progress} history rows`,
    )
    return summary
  } catch (err) {
    console.error(`[transfer] Could not adopt ${FILE_NAME}:`, err.message)
    return null
  }
}

module.exports = {
  FILE_NAME,
  FORMAT_VERSION,
  defaultPath,
  isFreshInstall,
  buildSnapshot,
  describe,
  writeTo,
  saveNow,
  scheduleSave,
  flush,
  status,
  read,
  applySnapshot,
  adoptIfFresh,
}
