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
    showInFolder: (target) => ipcRenderer.invoke('app:showInFolder', target),
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

  play: {
    stream: (stream) => ipcRenderer.invoke('play:stream', stream),
    onStatus: (handler) => subscribe('play:status', handler),
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
