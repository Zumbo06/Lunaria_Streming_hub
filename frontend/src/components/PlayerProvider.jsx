import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { appApi, engineApi, playApi, playersApi, settingsApi } from '../api/orion.js'
import ConnectionLoadingModal from './ConnectionLoadingModal.jsx'
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
 * VLC / mpv hand-off, rich loading screen and notifications.
 */
export default function PlayerProvider({ children }) {
  const navigate = useNavigate()
  const [toasts, setToasts] = useState([])
  const [busyStreamId, setBusyStreamId] = useState(null)
  const [engine, setEngine] = useState(IDLE_ENGINE)
  const [loadingSession, setLoadingSession] = useState(null)
  const [defaultPlayerName, setDefaultPlayerName] = useState('player')
  const autoAdvanceToast = useRef(null)
  const closeLoadingTimer = useRef(null)

  // Fetch configured default player name for display
  useEffect(() => {
    settingsApi.get().then((settings) => {
      if (settings?.player) {
        setDefaultPlayerName(settings.player === 'mpv' ? 'mpv' : 'VLC')
      }
    }).catch(() => {})
  }, [])

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

  const locatePlayer = useCallback(
    async (playerId = 'vlc') => {
      const result = await playersApi.locate(playerId)
      if (result.path) {
        pushToast({ tone: 'success', title: 'Player set', message: result.path })
      } else if (result.error) {
        pushToast({ tone: 'error', title: 'Not usable', message: result.error })
      }
    },
    [pushToast],
  )

  // Engine event subscriptions
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
          setLoadingSession((s) => (s ? { ...s, phase: 'buffering' } : s))
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
          setLoadingSession((s) => (s ? { ...s, phase: 'buffering' } : s))
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
          setLoadingSession((s) => (s ? { ...s, phase: 'ready' } : s))
          break
        case 'stopped':
          setEngine(IDLE_ENGINE)
          setLoadingSession(null)
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
          setLoadingSession(null)
          break
        case 'error':
          setEngine(IDLE_ENGINE)
          setLoadingSession((s) => (s ? { ...s, phase: 'error', error: event.message } : s))
          pushToast({ tone: 'error', title: 'Engine error', message: event.message })
          break
        default:
          break
      }
    })
    return unsubscribe
  }, [pushToast])

  // Play status event subscriptions
  useEffect(() => {
    const unsubscribe = playApi.onStatus((event) => {
      switch (event.phase) {
        case 'starting-engine':
          setLoadingSession((s) => (s ? { ...s, phase: 'connecting' } : s))
          break
        case 'fetching-subtitle':
          setLoadingSession((s) => (s ? { ...s, phase: 'buffering' } : s))
          break
        case 'launching-player':
          setLoadingSession((s) =>
            s ? { ...s, phase: 'playing', player: event.player || s.player } : s,
          )
          break
        case 'playing':
          setLoadingSession((s) =>
            s ? { ...s, phase: 'playing', player: event.player || s.player } : s,
          )
          // Smoothly close loading screen once player is launched
          clearTimeout(closeLoadingTimer.current)
          closeLoadingTimer.current = setTimeout(() => {
            setLoadingSession(null)
          }, 1400)
          break
        case 'cancelled':
          setLoadingSession(null)
          break
        case 'failed':
          setLoadingSession((s) => (s ? { ...s, phase: 'error', error: event.error } : s))
          break
        default:
          break
      }
    })
    return () => {
      unsubscribe?.()
      clearTimeout(closeLoadingTimer.current)
    }
  }, [])

  const stopEngine = useCallback(async () => {
    clearTimeout(closeLoadingTimer.current)
    setLoadingSession(null)
    await engineApi.stop()
    setEngine(IDLE_ENGINE)
  }, [])

  const play = useCallback(
    async (stream, item, subtitle) => {
      clearTimeout(closeLoadingTimer.current)
      setBusyStreamId(stream.id)

      // Initialize loading session with full visual metadata
      setLoadingSession({
        stream,
        item,
        subtitle,
        phase: stream.kind === 'p2p' ? 'connecting' : 'starting-engine',
        player: defaultPlayerName,
        error: null,
        isMinimized: false,
        startTime: Date.now(),
      })

      if (stream.kind === 'p2p') {
        setEngine({ ...IDLE_ENGINE, active: true, phase: 'connecting', name: stream.filename })
      }

      try {
        const result = await playApi.stream(stream, item, subtitle)

        if (result.ok) {
          const parts = []
          if (result.hdr) parts.push(`${result.hdr}`)
          if (result.resumedAt > 0) {
            parts.push(`resuming at ${Math.floor(result.resumedAt / 60)}m ${result.resumedAt % 60}s`)
          }
          if (result.subtitleLoaded) parts.push(`${subtitle.language} subtitles`)

          setLoadingSession((s) =>
            s ? { ...s, phase: 'playing', player: result.player || s.player } : s,
          )

          pushToast({
            tone: 'success',
            title: `Handed to ${result.player}`,
            message: parts.length > 0 ? parts.join(' · ') : stream.filename,
          })

          // Close modal gracefully after player launched
          clearTimeout(closeLoadingTimer.current)
          closeLoadingTimer.current = setTimeout(() => {
            setLoadingSession(null)
          }, 1200)
        } else if (result.code === 'CANCELLED') {
          // The user stopped this themselves
          setEngine(IDLE_ENGINE)
          setLoadingSession(null)
        } else if (result.code === 'PLAYER_NOT_FOUND') {
          setEngine(IDLE_ENGINE)
          setLoadingSession((s) =>
            s
              ? {
                  ...s,
                  phase: 'error',
                  error: `${result.player === 'mpv' ? 'mpv' : 'VLC'} was not found on this machine.`,
                }
              : null,
          )
          pushToast({
            tone: 'error',
            title: result.error,
            message: `Lunaria could not locate ${result.player === 'mpv' ? 'mpv' : 'VLC'} on this machine.`,
            duration: 0,
            action: { label: 'Locate it…', run: () => locatePlayer(result.player) },
          })
        } else {
          setEngine(IDLE_ENGINE)
          setLoadingSession((s) =>
            s ? { ...s, phase: 'error', error: result.error || 'Playback failed' } : null,
          )
          pushToast({ tone: 'error', title: 'Playback failed', message: result.error })
        }

        return result
      } finally {
        setBusyStreamId(null)
      }
    },
    [defaultPlayerName, locatePlayer, pushToast],
  )

  const openEntryDetails = useCallback(
    (entry, state) => {
      navigate(`/title/${encodeURIComponent(entry.type)}/${encodeURIComponent(entry.id)}`, {
        state: { episodeId: entry.videoId || null, ...state },
      })
    },
    [navigate],
  )

  /**
   * Continues a Continue watching card. A resumable entry replays the release
   * it was watched with; an "up next" card has no release yet, so the main
   * process picks one matching the previous episode.
   */
  const resumeEntry = useCallback(
    async (entry) => {
      const item = {
        type: entry.type,
        id: entry.id,
        videoId: entry.videoId || entry.id,
        name: entry.name,
        poster: entry.poster || null,
        background: entry.background || entry.poster || null,
        season: entry.season ?? null,
        episode: entry.episode ?? null,
        episodeTitle: entry.episodeTitle || null,
      }

      if (entry.upNext) {
        setBusyStreamId(`next:${item.videoId}`)
        setLoadingSession({
          stream: { filename: `Next: S${item.season}:E${item.episode}`, kind: 'p2p' },
          item,
          subtitle: null,
          phase: 'connecting',
          player: defaultPlayerName,
          error: null,
          isMinimized: false,
          startTime: Date.now(),
        })

        try {
          const result = await playApi.next(
            item,
            entry.previousSource || null,
            entry.previousSubtitle || null,
          )

          if (result.ok) {
            setLoadingSession((s) =>
              s ? { ...s, phase: 'playing', player: result.player || s.player } : s,
            )
            pushToast({
              tone: 'success',
              title: `Handed to ${result.player}`,
              message: `S${item.season}:E${item.episode}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ''}`,
            })
            clearTimeout(closeLoadingTimer.current)
            closeLoadingTimer.current = setTimeout(() => {
              setLoadingSession(null)
            }, 1200)
          } else {
            setLoadingSession(null)
            pushToast({
              tone: 'error',
              title: 'Could not start the next episode',
              message: result.error,
            })
            openEntryDetails(entry, { resumeFailed: result.error })
          }
          return result
        } finally {
          setBusyStreamId(null)
        }
      }

      if (!entry.source) {
        openEntryDetails(entry)
        return null
      }

      const result = await play(entry.source, item, entry.subtitle || null)

      if (!result?.ok && result?.code !== 'PLAYER_NOT_FOUND') {
        openEntryDetails(entry, {
          resumeFailed: result?.error || 'That source could not be started',
          highlightSourceId: entry.source.id,
        })
      }
      return result
    },
    [defaultPlayerName, openEntryDetails, play, pushToast],
  )

  // Auto-advance announcements
  useEffect(() => {
    const unsubscribe = playApi.onAutoAdvance((event) => {
      if (autoAdvanceToast.current) {
        dismissToast(autoAdvanceToast.current)
        autoAdvanceToast.current = null
      }

      const label = event.next ? `S${event.next.season}:E${event.next.episode}` : 'the next episode'

      switch (event.phase) {
        case 'scheduled':
          autoAdvanceToast.current = pushToast({
            tone: 'info',
            title: `Up next · ${label}`,
            message: [event.next?.episodeTitle, event.stream?.filename].filter(Boolean).join(' — '),
            countdownTo: Date.now() + (event.startsInMs || 0),
            duration: 0,
            action: { label: 'Cancel', run: () => playApi.cancelAutoAdvance() },
          })
          break
        case 'cancelled':
          if (event.reason === 'user') {
            pushToast({ tone: 'info', title: 'Stopped', message: `${label} will not start automatically` })
          }
          break
        case 'unavailable':
        case 'failed':
          pushToast({ tone: 'error', title: `Could not start ${label}`, message: event.error })
          break
        default:
          break
      }
    })
    return unsubscribe
  }, [dismissToast, pushToast])

  const applySubtitleNow = useCallback(
    async (subtitle) => {
      const result = await playApi.addSubtitle(subtitle)
      pushToast(
        result.ok
          ? { tone: 'success', title: 'Subtitle loaded', message: `${result.language} track added to mpv` }
          : { tone: 'error', title: 'Could not load subtitle', message: result.error },
      )
      return result
    },
    [pushToast],
  )

  const minimizeLoading = useCallback(() => {
    setLoadingSession((s) => (s ? { ...s, isMinimized: true } : null))
  }, [])

  const maximizeLoading = useCallback(() => {
    setLoadingSession((s) => {
      if (s) return { ...s, isMinimized: false }
      // If engine is running without session, reconstruct minimal session from engine state
      if (engine.active) {
        return {
          stream: { filename: engine.name, kind: 'p2p' },
          item: { name: engine.name },
          subtitle: null,
          phase: engine.phase,
          player: defaultPlayerName,
          error: null,
          isMinimized: false,
        }
      }
      return null
    })
  }, [engine, defaultPlayerName])

  const value = useMemo(
    () => ({
      play,
      resumeEntry,
      openEntryDetails,
      stopEngine,
      busyStreamId,
      engine,
      pushToast,
      locatePlayer,
      applySubtitleNow,
      loadingSession,
      minimizeLoading,
      maximizeLoading,
    }),
    [
      play,
      resumeEntry,
      openEntryDetails,
      stopEngine,
      busyStreamId,
      engine,
      pushToast,
      locatePlayer,
      applySubtitleNow,
      loadingSession,
      minimizeLoading,
      maximizeLoading,
    ],
  )

  const isModalOpen = Boolean(loadingSession && !loadingSession.isMinimized)

  return (
    <PlayerContext.Provider value={value}>
      {children}

      {/* Fullscreen Stremio-Style Loading Screen */}
      <ConnectionLoadingModal
        open={isModalOpen}
        session={loadingSession}
        engine={engine}
        onCancel={stopEngine}
        onMinimize={minimizeLoading}
      />

      {/* Bottom Bar: Visible when engine active and modal minimized */}
      {(!isModalOpen || loadingSession?.isMinimized) && (
        <EngineBar engine={engine} onStop={stopEngine} onExpand={maximizeLoading} />
      )}

      {/* Notifications */}
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </PlayerContext.Provider>
  )
}

const TOAST_TONES = {
  success: { icon: CheckCircle2, ring: 'ring-emerald-500/30', accent: 'text-emerald-300' },
  error: { icon: AlertTriangle, ring: 'ring-rose-500/30', accent: 'text-rose-300' },
  info: { icon: Info, ring: 'ring-accent/30', accent: 'text-accent-soft' },
}

/** Seconds left before an auto-advance fires, so the cancel window is visible. */
function Countdown({ endsAt }) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.max(0, Math.ceil((endsAt - now) / 1000))

  return (
    <p className="mt-1 text-[12px] font-medium text-accent-soft">
      {seconds > 0 ? `Starting in ${seconds}s` : 'Starting…'}
    </p>
  )
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
                {toast.countdownTo && <Countdown endsAt={toast.countdownTo} />}
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => {
                      toast.action.run()
                      onDismiss(toast.id)
                    }}
                    className="focus-ring mt-2 rounded bg-ink-700 px-2 py-1 text-[11.5px] font-medium text-slate-200 hover:bg-ink-600"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                aria-label="Dismiss notification"
                className="focus-ring rounded p-0.5 text-haze transition hover:text-slate-200"
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
