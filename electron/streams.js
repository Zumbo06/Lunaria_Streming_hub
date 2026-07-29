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

// ---- Languages ----
//
// Addons advertise audio languages two ways: regional-indicator flag emoji
// (Torrentio's convention) and plain words in the title. Both are read, since
// a stream frequently carries only one of them.

const FLAG_LANGUAGES = {
  GB: 'English', US: 'English', AU: 'English', CA: 'English', IE: 'English', NZ: 'English',
  FR: 'French', ES: 'Spanish', MX: 'Spanish', AR: 'Spanish', DE: 'German', AT: 'German',
  IT: 'Italian', PT: 'Portuguese', BR: 'Portuguese', RU: 'Russian', UA: 'Ukrainian',
  JP: 'Japanese', KR: 'Korean', CN: 'Chinese', TW: 'Chinese', HK: 'Chinese',
  IN: 'Hindi', TR: 'Turkish', NL: 'Dutch', PL: 'Polish', SE: 'Swedish', NO: 'Norwegian',
  DK: 'Danish', FI: 'Finnish', GR: 'Greek', CZ: 'Czech', HU: 'Hungarian', RO: 'Romanian',
  BG: 'Bulgarian', HR: 'Croatian', RS: 'Serbian', SK: 'Slovak', IL: 'Hebrew',
  SA: 'Arabic', EG: 'Arabic', IR: 'Persian', TH: 'Thai', VN: 'Vietnamese', ID: 'Indonesian',
  MY: 'Malay', PH: 'Filipino', LT: 'Lithuanian', LV: 'Latvian', EE: 'Estonian',
}

const TEXT_LANGUAGES = [
  [/\benglish\b|\beng\b/i, 'English'],
  [/\bfrench\b|\bfrancais\b|\bvff?\b|\btruefrench\b/i, 'French'],
  [/\bspanish\b|\bespañol\b|\bespanol\b|\bcastellano\b|\blatino\b/i, 'Spanish'],
  [/\bgerman\b|\bdeutsch\b/i, 'German'],
  [/\bitalian\b|\bitaliano\b/i, 'Italian'],
  [/\bportuguese\b|\bportugues\b/i, 'Portuguese'],
  [/\brussian\b|\brus\b/i, 'Russian'],
  [/\bjapanese\b|\bjpn\b/i, 'Japanese'],
  [/\bkorean\b|\bkor\b/i, 'Korean'],
  [/\bchinese\b|\bmandarin\b|\bcantonese\b/i, 'Chinese'],
  [/\bhindi\b|\btamil\b|\btelugu\b/i, 'Hindi'],
  [/\bturkish\b|\btürkçe\b|\bturkce\b/i, 'Turkish'],
  [/\bdutch\b|\bnederlands\b/i, 'Dutch'],
  [/\bpolish\b|\bpolski\b|\blektor\b/i, 'Polish'],
  [/\bswedish\b/i, 'Swedish'],
  [/\bdanish\b/i, 'Danish'],
  [/\bnorwegian\b/i, 'Norwegian'],
  [/\bfinnish\b/i, 'Finnish'],
  [/\bgreek\b/i, 'Greek'],
  [/\bczech\b/i, 'Czech'],
  [/\bhungarian\b/i, 'Hungarian'],
  [/\bromanian\b/i, 'Romanian'],
  [/\bukrainian\b/i, 'Ukrainian'],
  [/\barabic\b/i, 'Arabic'],
  [/\bhebrew\b/i, 'Hebrew'],
  [/\bthai\b/i, 'Thai'],
  [/\bvietnamese\b/i, 'Vietnamese'],
  [/\bhindi\b/i, 'Hindi'],
]

/** Decodes regional-indicator pairs (🇬🇧 -> "GB") into language names. */
function languagesFromFlags(text) {
  const found = []
  const matches = text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || []

  for (const flag of matches) {
    const points = [...flag].map((char) => char.codePointAt(0) - 0x1f1e6)
    if (points.some((point) => point < 0 || point > 25)) continue

    const code = points.map((point) => String.fromCharCode(65 + point)).join('')
    const language = FLAG_LANGUAGES[code]
    if (language && !found.includes(language)) found.push(language)
  }

  return found
}

function parseLanguages(text) {
  const languages = languagesFromFlags(text)

  for (const [pattern, language] of TEXT_LANGUAGES) {
    if (pattern.test(text) && !languages.includes(language)) languages.push(language)
  }

  return languages
}

function parseMultiAudio(text) {
  return /\bmulti[\s-]?(audio|lang)|\bdual[\s-]?audio\b|\bdub(bed)?\b/i.test(text)
}

const TAG_PATTERNS = [
  [/\bremux\b/i, 'REMUX'],
  [/blu-?ray|\bbdrip\b|\bbrrip\b/i, 'BluRay'],
  [/web-?dl/i, 'WEB-DL'],
  [/web-?rip/i, 'WEBRip'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\b(cam|hdcam|telesync|hdts)\b/i, 'CAM'],
  [/\bhdr10\+|\bhdr10plus\b/i, 'HDR10+'],
  [/\bhlg\b/i, 'HLG'],
  [/\bhdr10\b/i, 'HDR10'],
  [/\bhdr\b/i, 'HDR'],
  [/\bdolby.?vision\b|\bdo?vi\b|\bdv\b/i, 'DV'],
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

/**
 * Identifies the high-dynamic-range format a release advertises, which decides
 * the arguments the player is launched with. Dolby Vision is reported ahead of
 * the HDR10 layer it is usually built on, since it needs different handling.
 */
function detectHdr(text) {
  const dolbyVision = /\bdolby.?vision\b|\bdo?vi\b|\bdv\b/i.test(text)
  const hdr10Plus = /\bhdr10\+|\bhdr10plus\b/i.test(text)
  const hlg = /\bhlg\b/i.test(text)
  const hdr10 = /\bhdr10\b/i.test(text)
  const genericHdr = /\bhdr\b/i.test(text)

  if (dolbyVision) return { isHdr: true, format: 'DV', hdr10Fallback: hdr10Plus || hdr10 || genericHdr }
  if (hdr10Plus) return { isHdr: true, format: 'HDR10+', hdr10Fallback: true }
  if (hlg) return { isHdr: true, format: 'HLG', hdr10Fallback: false }
  if (hdr10 || genericHdr) return { isHdr: true, format: 'HDR10', hdr10Fallback: true }

  return { isHdr: false, format: null, hdr10Fallback: false }
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
  const hdr = detectHdr(haystack)

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
    languages: parseLanguages(haystack),
    multiAudio: parseMultiAudio(haystack),
    isHdr: hdr.isHdr,
    hdrFormat: hdr.format,
    hdr10Fallback: hdr.hdr10Fallback,
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
  parseLanguages,
  parseMultiAudio,
  detectHdr,
  classify,
  normalizeStream,
  groupByResolution,
  buildMagnet,
  directUrlFor,
}
