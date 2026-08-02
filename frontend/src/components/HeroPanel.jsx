import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Info, Play, Star } from 'lucide-react'

const ADVANCE_MS = 7000
// After a manual click, hold off the timer so the slide does not slide out from
// under someone who is reading it.
const RESUME_AFTER_MS = 12000

/**
 * Rotating showcase at the top of Home.
 *
 * Catalog responses already carry `background`, `logo` and `description`, so a
 * slide needs no extra request — see the field probe in the README notes.
 * Slides crossfade rather than translate: with full-bleed artwork a fade reads
 * as deliberate where a slide reveals the letterboxing of mismatched images.
 */
export default function HeroPanel({ items = [] }) {
  const navigate = useNavigate()
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const resumeTimer = useRef(null)

  const count = items.length

  const go = useCallback(
    (next, manual = false) => {
      if (count === 0) return
      setIndex(((next % count) + count) % count)

      if (manual) {
        setPaused(true)
        clearTimeout(resumeTimer.current)
        resumeTimer.current = setTimeout(() => setPaused(false), RESUME_AFTER_MS)
      }
    },
    [count],
  )

  // Auto-advance, unless paused by hover, a manual click, or a stated
  // preference for reduced motion.
  useEffect(() => {
    if (count <= 1 || paused) return undefined
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined

    const timer = setInterval(() => setIndex((current) => (current + 1) % count), ADVANCE_MS)
    return () => clearInterval(timer)
  }, [count, paused])

  useEffect(() => () => clearTimeout(resumeTimer.current), [])

  // A shorter list after a refresh must not leave the index out of range.
  useEffect(() => {
    if (index >= count && count > 0) setIndex(0)
  }, [count, index])

  if (count === 0) return null

  const item = items[index]
  const year = item.releaseInfo || item.year || ''
  const genres = (item.genres || item.genre || []).slice(0, 3)

  return (
    <section
      className="relative mb-8 h-[340px] overflow-hidden rounded-2xl bg-ink-900 ring-1 ring-white/5 sm:h-[400px]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="Featured titles"
    >
      {/* Every slide stays mounted so the crossfade has something to fade to,
          and so switching back does not re-download the artwork. */}
      {items.map((entry, position) => (
        <div
          key={`${entry.type}-${entry.id}`}
          aria-hidden={position !== index}
          className={`absolute inset-0 transition-opacity duration-700 ease-out ${
            position === index ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <img
            src={entry.background || entry.poster}
            alt=""
            loading={position === 0 ? 'eager' : 'lazy'}
            decoding="async"
            className="h-full w-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-ink-950 via-ink-950/80 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-transparent to-transparent" />
        </div>
      ))}

      <div className="relative flex h-full max-w-2xl flex-col justify-end p-6 sm:p-8">
        {item.logo ? (
          <img
            src={item.logo}
            alt={item.name}
            decoding="async"
            className="mb-3 max-h-20 w-auto max-w-[320px] object-contain object-left drop-shadow-lg"
          />
        ) : (
          <h2 className="mb-2 text-3xl font-bold leading-tight tracking-tight text-white drop-shadow-lg">
            {item.name}
          </h2>
        )}

        <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[12px] text-slate-300">
          {item.imdbRating && (
            <span className="flex items-center gap-1 font-medium text-amber-300">
              <Star size={11} className="fill-amber-300" />
              {item.imdbRating}
            </span>
          )}
          {year && <span>{year}</span>}
          {genres.length > 0 && <span className="text-haze">{genres.join(' · ')}</span>}
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-200">
            {item.type}
          </span>
        </div>

        {item.description && (
          <p className="mb-4 line-clamp-2 max-w-xl text-[13px] leading-relaxed text-slate-300 drop-shadow">
            {item.description}
          </p>
        )}

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => navigate(`/title/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`)}
            className="focus-ring flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-[13.5px] font-semibold text-ink-950 transition hover:bg-accent-soft"
          >
            <Play size={15} className="fill-ink-950" />
            Watch
          </button>
          <button
            type="button"
            onClick={() => navigate(`/title/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`)}
            className="focus-ring flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2.5 text-[13px] font-medium text-slate-100 backdrop-blur transition hover:bg-white/20"
          >
            <Info size={15} />
            Details
          </button>
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous"
            onClick={() => go(index - 1, true)}
            className="focus-ring absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-slate-200 backdrop-blur transition hover:bg-black/75 hover:text-white"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            type="button"
            aria-label="Next"
            onClick={() => go(index + 1, true)}
            className="focus-ring absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-2 text-slate-200 backdrop-blur transition hover:bg-black/75 hover:text-white"
          >
            <ChevronRight size={20} />
          </button>

          <div className="absolute bottom-5 right-6 flex items-center gap-1.5">
            {items.map((entry, position) => (
              <button
                key={`dot-${entry.type}-${entry.id}`}
                type="button"
                aria-label={`Go to ${entry.name}`}
                aria-current={position === index}
                onClick={() => go(position, true)}
                className={`focus-ring h-1.5 rounded-full transition-all ${
                  position === index ? 'w-6 bg-accent' : 'w-1.5 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}

export function HeroSkeleton() {
  return <div className="skeleton mb-8 h-[340px] w-full rounded-2xl sm:h-[400px]" />
}
