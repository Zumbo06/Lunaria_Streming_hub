const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { fork, spawn } = require('child_process')

const config = require('./config')
const addonsLib = require('./addons')
const streamsLib = require('./streams')
const library = require('./library')
const subtitlesLib = require('./subtitles')
const players = require('./players')
const vlc = require('./vlc')
const transfer = require('./transfer')

const isDev = process.env.ELECTRON_START_URL != null

// The engine is forked as a child process running ESM, and it pulls in native
// `.node` binaries through WebTorrent. Neither can be loaded from inside an
// asar archive: `.node` files are not real files there, and Node's ESM loader
// does not go through Electron's asar patch. So `asarUnpack` in package.json
// puts the engine and the whole dependency tree on disk beside the archive,
// and this rewrites the path to point at the copy that really exists.
//
// `asarUnpack` deliberately takes all of `node_modules` rather than a list of
// the packages with native code. On the first packaged build it named them
// individually, and `utp-native`'s loader shim (`node-gyp-build`) stayed inside
// the archive — WebTorrent caught the failure, disabled uTP and carried on, so
// the only symptom was quietly connecting to fewer peers. The production tree
// is ~28 MB; being selective saves nothing and hides that class of bug.
const ENGINE_PATH = path
  .join(__dirname, 'engine', 'server.mjs')
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

let mainWindow = null

// Whose watchlist and history the app is currently reading and writing.
let currentProfileId = null

function activeProfileId() {
  if (currentProfileId && library.getProfile(currentProfileId)) return currentProfileId
  const [first] = library.listProfiles()
  currentProfileId = first ? first.id : null
  return currentProfileId
}

// Hydrated addon records live here; the renderer only ever sees `uid` handles
// so a manifest URL carrying a Debrid token never crosses into page context.
let addonRecords = []

// ---- Addon state ----

function uidFor(manifestUrl) {
  return crypto.createHash('sha1').update(manifestUrl).digest('hex').slice(0, 12)
}

// Live reachability, keyed by manifest URL. Deliberately not persisted: a
// status is only worth anything for as long as it is fresh, and a stale
// "unreachable" carried across a restart would be a lie about an addon that has
// since recovered.
const addonHealth = new Map()

function healthFor(addon) {
  const entry = addonHealth.get(addon.manifestUrl)

  if (!entry) {
    // Nothing probed yet — the last manifest fetch is the only evidence there is.
    return { state: addon.error ? 'unreachable' : 'unknown', latencyMs: null, checkedAt: null, error: addon.error || null }
  }
  return entry
}

function publicAddon(addon) {
  return {
    uid: uidFor(addon.manifestUrl),
    id: addon.id || null,
    name: addon.name || addon.manifestUrl,
    version: addon.version || '',
    description: addon.description || '',
    logo: addon.logo || null,
    types: addon.types || [],
    catalogCount: (addon.catalogs || []).length,
    resources: (addon.resources || []).map((r) => (typeof r === 'string' ? r : r.name)),
    displayUrl: config.maskUrl(addon.manifestUrl),
    configured: config.hasSecret(addon.manifestUrl),
    enabled: addon.enabled !== false,
    error: addon.error || null,
    health: healthFor(addon),
  }
}

function publicAddons() {
  return addonRecords.map(publicAddon)
}

/** Stores the addon list, notes it for the transfer file, and tells the UI. */
function persistAddons() {
  config.saveAddons(addonRecords)
  transfer.scheduleSave()
  broadcast('addons:changed', publicAddons())
  return publicAddons()
}

function addonByUid(uid) {
  return addonRecords.find((addon) => uidFor(addon.manifestUrl) === uid) || null
}

function enabledAddons() {
  return addonRecords.filter((addon) => addon.enabled !== false && !addon.error)
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/**
 * Marks the transfer file stale and passes the value straight through, so a
 * mutating handler can be wrapped without changing its shape. The write itself
 * is coalesced — see transfer.js.
 */
function touched(value) {
  transfer.scheduleSave()
  return value
}

/** Re-fetches every stored manifest so capabilities stay current (REQ-1.1). */
async function hydrateAddons() {
  const stored = config.getAddons()
  const { addonTimeoutMs } = config.getSettings()

  addonRecords = await Promise.all(
    stored.map(async (entry) => {
      const startedAt = Date.now()
      try {
        const { manifest, manifestUrl } = await addonsLib.fetchManifest(entry.manifestUrl, addonTimeoutMs)
        // A hydrate is already a round trip to every addon, so the status board
        // gets populated for free rather than probing everything a second time.
        addonHealth.set(entry.manifestUrl, {
          state: 'online',
          latencyMs: Date.now() - startedAt,
          checkedAt: Date.now(),
          error: null,
        })
        return addonsLib.toAddonRecord(manifest, manifestUrl, entry.enabled !== false)
      } catch (err) {
        addonHealth.set(entry.manifestUrl, {
          state: 'unreachable',
          latencyMs: Date.now() - startedAt,
          checkedAt: Date.now(),
          error: err.message,
        })
        // Keep unreachable addons in the list rather than silently dropping a
        // user's install — the manager surfaces the error instead.
        return {
          ...entry,
          name: entry.name || entry.manifestUrl,
          enabled: entry.enabled !== false,
          resources: entry.resources || [],
          catalogs: entry.catalogs || [],
          types: entry.types || [],
          error: err.message,
        }
      }
    }),
  )

  persistAddons()
  return addonRecords
}

/**
 * Probes reachability without re-hydrating. `hydrateAddons` rewrites every
 * record from its manifest, which is the wrong tool for "is this thing up?" —
 * it is slower, it churns the stored config, and it cannot report a status
 * while it is still running. This marks each target `checking`, pushes that to
 * the UI, then fills in the answers as they land.
 */
async function checkAddons(targets = addonRecords) {
  if (targets.length === 0) return publicAddons()

  const { addonTimeoutMs } = config.getSettings()

  for (const addon of targets) {
    addonHealth.set(addon.manifestUrl, { ...healthFor(addon), state: 'checking' })
  }
  broadcast('addons:changed', publicAddons())

  await Promise.all(
    targets.map(async (addon) => {
      const result = await addonsLib.probe(addon.manifestUrl, addonTimeoutMs)

      addonHealth.set(addon.manifestUrl, {
        state: result.ok ? 'online' : 'unreachable',
        latencyMs: result.latencyMs,
        checkedAt: result.checkedAt,
        error: result.error,
      })

      // `enabledAddons` skips anything carrying an error, so a probe is not
      // only cosmetic: an addon that has come back starts being queried again,
      // and one that has gone down stops holding up every fan-out. Not written
      // to config — the next hydrate is the authority on what gets stored.
      addon.error = result.ok ? null : result.error
    }),
  )

  broadcast('addons:changed', publicAddons())
  return publicAddons()
}

// ---- P2P engine process ----

let engineProcess = null
let pendingStart = null
let engineState = { running: false, infoHash: null, url: null, name: null }

function settleStart(result, error) {
  if (!pendingStart) return
  const { resolve, reject, timer } = pendingStart
  pendingStart = null
  clearTimeout(timer)
  if (error) reject(error)
  else resolve(result)
}

/**
 * Pushes the guard back while the engine is visibly working. A 4K release with
 * 32 MB pieces can take several minutes to buffer honestly, and this timer
 * firing mid-buffer would abandon a stream that was never actually stuck — and
 * mask the engine's own, far more specific report.
 */
function refreshStartGuard() {
  if (!pendingStart) return
  clearTimeout(pendingStart.timer)
  pendingStart.timer = setTimeout(() => {
    settleStart(null, new Error('Engine stopped responding while preparing the stream'))
  }, pendingStart.guardMs)
}

function onEngineMessage(message) {
  if (!message || typeof message !== 'object') return

  switch (message.type) {
    case 'buffering':
    case 'progress':
    case 'metadata':
      refreshStartGuard()
      break
    case 'ready':
      engineState = {
        running: true,
        infoHash: message.infoHash,
        url: message.url,
        name: message.name,
        file: message.file,
      }
      settleStart(message)
      break
    case 'error':
      settleStart(null, new Error(message.message))
      break
    case 'stopped':
      engineState = { running: false, infoHash: null, url: null, name: null }
      break
    default:
      break
  }

  broadcast('engine:event', message)
}

function ensureEngine() {
  if (engineProcess && engineProcess.connected) return engineProcess

  engineProcess = fork(ENGINE_PATH, [], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    // Electron would otherwise re-launch itself as an app window; this makes
    // the child a plain Node runtime with an IPC channel.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })

  engineProcess.stdout?.on('data', (data) => console.log('[engine]', data.toString().trim()))
  engineProcess.stderr?.on('data', (data) => console.error('[engine ERR]', data.toString().trim()))
  engineProcess.on('message', onEngineMessage)

  engineProcess.on('exit', (code, signal) => {
    engineProcess = null
    engineState = { running: false, infoHash: null, url: null, name: null }
    settleStart(null, new Error(`Engine process exited (code ${code}, signal ${signal})`))
    broadcast('engine:event', { type: 'engine-offline', code, signal })
  })

  return engineProcess
}

/**
 * Where the engine writes. Streaming discards its scratch data, so it lives in
 * the OS temp dir by default; keeping downloads implies somewhere durable.
 */
function resolveDownloadDir(settings) {
  if (settings.downloadDir) return settings.downloadDir
  if (settings.keepDownloads) return path.join(app.getPath('downloads'), 'Orion')
  return null
}

/**
 * Removes `orion-*` scratch folders left behind by a crash or a force-quit.
 * Anything touched in the last five minutes is skipped so a second instance's
 * live stream is never pulled out from under it.
 */
function sweepStaleTempDirs() {
  const tmp = os.tmpdir()
  const cutoff = Date.now() - 5 * 60 * 1000

  let entries = []
  try {
    entries = fs.readdirSync(tmp, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('orion-')) continue
    const target = path.join(tmp, entry.name)
    try {
      if (fs.statSync(target).mtimeMs > cutoff) continue
      fs.rmSync(target, { recursive: true, force: true })
      console.log('[main] Removed stale engine folder:', target)
    } catch {
      /* in use or already gone */
    }
  }
}

/** Starts a torrent and resolves once the loopback URL is playable (REQ-3.1). */
function engineStart(stream, settings) {
  const engine = ensureEngine()
  const magnetUri = streamsLib.buildMagnet(stream)

  return new Promise((resolve, reject) => {
    settleStart(
      null,
      Object.assign(new Error('Superseded by a newer stream request'), { cancelled: true }),
    )

    // Must outlast the engine's own metadata + buffer deadlines, otherwise this
    // fires first and masks the engine's far more specific error. It is reset
    // by every engine event, so it only fires on genuine silence.
    const guardMs = 60000 + (Number(settings.bufferTimeoutMs) || 120000) + 30000

    const timer = setTimeout(() => {
      settleStart(null, new Error('Engine stopped responding while preparing the stream'))
    }, guardMs)

    pendingStart = { resolve, reject, timer, guardMs }

    engine.send({
      cmd: 'start',
      magnetUri,
      infoHash: stream.infoHash,
      fileIdx: stream.fileIdx,
      port: settings.enginePort,
      downloadDir: resolveDownloadDir(settings),
      headBufferBytes: settings.headBufferBytes,
      tailBufferBytes: settings.tailBufferBytes,
      readaheadBytes: settings.readaheadBytes,
      keepDownloads: settings.keepDownloads,
      bufferTimeoutMs: settings.bufferTimeoutMs,
    })
  })
}

function engineStop() {
  // A stop that lands mid-connect has to settle the in-flight start as well.
  // The engine answers a cancelled attempt with silence — no `ready`, no
  // `error` — so without this the play request stays pending behind its guard
  // timer for minutes: the UI goes idle, but the next source picked is racing a
  // request that still believes it owns the engine.
  settleStart(null, Object.assign(new Error('Stopped before playback started'), { cancelled: true }))

  if (engineProcess && engineProcess.connected) engineProcess.send({ cmd: 'stop' })
  engineState = { running: false, infoHash: null, url: null, name: null }
}

function killEngine() {
  if (!engineProcess) return

  const child = engineProcess
  engineProcess = null

  try {
    if (child.connected) child.send({ cmd: 'shutdown' })
  } catch {
    /* channel already closed */
  }

  // Give the engine a moment to unwind its swarm, then make sure it is gone —
  // an orphaned torrent process would keep seeding after Orion exits.
  setTimeout(() => {
    if (child.exitCode !== null) return
    if (process.platform === 'win32') {
      // Tree-kill: the engine's own sockets can outlive a plain .kill() here.
      try {
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } catch {
        /* already gone */
      }
    } else {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
  }, 1500)
}

// ---- Playback tracking ----
//
// Orion never decodes anything, so the only source of a real playback position
// is VLC itself. Its HTTP interface is polled while a session runs; when it
// stops answering, VLC has been closed, the last position is committed and the
// swarm is torn down so nothing keeps downloading after viewing has finished.

const POLL_INTERVAL_MS = 5000
const MISSES_BEFORE_ENDED = 3

let playbackSession = null

function stopPlaybackTracking() {
  if (!playbackSession) return
  clearInterval(playbackSession.timer)
  playbackSession = null
}

function recordProgress(session, status) {
  if (!status || status.lengthSeconds <= 0) return null
  const saved = library.saveProgress(session.profileId, {
    ...session.item,
    positionSeconds: status.timeSeconds,
    durationSeconds: status.lengthSeconds,
  })
  session.last = { ...status, ...saved }
  transfer.scheduleSave()
  return saved
}

function startPlaybackTracking(playerId, control, item, profileId) {
  stopPlaybackTracking()
  if (!control || !item?.id) return

  const session = { playerId, control, item, profileId, misses: 0, last: null, timer: null }

  session.timer = setInterval(async () => {
    if (playbackSession !== session) return

    const status = await players.readStatus(playerId, control)

    if (!status) {
      session.misses += 1
      if (session.misses < MISSES_BEFORE_ENDED) return

      // VLC is gone. Commit whatever was last seen and release the swarm.
      stopPlaybackTracking()
      broadcast('playback:ended', { item: session.item, last: session.last })
      engineStop()

      // Only reached once the player is closed, so the engine has already been
      // told to stop; the countdown gives it far longer than it needs to
      // unwind before a new torrent starts.
      scheduleAutoAdvance(session.item, session.last).catch((err) => {
        console.error('[main] Auto-advance failed:', err.message)
      })
      return
    }

    session.misses = 0
    const saved = recordProgress(session, status)
    if (saved) {
      broadcast('playback:progress', {
        item: session.item,
        state: status.state,
        positionSeconds: status.timeSeconds,
        durationSeconds: status.lengthSeconds,
        percent: saved.percent,
        finished: saved.finished,
      })
    }
  }, POLL_INTERVAL_MS)

  playbackSession = session
}

/** Resume point for an item, ignoring "barely started" and "basically done". */
function resumePointFor(profileId, item) {
  if (!item?.id) return 0
  const existing = library.getProgress(profileId, item.type, item.videoId || item.id)
  if (!existing || existing.finished) return 0
  if (existing.percent < 0.01 || existing.percent > 0.92) return 0
  return Math.max(0, Math.floor(existing.positionSeconds))
}

// ---- Window ----

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 940,
    minHeight: 620,
    title: 'Lunaria',
    backgroundColor: '#08090d',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  const startUrl = isDev
    ? process.env.ELECTRON_START_URL
    : `file://${path.join(__dirname, '..', 'frontend', 'dist', 'index.html')}`

  mainWindow.loadURL(startUrl)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // F11 anywhere in the app, and Escape to leave fullscreen. Handled here
  // rather than in the renderer so it works regardless of focus.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    if (input.key === 'F11') {
      event.preventDefault()
      mainWindow.setFullScreen(!mainWindow.isFullScreen())
    } else if (input.key === 'Escape' && mainWindow.isFullScreen()) {
      event.preventDefault()
      mainWindow.setFullScreen(false)
    }
  })

  for (const change of ['enter-full-screen', 'leave-full-screen']) {
    mainWindow.on(change, () => broadcast('window:fullscreen', { fullscreen: mainWindow.isFullScreen() }))
  }

  // Poster/backdrop links and addon homepages belong in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalSafely(url)
    return { action: 'deny' }
  })

  // The preload bridge is attached to whatever this window is showing, so
  // navigating it to a remote origin would hand that origin the entire IPC
  // surface — file dialogs, player launching, the config. Nothing in the app
  // navigates today (React Router works through the history API, which does not
  // raise this event), so this only ever fires on something unintended.
  mainWindow.webContents.on('will-navigate', (event, target) => {
    if (isAppUrl(target)) return

    event.preventDefault()
    openExternalSafely(target)
  })
}

/** The bundle this window is allowed to show: the built files, or the dev server. */
function isAppUrl(target) {
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return false
  }

  if (isDev && process.env.ELECTRON_START_URL) {
    try {
      if (parsed.origin === new URL(process.env.ELECTRON_START_URL).origin) return true
    } catch {
      /* malformed start URL — fall through to the file check */
    }
  }

  if (parsed.protocol !== 'file:') return false

  // Resolved rather than compared as strings, so `..` cannot walk out of the
  // app directory.
  const appRoot = path.resolve(__dirname, '..')
  const requested = path.resolve(decodeURIComponent(parsed.pathname).replace(/^[/\\]([a-zA-Z]:)/, '$1'))
  return requested === appRoot || requested.startsWith(appRoot + path.sep)
}

// ---- IPC: app + settings ----

ipcMain.handle('app:info', async () => {
  const settings = config.getSettings()
  return {
    platform: process.platform,
    versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
    userData: config.userDataDir(),
    encryptionAvailable: config.encryptionAvailable(),
    vlcPath: await vlc.findVlc(settings.vlcPath),
    // Single source of truth for the language pickers in Settings.
    audioLanguages: streamsLib.SUPPORTED_LANGUAGES,
  }
})

ipcMain.handle('settings:get', () => config.getSettings())

ipcMain.handle('settings:save', (event, patch) => {
  if (patch && ('vlcPath' in patch || 'mpvPath' in patch)) players.invalidateCache()
  return touched(config.saveSettings(patch || {}))
})

ipcMain.handle('cache:clear', () => {
  addonsLib.clearCache()
  return { ok: true }
})

/**
 * Hands a URL to the OS, but only ever a web one. `shell.openExternal` is a
 * launcher: on Windows a `file:` URL runs the executable it points at, and a
 * registered scheme (`ms-msdt:` and friends) starts whatever claimed it. The
 * URLs that reach here come from addon metadata, so the scheme is not ours to
 * trust.
 */
function openExternalSafely(url) {
  let protocol
  try {
    ;({ protocol } = new URL(url))
  } catch {
    return { ok: false, error: 'That is not a valid URL' }
  }

  if (protocol !== 'http:' && protocol !== 'https:') {
    console.warn(`[main] Refused to open a non-web URL externally: ${protocol}`)
    return { ok: false, error: 'Only http and https links can be opened' }
  }

  shell.openExternal(url)
  return { ok: true }
}

ipcMain.handle('app:openExternal', (event, url) => openExternalSafely(url))

ipcMain.handle('app:showInFolder', (event, target) => {
  if (target && fs.existsSync(target)) shell.showItemInFolder(target)
  return { ok: true }
})

const AVATAR_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
}

/**
 * Reads a picture off disk as a data URL. The renderer downscales it before it
 * is stored, so only a small square ends up in the encrypted profile payload.
 */
ipcMain.handle('dialog:chooseImage', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a profile picture',
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
  })

  if (result.canceled || result.filePaths.length === 0) return { dataUrl: null }

  const file = result.filePaths[0]
  const mime = AVATAR_MIME[path.extname(file).toLowerCase()]
  if (!mime) return { dataUrl: null, error: 'That file type is not a supported image' }

  try {
    const stat = fs.statSync(file)
    if (stat.size > 24 * 1024 * 1024) return { dataUrl: null, error: 'That image is too large (24 MB limit)' }

    const data = fs.readFileSync(file)
    return { dataUrl: `data:${mime};base64,${data.toString('base64')}`, name: path.basename(file) }
  } catch (err) {
    return { dataUrl: null, error: err.message }
  }
})

ipcMain.handle('window:toggleFullscreen', () => {
  if (!mainWindow) return { fullscreen: false }
  const next = !mainWindow.isFullScreen()
  mainWindow.setFullScreen(next)
  return { fullscreen: next }
})

ipcMain.handle('window:isFullscreen', () => ({ fullscreen: mainWindow?.isFullScreen() ?? false }))

ipcMain.handle('dialog:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a download folder',
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || result.filePaths.length === 0) return { path: null }
  return { path: result.filePaths[0] }
})

// ---- IPC: addons (SRS 3.1 Addon Manager) ----

ipcMain.handle('addons:list', () => publicAddons())

ipcMain.handle('addons:refresh', async () => {
  await hydrateAddons()
  return publicAddons()
})

ipcMain.handle('addons:check', (event, uid) => {
  const one = uid ? addonByUid(uid) : null
  return checkAddons(one ? [one] : addonRecords)
})

ipcMain.handle('addons:add', async (event, rawUrl) => {
  const { addonTimeoutMs } = config.getSettings()

  let normalized
  try {
    normalized = addonsLib.normalizeManifestUrl(rawUrl)
  } catch (err) {
    return { ok: false, error: `Not a usable manifest URL: ${err.message}` }
  }

  if (addonRecords.some((addon) => addon.manifestUrl === normalized)) {
    return { ok: false, error: 'That addon is already installed' }
  }

  try {
    const { manifest, manifestUrl } = await addonsLib.fetchManifest(normalized, addonTimeoutMs)
    addonRecords.push(addonsLib.toAddonRecord(manifest, manifestUrl, true))
    persistAddons()
    return { ok: true, addons: publicAddons() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('addons:remove', (event, uid) => {
  addonRecords = addonRecords.filter((addon) => uidFor(addon.manifestUrl) !== uid)
  persistAddons()
  return publicAddons()
})

ipcMain.handle('addons:toggle', (event, { uid, enabled }) => {
  const addon = addonByUid(uid)
  if (addon) {
    addon.enabled = Boolean(enabled)
    persistAddons()
  }
  return publicAddons()
})

ipcMain.handle('addons:reorder', (event, uids) => {
  const ordered = []
  for (const uid of uids || []) {
    const addon = addonByUid(uid)
    if (addon && !ordered.includes(addon)) ordered.push(addon)
  }
  for (const addon of addonRecords) if (!ordered.includes(addon)) ordered.push(addon)

  addonRecords = ordered
  persistAddons()
  return publicAddons()
})

// ---- IPC: catalogs, search, meta ----

ipcMain.handle('catalog:shelves', () =>
  addonsLib.homeShelves(enabledAddons()).map((shelf) => ({
    ...shelf,
    uid: uidFor(shelf.manifestUrl),
    manifestUrl: undefined,
    key: `${uidFor(shelf.manifestUrl)}::${shelf.type}::${shelf.catalogId}`,
  })),
)

/**
 * Every catalog the installed addons expose, including the ones that need a
 * genre picked first — those are unusable as a Home shelf but are exactly what
 * Discover is for.
 */
ipcMain.handle('catalog:catalogs', () => {
  const catalogs = []

  for (const addon of enabledAddons()) {
    if (!addonsLib.getResourceDef(addon, 'catalog')) continue

    for (const catalog of addon.catalogs || []) {
      const extras = addonsLib.catalogExtras(catalog)
      const genre = extras.find((extra) => extra.name === 'genre')

      catalogs.push({
        uid: uidFor(addon.manifestUrl),
        addonName: addon.name,
        type: catalog.type,
        catalogId: catalog.id,
        name: catalog.name || catalog.id,
        genres: genre?.options || [],
        requiresGenre: Boolean(genre?.isRequired),
        paginated: extras.some((extra) => extra.name === 'skip'),
        key: `${uidFor(addon.manifestUrl)}::${catalog.type}::${catalog.id}`,
      })
    }
  }

  return catalogs
})

ipcMain.handle('catalog:load', async (event, { uid, type, catalogId, skip = 0, genre = null }) => {
  const addon = addonByUid(uid)
  if (!addon) return { ok: false, error: 'Addon is no longer installed', metas: [] }

  const { addonTimeoutMs } = config.getSettings()
  const extra = {}
  if (skip) extra.skip = skip
  if (genre) extra.genre = genre

  try {
    const metas = await addonsLib.fetchCatalog(addon, type, catalogId, extra, addonTimeoutMs)
    return { ok: true, metas }
  } catch (err) {
    return { ok: false, error: err.message, metas: [] }
  }
})

ipcMain.handle('search:query', async (event, { query, requestId }) => {
  const trimmed = (query || '').trim()
  if (!trimmed) return { ok: true, metas: [], errors: [] }

  const { addonTimeoutMs } = config.getSettings()
  const targets = addonsLib.searchTargets(enabledAddons())

  const collected = []
  const errors = []
  const seen = new Set()

  const absorb = (metas, addonName) => {
    let added = false
    for (const meta of metas || []) {
      if (!meta?.id || seen.has(meta.id)) continue
      seen.add(meta.id)
      collected.push({ ...meta, _addon: addonName })
      added = true
    }
    return added
  }

  // Each catalog is emitted the moment it answers so the grid fills in
  // progressively instead of waiting on the slowest addon (NFR 5.1).
  await Promise.all(
    targets.map(async (target) => {
      const addon = addonRecords.find((a) => a.manifestUrl === target.manifestUrl)
      if (!addon) return
      try {
        const metas = await addonsLib.fetchCatalog(
          addon,
          target.type,
          target.catalogId,
          { search: trimmed },
          addonTimeoutMs,
        )
        if (absorb(metas, target.addonName) && requestId) {
          broadcast('search:partial', { requestId, metas: collected.slice() })
        }
      } catch (err) {
        errors.push({ addon: target.addonName, error: err.message })
      }
    }),
  )

  return { ok: true, metas: collected, errors }
})

/** First addon that answers with metadata for an item wins. */
async function metaFor(type, id) {
  const { addonTimeoutMs } = config.getSettings()
  const capable = enabledAddons().filter((addon) => addonsLib.supportsResource(addon, 'meta', type, id))

  const results = await addonsLib.fanOut(capable, (addon) =>
    addonsLib.fetchMeta(addon, type, id, addonTimeoutMs),
  )

  const hit = results.find((result) => result.ok && result.value)
  if (!hit) {
    const firstError = results.find((result) => !result.ok)
    return { ok: false, error: firstError?.error || 'No addon returned metadata for this item', meta: null }
  }
  return { ok: true, meta: hit.value }
}

ipcMain.handle('meta:get', (event, { type, id }) => metaFor(type, id))

// ---- IPC: streams (REQ-2.1 – 2.3) ----

async function collectStreams(type, id, requestId = null) {
  const { addonTimeoutMs, preferredAudioLanguages } = config.getSettings()
  const preferredAudio = preferredAudioLanguages || []
  const capable = enabledAddons().filter((addon) => addonsLib.supportsResource(addon, 'stream', type, id))

  if (capable.length === 0) {
    return { ok: true, groups: [], errors: [], total: 0, addonsQueried: 0, preferredAudio }
  }

  const collected = []
  const errors = []

  await Promise.all(
    capable.map(async (addon) => {
      try {
        const raw = await addonsLib.fetchStreams(addon, type, id, addonTimeoutMs)
        for (const stream of raw) collected.push(streamsLib.normalizeStream(stream, addon.name))
        if (raw.length > 0 && requestId) {
          broadcast('streams:partial', {
            requestId,
            groups: streamsLib.groupByResolution(collected.slice(), preferredAudio),
            total: collected.length,
          })
        }
      } catch (err) {
        errors.push({ addon: addon.name, error: err.message })
      }
    }),
  )

  return {
    ok: true,
    groups: streamsLib.groupByResolution(collected, preferredAudio),
    errors,
    total: collected.length,
    addonsQueried: capable.length,
    preferredAudio,
  }
}

ipcMain.handle('streams:get', (event, { type, id, requestId }) => collectStreams(type, id, requestId))

// ---- IPC: subtitles ----

async function collectSubtitles(type, id, extra) {
  const { addonTimeoutMs, preferredSubtitleLanguages } = config.getSettings()
  const capable = enabledAddons().filter((addon) => addonsLib.supportsResource(addon, 'subtitles', type, id))

  if (capable.length === 0) {
    return { ok: true, groups: [], errors: [], total: 0, addonsQueried: 0 }
  }

  const collected = []
  const errors = []

  await Promise.all(
    capable.map(async (addon) => {
      try {
        const raw = await addonsLib.fetchSubtitles(addon, type, id, extra || {}, addonTimeoutMs)
        for (const subtitle of raw) collected.push(subtitlesLib.normalizeSubtitle(subtitle, addon.name))
      } catch (err) {
        errors.push({ addon: addon.name, error: err.message })
      }
    }),
  )

  return {
    ok: true,
    groups: subtitlesLib.organise(collected, preferredSubtitleLanguages || []),
    errors,
    total: collected.length,
    addonsQueried: capable.length,
  }
}

ipcMain.handle('subtitles:get', (event, { type, id, extra }) => collectSubtitles(type, id, extra || {}))

// ---- IPC: playback (SRS 4.4) ----

/**
 * Everything between "a stream was chosen" and "a player is running it":
 * engine start or URL resolution, subtitle download, launch, progress
 * tracking. Shared by the play IPC and by auto-advance so the two can never
 * drift apart.
 */
async function startPlayback({ stream, item, subtitle, playerOverride } = {}) {
  // Choosing something to watch overrules a queued next episode, which would
  // otherwise take the player over part-way through.
  cancelAutoAdvance('superseded')

  const settings = config.getSettings()
  const playerId = playerOverride || players.resolveId(settings)
  const player = players.describe(playerId)
  const playerPath = await players.find(playerId, settings)

  if (!playerPath) {
    return {
      ok: false,
      code: 'PLAYER_NOT_FOUND',
      player: playerId,
      error: `${player.name} was not found on this system`,
    }
  }

  const hdr = players.hdrDecision(stream, settings)

  const profileId = activeProfileId()
  const resumeAt = settings.resumePlayback === false ? 0 : resumePointFor(profileId, item)

  try {
    let url

    if (stream.kind === 'p2p') {
      broadcast('play:status', { phase: 'starting-engine', stream: stream.filename })
      const ready = await engineStart(stream, settings)
      url = ready.url
    } else {
      url = streamsLib.directUrlFor(stream)
      if (!url) return { ok: false, code: 'NO_URL', error: 'This stream has no playable source' }
    }

    // Subtitles must be on disk before VLC starts: --sub-file takes no URL.
    let subtitleFile = null
    if (subtitle?.url) {
      broadcast('play:status', { phase: 'fetching-subtitle', stream: stream.filename })
      try {
        subtitleFile = await subtitlesLib.download(subtitle.url)
      } catch (err) {
        // A missing subtitle should never block the film.
        broadcast('play:status', { phase: 'subtitle-failed', stream: stream.filename, error: err.message })
      }
    }

    broadcast('play:status', { phase: 'launching-player', player: player.name, stream: stream.filename })
    const launched = await players.launch(playerId, url, {
      playerPath,
      networkCaching: settings.networkCaching,
      extraArgs: playerId === 'mpv' ? settings.mpvExtraArgs : settings.vlcExtraArgs,
      startTimeSeconds: resumeAt,
      enableControl: settings.trackProgress !== false,
      subtitleFile,
      hdr,
      hdrToneMap: settings.hdrToneMap,
      title: item?.name || stream.filename,
      // Selects the matching track inside a multi-audio file. Independent of
      // which release was chosen — that decision is the user's.
      audioLanguages: subtitlesLib.codesFor(settings.preferredAudioLanguages || []),
      subtitleLanguages: subtitlesLib.codesFor(settings.preferredSubtitleLanguages || []),
    })

    if (settings.trackProgress !== false && item?.id) {
      // The release and subtitle ride along with the item so every progress
      // write records *how* this was watched, not only how far in.
      startPlaybackTracking(
        playerId,
        launched.control,
        { ...item, source: streamsLib.snapshot(stream), subtitle: subtitle || null },
        profileId,
      )
    }

    broadcast('play:status', {
      phase: 'playing',
      stream: stream.filename,
      player: player.name,
      url,
      resumedAt: resumeAt,
      subtitle: subtitleFile ? subtitle.language : null,
      hdr: hdr.isHdr ? hdr.format : null,
    })
    return {
      ok: true,
      url,
      kind: stream.kind,
      pid: launched.pid,
      resumedAt: resumeAt,
      subtitleLoaded: Boolean(subtitleFile),
      player: player.name,
      playerId,
      hdr: hdr.isHdr ? hdr.format : null,
      hdrArgs: players.hdrArgsFor(playerId, hdr, settings),
    }
  } catch (err) {
    // Stopping a connect, or picking a different source part-way through it, is
    // something the user just did on purpose — reporting it as a failure would
    // put an error toast on top of their own action.
    if (err.cancelled) {
      broadcast('play:status', { phase: 'cancelled', stream: stream.filename })
      return { ok: false, code: 'CANCELLED', error: err.message }
    }

    broadcast('play:status', { phase: 'failed', stream: stream.filename, error: err.message })
    return { ok: false, code: 'PLAY_FAILED', error: err.message }
  }
}

ipcMain.handle('play:stream', (event, request = {}) => startPlayback(request))

// ---- Auto-advance (next episode) ----
//
// Starting a torrent and a player without anyone asking is intrusive, so
// nothing launches straight away: the next episode is resolved, announced, and
// only played once a countdown the renderer can cancel has run out.

const AUTO_ADVANCE_DELAY_MS = 10000

let autoAdvance = null

function announceAutoAdvance(phase, detail) {
  broadcast('play:autoAdvance', { phase, ...detail })
}

function cancelAutoAdvance(reason = 'cancelled') {
  if (!autoAdvance) return false

  clearTimeout(autoAdvance.timer)
  const { next } = autoAdvance
  autoAdvance = null
  announceAutoAdvance('cancelled', { next, reason })
  return true
}

/**
 * The episode after the one that just finished, resolved through the same meta
 * the detail page uses. Null for films, for the last episode of a series, and
 * whenever no addon can describe the series any more.
 */
async function nextEpisodeFor(item) {
  if (!item?.id || item.type !== 'series') return null

  const { meta } = await metaFor(item.type, item.id)
  const video = meta ? addonsLib.nextVideo(meta, item.videoId || item.id) : null
  if (!video) return null

  return {
    type: item.type,
    id: item.id,
    videoId: video.id,
    name: meta.name || item.name || '',
    poster: meta.poster || item.poster || null,
    season: video.season,
    episode: video.episode,
    episodeTitle: video.title || video.name || '',
  }
}

/**
 * Picks the release for a follow-on episode. `bingeGroup` is the protocol's own
 * answer to this and is honoured first; after that the same addon at the same
 * resolution is nearly always the same release group, which is what continuing
 * a series should feel like. Otherwise the top of the ranked list.
 */
function pickFollowOnStream(groups, previous) {
  const all = groups.flatMap((group) => group.streams)
  if (all.length === 0) return null

  if (previous) {
    if (previous.bingeGroup) {
      const binge = all.find((stream) => stream.bingeGroup === previous.bingeGroup)
      if (binge) return binge
    }

    const sameRelease = all.find(
      (stream) => stream.addonName === previous.addonName && stream.resolution === previous.resolution,
    )
    if (sameRelease) return sameRelease
  }

  return all[0]
}

/**
 * An external subtitle is tied to the file it was fetched for, so the previous
 * episode's cannot be reused — but the *language* choice should carry over.
 */
async function followOnSubtitle(previous, next) {
  if (!previous?.lang) return null

  try {
    const { groups } = await collectSubtitles(next.type, next.videoId, {})
    const tracks = groups.flatMap((group) => group.tracks)
    return tracks.find((track) => track.lang === previous.lang) || null
  } catch {
    return null
  }
}

async function scheduleAutoAdvance(item, last) {
  if (config.getSettings().autoPlayNext === false) return
  if (!last?.finished) return

  cancelAutoAdvance('superseded')

  const next = await nextEpisodeFor(item)
  if (!next) return

  const { groups } = await collectStreams(next.type, next.videoId)
  const stream = pickFollowOnStream(groups, item.source)

  if (!stream) {
    announceAutoAdvance('unavailable', { next, error: 'No addon offered a stream for the next episode' })
    return
  }

  const subtitle = await followOnSubtitle(item.subtitle, next)

  autoAdvance = {
    next,
    timer: setTimeout(async () => {
      autoAdvance = null
      announceAutoAdvance('starting', { next })

      const result = await startPlayback({ stream, item: next, subtitle })
      if (!result.ok) announceAutoAdvance('failed', { next, error: result.error })
    }, AUTO_ADVANCE_DELAY_MS),
  }

  announceAutoAdvance('scheduled', {
    next,
    startsInMs: AUTO_ADVANCE_DELAY_MS,
    subtitle: subtitle ? subtitle.language : null,
    stream: {
      filename: stream.filename,
      addonName: stream.addonName,
      resolution: stream.resolution,
    },
  })
}

ipcMain.handle('play:cancelAutoAdvance', () => ({ cancelled: cancelAutoAdvance('user') }))

/**
 * Plays an episode nobody has picked a release for yet — an "up next" card.
 * The release is chosen the same way auto-advance chooses one, so continuing a
 * series by hand and by timer land on the same file.
 */
ipcMain.handle('play:next', async (event, { item, previousSource, previousSubtitle } = {}) => {
  if (!item?.videoId) return { ok: false, code: 'NO_ITEM', error: 'No episode to play' }

  const { groups } = await collectStreams(item.type, item.videoId)
  const stream = pickFollowOnStream(groups, previousSource)

  if (!stream) {
    return { ok: false, code: 'NO_STREAM', error: 'No addon offered a stream for this episode' }
  }

  const subtitle = await followOnSubtitle(previousSubtitle, item)
  return startPlayback({ stream, item, subtitle })
})

// ---- IPC: players ----

ipcMain.handle('players:detect', async () => {
  players.invalidateCache()
  const settings = config.getSettings()
  return { players: await players.detectAll(settings), selected: players.resolveId(settings) }
})

ipcMain.handle('players:locate', async (event, playerId) => {
  const isMpv = playerId === 'mpv'
  const filters =
    process.platform === 'win32'
      ? [{ name: isMpv ? 'mpv' : 'VLC', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }]

  const result = await dialog.showOpenDialog(mainWindow, {
    title: `Locate the ${isMpv ? 'mpv' : 'VLC'} executable`,
    properties: process.platform === 'darwin' ? ['openFile', 'treatPackageAsDirectory'] : ['openFile'],
    filters,
  })

  if (result.canceled || result.filePaths.length === 0) return { path: null }

  // Picking mpv.com from a portable folder is corrected to mpv.exe here.
  const chosen = isMpv
    ? require('./mpv').normalizeCandidate(result.filePaths[0])
    : vlc.normalizeCandidate(result.filePaths[0])

  const verified = await players.verifyPath(playerId, chosen)
  if (!verified.ok) {
    return { path: null, error: verified.error || 'That file is not a usable player executable' }
  }

  config.saveSettings(isMpv ? { mpvPath: chosen } : { vlcPath: chosen })
  players.invalidateCache()
  return { path: chosen, version: verified.version || null }
})

// ---- mpv.conf in a portable folder ----

const mpvconf = require('./mpvconf')

async function resolvedMpvPath() {
  const settings = config.getSettings()
  return players.find('mpv', settings)
}

ipcMain.handle('mpvconf:status', async () => {
  const mpvPath = await resolvedMpvPath()
  if (!mpvPath) return { ok: false, error: 'mpv was not found' }

  const settings = config.getSettings()
  return {
    ok: true,
    mpvPath,
    ...mpvconf.read(mpvPath),
    shadow: mpvconf.shadowedUserConfig(),
    preview: mpvconf.renderBlock({
      passthrough: settings.hdrPassthrough !== false,
      toneMap: settings.hdrToneMap || 'clip',
      customOptions: settings.mpvHdrOptions || '',
    }),
  }
})

ipcMain.handle('mpvconf:validate', async (event, text) => {
  const mpvPath = await resolvedMpvPath()
  if (!mpvPath) return { ok: false, error: 'mpv was not found', results: [] }
  return require('./mpv').validateOptions(mpvPath, text)
})

ipcMain.handle('mpvconf:write', async (event, options) => {
  const mpvPath = await resolvedMpvPath()
  if (!mpvPath) return { ok: false, error: 'mpv was not found' }

  const settings = config.getSettings()
  const customOptions = options?.customOptions ?? settings.mpvHdrOptions ?? ''

  // Refuse to write an option mpv would silently ignore.
  if (customOptions.trim()) {
    const validation = await require('./mpv').validateOptions(mpvPath, customOptions)
    if (!validation.ok) {
      return {
        ok: false,
        error: 'Some of your extra options are not valid for this mpv build',
        results: validation.results.filter((entry) => !entry.ok),
      }
    }
  }

  try {
    const result = mpvconf.write(mpvPath, {
      passthrough: options?.passthrough ?? settings.hdrPassthrough !== false,
      toneMap: options?.toneMap || settings.hdrToneMap || 'clip',
      exclusiveFullscreen: Boolean(options?.exclusiveFullscreen),
      customOptions,
    })
    return { ok: true, ...result, shadow: mpvconf.shadowedUserConfig() }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('mpvconf:remove', async () => {
  const mpvPath = await resolvedMpvPath()
  if (!mpvPath) return { ok: false, error: 'mpv was not found' }

  try {
    return { ok: true, ...mpvconf.remove(mpvPath) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('mpvconf:reveal', async () => {
  const mpvPath = await resolvedMpvPath()
  if (!mpvPath) return { ok: false }

  const file = mpvconf.configPath(mpvPath)
  if (fs.existsSync(file)) shell.showItemInFolder(file)
  return { ok: true }
})

/** Portable mpv folders found on disk, so they can be picked without browsing. */
ipcMain.handle('players:portable', async () => {
  const found = players.findPortable()
  const checked = await Promise.all(
    found.map(async (candidate) => ({ path: candidate, ...(await players.verifyPath('mpv', candidate)) })),
  )
  return checked.filter((entry) => entry.ok)
})

/** Lets the UI show exactly which flags a stream would be launched with. */
ipcMain.handle('players:preview', (event, stream) => {
  const settings = config.getSettings()
  const playerId = players.resolveId(settings)
  const hdr = players.hdrDecision(stream, settings)

  return {
    playerId,
    playerName: players.describe(playerId).name,
    hdrSupport: players.describe(playerId).hdrSupport,
    hdrNote: players.describe(playerId).hdrNote,
    hdr: hdr.isHdr ? hdr.format : null,
    reason: hdr.reason,
    args: players.hdrArgsFor(playerId, hdr, settings),
  }
})

// ---- IPC: profiles, watchlist, history ----

ipcMain.handle('profiles:list', () => library.listProfiles())

ipcMain.handle('profiles:current', () => library.getProfile(activeProfileId()))

ipcMain.handle('profiles:select', (event, id) => {
  const profile = library.getProfile(id)
  if (!profile) return null
  currentProfileId = id
  library.touchProfile(id)
  // Switching identity mid-stream would attribute the rest of it to the wrong
  // profile, so the current session is closed out first.
  stopPlaybackTracking()
  broadcast('profiles:changed', { current: profile, profiles: library.listProfiles() })
  return profile
})

ipcMain.handle('profiles:create', (event, details) => {
  const profile = touched(library.createProfile(details || {}))
  broadcast('profiles:changed', { current: library.getProfile(activeProfileId()), profiles: library.listProfiles() })
  return profile
})

ipcMain.handle('profiles:update', (event, { id, ...details }) => {
  const profile = touched(library.updateProfile(id, details))
  broadcast('profiles:changed', { current: library.getProfile(activeProfileId()), profiles: library.listProfiles() })
  return profile
})

ipcMain.handle('profiles:delete', (event, id) => {
  try {
    const remaining = touched(library.deleteProfile(id))
    if (currentProfileId === id) currentProfileId = remaining[0]?.id ?? null
    broadcast('profiles:changed', { current: library.getProfile(activeProfileId()), profiles: remaining })
    return { ok: true, profiles: remaining }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('watchlist:get', () => library.getWatchlist(activeProfileId()))

ipcMain.handle('watchlist:add', (event, item) => touched(library.addToWatchlist(activeProfileId(), item)))

ipcMain.handle('watchlist:remove', (event, { type, id }) =>
  touched(library.removeFromWatchlist(activeProfileId(), type, id)),
)

ipcMain.handle('watchlist:has', (event, { type, id }) => library.inWatchlist(activeProfileId(), type, id))

ipcMain.handle('progress:continue', (event, limit) => library.getContinueWatching(activeProfileId(), limit || 20))

/**
 * Series whose latest episode is finished but which have another one waiting.
 * Kept separate from `progress:continue` because it needs a meta request per
 * series — Home renders the resumable row first and folds these in after.
 */
ipcMain.handle('progress:upNext', async (event, limit) => {
  const profileId = activeProfileId()
  if (!profileId) return []

  const resuming = new Set(library.getContinueWatching(profileId, 50).map((entry) => `${entry.type}:${entry.id}`))
  const finished = library.getFinishedSeries(profileId, limit || 8)

  const resolved = await Promise.all(
    finished
      .filter((entry) => !resuming.has(`${entry.type}:${entry.id}`))
      .map(async (entry) => {
        try {
          const next = await nextEpisodeFor(entry)
          if (!next) return null

          // Deliberately *not* `source`: that release is the previous episode's
          // file and would play the wrong thing. It travels as a hint for
          // matching the same release group when this card is played.
          return {
            ...next,
            previousSource: entry.source || null,
            previousSubtitle: entry.subtitle || null,
            upNext: true,
            updatedAt: entry.updatedAt,
          }
        } catch {
          return null
        }
      }),
  )

  return resolved.filter(Boolean)
})

ipcMain.handle('progress:get', (event, { type, videoId }) =>
  library.getProgress(activeProfileId(), type, videoId),
)

/**
 * Removes a title from Continue watching. For a series that means the whole
 * show, not the episode showing on the card: the card is only ever a window
 * onto the series, so clearing one episode just slides the next one into view.
 * `id` is the catalogue root; without it there is nothing to clear a series by,
 * so the single-video delete stays the fallback.
 */
ipcMain.handle('progress:clear', (event, { type, videoId, id }) => {
  const profileId = activeProfileId()

  if (type === 'series' && id) return touched(library.clearSeriesProgress(profileId, type, id))
  return touched(library.clearProgress(profileId, type, videoId || id))
})

ipcMain.handle('progress:clearAll', () => touched(library.clearAllProgress(activeProfileId())))

ipcMain.handle('library:stats', () => library.stats(activeProfileId()))

/**
 * Loads a subtitle into the player that is already running. mpv can take one
 * over its IPC channel; VLC's HTTP interface has no equivalent, so there the
 * track has to be chosen before playback starts.
 */
ipcMain.handle('play:addSubtitle', async (event, subtitle) => {
  if (!playbackSession) return { ok: false, error: 'Nothing is playing' }
  if (playbackSession.playerId !== 'mpv') {
    return { ok: false, error: 'VLC cannot load a subtitle mid-playback — pick one before pressing play' }
  }
  if (!subtitle?.url) return { ok: false, error: 'That subtitle has no URL' }

  try {
    const file = await subtitlesLib.download(subtitle.url)
    const result = await require('./mpv').addSubtitle(playbackSession.control, file, subtitle.language || 'Orion')
    if (!result.ok) return { ok: false, error: result.error }

    broadcast('play:status', { phase: 'subtitle-added', subtitle: subtitle.language })
    return { ok: true, language: subtitle.language }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

ipcMain.handle('engine:stop', () => {
  engineStop()
  return { ok: true }
})

ipcMain.handle('engine:status', () => engineState)

// ---- IPC: VLC ----

ipcMain.handle('vlc:detect', async () => {
  const settings = config.getSettings()
  vlc.invalidateCache()
  const found = await vlc.findVlc(settings.vlcPath)
  return { path: found }
})

ipcMain.handle('vlc:locate', async () => {
  const filters =
    process.platform === 'win32'
      ? [{ name: 'VLC', extensions: ['exe'] }]
      : [{ name: 'All files', extensions: ['*'] }]

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Locate the VLC executable',
    properties: process.platform === 'darwin' ? ['openFile', 'treatPackageAsDirectory'] : ['openFile'],
    filters,
  })

  if (result.canceled || result.filePaths.length === 0) return { path: null }

  const chosen = vlc.normalizeCandidate(result.filePaths[0])
  if (!vlc.isExecutableFile(chosen)) {
    return { path: null, error: 'That file is not an executable' }
  }

  config.saveSettings({ vlcPath: chosen })
  vlc.invalidateCache()
  return { path: chosen }
})

// ---- IPC: transfer file ----

ipcMain.handle('transfer:status', () => transfer.status())

ipcMain.handle('transfer:save', () => {
  const written = transfer.saveNow({ force: true })
  return written ? { ok: true, ...written } : { ok: false, error: 'Could not write the transfer file' }
})

ipcMain.handle('transfer:reveal', () => {
  const target = transfer.defaultPath()
  if (!fs.existsSync(target)) transfer.saveNow({ force: true })
  shell.showItemInFolder(target)
  return { ok: true }
})

/** Writes a copy wherever the user asks, for carrying to the other machine. */
ipcMain.handle('transfer:export', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Lunaria config',
    defaultPath: transfer.FILE_NAME,
    filters: [{ name: 'Lunaria config', extensions: ['json'] }],
  })

  if (result.canceled || !result.filePath) return { ok: false, cancelled: true }

  try {
    const written = transfer.writeTo(result.filePath)
    return { ok: true, path: written.path, bytes: written.bytes, summary: transfer.describe(written.snapshot) }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

/**
 * Two steps on purpose: the first reads the file and reports what is in it, so
 * the user sees whose profiles they are about to merge in before anything is
 * written. Passing `apply` performs it.
 */
ipcMain.handle('transfer:import', async (event, { file, apply = false, mode = 'merge' } = {}) => {
  let source = file

  if (!source) {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Lunaria config',
      properties: ['openFile'],
      filters: [{ name: 'Lunaria config', extensions: ['json'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true }
    source = result.filePaths[0]
  }

  let snapshot
  try {
    snapshot = transfer.read(source)
  } catch (err) {
    return { ok: false, error: err.message }
  }

  const summary = transfer.describe(snapshot)
  if (!apply) return { ok: true, preview: true, file: source, summary }

  try {
    const applied = transfer.applySnapshot(snapshot, { mode })

    // Addons arrive as bare URLs; hydrating fills in their manifests and gives
    // the status board something real to show.
    await hydrateAddons()
    broadcast('profiles:changed', {
      current: library.getProfile(activeProfileId()),
      profiles: library.listProfiles(),
    })

    return { ok: true, file: source, summary, applied }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// ---- Lifecycle ----

app.whenReady().then(() => {
  library.init()
  // Before the window opens, so a fresh install that was handed a config file
  // comes up already wearing it rather than flashing an empty first-run state.
  transfer.adoptIfFresh()

  createWindow()
  sweepStaleTempDirs()
  hydrateAddons().catch((err) => console.error('[main] Addon hydration failed:', err.message))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killEngine()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopPlaybackTracking()
  killEngine()
  subtitlesLib.cleanup()
  // Before the database closes: the flush reads through it.
  transfer.flush()
  library.close()
})
