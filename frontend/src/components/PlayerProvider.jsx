import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { appApi, engineApi, playApi, vlcApi } from '../api/orion.js'
import EngineBar from './EngineBar.jsx'

const PlayerContext = createContext(null)

export function usePlayer() {
  const context = useContext(PlayerContext)
  if (!context) throw new Error('usePlayer must be used inside <PlayerProvider>')
  return context
}

const IDLE_ENGINE = {
  active: false,
  phase: 'idle',
  name: null,
  progress: 0,
  downloaded: 0,
  length: 0,
  downloadSpeed: 0,
  numPeers: 0,
  url: null,
  buffer: null,
}

let toastId = 0

/**
 * Owns everything that happens after a stream is clicked: engine progress,
 * VLC hand-off and the resulting notifications. Kept above the router so a
 * torrent keeps reporting while the user browses elsewhere.
 */
export default function PlayerProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [busyStreamId, setBusyStreamId] = useState(null)
  const [engine, setEngine] = useState(IDLE_ENGINE)

  const dismissToast = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (toast) => {
      const id = ++toastId
      setToasts((current) => [...current, { ...toast, id }])
      if (toast.duration !== 0) {
        setTimeout(() => dismissToast(id), toast.duration || 7000)
      }
      return id
    },
    [dismissToast],
  )

  const locateVlc = useCallback(async () => {
    const result = await vlcApi.locate()
    if (result.path) {
      pushToast({ tone: 'success', title: 'VLC set', message: result.path })
    } else if (result.error) {
      pushToast({ tone: 'error', title: 'Not usable', message: result.error })
    }
  }, [pushToast])

  useEffect(() => {
    const unsubscribe = engineApi.onEvent((event) => {
      switch (event.type) {
        case 'metadata':
          setEngine((current) => ({
            ...current,
            active: true,
            phase: 'buffering',
            name: event.file?.name || event.name,
            length: event.file?.length || 0,
            url: event.url,
          }))
          break
        case 'buffering':
          setEngine((current) => ({
            ...current,
            active: true,
            phase: 'buffering',
            numPeers: event.numPeers ?? current.numPeers,
            downloadSpeed: event.downloadSpeed ?? current.downloadSpeed,
            buffer: {
              headDone: event.headDone ?? 0,
              headTarget: event.headTarget ?? 0,
              tailPresent: event.tailPresent ?? 0,
              tailTotal: event.tailTotal ?? 0,
            },
          }))
          break
        case 'progress':
          setEngine((current) => ({
            ...current,
            active: true,
            progress: event.progress ?? current.progress,
            downloaded: event.downloaded ?? current.downloaded,
            length: event.length || current.length,
            downloadSpeed: event.downloadSpeed ?? 0,
            numPeers: event.numPeers ?? 0,
          }))
          break
        case 'ready':
          setEngine((current) => ({ ...current, active: true, phase: 'streaming', url: event.url }))
          break
        case 'stopped':
          setEngine(IDLE_ENGINE)
          if (event.kept?.path) {
            pushToast({
              tone: event.kept.complete ? 'success' : 'info',
              title: event.kept.complete ? 'Download kept' : 'Kept (incomplete)',
              message: event.kept.path,
              duration: 0,
              action: { label: 'Show in folder', run: () => appApi.showInFolder(event.kept.path) },
            })
          }
          break
        case 'engine-offline':
          setEngine(IDLE_ENGINE)
          break
        case 'error':
          setEngine(IDLE_ENGINE)
          pushToast({ tone: 'error', title: 'Engine error', message: event.message })
          break
        default:
          break
      }
    })
    return unsubscribe
  }, [pushToast])

  const play = useCallback(
    async (stream, item, subtitle) => {
      setBusyStreamId(stream.id)

      if (stream.kind === 'p2p') {
        setEngine({ ...IDLE_ENGINE, active: true, phase: 'connecting', name: stream.filename })
      }

      try {
        const result = await playApi.stream(stream, item, subtitle)

        if (result.ok) {
          const parts = []
          if (result.resumedAt > 0) {
            parts.push(`resuming at ${Math.floor(result.resumedAt / 60)}m ${result.resumedAt % 60}s`)
          }
          if (result.subtitleLoaded) parts.push(`${subtitle.language} subtitles`)

          pushToast({
            tone: 'success',
            title: 'Handed to VLC',
            message: parts.length > 0 ? parts.join(' · ') : stream.filename,
          })
        } else if (result.code === 'VLC_NOT_FOUND') {
          setEngine(IDLE_ENGINE)
          pushToast({
            tone: 'error',
            title: 'VLC not found',
            message: 'Orion could not locate a VLC install on this machine.',
            duration: 0,
            action: { label: 'Locate VLC…', run: locateVlc },
          })
        } else {
          setEngine(IDLE_ENGINE)
          pushToast({ tone: 'error', title: 'Playback failed', message: result.error })
        }

        return result
      } finally {
        setBusyStreamId(null)
      }
    },
    [locateVlc, pushToast],
  )

  const stopEngine = useCallback(async () => {
    await engineApi.stop()
    setEngine(IDLE_ENGINE)
  }, [])

  const value = useMemo(
    () => ({ play, stopEngine, busyStreamId, engine, pushToast, locateVlc }),
    [play, stopEngine, busyStreamId, engine, pushToast, locateVlc],
  )

  return (
    <PlayerContext.Provider value={value}>
      {children}
      <EngineBar engine={engine} onStop={stopEngine} />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </PlayerContext.Provider>
  )
}

const TOAST_TONES = {
  success: { icon: CheckCircle2, ring: 'ring-emerald-500/30', accent: 'text-emerald-300' },
  error: { icon: AlertTriangle, ring: 'ring-rose-500/30', accent: 'text-rose-300' },
  info: { icon: Info, ring: 'ring-accent/30', accent: 'text-accent-soft' },
}

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-[336px] flex-col gap-2">
      {toasts.map((toast) => {
        const tone = TOAST_TONES[toast.tone] || TOAST_TONES.info
        const Icon = tone.icon

        return (
          <div
            key={toast.id}
            className={`pointer-events-auto animate-risein rounded-xl bg-ink-850/95 p-3 shadow-poster ring-1 backdrop-blur ${tone.ring}`}
          >
            <div className="flex items-start gap-2.5">
              <Icon size={16} className={`mt-0.5 shrink-0 ${tone.accent}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-100">{toast.title}</p>
                {toast.message && (
                  <p className="mt-0.5 break-words text-[12px] leading-snug text-haze">{toast.message}</p>
                )}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action.run()
                      onDismiss(toast.id)
                    }}
                    className="focus-ring mt-2 rounded-md bg-accent/15 px-2.5 py-1 text-[12px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/25"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => onDismiss(toast.id)}
                className="focus-ring rounded p-0.5 text-ink-500 transition hover:text-slate-300"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
