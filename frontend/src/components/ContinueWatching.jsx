import { useEffect, useState } from 'react'
import { Film, Info, Loader2, Play, X } from 'lucide-react'
import { formatRemaining, progressApi, settingsApi } from '../api/orion.js'
import { usePlayer } from './PlayerProvider.jsx'

/**
 * Resume row. Entries come from real player positions, so a title only appears
 * here once it has actually been started — plus the episode that follows one
 * you finished, which would otherwise drop off the row entirely.
 */
export default function ContinueWatching({ entries, onChanged }) {
  const [resumeAction, setResumeAction] = useState('play')

  useEffect(() => {
    settingsApi.get().then((settings) => setResumeAction(settings.resumeAction || 'play'))
  }, [])

  if (!entries || entries.length === 0) return null

  return (
    <section className="mb-8 animate-risein">
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-slate-100">Continue watching</h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {entries.map((entry) => (
          <ResumeCard
            key={`${entry.type}-${entry.videoId || entry.id}`}
            entry={entry}
            resumeAction={resumeAction}
            onChanged={onChanged}
          />
        ))}
      </div>
    </section>
  )
}

function ResumeCard({ entry, resumeAction, onChanged }) {
  const { resumeEntry, openEntryDetails } = usePlayer()
  const [failed, setFailed] = useState(false)
  const [starting, setStarting] = useState(false)

  const percent = Math.round((entry.percent || 0) * 100)
  const remaining = formatRemaining(entry.positionSeconds, entry.durationSeconds)

  const episodeLabel =
    entry.season != null && entry.episode != null ? `S${entry.season}:E${entry.episode}` : null

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

  async function dismiss() {
    await progressApi.clear(entry.type, entry.videoId || entry.id)
    onChanged?.()
  }

  return (
    <div className="group relative w-[260px] shrink-0" title={entry.name}>
      <div className="relative aspect-video overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/5 transition group-hover:ring-accent/40">
        {entry.poster && !failed ? (
          <img
            src={entry.poster}
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

        <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
          {starting ? <Loader2 size={18} className="animate-spin" /> : <Play size={18} className="fill-white" />}
        </span>

        {entry.upNext && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 z-20 rounded bg-accent/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-950">
            Up next
          </span>
        )}

        <div className="absolute right-1.5 top-1.5 z-20 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
          <button
            type="button"
            onClick={() => openEntryDetails(entry, { highlightSourceId: entry.source?.id })}
            aria-label={`Open details for ${entry.name}`}
            title="Details"
            className="focus-ring rounded-md bg-black/60 p-1 text-slate-300 backdrop-blur transition hover:text-white"
          >
            <Info size={13} />
          </button>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Remove from continue watching"
            className="focus-ring rounded-md bg-black/60 p-1 text-slate-300 backdrop-blur transition hover:text-white"
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
          <div className="mt-2 h-[3px] w-full overflow-hidden rounded-full bg-white/25">
            <div
              className="h-full rounded-full bg-accent shadow-[0_0_6px_rgba(111,141,255,0.7)]"
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
