// Profiles, watchlist and watch history.
//
// Storage is SQLite through Node's built-in `node:sqlite` — Electron 43 ships
// Node 24, so this costs no dependency and no native rebuild.
//
// Everything that reveals what was watched (titles, ids, posters, profile
// names) is held in an encrypted `payload` blob rather than plain columns, so
// the database file on disk does not read as a viewing history. Only the values
// needed to index and sort — profile id, opaque key hash, timestamps, percent —
// stay in the clear. Item keys are hashed with a per-install random salt so
// they cannot be matched back to a known IMDb id by dictionary.

const { app, safeStorage } = require('electron')
const crypto = require('crypto')
const path = require('path')
const { DatabaseSync } = require('node:sqlite')

const ENC_PREFIX = Buffer.from('ENC1')
const RAW_PREFIX = Buffer.from('RAW1')

let db = null
let salt = null

// ---- Payload encryption ----

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function seal(value) {
  const json = JSON.stringify(value ?? null)
  if (encryptionAvailable()) {
    return Buffer.concat([ENC_PREFIX, safeStorage.encryptString(json)])
  }
  return Buffer.concat([RAW_PREFIX, Buffer.from(json, 'utf8')])
}

function unseal(blob) {
  if (!blob) return null
  const buffer = Buffer.isBuffer(blob) ? blob : Buffer.from(blob)

  try {
    if (buffer.subarray(0, 4).equals(ENC_PREFIX)) {
      return JSON.parse(safeStorage.decryptString(buffer.subarray(4)))
    }
    if (buffer.subarray(0, 4).equals(RAW_PREFIX)) {
      return JSON.parse(buffer.subarray(4).toString('utf8'))
    }
  } catch (err) {
    console.error('[library] Could not read a row payload:', err.message)
  }
  return null
}

/** Opaque, salted lookup key — never the raw catalogue id. */
function keyFor(...parts) {
  return crypto
    .createHash('sha256')
    .update(salt)
    .update(parts.filter(Boolean).join('|'))
    .digest('hex')
}

// ---- Schema ----

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      name TEXT PRIMARY KEY,
      value BLOB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      item_key TEXT NOT NULL,
      payload BLOB NOT NULL,
      added_at INTEGER NOT NULL,
      UNIQUE (profile_id, item_key)
    );

    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL,
      video_key TEXT NOT NULL,
      series_key TEXT,
      payload BLOB NOT NULL,
      position_seconds REAL NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 0,
      percent REAL NOT NULL DEFAULT 0,
      finished INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE (profile_id, video_key)
    );

    CREATE INDEX IF NOT EXISTS idx_watchlist_profile ON watchlist (profile_id, added_at DESC);
    CREATE INDEX IF NOT EXISTS idx_progress_profile ON progress (profile_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_progress_series ON progress (profile_id, series_key);
  `)
}

function loadSalt() {
  const row = db.prepare('SELECT value FROM meta WHERE name = ?').get('salt')
  if (row?.value) {
    const existing = unseal(row.value)
    if (existing) return Buffer.from(existing, 'hex')
  }

  const fresh = crypto.randomBytes(32)
  db.prepare('INSERT OR REPLACE INTO meta (name, value) VALUES (?, ?)').run('salt', seal(fresh.toString('hex')))
  return fresh
}

function init(filePath) {
  if (db) return db

  const target = filePath || path.join(app.getPath('userData'), 'library.db')
  db = new DatabaseSync(target)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

  migrate()
  salt = loadSalt()

  if (listProfiles().length === 0) {
    createProfile({ name: 'Me', avatar: '🍿', color: '#6f8dff' })
  }

  return db
}

function close() {
  try {
    db?.close()
  } catch {
    /* already closed */
  }
  db = null
}

// ---- Profiles ----

function rowToProfile(row) {
  const payload = unseal(row.payload) || {}
  return {
    id: row.id,
    name: payload.name || 'Profile',
    avatar: payload.avatar || '🍿',
    // A picture chosen by the user, held as a data URL inside the encrypted
    // payload so a photo of them never sits unprotected on disk.
    avatarImage: payload.avatarImage || null,
    color: payload.color || '#6f8dff',
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }
}

function listProfiles() {
  return db
    .prepare('SELECT id, payload, created_at, last_used_at FROM profiles ORDER BY last_used_at DESC, id ASC')
    .all()
    .map(rowToProfile)
}

function createProfile({ name, avatar, color, avatarImage }) {
  const now = Date.now()
  const info = db
    .prepare('INSERT INTO profiles (payload, created_at, last_used_at) VALUES (?, ?, ?)')
    .run(
      seal({
        name: (name || 'Profile').slice(0, 40),
        avatar: avatar || '🍿',
        avatarImage: avatarImage || null,
        color: color || '#6f8dff',
      }),
      now,
      now,
    )

  return getProfile(Number(info.lastInsertRowid))
}

function getProfile(id) {
  const row = db.prepare('SELECT id, payload, created_at, last_used_at FROM profiles WHERE id = ?').get(id)
  return row ? rowToProfile(row) : null
}

function updateProfile(id, { name, avatar, color, avatarImage }) {
  const current = getProfile(id)
  if (!current) return null

  db.prepare('UPDATE profiles SET payload = ? WHERE id = ?').run(
    seal({
      name: (name ?? current.name).slice(0, 40),
      avatar: avatar ?? current.avatar,
      // An explicit null clears the picture and falls back to the emoji.
      avatarImage: avatarImage === undefined ? current.avatarImage : avatarImage,
      color: color ?? current.color,
    }),
    id,
  )
  return getProfile(id)
}

function touchProfile(id) {
  db.prepare('UPDATE profiles SET last_used_at = ? WHERE id = ?').run(Date.now(), id)
  return getProfile(id)
}

/** Removes a profile and everything recorded under it. */
function deleteProfile(id) {
  if (listProfiles().length <= 1) {
    throw new Error('At least one profile must remain')
  }
  db.prepare('DELETE FROM watchlist WHERE profile_id = ?').run(id)
  db.prepare('DELETE FROM progress WHERE profile_id = ?').run(id)
  db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
  return listProfiles()
}

// ---- Watchlist ----

function getWatchlist(profileId) {
  return db
    .prepare('SELECT payload, added_at FROM watchlist WHERE profile_id = ? ORDER BY added_at DESC')
    .all(profileId)
    .map((row) => ({ ...(unseal(row.payload) || {}), addedAt: row.added_at }))
    .filter((item) => item.id)
}

function addToWatchlist(profileId, item) {
  const key = keyFor(item.type, item.id)
  db.prepare(
    'INSERT OR REPLACE INTO watchlist (profile_id, item_key, payload, added_at) VALUES (?, ?, ?, ?)',
  ).run(
    profileId,
    key,
    seal({
      type: item.type,
      id: item.id,
      name: item.name || '',
      poster: item.poster || null,
      year: item.releaseInfo || item.year || '',
    }),
    Date.now(),
  )
  return getWatchlist(profileId)
}

function removeFromWatchlist(profileId, type, id) {
  db.prepare('DELETE FROM watchlist WHERE profile_id = ? AND item_key = ?').run(profileId, keyFor(type, id))
  return getWatchlist(profileId)
}

function inWatchlist(profileId, type, id) {
  const row = db
    .prepare('SELECT 1 AS present FROM watchlist WHERE profile_id = ? AND item_key = ?')
    .get(profileId, keyFor(type, id))
  return Boolean(row)
}

// ---- Progress / continue watching ----

const FINISHED_AT = 0.92
const STARTED_AT = 0.01

/**
 * Upserts the position for one video. `videoId` is the episode id for series
 * and the item id for films; `id` always stays the catalogue root so the two
 * can be grouped on the Continue watching row.
 *
 * `source` and `subtitle` record *how* it was watched so the same release can
 * be resumed without asking every addon again. Both ride inside the encrypted
 * payload — a release name is as revealing as a title.
 */
function saveProgress(profileId, entry) {
  const {
    type,
    id,
    videoId,
    name,
    poster,
    season = null,
    episode = null,
    source = null,
    subtitle = null,
    positionSeconds = 0,
    durationSeconds = 0,
  } = entry

  const resolvedVideoId = videoId || id
  const percent = durationSeconds > 0 ? Math.min(1, positionSeconds / durationSeconds) : 0
  const finished = percent >= FINISHED_AT ? 1 : 0

  db.prepare(
    `INSERT INTO progress
       (profile_id, video_key, series_key, payload, position_seconds, duration_seconds, percent, finished, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, video_key) DO UPDATE SET
       payload = excluded.payload,
       position_seconds = excluded.position_seconds,
       duration_seconds = excluded.duration_seconds,
       percent = excluded.percent,
       finished = excluded.finished,
       updated_at = excluded.updated_at`,
  ).run(
    profileId,
    keyFor(type, resolvedVideoId),
    keyFor(type, id),
    seal({
      type,
      id,
      videoId: resolvedVideoId,
      name: name || '',
      poster: poster || null,
      season,
      episode,
      source,
      subtitle,
    }),
    positionSeconds,
    durationSeconds,
    percent,
    finished,
    Date.now(),
  )

  return { percent, finished: Boolean(finished) }
}

function getProgress(profileId, type, videoId) {
  const row = db
    .prepare(
      `SELECT payload, position_seconds, duration_seconds, percent, finished, updated_at
         FROM progress WHERE profile_id = ? AND video_key = ?`,
    )
    .get(profileId, keyFor(type, videoId))

  if (!row) return null
  return {
    ...(unseal(row.payload) || {}),
    positionSeconds: row.position_seconds,
    durationSeconds: row.duration_seconds,
    percent: row.percent,
    finished: Boolean(row.finished),
    updatedAt: row.updated_at,
  }
}

/**
 * Most recent unfinished item per title — a series contributes only its latest
 * episode rather than one entry per episode watched.
 */
function getContinueWatching(profileId, limit = 20) {
  const rows = db
    .prepare(
      `SELECT p.payload, p.position_seconds, p.duration_seconds, p.percent, p.updated_at
         FROM progress p
         JOIN (
           SELECT series_key, MAX(updated_at) AS newest
             FROM progress
            WHERE profile_id = ? AND finished = 0 AND percent > ?
            GROUP BY series_key
         ) latest
           ON p.series_key = latest.series_key AND p.updated_at = latest.newest
        WHERE p.profile_id = ? AND p.finished = 0 AND p.percent > ?
        ORDER BY p.updated_at DESC
        LIMIT ?`,
    )
    .all(profileId, STARTED_AT, profileId, STARTED_AT, limit)

  return rows
    .map((row) => ({
      ...(unseal(row.payload) || {}),
      positionSeconds: row.position_seconds,
      durationSeconds: row.duration_seconds,
      percent: row.percent,
      updatedAt: row.updated_at,
    }))
    .filter((entry) => entry.id)
}

/**
 * The most recently *finished* episode of each series, which is what "up next"
 * is derived from — the episode itself is done, so it no longer belongs on the
 * Continue watching row, but the show may well have another one waiting.
 *
 * Films are excluded: finishing one is the end of it.
 */
function getFinishedSeries(profileId, limit = 8) {
  const rows = db
    .prepare(
      `SELECT p.payload, p.duration_seconds, p.updated_at
         FROM progress p
         JOIN (
           SELECT series_key, MAX(updated_at) AS newest
             FROM progress
            WHERE profile_id = ? AND finished = 1
            GROUP BY series_key
         ) latest
           ON p.series_key = latest.series_key AND p.updated_at = latest.newest
        WHERE p.profile_id = ? AND p.finished = 1
        ORDER BY p.updated_at DESC
        LIMIT ?`,
    )
    .all(profileId, profileId, limit * 3)

  return rows
    .map((row) => ({
      ...(unseal(row.payload) || {}),
      durationSeconds: row.duration_seconds,
      updatedAt: row.updated_at,
    }))
    // `type` only survives inside the payload, so the series filter has to
    // happen here rather than in the query.
    .filter((entry) => entry.id && entry.type === 'series')
    .slice(0, limit)
}

/** Forgets one video: an episode, or a film. */
function clearProgress(profileId, type, videoId) {
  db.prepare('DELETE FROM progress WHERE profile_id = ? AND video_key = ?').run(profileId, keyFor(type, videoId))
  return true
}

/**
 * Forgets a whole series — every episode row, watched or part-watched.
 *
 * Removing a series from Continue watching needs this rather than
 * `clearProgress`. A film has a single row, so deleting it is the end of it; a
 * series has one per episode and the row is fed by two queries. Dropping only
 * the current episode promotes the previous one into its place through
 * `getContinueWatching`, and once the unfinished rows are gone a finished one
 * brings the series straight back as an "Up next" card through
 * `getFinishedSeries`. Both have to go for the card to stay gone.
 */
function clearSeriesProgress(profileId, type, id) {
  const info = db
    .prepare('DELETE FROM progress WHERE profile_id = ? AND series_key = ?')
    .run(profileId, keyFor(type, id))
  return { cleared: Number(info.changes) || 0 }
}

function clearAllProgress(profileId) {
  db.prepare('DELETE FROM progress WHERE profile_id = ?').run(profileId)
  return true
}

// ---- Transfer ----
//
// Everything above keeps payloads sealed with the OS keychain, which is bound
// to this user on this machine — copying `library.db` to another one yields
// rows nothing can decrypt. Moving a profile therefore has to go through
// decrypted values, which is what these two pairs of functions are for.

/** Every watchlist row for a profile, with its original timestamp. */
function exportWatchlist(profileId) {
  return db
    .prepare('SELECT payload, added_at FROM watchlist WHERE profile_id = ? ORDER BY added_at DESC')
    .all(profileId)
    .map((row) => ({ ...(unseal(row.payload) || {}), addedAt: row.added_at }))
    .filter((item) => item.id)
}

/**
 * Every progress row for a profile — not just the unfinished ones
 * `getContinueWatching` returns, since a restored profile should know what it
 * has already watched too.
 */
function exportProgress(profileId) {
  return db
    .prepare(
      `SELECT payload, position_seconds, duration_seconds, percent, finished, updated_at
         FROM progress WHERE profile_id = ? ORDER BY updated_at DESC`,
    )
    .all(profileId)
    .map((row) => ({
      ...(unseal(row.payload) || {}),
      positionSeconds: row.position_seconds,
      durationSeconds: row.duration_seconds,
      percent: row.percent,
      finished: Boolean(row.finished),
      updatedAt: row.updated_at,
    }))
    .filter((entry) => entry.id)
}

/**
 * Restores rows verbatim, timestamps included — `addToWatchlist` and
 * `saveProgress` both stamp "now", which would collapse a restored history into
 * a single moment and scramble the order of Continue watching.
 */
function importWatchlist(profileId, items) {
  const insert = db.prepare(
    'INSERT OR REPLACE INTO watchlist (profile_id, item_key, payload, added_at) VALUES (?, ?, ?, ?)',
  )
  let written = 0

  for (const item of items || []) {
    if (!item?.id || !item?.type) continue
    insert.run(
      profileId,
      keyFor(item.type, item.id),
      seal({
        type: item.type,
        id: item.id,
        name: item.name || '',
        poster: item.poster || null,
        year: item.year || '',
      }),
      Number(item.addedAt) || Date.now(),
    )
    written += 1
  }

  return written
}

function importProgress(profileId, entries) {
  const insert = db.prepare(
    `INSERT INTO progress
       (profile_id, video_key, series_key, payload, position_seconds, duration_seconds, percent, finished, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (profile_id, video_key) DO UPDATE SET
       payload = excluded.payload,
       position_seconds = excluded.position_seconds,
       duration_seconds = excluded.duration_seconds,
       percent = excluded.percent,
       finished = excluded.finished,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at > progress.updated_at`,
  )
  let written = 0

  for (const entry of entries || []) {
    if (!entry?.id || !entry?.type) continue

    const videoId = entry.videoId || entry.id
    const duration = Number(entry.durationSeconds) || 0
    const position = Number(entry.positionSeconds) || 0
    const percent = Number.isFinite(entry.percent)
      ? entry.percent
      : duration > 0
        ? Math.min(1, position / duration)
        : 0

    insert.run(
      profileId,
      keyFor(entry.type, videoId),
      keyFor(entry.type, entry.id),
      seal({
        type: entry.type,
        id: entry.id,
        videoId,
        name: entry.name || '',
        poster: entry.poster || null,
        season: entry.season ?? null,
        episode: entry.episode ?? null,
        source: entry.source || null,
        subtitle: entry.subtitle || null,
      }),
      position,
      duration,
      percent,
      entry.finished || percent >= FINISHED_AT ? 1 : 0,
      Number(entry.updatedAt) || Date.now(),
    )
    written += 1
  }

  return written
}

/** Matches an incoming profile to an existing one by name, for merge imports. */
function findProfileByName(name) {
  return listProfiles().find((profile) => profile.name === name) || null
}

function stats(profileId) {
  const watchlistCount = db
    .prepare('SELECT COUNT(*) AS n FROM watchlist WHERE profile_id = ?')
    .get(profileId)?.n ?? 0
  const inProgress = db
    .prepare('SELECT COUNT(*) AS n FROM progress WHERE profile_id = ? AND finished = 0 AND percent > ?')
    .get(profileId, STARTED_AT)?.n ?? 0
  const finished = db
    .prepare('SELECT COUNT(*) AS n FROM progress WHERE profile_id = ? AND finished = 1')
    .get(profileId)?.n ?? 0

  return { watchlistCount, inProgress, finished, encrypted: encryptionAvailable() }
}

module.exports = {
  init,
  close,
  encryptionAvailable,
  listProfiles,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  touchProfile,
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  inWatchlist,
  saveProgress,
  getProgress,
  getContinueWatching,
  getFinishedSeries,
  clearProgress,
  clearSeriesProgress,
  clearAllProgress,
  exportWatchlist,
  exportProgress,
  importWatchlist,
  importProgress,
  findProfileByName,
  stats,
}
