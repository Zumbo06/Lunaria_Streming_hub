import { useCallback, useEffect, useRef, useState } from 'react'
import { Film, Info, Loader2, Play, X } from 'lucide-react'
import { formatRemaining, progressApi, settingsApi } from '../api/orion.js'
import { usePlayer } from './PlayerProvider.jsx'

// How long a removal can still be taken back before the progress is deleted.
const UNDO_MS = 7000

const titleKey = (entry) => `${entry.type}:${entry.id}`

/**
 * Resume row. Entries come from real player positions, so a title only appears
 * here once it has actually been started — plus the episode that follows one
 * you finished, which would otherwise drop off the row entirely.
 */
export default function ContinueWatching({ entries, onChanged }) {
  const { pushToast, dismissToast } = usePlayer()
  const [resumeAction, setResumeAction] = useState('play')
  const [hidden, setHidden] = useState(() => new Set())
  const pending = useRef(new Map())

  useEffect(() => {
    settingsApi.get().then((settings) => setResumeAction(settings.resumeAction || 'play'))
  }, [])

  // Leaving the page commits whatever is still waiting out its undo window.
  useEffect(() => {
    const queued = pending.current
    return () => {
      for (const { timer, commit, toastId } of queued.values()) {
        clearTimeout(timer)
        dismissToast(toastId)
        commit()
      }
      queued.clear()
    }
  }, [dismissToast])

  // Removing a series deletes every episode's progress, not just the card, so
  // the delete is held back behind an undo toast instead of happening on click.
  const remove = useCallback(
    (entry) => {
      const key = titleKey(entry)
      if (pending.current.has(key)) return

      const unhide = () =>
        setHidden((current) => {
          const next = new Set(current)
          next.delete(key)
          return next
        })

      setHidden((current) => new Set(current).add(key))

      const toastId = pushToast({
        tone: 'info',
        title: 'Removed from Continue watching',
        message: entry.type === 'series' ? `${entry.name} and its watch history` : entry.name,
        duration: UNDO_MS,
        action: {
          label: 'Undo',
          run: () => {
            const queued = pending.current.get(key)
            if (!queued) return
            clearTimeout(queued.timer)
            pending.current.delete(key)
            unhide()
          },
        },
      })

      const commit = () => progressApi.clear(entry.type, entry.videoId || entry.id, entry.id)

      const timer = setTimeout(async () => {
        pending.current.delete(key)
        await commit()
        await onChanged?.()
        unhide()
      }, UNDO_MS)

      pending.current.set(key, { timer, commit, toastId })
    },
    [onChanged, pushToast],
  )

  const visible = (entries || []).filter((entry) => !hidden.has(titleKey(entry)))
  if (visible.length === 0) return null

  return (
    <section className="mb-8 animate-risein">
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-slate-100">Continue watching</h2>
      {/* Padded out and pulled back so hover shadows are not clipped by the scroller. */}
      <div className="no-scrollbar -mx-3 -my-3 flex gap-4 overflow-x-auto px-3 py-3">
        {visible.map((entry) => (
          <ResumeCard
            key={`${entry.type}-${entry.videoId || entry.id}`}
            entry={entry}
            resumeAction={resumeAction}
            onRemove={remove}
          />
        ))}
      </div>
    </section>
  )
}

function ResumeCard({ entry, resumeAction, onRemove }) {
  const { resumeEntry, openEntryDetails } = usePlayer()
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)

  const artwork = entry.thumbnail || entry.background || entry.poster
  const percent = Math.round((entry.percent || 0) * 100)
  const remaining = formatRemaining(entry.positionSeconds, entry.durationSeconds)

  const episodeLabel =
    entry.season != null && entry.episode != null ? `S${entry.season}:E${entry.episode}` : null

  const removeLabel =
    entry.type === 'series' ? 'Remove show and its watch history' : 'Remove from Continue watching'

  // Entries recorded before releases were remembered carry no source, so they
  // can only ever open the title page — the setting does not apply to them.
  const canResume = resumeAction === 'play' && (entry.upNext || Boolean(entry.source))

  async function open() {
    if (!canResume) {
      openEntryDetails(entry, { highlightSourceId: entry.source?.id })
      return
    }

    setStarting(true)
    try {
      await resumeEntry(entry)
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="group relative w-[260px] shrink-0" title={entry.name}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-ink-800 shadow-poster ring-1 ring-white/5 transition duration-200 group-hover:shadow-lift group-hover:ring-accent/40">
        {/* Landscape art first — an episode still or the backdrop — so a
            portrait poster is only cropped to 16:9 as a last resort. */}
        {artwork && !failed ? (
          <img
            src={artwork}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className="h-full w-full object-cover opacity-70 transition group-hover:opacity-90"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-500">
            <Film size={24} />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />

        {/* The whole card is the primary action; the small controls above sit
            on top of it rather than nested inside a button. */}
        <button
          type="button"
          onClick={open}
          disabled={starting}
          aria-label={canResume ? `Resume ${entry.name}` : `Open ${entry.name}`}
          className="focus-ring absolute inset-0 z-10"
        />

        <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white opacity-0 backdrop-blur transition group-focus-within:opacity-100 group-hover:opacity-100">
          {starting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} className="fill-white" />}
        </span>

        {entry.upNext && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded bg-accent/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-950">
            Up next
          </span>
        )}

        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            onClick={() => openEntryDetails(entry, { highlightSourceId: entry.source?.id })}
            aria-label={`Open details for ${entry.name}`}
            title="Details"
            className="focus-ring rounded-md bg-black/60 p-1.5 text-slate-300 backdrop-blur transition hover:text-white"
          >
            <Info size={13} />
          </button>
          <button
            type="button"
            onClick={() => onRemove(entry)}
            aria-label={removeLabel}
            title={removeLabel}
            className="focus-ring rounded-md bg-black/60 p-1.5 text-slate-300 backdrop-blur transition hover:text-white"
          >
            <X size={13} />
          </button>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2.5">
          <p className="truncate text-[13px] font-medium text-white">{entry.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
            {episodeLabel && <span className="font-medium text-accent-soft">{episodeLabel}</span>}
            {entry.upNext ? (
              <span className="truncate">{entry.episodeTitle || 'Next episode'}</span>
            ) : (
              remaining && <span>{remaining}</span>
            )}
          </div>
          {/* An up-next episode has not been started, so there is no bar to show. */}
          {!entry.upNext && (
            <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/25">
              <div
                className="h-full rounded-full bg-accent shadow-glow"
                style={{ width: `${Math.max(2, percent)}%` }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
