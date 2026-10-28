// Thin wrapper over the preload bridge. Every call funnels through here so the
// pages never touch `window.orion` directly and so opening the Vite dev server
// in a plain browser fails loudly instead of throwing "undefined" deep in a
// component.

const bridge = typeof window !== 'undefined' ? window.orion : undefined

export const isDesktop = Boolean(bridge)

function required() {
  throw new Error(
    'Lunaria’s desktop bridge is unavailable. Launch the app with `npm run dev` from the project root rather than opening the Vite URL in a browser.',
  )
}

const noBridge = new Proxy({}, { get: () => required })

const api = bridge || {
  app: noBridge,
  settings: noBridge,
  addons: noBridge,
  catalog: noBridge,
  search: noBridge,
  meta: noBridge,
  streams: noBridge,
  subtitles: noBridge,
  play: noBridge,
  profiles: noBridge,
  watchlist: noBridge,
  progress: noBridge,
  engine: noBridge,
  players: noBridge,
  vlc: noBridge,
  transfer: noBridge,
  downloads: noBridge,
}

export const appApi = api.app
export const settingsApi = api.settings
export const addonsApi = api.addons
export const catalogApi = api.catalog
export const searchApi = api.search
export const metaApi = api.meta
export const streamsApi = api.streams
export const subtitlesApi = api.subtitles
export const playApi = api.play
export const profilesApi = api.profiles
export const watchlistApi = api.watchlist
export const progressApi = api.progress
export const engineApi = api.engine
export const playersApi = api.players
export const vlcApi = api.vlc
export const transferApi = api.transfer
export const downloadsApi = api.downloads

let counter = 0
export function nextRequestId() {
  counter += 1
  return `req-${Date.now()}-${counter}`
}

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

export function formatSpeed(bytesPerSecond) {
  const formatted = formatBytes(bytesPerSecond)
  return formatted ? `${formatted}/s` : '0 B/s'
}

export function formatRemaining(positionSeconds, durationSeconds) {
  const left = Math.max(0, (durationSeconds || 0) - (positionSeconds || 0))
  if (left < 30) return null

  const minutes = Math.round(left / 60)
  if (minutes < 60) return `${minutes}m left`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`
}

/** "3 minutes ago" / "2 days ago" — relative time for status and save stamps. */
export function formatAgo(timestamp) {
  if (!timestamp) return null

  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  return `${Math.round(hours / 24)}d ago`
}

export function formatRuntime(runtime) {
  if (!runtime) return null
  if (typeof runtime === 'string') return runtime
  const hours = Math.floor(runtime / 60)
  const minutes = runtime % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

// ---- Credits ----

/**
 * Addons disagree on how credits travel: Cinemeta sends `director`, `writer`
 * and `cast` as arrays (with `director: null` for series) and repeats them in
 * `links` by category, while others send a comma-joined string or `{ name }`
 * objects. Every shape is folded into plain, de-duplicated name lists.
 */
const CREDIT_SOURCES = {
  directors: { field: 'director', category: 'Directors' },
  writers: { field: 'writer', category: 'Writers' },
  cast: { field: 'cast', category: 'Cast' },
}

function namesFrom(value) {
  if (!value) return []
  if (typeof value === 'string') return value.split(',')
  if (!Array.isArray(value)) return []
  return value.map((entry) => (typeof entry === 'string' ? entry : entry?.name))
}

export function creditsOf(meta) {
  const credits = {}

  for (const [role, { field, category }] of Object.entries(CREDIT_SOURCES)) {
    const fromLinks = (Array.isArray(meta?.links) ? meta.links : [])
      .filter((link) => link?.category === category)
      .map((link) => link.name)
    const fromExtras = role === 'cast' ? namesFrom(meta?.app_extras?.cast) : []

    const names = []
    const seen = new Set()
    for (const raw of [...namesFrom(meta?.[field]), ...fromLinks, ...fromExtras]) {
      const name = typeof raw === 'string' ? raw.trim() : ''
      if (!name || seen.has(name.toLowerCase())) continue
      seen.add(name.toLowerCase())
      names.push(name)
    }
    credits[role] = names
  }

  return credits
}

/** YouTube link for the first trailer an addon lists, if any. */
export function trailerUrlOf(meta) {
  const id =
    (Array.isArray(meta?.trailerStreams) && meta.trailerStreams.find((entry) => entry?.ytId)?.ytId) ||
    (Array.isArray(meta?.trailers) && meta.trailers.find((entry) => entry?.source)?.source)
  return id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : null
}

// ---- Episodes ----

/** "21 Jan 2008" in the user's locale, or null for a missing or broken date. */
export function formatAirDate(value) {
  const at = value ? new Date(value) : null
  if (!at || Number.isNaN(at.getTime())) return null
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Addons may omit an episode's `id`; this is the shape the main process falls back to. */
export function videoIdOf(video, seriesId) {
  return video.id || `${seriesId}:${video.season}:${video.episode}`
}

/** Same rule as `isReleased` in electron/addons.js: undated episodes count as out. */
export function isReleased(video) {
  const when = video?.released || video?.firstAired
  if (!when) return true

  const at = Date.parse(when)
  return Number.isNaN(at) || at <= Date.now()
}

/**
 * The episode after `videoId` across the detail page's season list, mirroring
 * `nextVideo` in electron/addons.js so the detail page and Home's "up next"
 * always agree: unaired episodes are skipped, and specials only lead on to
 * other specials.
 */
export function nextEpisodeAfter(seasons, videoId, seriesId) {
  const ordered = seasons.flatMap((entry) => entry.videos)
  const at = ordered.findIndex((video) => videoIdOf(video, seriesId) === videoId)
  if (at === -1) return null

  const inSpecials = Number(ordered[at].season ?? 0) === 0
  return (
    ordered
      .slice(at + 1)
      .find((video) => (Number(video.season ?? 0) === 0) === inSpecials && isReleased(video)) || null
  )
}
