import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Film, Play, X } from 'lucide-react'
import { formatRemaining, progressApi } from '../api/orion.js'

/**
 * Resume row. Entries come from real VLC playback positions, so a title only
 * appears here once it has actually been started and not finished.
 */
export default function ContinueWatching({ entries, onChanged }) {
  if (!entries || entries.length === 0) return null

  return (
    <section className="mb-8 animate-risein">
      <h2 className="mb-3 text-[15px] font-semibold tracking-tight text-slate-100">Continue watching</h2>
      <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
        {entries.map((entry) => (
          <ResumeCard key={`${entry.type}-${entry.videoId || entry.id}`} entry={entry} onChanged={onChanged} />
        ))}
      </div>
    </section>
  )
}

function ResumeCard({ entry, onChanged }) {
  const [failed, setFailed] = useState(false)
  const percent = Math.round((entry.percent || 0) * 100)
  const remaining = formatRemaining(entry.positionSeconds, entry.durationSeconds)

  const episodeLabel =
    entry.season != null && entry.episode != null ? `S${entry.season}:E${entry.episode}` : null

  async function dismiss(event) {
    event.preventDefault()
    event.stopPropagation()
    await progressApi.clear(entry.type, entry.videoId || entry.id)
    onChanged?.()
  }

  return (
    <Link
      to={`/title/${encodeURIComponent(entry.type)}/${encodeURIComponent(entry.id)}`}
      className="group relative w-[260px] shrink-0 focus-ring rounded-lg"
      title={entry.name}
    >
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

        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2.5 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
          <Play size={18} className="fill-white" />
        </span>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Remove from continue watching"
          className="focus-ring absolute right-1.5 top-1.5 rounded-md bg-black/60 p-1 text-slate-300 opacity-0 backdrop-blur transition hover:text-white group-hover:opacity-100"
        >
          <X size={13} />
        </button>

        <div className="absolute inset-x-0 bottom-0 p-2.5">
          <p className="truncate text-[13px] font-medium text-white">{entry.name}</p>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-300">
            {episodeLabel && <span className="font-medium text-accent-soft">{episodeLabel}</span>}
            {remaining && <span>{remaining}</span>}
          </div>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>
    </Link>
  )
}
