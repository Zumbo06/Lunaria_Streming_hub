import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Check, Film, Star } from 'lucide-react'
import { formatAirDate, formatRemaining, isReleased, videoIdOf } from '../api/orion.js'

// Matches STARTED_AT in electron/library.js: below this an episode was opened, not watched.
const STARTED_AT = 0.01

/**
 * Season tabs and the episode list for a series. Watched state comes from the
 * profile's own progress, so the list doubles as a record of where someone is.
 */
export default function EpisodeList({
  seriesId,
  seasons,
  selectedSeason,
  onSelectSeason,
  episodeId,
  onSelectEpisode,
  progress,
}) {
  const listRef = useRef(null)
  const currentSeason = seasons.find((entry) => entry.season === selectedSeason)

  // Keep the selected episode in view inside the list without scrolling the
  // page itself — the page should still open on the title, not halfway down.
  useEffect(() => {
    const list = listRef.current
    const row = list?.querySelector('[data-active="true"]')
    if (!list || !row) return

    // The list is `relative`, so it is the row's offset parent.
    const top = row.offsetTop
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' })
    }
  }, [episodeId, selectedSeason])

  return (
    <div className="page pt-10">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[17px] font-semibold tracking-tight text-slate-100">Episodes</h2>
        {seasons.map((entry) => {
          const watched = entry.videos.filter((video) => progress[videoIdOf(video, seriesId)]?.finished).length
          const active = entry.season === selectedSeason

          return (
            <button
              key={entry.season}
              type="button"
              onClick={() => onSelectSeason(entry.season)}
              aria-pressed={active}
              className={`focus-ring flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
                active
                  ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40'
                  : 'bg-ink-850 text-haze hover:bg-ink-800 hover:text-slate-200'
              }`}
            >
              {entry.season === 0 ? 'Specials' : `Season ${entry.season}`}
              {watched > 0 && (
                <span className={`tabular-nums ${active ? 'text-accent-soft/80' : 'text-ink-500'}`}>
                  {watched === entry.videos.length ? <Check size={12} /> : `${watched}/${entry.videos.length}`}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div
        ref={listRef}
        className="relative -mx-1 grid max-h-[600px] gap-2 overflow-y-auto px-1 py-1 lg:grid-cols-2"
      >
        {(currentSeason?.videos || []).map((video) => {
          const videoId = videoIdOf(video, seriesId)
          return (
            <EpisodeRow
              key={videoId}
              video={video}
              active={videoId === episodeId}
              progress={progress[videoId]}
              onSelect={() => onSelectEpisode(videoId)}
            />
          )
        })}
      </div>
    </div>
  )
}

function EpisodeRow({ video, active, progress, onSelect }) {
  const [thumbFailed, setThumbFailed] = useState(false)

  const released = isReleased(video)
  const airDate = formatAirDate(video.released || video.firstAired)
  const title = video.title || video.name || `Episode ${video.episode}`
  const overview = video.overview || video.description
  const rating = Number(video.rating) > 0 ? video.rating : null

  const watched = Boolean(progress?.finished)
  const inProgress = !watched && (progress?.percent || 0) >= STARTED_AT
  const remaining = inProgress ? formatRemaining(progress.positionSeconds, progress.durationSeconds) : null

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!released}
      data-active={active}
      aria-current={active || undefined}
      className={`focus-ring group flex items-start gap-3 rounded-lg p-2 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? 'bg-accent/10 ring-accent/40'
          : 'bg-ink-850 ring-white/5 enabled:hover:bg-ink-800 enabled:hover:ring-white/10'
      }`}
    >
      <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-md bg-ink-800">
        {video.thumbnail && !thumbFailed ? (
          <img
            src={video.thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className={`h-full w-full object-cover transition ${watched ? 'opacity-60' : ''}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-ink-500">
            <Film size={20} />
          </div>
        )}

        {watched && (
          <span className="absolute right-1.5 top-1.5 rounded-full bg-emerald-500 p-0.5 text-ink-950 shadow">
            <Check size={11} strokeWidth={3} />
          </span>
        )}

        {inProgress && (
          <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25">
            <div
              className="h-full bg-accent shadow-glow"
              style={{ width: `${Math.max(2, Math.round(progress.percent * 100))}%` }}
            />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-baseline gap-2">
          <span className="shrink-0 text-[11px] font-semibold tabular-nums text-haze">E{video.episode ?? '–'}</span>
          <span className="truncate text-[13px] font-medium text-slate-100">{title}</span>
        </div>

        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-haze">
          {!released ? (
            <span className="flex items-center gap-1 text-amber-300">
              <CalendarClock size={11} />
              {airDate ? `Airs ${airDate}` : 'Not aired yet'}
            </span>
          ) : (
            airDate && <span>{airDate}</span>
          )}
          {rating && (
            <span className="flex items-center gap-0.5 text-amber-300">
              <Star size={10} className="fill-amber-300" />
              {rating}
            </span>
          )}
          {watched && <span className="font-medium text-emerald-300">Watched</span>}
          {remaining && <span className="font-medium text-accent-soft">{remaining}</span>}
        </div>

        {overview && <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-haze">{overview}</p>}
      </div>
    </button>
  )
}
