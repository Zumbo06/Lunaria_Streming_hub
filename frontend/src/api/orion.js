// Thin wrapper over the preload bridge. Every call funnels through here so the
// pages never touch `window.orion` directly and so opening the Vite dev server
// in a plain browser fails loudly instead of throwing "undefined" deep in a
// component.

const bridge = typeof window !== 'undefined' ? window.orion : undefined

export const isDesktop = Boolean(bridge)

function required() {
  throw new Error(
    'Orion’s desktop bridge is unavailable. Launch the app with `npm run dev` from the project root rather than opening the Vite URL in a browser.',
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
  play: noBridge,
  engine: noBridge,
  vlc: noBridge,
}

export const appApi = api.app
export const settingsApi = api.settings
export const addonsApi = api.addons
export const catalogApi = api.catalog
export const searchApi = api.search
export const metaApi = api.meta
export const streamsApi = api.streams
export const playApi = api.play
export const engineApi = api.engine
export const vlcApi = api.vlc

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

export function formatRuntime(runtime) {
  if (!runtime) return null
  if (typeof runtime === 'string') return runtime
  const hours = Math.floor(runtime / 60)
  const minutes = runtime % 60
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}
