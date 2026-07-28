// Stream classification and badge extraction (SRS 4.2, REQ-2.2 / REQ-2.3).
//
// Addons describe a playable source either as a ready HTTP URL (Debrid and
// direct hosters) or as a raw `infoHash` for the P2P engine. Everything else
// about a stream — size, seeders, resolution — is only available as free text
// inside `name`/`title`, so it is parsed out here rather than in the renderer.

const RESOLUTION_ORDER = ['4K', '1080p', '720p', 'SD', 'Unknown']

// Public trackers appended to every magnet so a swarm can be joined even when
// the addon supplies no `sources` array.
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
]

function detectResolution(text) {
  if (/(2160p|4k|uhd)\b/i.test(text)) return '4K'
  if (/1080p|\bfhd\b/i.test(text)) return '1080p'
  if (/720p/i.test(text)) return '720p'
  if (/480p|360p|240p|\bsd\b|dvdrip|dvdscr/i.test(text)) return 'SD'
  return 'Unknown'
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return null
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(2)} ${units[unit]}`
}

/** Prefers the machine-readable behaviorHints.videoSize over parsed text. */
function parseSize(stream, text) {
  const hinted = Number(stream?.behaviorHints?.videoSize)
  if (Number.isFinite(hinted) && hinted > 0) {
    return { sizeBytes: hinted, sizeLabel: formatBytes(hinted) }
  }

  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(TB|GB|MB|GiB|MiB|TiB)/i)
  if (!match) return { sizeBytes: null, sizeLabel: null }

  const amount = parseFloat(match[1].replace(',', '.'))
  const scale = { mb: 1024 ** 2, mib: 1024 ** 2, gb: 1024 ** 3, gib: 1024 ** 3, tb: 1024 ** 4, tib: 1024 ** 4 }
  const bytes = Math.round(amount * (scale[match[2].toLowerCase()] || 1))
  return { sizeBytes: bytes, sizeLabel: formatBytes(bytes) }
}

function parseSeeders(text) {
  const emoji = text.match(/👤\s*(\d+)/)
  if (emoji) return Number(emoji[1])

  const worded = text.match(/(\d+)\s*seeders?\b/i) || text.match(/\bseeds?\s*[:=]\s*(\d+)/i)
  return worded ? Number(worded[1]) : null
}

function parseProvider(text) {
  const match = text.match(/⚙️\s*([^\n\r|]+)/)
  return match ? match[1].trim() : null
}

const TAG_PATTERNS = [
  [/\bremux\b/i, 'REMUX'],
  [/blu-?ray|\bbdrip\b|\bbrrip\b/i, 'BluRay'],
  [/web-?dl/i, 'WEB-DL'],
  [/web-?rip/i, 'WEBRip'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\b(cam|hdcam|telesync|hdts)\b/i, 'CAM'],
  [/\bhdr10\+/i, 'HDR10+'],
  [/\bhdr\b/i, 'HDR'],
  [/\bdolby.?vision\b|\bdv\b/i, 'DV'],
  [/x265|h\.?265|hevc/i, 'HEVC'],
  [/\bav1\b/i, 'AV1'],
  [/10.?bit/i, '10bit'],
  [/\batmos\b/i, 'Atmos'],
  [/dts-?hd|dts-?x|\bdts\b/i, 'DTS'],
]

function parseTags(text) {
  const tags = []
  for (const [pattern, label] of TAG_PATTERNS) {
    if (pattern.test(text) && !tags.includes(label)) tags.push(label)
  }
  return tags
}

/** Torrentio marks Debrid-cached results as [RD+], uncached as [RD download]. */
function parseCached(text) {
  if (/\[(RD|AD|PM|DL|OC|TB|EM)\+\]/i.test(text)) return true
  if (/\[(RD|AD|PM|DL|OC|TB|EM)\s+download\]/i.test(text)) return false
  return null
}

function classify(stream) {
  // A ready URL always beats a hash: it needs no swarm and starts instantly.
  if (typeof stream.url === 'string' && stream.url) return 'direct'
  if (typeof stream.infoHash === 'string' && stream.infoHash) return 'p2p'
  if (stream.ytId) return 'youtube'
  if (stream.externalUrl) return 'external'
  return 'unsupported'
}

/** Flattens one raw addon stream object into the shape the UI renders. */
function normalizeStream(stream, addonName) {
  const name = typeof stream.name === 'string' ? stream.name : ''
  const title = typeof stream.title === 'string' ? stream.title : stream.description || ''
  const haystack = `${name}\n${title}`

  const lines = title.split('\n').map((line) => line.trim()).filter(Boolean)
  const filename = stream?.behaviorHints?.filename || lines[0] || name.replace(/\n/g, ' ') || 'Unnamed stream'

  const kind = classify(stream)
  const { sizeBytes, sizeLabel } = parseSize(stream, haystack)

  return {
    id: `${stream.infoHash || stream.url || stream.ytId || stream.externalUrl || filename}::${stream.fileIdx ?? ''}`,
    kind,
    addonName,
    label: name.replace(/\n/g, ' ').trim(),
    filename,
    detail: lines.slice(1).join('  •  '),
    resolution: detectResolution(haystack),
    sizeBytes,
    sizeLabel,
    seeders: parseSeeders(haystack),
    provider: parseProvider(haystack),
    tags: parseTags(haystack),
    cached: parseCached(haystack),
    url: stream.url || null,
    infoHash: stream.infoHash ? stream.infoHash.toLowerCase() : null,
    fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null,
    sources: Array.isArray(stream.sources) ? stream.sources : [],
    ytId: stream.ytId || null,
    externalUrl: stream.externalUrl || null,
    bingeGroup: stream?.behaviorHints?.bingeGroup || null,
  }
}

function dedupe(streams) {
  const seen = new Set()
  return streams.filter((stream) => {
    const key = stream.infoHash ? `${stream.infoHash}:${stream.fileIdx ?? ''}` : stream.url || stream.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function compareStreams(a, b) {
  // Instant sources first, then the healthiest swarm, then the biggest file.
  if (a.cached !== b.cached) return (b.cached === true) - (a.cached === true)
  if (a.kind !== b.kind) return (b.kind === 'direct') - (a.kind === 'direct')
  if ((b.seeders ?? -1) !== (a.seeders ?? -1)) return (b.seeders ?? -1) - (a.seeders ?? -1)
  return (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0)
}

/** Groups into the 4K / 1080p / 720p buckets the detail panel renders (UI 3.1). */
function groupByResolution(streams) {
  const buckets = new Map(RESOLUTION_ORDER.map((key) => [key, []]))

  for (const stream of dedupe(streams)) {
    if (stream.kind === 'unsupported') continue
    buckets.get(stream.resolution)?.push(stream)
  }

  return RESOLUTION_ORDER.map((resolution) => ({
    resolution,
    streams: buckets.get(resolution).sort(compareStreams),
  })).filter((group) => group.streams.length > 0)
}

/**
 * Builds a magnet URI from an addon's infoHash plus whatever trackers it
 * advertised in `sources`, which is what the engine hands to WebTorrent.
 */
function buildMagnet(stream) {
  if (!stream.infoHash) throw new Error('Stream has no infoHash')

  const trackers = new Set(DEFAULT_TRACKERS)
  for (const source of stream.sources || []) {
    if (typeof source !== 'string') continue
    if (source.startsWith('tracker:')) trackers.add(source.slice('tracker:'.length))
  }

  const params = [`xt=urn:btih:${stream.infoHash}`]
  if (stream.filename) params.push(`dn=${encodeURIComponent(stream.filename)}`)
  for (const tracker of trackers) params.push(`tr=${encodeURIComponent(tracker)}`)

  return `magnet:?${params.join('&')}`
}

/** Resolves the URL handed to VLC for non-P2P streams (REQ-4.1). */
function directUrlFor(stream) {
  if (stream.kind === 'direct') return stream.url
  if (stream.kind === 'youtube') return `https://www.youtube.com/watch?v=${stream.ytId}`
  if (stream.kind === 'external') return stream.externalUrl
  return null
}

module.exports = {
  RESOLUTION_ORDER,
  DEFAULT_TRACKERS,
  detectResolution,
  formatBytes,
  parseSize,
  parseSeeders,
  parseTags,
  classify,
  normalizeStream,
  groupByResolution,
  buildMagnet,
  directUrlFor,
}
