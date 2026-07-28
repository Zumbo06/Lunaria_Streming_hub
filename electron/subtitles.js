// Subtitle handling for the Stremio `subtitles` resource (OpenSubtitles et al).
//
// Addons return a URL per track, but VLC's --sub-file wants a local path, so
// the chosen track is downloaded to a scratch file before playback and removed
// when Orion exits.

const fs = require('fs')
const os = require('os')
const path = require('path')

// ISO 639-1 and the 639-2/B forms addons actually emit.
const LANGUAGE_NAMES = {
  en: 'English', eng: 'English',
  tr: 'Turkish', tur: 'Turkish',
  fr: 'French', fre: 'French', fra: 'French',
  es: 'Spanish', spa: 'Spanish',
  de: 'German', ger: 'German', deu: 'German',
  it: 'Italian', ita: 'Italian',
  pt: 'Portuguese', por: 'Portuguese',
  // OpenSubtitles splits the Portuguese and Chinese variants out.
  pob: 'Portuguese (BR)', 'pt-br': 'Portuguese (BR)', 'pt-pt': 'Portuguese',
  zht: 'Chinese (Trad)', cht: 'Chinese (Trad)', zhe: 'Chinese (Simp)', chs: 'Chinese (Simp)',
  spn: 'Spanish (LA)', 'es-mx': 'Spanish (LA)', ext: 'Extremaduran',
  sme: 'Northern Sami', mne: 'Montenegrin', bos: 'Bosnian', mac: 'Macedonian', mkd: 'Macedonian',
  alb: 'Albanian', sqi: 'Albanian', ice: 'Icelandic', isl: 'Icelandic',
  geo: 'Georgian', kat: 'Georgian', arm: 'Armenian', hye: 'Armenian',
  ben: 'Bengali', tam: 'Tamil', tel: 'Telugu', mal: 'Malayalam', kan: 'Kannada', mar: 'Marathi',
  urd: 'Urdu', nep: 'Nepali', sin: 'Sinhala', khm: 'Khmer', bur: 'Burmese', mya: 'Burmese',
  ru: 'Russian', rus: 'Russian',
  uk: 'Ukrainian', ukr: 'Ukrainian',
  pl: 'Polish', pol: 'Polish',
  nl: 'Dutch', dut: 'Dutch', nld: 'Dutch',
  sv: 'Swedish', swe: 'Swedish',
  no: 'Norwegian', nor: 'Norwegian',
  da: 'Danish', dan: 'Danish',
  fi: 'Finnish', fin: 'Finnish',
  cs: 'Czech', cze: 'Czech', ces: 'Czech',
  sk: 'Slovak', slo: 'Slovak', slk: 'Slovak',
  hu: 'Hungarian', hun: 'Hungarian',
  ro: 'Romanian', rum: 'Romanian', ron: 'Romanian',
  bg: 'Bulgarian', bul: 'Bulgarian',
  el: 'Greek', gre: 'Greek', ell: 'Greek',
  he: 'Hebrew', heb: 'Hebrew',
  ar: 'Arabic', ara: 'Arabic',
  fa: 'Persian', per: 'Persian', fas: 'Persian',
  hi: 'Hindi', hin: 'Hindi',
  ja: 'Japanese', jpn: 'Japanese',
  ko: 'Korean', kor: 'Korean',
  zh: 'Chinese', chi: 'Chinese', zho: 'Chinese',
  th: 'Thai', tha: 'Thai',
  vi: 'Vietnamese', vie: 'Vietnamese',
  id: 'Indonesian', ind: 'Indonesian',
  ms: 'Malay', may: 'Malay', msa: 'Malay',
  hr: 'Croatian', hrv: 'Croatian',
  sr: 'Serbian', srp: 'Serbian',
  sl: 'Slovenian', slv: 'Slovenian',
  et: 'Estonian', est: 'Estonian',
  lv: 'Latvian', lav: 'Latvian',
  lt: 'Lithuanian', lit: 'Lithuanian',
  ca: 'Catalan', cat: 'Catalan',
  gl: 'Galician', glg: 'Galician',
  eu: 'Basque', baq: 'Basque', eus: 'Basque',
}

const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa', '.sub']

function languageName(code) {
  if (!code) return 'Unknown'
  const key = String(code).toLowerCase().trim()
  return LANGUAGE_NAMES[key] || key.toUpperCase()
}

/** Flattens one addon subtitle object into what the picker renders. */
function normalizeSubtitle(subtitle, addonName) {
  const lang = subtitle.lang || subtitle.language || ''
  return {
    id: `${addonName}:${subtitle.id ?? subtitle.url}`,
    url: subtitle.url,
    lang,
    language: languageName(lang),
    addonName,
    // OpenSubtitles puts the release name here; useful for picking a track that
    // matches the exact rip being streamed.
    label: subtitle.SubFileName || subtitle.name || null,
  }
}

function dedupe(subtitles) {
  const seen = new Set()
  return subtitles.filter((subtitle) => {
    if (!subtitle.url || seen.has(subtitle.url)) return false
    seen.add(subtitle.url)
    return true
  })
}

/** Groups by language, preferred languages first, then alphabetical. */
function organise(subtitles, preferred = []) {
  const wanted = preferred.map((entry) => entry.toLowerCase())
  const groups = new Map()

  for (const subtitle of dedupe(subtitles)) {
    if (!groups.has(subtitle.language)) groups.set(subtitle.language, [])
    groups.get(subtitle.language).push(subtitle)
  }

  return [...groups.entries()]
    .map(([language, tracks]) => ({ language, tracks }))
    .sort((a, b) => {
      const aRank = wanted.indexOf(a.language.toLowerCase())
      const bRank = wanted.indexOf(b.language.toLowerCase())
      if (aRank !== bRank) return (aRank === -1 ? 999 : aRank) - (bRank === -1 ? 999 : bRank)
      return a.language.localeCompare(b.language)
    })
}

function extensionFor(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    const found = SUBTITLE_EXTENSIONS.find((extension) => pathname.endsWith(extension))
    if (found) return found
  } catch {
    /* not a parseable URL */
  }
  return '.srt'
}

let scratchDir = null
const downloaded = new Set()

function ensureScratchDir() {
  if (!scratchDir) scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orion-subs-'))
  return scratchDir
}

/**
 * Fetches a subtitle track to a local file. VLC will not take a remote URL for
 * --sub-file, so this is required rather than an optimisation.
 */
async function download(url, timeoutMs = 15000) {
  if (!url) throw new Error('Subtitle has no URL')

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Orion/1.0' },
      redirect: 'follow',
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0) throw new Error('Subtitle file was empty')
    if (body.length > 8 * 1024 * 1024) throw new Error('Subtitle file is implausibly large')

    const target = path.join(
      ensureScratchDir(),
      `sub-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${extensionFor(url)}`,
    )
    fs.writeFileSync(target, body)
    downloaded.add(target)
    return target
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Subtitle download timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function cleanup() {
  for (const file of downloaded) {
    try {
      fs.rmSync(file, { force: true })
    } catch {
      /* already gone */
    }
  }
  downloaded.clear()

  if (scratchDir) {
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true })
    } catch {
      /* in use */
    }
    scratchDir = null
  }
}

module.exports = {
  LANGUAGE_NAMES,
  languageName,
  normalizeSubtitle,
  organise,
  download,
  cleanup,
}
