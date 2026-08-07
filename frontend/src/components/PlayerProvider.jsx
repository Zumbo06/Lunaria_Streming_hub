import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { appApi, engineApi, playApi, playersApi } from '../api/orion.js'
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
  const navigate = useNavigate()
  const [toasts, setToasts] = useState([])
  const [busyStreamId, setBusyStreamId] = useState(null)
  const [engine, setEngine] = useState(IDLE_ENGINE)
  const autoAdvanceToast = useRef(null)

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
          if (result.hdr) parts.push(`${result.hdr}`)
          if (result.resumedAt > 0) {
            parts.push(`resuming at ${Math.floor(result.resumedAt / 60)}m ${result.resumedAt % 60}s`)
          }
          if (result.subtitleLoaded) parts.push(`${subtitle.language} subtitles`)

          pushToast({
            tone: 'success',
            title: `Handed to ${result.player}`,
            message: parts.length > 0 ? parts.join(' · ') : stream.filename,
          })
        } else if (result.code === 'CANCELLED') {
          // The user stopped this themselves, or replaced it with another
          // source — nothing to report back to them.
          setEngine(IDLE_ENGINE)
        } else if (result.code === 'PLAYER_NOT_FOUND') {
          setEngine(IDLE_ENGINE)
          pushToast({
            tone: 'error',
            title: result.error,
            message: `Lunaria could not locate ${result.player === 'mpv' ? 'mpv' : 'VLC'} on this machine.`,
            duration: 0,
            action: { label: 'Locate it…', run: () => locatePlayer(result.player) },
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
    [locatePlayer, pushToast],
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
   * process picks one matching the previous episode. Anything that fails lands
   * on the title page with the reason rather than at a dead end.
   */
  const resumeEntry = useCallback(
    async (entry) => {
      const item = {
        type: entry.type,
        id: entry.id,
        videoId: entry.videoId || entry.id,
        name: entry.name,
        poster: entry.poster || null,
        season: entry.season ?? null,
        episode: entry.episode ?? null,
      }

      if (entry.upNext) {
        setBusyStreamId(`next:${item.videoId}`)
        try {
          const result = await playApi.next(item, entry.previousSource || null, entry.previousSubtitle || null)

          if (result.ok) {
            pushToast({
              tone: 'success',
              title: `Handed to ${result.player}`,
              message: `S${item.season}:E${item.episode}${entry.episodeTitle ? ` · ${entry.episodeTitle}` : ''}`,
            })
          } else {
            pushToast({ tone: 'error', title: 'Could not start the next episode', message: result.error })
            openEntryDetails(entry, { resumeFailed: result.error })
          }
          return result
        } finally {
          setBusyStreamId(null)
        }
      }

      // Nothing was recorded about how this was watched — the only honest
      // thing to do is let the source be picked again.
      if (!entry.source) {
        openEntryDetails(entry)
        return null
      }

      const result = await play(entry.source, item, entry.subtitle || null)

      // `play` has already explained a missing player, and that is not the
      // source's fault — only a broken source sends you to the title page.
      if (!result?.ok && result?.code !== 'PLAYER_NOT_FOUND') {
        openEntryDetails(entry, {
          resumeFailed: result?.error || 'That source could not be started',
          highlightSourceId: entry.source.id,
        })
      }
      return result
    },
    [openEntryDetails, play, pushToast],
  )

  // Auto-advance announcements. The scheduled toast is the only thing standing
  // between a finished episode and the next one starting, so it never expires
  // on its own — it is replaced or dismissed by the next announcement.
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

  /** Pushes a subtitle into the running player without restarting the stream. */
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

  const stopEngine = useCallback(async () => {
    await engineApi.stop()
    setEngine(IDLE_ENGINE)
  }, [])

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
    ],
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
