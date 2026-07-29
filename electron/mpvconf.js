// Writes an HDR-tuned mpv.conf into a portable mpv folder.
//
// On Windows, mpv reads its config from `portable_config/` beside mpv.exe when
// that folder exists, and from %APPDATA%\mpv otherwise. Creating
// portable_config therefore makes the build fully self-contained — and also
// makes mpv stop reading %APPDATA%\mpv, so callers are told when that folder
// holds anything worth keeping.
//
// Only the block between the managed markers is ever rewritten; anything the
// user adds around it survives.

const fs = require('fs')
const path = require('path')

const BEGIN = '# >>> Orion HDR settings (managed — edits inside this block are overwritten) >>>'
const END = '# <<< Orion HDR settings <<<'

function portableDir(mpvPath) {
  return path.join(path.dirname(mpvPath), 'portable_config')
}

function configPath(mpvPath) {
  return path.join(portableDir(mpvPath), 'mpv.conf')
}

// Verified against mpv 0.41 with a genuinely PQ-tagged file:
//   p.max_luma                 -> "Property 'max-luma' was not found", never fires
//   p.video_params.max_luma    -> no error, but never fires either
//   p.video_params.gamma       -> fires on PQ/HLG, stays off for SDR
// so the transfer function is what the profile keys on.
const HDR_CONDITION =
  'p.video_params and (p.video_params.gamma == "pq" or p.video_params.gamma == "hlg")'

/**
 * The HDR block. Every option here was checked against the installed mpv rather
 * than assumed — a single unknown option stops the whole config from loading.
 *
 * Structure matters as much as content: global options come first, the
 * conditional profile last, and the block closes with `[default]`. Without that
 * terminator any line the user appends below would be silently captured into
 * the HDR profile and only apply to HDR files.
 */
/** Option keys the user has set themselves, so the base block can skip them. */
function overriddenKeys(customOptions) {
  return new Set(
    String(customOptions || '')
      .split(/\r?\n/)
      .map((line) => line.trim().split('=')[0].trim())
      .filter(Boolean),
  )
}

function hdrLines({
  passthrough = true,
  toneMap: requestedCurve = 'clip',
  exclusiveFullscreen = false,
  hardwareDecoding = true,
  customOptions = '',
}) {
  // Passthrough and the tone-mapping curve are independent: the hint tells the
  // display what it is receiving, while the curve governs whatever mapping
  // libplacebo still has to do because the panel cannot reach the source peak.
  // Treating them as either/or produces a config that silently drops HDR
  // passthrough the moment a curve is chosen.
  const owned = overriddenKeys(customOptions)
  const emit = (key, value) => (owned.has(key) ? [] : [`${key}=${value}`])
  // Guards against the legacy "passthrough" setting being written as a curve.
  const toneMap = require('./mpv').normalizeCurve(requestedCurve)

  const lines = [
    '# --- Applies to everything -------------------------------------------',
    '',
    '# libplacebo-backed output. Required for HDR10+ and Dolby Vision dynamic',
    '# metadata; the older gpu output cannot apply either.',
    'vo=gpu-next',
    'gpu-api=d3d11',
  ]

  if (hardwareDecoding) {
    lines.push(
      '',
      '# mpv decodes in software by default, which is punishing for 4K HEVC.',
      '# auto-safe sticks to hardware decoders known to be reliable.',
      'hwdec=auto-safe',
    )
  }

  if (exclusiveFullscreen) {
    lines.push('', '# Some GPUs only engage HDR in exclusive fullscreen.', 'd3d11-exclusive-fs=yes')
  }

  lines.push(
    '',
    '# --- Applies to HDR files only ---------------------------------------',
    '# Keyed on the transfer function: PQ (HDR10/HDR10+/Dolby Vision) or HLG.',
    '',
    '[orion-hdr]',
    `profile-cond=${HDR_CONDITION}`,
    'profile-restore=copy',
  )

  if (passthrough) {
    lines.push(
      '',
      '# Tell the display it is receiving HDR — correct when the Windows',
      '# desktop is in HDR mode. mpv requests a PQ swapchain and passes the',
      '# source metadata through.',
      ...emit('target-colorspace-hint', 'yes'),
      ...emit('d3d11-output-csp', 'auto'),
    )
  } else {
    lines.push(
      '',
      '# Display is SDR: convert rather than announcing HDR to it.',
      ...emit('target-colorspace-hint', 'no'),
    )
  }

  lines.push(
    '',
    toneMap === 'clip'
      ? '# clip = let the display do the mapping and leave the signal alone.'
      : `# Curve applied to whatever mapping is still needed after passthrough.`,
    ...emit('tone-mapping', toneMap),
  )

  if (toneMap !== 'clip') {
    lines.push(
      '',
      '# Measure real per-scene peak brightness rather than trusting the static',
      '# metadata, which is frequently wrong.',
      ...emit('hdr-compute-peak', 'yes'),
      ...emit('hdr-peak-percentile', '99.995'),
      ...emit('target-peak', 'auto'),
      // target-contrast is the black-level control: `inf` suits OLED. Left at
      // auto here so a user setting in the extra options wins outright.
      ...emit('target-contrast', 'auto'),
      '',
      '# Claw back local contrast lost in the mapping.',
      ...emit('hdr-contrast-recovery', '0.30'),
    )
  }

  const custom = String(customOptions || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (custom.length > 0) {
    lines.push(
      '',
      '# Your own HDR options, set in Orion. These are kept verbatim across',
      '# rewrites — edit them in Settings rather than here.',
      ...custom,
    )
  }

  lines.push(
    '',
    '# Closes the profile above. Anything you add below this line applies to',
    '# every file again — without it, mpv would fold it into [orion-hdr].',
    '[default]',
  )

  return lines
}

function renderBlock(options) {
  return [BEGIN, ...hdrLines(options), END].join('\r\n')
}

/** Replaces the managed block, or appends one, leaving other content intact. */
function mergeBlock(existing, block) {
  if (!existing) return `${block}\r\n`

  const beginAt = existing.indexOf(BEGIN)
  const endAt = existing.indexOf(END)

  if (beginAt !== -1 && endAt !== -1 && endAt > beginAt) {
    const before = existing.slice(0, beginAt)
    const after = existing.slice(endAt + END.length)
    return `${before}${block}${after}`
  }

  const separator = existing.endsWith('\n') ? '' : '\r\n'
  return `${existing}${separator}\r\n${block}\r\n`
}

function read(mpvPath) {
  const file = configPath(mpvPath)
  if (!fs.existsSync(file)) return { exists: false, path: file, contents: null, managed: false }

  const contents = fs.readFileSync(file, 'utf8')
  return { exists: true, path: file, contents, managed: contents.includes(BEGIN) }
}

/**
 * Writes the block. Any pre-existing mpv.conf is copied to mpv.conf.bak once,
 * so a hand-written config is always recoverable.
 */
function write(mpvPath, options = {}) {
  if (!mpvPath) throw new Error('No mpv path given')

  const dir = portableDir(mpvPath)
  const file = configPath(mpvPath)

  fs.mkdirSync(dir, { recursive: true })

  let existing = null
  if (fs.existsSync(file)) {
    existing = fs.readFileSync(file, 'utf8')
    const backup = `${file}.bak`
    if (!fs.existsSync(backup)) fs.copyFileSync(file, backup)
  }

  const merged = mergeBlock(existing, renderBlock(options))
  fs.writeFileSync(file, merged, 'utf8')

  return { path: file, dir, created: !existing, contents: merged }
}

/** Strips the managed block; removes the file if nothing else was in it. */
function remove(mpvPath) {
  const file = configPath(mpvPath)
  if (!fs.existsSync(file)) return { removed: false, path: file }

  const contents = fs.readFileSync(file, 'utf8')
  const beginAt = contents.indexOf(BEGIN)
  const endAt = contents.indexOf(END)

  if (beginAt === -1 || endAt === -1) return { removed: false, path: file, reason: 'no managed block' }

  const remaining = (contents.slice(0, beginAt) + contents.slice(endAt + END.length)).trim()
  if (remaining.length === 0) {
    fs.rmSync(file, { force: true })
    return { removed: true, path: file, deletedFile: true }
  }

  fs.writeFileSync(file, `${remaining}\r\n`, 'utf8')
  return { removed: true, path: file, deletedFile: false }
}

/** Whether a %APPDATA%\mpv config would be shadowed by going portable. */
function shadowedUserConfig() {
  if (process.platform !== 'win32' || !process.env.APPDATA) return { shadowed: false }

  const dir = path.join(process.env.APPDATA, 'mpv')
  if (!fs.existsSync(dir)) return { shadowed: false }

  let entries = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return { shadowed: false }
  }

  return { shadowed: entries.length > 0, dir, entries }
}

module.exports = {
  BEGIN,
  END,
  HDR_CONDITION,
  portableDir,
  configPath,
  hdrLines,
  renderBlock,
  read,
  write,
  remove,
  shadowedUserConfig,
}
