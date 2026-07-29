// Player routing. Orion drives an external player, and which one it is should
// be the only thing that changes between VLC and mpv — everything upstream
// (engine, subtitles, progress tracking) stays identical.

const mpv = require('./mpv')
const vlc = require('./vlc')

const PLAYERS = {
  vlc: {
    id: 'vlc',
    name: 'VLC',
    // VLC 3 can only pass HDR through to a display already in HDR mode.
    hdrSupport: 'passthrough',
    hdrNote:
      'VLC 3 passes HDR through using its Direct3D11 output. It has no tone-mapping controls, so an HDR file on an SDR display will look washed out — use mpv for that.',
  },
  mpv: {
    id: 'mpv',
    name: 'mpv',
    hdrSupport: 'full',
    hdrNote:
      'mpv handles HDR through libplacebo: pass it through to an HDR display, or tone-map HDR10, HDR10+ and Dolby Vision down to SDR with a chosen curve.',
  },
}

function describe(id) {
  return PLAYERS[id] || PLAYERS.vlc
}

function resolveId(settings) {
  return settings?.player === 'mpv' ? 'mpv' : 'vlc'
}

/** Locates the binary for a player, honouring the user's override path. */
async function find(id, settings) {
  if (id === 'mpv') return mpv.findMpv(settings?.mpvPath)
  return vlc.findVlc(settings?.vlcPath)
}

/** Which players are actually installed, for the picker in Settings. */
async function detectAll(settings) {
  const [vlcPath, mpvPath] = await Promise.all([vlc.findVlc(settings?.vlcPath), mpv.findMpv(settings?.mpvPath)])

  // Portable mpv reports its build, which is worth showing: HDR behaviour
  // depends on the bundled libplacebo version.
  const mpvInfo = mpvPath ? await mpv.verify(mpvPath) : null

  return {
    vlc: { ...PLAYERS.vlc, path: vlcPath, installed: Boolean(vlcPath) },
    mpv: {
      ...PLAYERS.mpv,
      path: mpvPath,
      installed: Boolean(mpvPath),
      version: mpvInfo?.ok ? mpvInfo.version : null,
      libplacebo: mpvInfo?.ok ? mpvInfo.libplacebo : null,
      portable: Boolean(mpvPath) && !/program files|\/usr\/|\\WinGet\\|chocolatey/i.test(mpvPath),
    },
  }
}

/** Extra portable builds found on disk, offered as one-click choices. */
function findPortable() {
  return mpv.scanPortable()
}

/** Confirms a chosen executable really is the player it claims to be. */
async function verifyPath(playerId, candidate) {
  if (playerId === 'mpv') return mpv.verify(mpv.normalizeCandidate(candidate))
  return vlc.isExecutableFile(candidate)
    ? { ok: true, version: null }
    : { ok: false, error: 'No executable at that path' }
}

function invalidateCache() {
  vlc.invalidateCache()
  mpv.invalidateCache()
}

/**
 * Decides whether this playback gets HDR arguments.
 *   off   — never
 *   force — always, even when nothing advertised HDR
 *   auto  — only when the release itself claims HDR (the default)
 */
function hdrDecision(stream, settings) {
  const mode = settings?.hdrMode || 'auto'
  if (mode === 'off') return { isHdr: false, format: null, reason: 'disabled in settings' }
  if (mode === 'force') {
    return { isHdr: true, format: stream?.hdrFormat || 'HDR10', reason: 'forced in settings' }
  }
  if (stream?.isHdr) return { isHdr: true, format: stream.hdrFormat, reason: 'detected in the release name' }
  return { isHdr: false, format: null, reason: 'no HDR advertised' }
}

async function launch(id, streamUrl, options) {
  if (id === 'mpv') {
    return mpv.launch(streamUrl, { ...options, mpvPath: options.playerPath })
  }
  return vlc.launch(streamUrl, { ...options, vlcPath: options.playerPath })
}

function readStatus(id, control, timeoutMs) {
  if (id === 'mpv') return mpv.readStatus(control, timeoutMs)
  return vlc.readStatus(control, timeoutMs)
}

/** The exact arguments a given player would add for HDR, for display in the UI. */
function hdrArgsFor(id, hdr, settings) {
  if (!hdr?.isHdr) return []
  if (id === 'mpv') {
    return mpv.hdrArgs({ hdrFormat: hdr.format, toneMap: settings?.hdrToneMap || 'passthrough' })
  }
  return vlc.hdrArgs()
}

module.exports = {
  PLAYERS,
  describe,
  resolveId,
  find,
  detectAll,
  findPortable,
  verifyPath,
  launch,
  readStatus,
  hdrDecision,
  hdrArgsFor,
  invalidateCache,
}
