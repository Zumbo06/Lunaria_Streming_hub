// Stremio Addon Protocol client (SRS 4.1, REQ-1.1 / REQ-1.2 / REQ-2.1).
//
// Every addon is addressed purely through its manifest URL, and all resource
// requests follow the published path shape so that any addon written for the
// official client works here unchanged (SRS 5.3 Extensibility).

const VIDEO_TYPES = ['movie', 'series', 'anime', 'channel', 'tv', 'other']

// ---- URL handling ----

/**
 * Accepts `stremio://host/manifest.json`, `https://host/manifest.json`, or a
 * bare base URL, and returns a canonical https manifest URL.
 */
function normalizeManifestUrl(input) {
  if (typeof input !== 'string') throw new Error('Manifest URL must be a string')

  let url = input.trim()
  if (!url) throw new Error('Manifest URL is empty')

  if (url.startsWith('stremio://')) url = `https://${url.slice('stremio://'.length)}`
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`

  url = url.replace(/\/+$/, '')
  if (!url.endsWith('/manifest.json')) url = `${url}/manifest.json`

  // Throws on anything that is not a parseable URL.
  new URL(url)
  return url
}

function baseUrlOf(manifestUrl) {
  return manifestUrl.replace(/\/manifest\.json$/, '')
}

/** Extras are path segments: /catalog/movie/top/skip=100&genre=Action.json */
function encodeExtra(extra) {
  const parts = Object.entries(extra || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
  return parts.join('&')
}

function buildCatalogUrl(addon, type, catalogId, extra) {
  const base = baseUrlOf(addon.manifestUrl)
  const encoded = encodeExtra(extra)
  const suffix = encoded ? `/${encoded}` : ''
  return `${base}/catalog/${encodeURIComponent(type)}/${encodeURIComponent(catalogId)}${suffix}.json`
}

function buildMetaUrl(addon, type, id) {
  return `${baseUrlOf(addon.manifestUrl)}/meta/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
}

function buildStreamUrl(addon, type, id) {
  return `${baseUrlOf(addon.manifestUrl)}/stream/${encodeURIComponent(type)}/${encodeURIComponent(id)}.json`
}

function buildSubtitlesUrl(addon, type, id, extra) {
  const base = baseUrlOf(addon.manifestUrl)
  const encoded = encodeExtra(extra)
  const suffix = encoded ? `/${encoded}` : ''
  return `${base}/subtitles/${encodeURIComponent(type)}/${encodeURIComponent(id)}${suffix}.json`
}

// ---- Fetching ----

const cache = new Map()

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() > hit.expires) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expires: Date.now() + ttlMs })
}

function clearCache() {
  cache.clear()
}

async function fetchJson(url, { timeoutMs = 8000, ttlMs = 0 } = {}) {
  if (ttlMs > 0) {
    const cached = cacheGet(url)
    if (cached) return cached
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': 'Orion/1.0' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

    const data = await res.json()
    if (ttlMs > 0) cacheSet(url, data, ttlMs)
    return data
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ---- Manifests (REQ-1.1) ----

async function fetchManifest(manifestUrl, timeoutMs = 8000) {
  const url = normalizeManifestUrl(manifestUrl)
  const manifest = await fetchJson(url, { timeoutMs })

  if (!manifest || typeof manifest !== 'object') throw new Error('Manifest is not a JSON object')
  if (!manifest.id) throw new Error('Manifest is missing an "id"')
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    throw new Error('Manifest declares no resources')
  }

  return { manifest, manifestUrl: url }
}

/** Flattens a fetched manifest into the record shape persisted in config. */
function toAddonRecord(manifest, manifestUrl, enabled = true) {
  return {
    manifestUrl,
    id: manifest.id,
    name: manifest.name || manifest.id,
    version: manifest.version || '',
    description: manifest.description || '',
    logo: manifest.logo || null,
    background: manifest.background || null,
    types: Array.isArray(manifest.types) ? manifest.types : [],
    resources: manifest.resources || [],
    catalogs: Array.isArray(manifest.catalogs) ? manifest.catalogs : [],
    idPrefixes: manifest.idPrefixes || null,
    behaviorHints: manifest.behaviorHints || {},
    enabled,
  }
}

// ---- Capability checks ----

/** `resources` entries are either bare strings or {name, types, idPrefixes}. */
function getResourceDef(addon, resourceName) {
  for (const entry of addon.resources || []) {
    if (typeof entry === 'string' && entry === resourceName) {
      return { name: entry, types: addon.types, idPrefixes: addon.idPrefixes }
    }
    if (entry && typeof entry === 'object' && entry.name === resourceName) {
      return {
        name: entry.name,
        types: entry.types || addon.types,
        idPrefixes: entry.idPrefixes || addon.idPrefixes,
      }
    }
  }
  return null
}

function supportsResource(addon, resourceName, type, id) {
  if (addon.enabled === false) return false

  const def = getResourceDef(addon, resourceName)
  if (!def) return false
  if (type && Array.isArray(def.types) && def.types.length && !def.types.includes(type)) return false
  if (id && Array.isArray(def.idPrefixes) && def.idPrefixes.length) {
    if (!def.idPrefixes.some((prefix) => id.startsWith(prefix))) return false
  }
  return true
}

/** Handles both the v3.1 `extra` array and the older extraSupported/Required. */
function catalogExtras(catalog) {
  if (Array.isArray(catalog.extra)) {
    return catalog.extra.map((e) => ({
      name: e.name,
      isRequired: Boolean(e.isRequired),
      options: e.options || null,
    }))
  }
  const supported = catalog.extraSupported || []
  const required = catalog.extraRequired || []
  return supported.map((name) => ({ name, isRequired: required.includes(name), options: null }))
}

function catalogSupportsExtra(catalog, name) {
  return catalogExtras(catalog).some((e) => e.name === name)
}

function catalogRequiredExtras(catalog) {
  return catalogExtras(catalog)
    .filter((e) => e.isRequired)
    .map((e) => e.name)
}

/**
 * Catalogs that can be rendered as a Home shelf: those with no required extra
 * beyond pagination. A catalog that demands `search` or `genre` needs user
 * input first, so it belongs on the Search screen instead.
 */
function homeShelves(addons) {
  const shelves = []
  for (const addon of addons) {
    if (addon.enabled === false) continue
    if (!getResourceDef(addon, 'catalog')) continue

    for (const catalog of addon.catalogs || []) {
      const required = catalogRequiredExtras(catalog).filter((name) => name !== 'skip')
      if (required.length > 0) continue

      shelves.push({
        key: `${addon.manifestUrl}::${catalog.type}::${catalog.id}`,
        manifestUrl: addon.manifestUrl,
        addonName: addon.name,
        type: catalog.type,
        catalogId: catalog.id,
        name: catalog.name || catalog.id,
        paginated: catalogSupportsExtra(catalog, 'skip'),
      })
    }
  }
  return shelves
}

/** Catalogs advertising `search`, used to fan a query out across addons. */
function searchTargets(addons) {
  const targets = []
  for (const addon of addons) {
    if (addon.enabled === false) continue
    if (!getResourceDef(addon, 'catalog')) continue

    for (const catalog of addon.catalogs || []) {
      if (!catalogSupportsExtra(catalog, 'search')) continue
      targets.push({
        manifestUrl: addon.manifestUrl,
        addonName: addon.name,
        type: catalog.type,
        catalogId: catalog.id,
      })
    }
  }
  return targets
}

// ---- Resource calls ----

async function fetchCatalog(addon, type, catalogId, extra, timeoutMs) {
  const url = buildCatalogUrl(addon, type, catalogId, extra)
  const data = await fetchJson(url, { timeoutMs, ttlMs: 5 * 60 * 1000 })
  return Array.isArray(data?.metas) ? data.metas : []
}

async function fetchMeta(addon, type, id, timeoutMs) {
  const url = buildMetaUrl(addon, type, id)
  const data = await fetchJson(url, { timeoutMs, ttlMs: 10 * 60 * 1000 })
  return data?.meta || null
}

async function fetchStreams(addon, type, id, timeoutMs) {
  const url = buildStreamUrl(addon, type, id)
  const data = await fetchJson(url, { timeoutMs, ttlMs: 60 * 1000 })
  return Array.isArray(data?.streams) ? data.streams : []
}

/**
 * Subtitle addons (OpenSubtitles and friends) answer on the `subtitles`
 * resource. Some of them use the `videoHash`/`videoSize` extras to match an
 * exact release, so both are forwarded when known.
 */
async function fetchSubtitles(addon, type, id, extra, timeoutMs) {
  const url = buildSubtitlesUrl(addon, type, id, extra)
  const data = await fetchJson(url, { timeoutMs, ttlMs: 5 * 60 * 1000 })
  return Array.isArray(data?.subtitles) ? data.subtitles : []
}

// ---- Episode ordering ----

/** An episode an addon has announced but not yet aired is not playable. */
function isReleased(video) {
  const when = video.released || video.firstAired
  if (!when) return true

  const at = Date.parse(when)
  return Number.isNaN(at) || at <= Date.now()
}

/**
 * Puts a series meta's `videos` into broadcast order. Addons are free to return
 * them in any order and some omit `id`, so both are normalised here rather than
 * at each call site — the fallback id is the same `series:season:episode` shape
 * the detail page builds.
 */
function orderedVideos(meta) {
  const videos = Array.isArray(meta?.videos) ? meta.videos : []

  return videos
    .filter((video) => video && (video.id || (video.season != null && video.episode != null)))
    .map((video) => ({
      ...video,
      id: video.id || `${meta.id}:${video.season}:${video.episode}`,
      season: Number(video.season ?? 0),
      episode: Number(video.episode ?? 0),
    }))
    // Specials sit in season 0 and therefore sort ahead of the first season,
    // which is where the detail page places them too.
    .sort((a, b) => a.season - b.season || a.episode - b.episode)
}

/**
 * The episode that follows `currentVideoId` — the next one in the same season,
 * or the first of the season after it. Returns null at the end of the series,
 * when every later episode is still unaired, or when the current episode is not
 * part of this meta at all.
 */
function nextVideo(meta, currentVideoId) {
  if (!currentVideoId) return null

  const ordered = orderedVideos(meta)
  const at = ordered.findIndex((video) => video.id === currentVideoId)
  if (at === -1) return null

  return ordered.slice(at + 1).find(isReleased) || null
}

/**
 * Runs `task` against every addon at once and resolves with one entry per
 * addon, successes and failures alike. A single dead scraper must never hold
 * up the rest of the list (REQ-2.1, NFR 5.1).
 */
async function fanOut(addons, task) {
  const settled = await Promise.allSettled(addons.map((addon) => task(addon)))
  return settled.map((result, index) => ({
    addon: addons[index],
    ok: result.status === 'fulfilled',
    value: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? result.reason?.message || String(result.reason) : null,
  }))
}

module.exports = {
  VIDEO_TYPES,
  normalizeManifestUrl,
  baseUrlOf,
  buildCatalogUrl,
  buildMetaUrl,
  buildStreamUrl,
  buildSubtitlesUrl,
  fetchManifest,
  toAddonRecord,
  getResourceDef,
  supportsResource,
  catalogExtras,
  catalogSupportsExtra,
  catalogRequiredExtras,
  homeShelves,
  searchTargets,
  fetchCatalog,
  fetchMeta,
  fetchStreams,
  fetchSubtitles,
  orderedVideos,
  nextVideo,
  fanOut,
  clearCache,
}
