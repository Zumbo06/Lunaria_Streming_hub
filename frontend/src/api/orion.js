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
