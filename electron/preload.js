const { contextBridge, ipcRenderer } = require('electron')

/**
 * The renderer's only route to the system. Addons are addressed by opaque
 * `uid` handles rather than manifest URLs, so a Debrid token embedded in an
 * addon URL never reaches page context (NFR 5.2).
 */
function subscribe(channel, handler) {
  const listener = (event, payload) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

contextBridge.exposeInMainWorld('orion', {
  app: {
    info: () => ipcRenderer.invoke('app:info'),
    openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
    clearCache: () => ipcRenderer.invoke('cache:clear'),
    chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
    chooseImage: () => ipcRenderer.invoke('dialog:chooseImage'),
    showInFolder: (target) => ipcRenderer.invoke('app:showInFolder', target),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen'),
    isFullscreen: () => ipcRenderer.invoke('window:isFullscreen'),
    onFullscreenChange: (handler) => subscribe('window:fullscreen', handler),
  },

  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
  },

  addons: {
    list: () => ipcRenderer.invoke('addons:list'),
    add: (url) => ipcRenderer.invoke('addons:add', url),
    remove: (uid) => ipcRenderer.invoke('addons:remove', uid),
    toggle: (uid, enabled) => ipcRenderer.invoke('addons:toggle', { uid, enabled }),
    reorder: (uids) => ipcRenderer.invoke('addons:reorder', uids),
    refresh: () => ipcRenderer.invoke('addons:refresh'),
    // No uid checks every addon.
    check: (uid) => ipcRenderer.invoke('addons:check', uid),
    onChanged: (handler) => subscribe('addons:changed', handler),
  },

  transfer: {
    status: () => ipcRenderer.invoke('transfer:status'),
    save: () => ipcRenderer.invoke('transfer:save'),
    reveal: () => ipcRenderer.invoke('transfer:reveal'),
    export: () => ipcRenderer.invoke('transfer:export'),
    // Without `apply` this only reads the file back and reports what is in it.
    inspect: (file) => ipcRenderer.invoke('transfer:import', { file }),
    import: (file, mode) => ipcRenderer.invoke('transfer:import', { file, apply: true, mode }),
  },

  catalog: {
    shelves: () => ipcRenderer.invoke('catalog:shelves'),
    catalogs: () => ipcRenderer.invoke('catalog:catalogs'),
    load: (params) => ipcRenderer.invoke('catalog:load', params),
  },

  search: {
    query: (query, requestId) => ipcRenderer.invoke('search:query', { query, requestId }),
    onPartial: (handler) => subscribe('search:partial', handler),
  },

  meta: {
    get: (type, id) => ipcRenderer.invoke('meta:get', { type, id }),
  },

  streams: {
    get: (type, id, requestId) => ipcRenderer.invoke('streams:get', { type, id, requestId }),
    onPartial: (handler) => subscribe('streams:partial', handler),
  },

  subtitles: {
    get: (type, id, extra) => ipcRenderer.invoke('subtitles:get', { type, id, extra }),
  },

  play: {
    stream: (stream, item, subtitle, playerOverride) =>
      ipcRenderer.invoke('play:stream', { stream, item, subtitle, playerOverride }),
    next: (item, previousSource, previousSubtitle) =>
      ipcRenderer.invoke('play:next', { item, previousSource, previousSubtitle }),
    onStatus: (handler) => subscribe('play:status', handler),
    addSubtitle: (subtitle) => ipcRenderer.invoke('play:addSubtitle', subtitle),
    onProgress: (handler) => subscribe('playback:progress', handler),
    onEnded: (handler) => subscribe('playback:ended', handler),
    onAutoAdvance: (handler) => subscribe('play:autoAdvance', handler),
    cancelAutoAdvance: () => ipcRenderer.invoke('play:cancelAutoAdvance'),
  },

  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    current: () => ipcRenderer.invoke('profiles:current'),
    select: (id) => ipcRenderer.invoke('profiles:select', id),
    create: (details) => ipcRenderer.invoke('profiles:create', details),
    update: (details) => ipcRenderer.invoke('profiles:update', details),
    remove: (id) => ipcRenderer.invoke('profiles:delete', id),
    onChanged: (handler) => subscribe('profiles:changed', handler),
  },

  watchlist: {
    get: () => ipcRenderer.invoke('watchlist:get'),
    add: (item) => ipcRenderer.invoke('watchlist:add', item),
    remove: (type, id) => ipcRenderer.invoke('watchlist:remove', { type, id }),
    has: (type, id) => ipcRenderer.invoke('watchlist:has', { type, id }),
  },

  progress: {
    continueWatching: (limit) => ipcRenderer.invoke('progress:continue', limit),
    upNext: (limit) => ipcRenderer.invoke('progress:upNext', limit),
    get: (type, videoId) => ipcRenderer.invoke('progress:get', { type, videoId }),
    // `id` is the catalogue root — for a series it is what removes the whole
    // show rather than only the episode on the card.
    clear: (type, videoId, id) => ipcRenderer.invoke('progress:clear', { type, videoId, id }),
    clearAll: () => ipcRenderer.invoke('progress:clearAll'),
    stats: () => ipcRenderer.invoke('library:stats'),
  },

  engine: {
    stop: () => ipcRenderer.invoke('engine:stop'),
    status: () => ipcRenderer.invoke('engine:status'),
    onEvent: (handler) => subscribe('engine:event', handler),
  },

  players: {
    detect: () => ipcRenderer.invoke('players:detect'),
    locate: (playerId) => ipcRenderer.invoke('players:locate', playerId),
    portable: () => ipcRenderer.invoke('players:portable'),
    mpvConfigStatus: () => ipcRenderer.invoke('mpvconf:status'),
    writeMpvConfig: (options) => ipcRenderer.invoke('mpvconf:write', options),
    validateMpvOptions: (text) => ipcRenderer.invoke('mpvconf:validate', text),
    removeMpvConfig: () => ipcRenderer.invoke('mpvconf:remove'),
    revealMpvConfig: () => ipcRenderer.invoke('mpvconf:reveal'),
    preview: (stream) => ipcRenderer.invoke('players:preview', stream),
  },

  vlc: {
    detect: () => ipcRenderer.invoke('vlc:detect'),
    locate: () => ipcRenderer.invoke('vlc:locate'),
  },
})
