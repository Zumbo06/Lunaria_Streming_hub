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
    onChanged: (handler) => subscribe('addons:changed', handler),
  },

  catalog: {
    shelves: () => ipcRenderer.invoke('catalog:shelves'),
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
    stream: (stream, item, subtitle) => ipcRenderer.invoke('play:stream', { stream, item, subtitle }),
    onStatus: (handler) => subscribe('play:status', handler),
    onProgress: (handler) => subscribe('playback:progress', handler),
    onEnded: (handler) => subscribe('playback:ended', handler),
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
    get: (type, videoId) => ipcRenderer.invoke('progress:get', { type, videoId }),
    clear: (type, videoId) => ipcRenderer.invoke('progress:clear', { type, videoId }),
    clearAll: () => ipcRenderer.invoke('progress:clearAll'),
    stats: () => ipcRenderer.invoke('library:stats'),
  },

  engine: {
    stop: () => ipcRenderer.invoke('engine:stop'),
    status: () => ipcRenderer.invoke('engine:status'),
    onEvent: (handler) => subscribe('engine:event', handler),
  },

  vlc: {
    detect: () => ipcRenderer.invoke('vlc:detect'),
    locate: () => ipcRenderer.invoke('vlc:locate'),
  },
})
