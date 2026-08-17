import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Film, Star } from 'lucide-react'

/**
 * Posters decode off the main thread and load lazily, so scrolling a shelf
 * never stalls the UI loop (NFR 5.1 Interface Fluidity).
 */
export default function PosterCard({ meta, width = 'w-[152px]' }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  const year = meta.releaseInfo || meta.year || ''
  const rating = meta.imdbRating || null

  return (
    <Link
      to={`/title/${encodeURIComponent(meta.type)}/${encodeURIComponent(meta.id)}`}
      className={`group relative ${width} shrink-0 focus-ring rounded-lg`}
      title={meta.name}
    >
      {/* Dynamic Reactive Ambient Lighting Glow */}
      {loaded && meta.poster && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-2.5 rounded-2xl opacity-0 blur-xl filter saturate-150 transition-opacity duration-500 group-hover:opacity-70"
          style={{
            backgroundImage: `url(${meta.poster})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        />
      )}

      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-ink-800 shadow-poster ring-1 ring-white/5 transition duration-200 group-hover:shadow-lift group-hover:ring-accent/40">
        {!loaded && !failed && <div className="skeleton absolute inset-0" />}

        {failed || !meta.poster ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-ink-500">
            <Film size={26} />
            <span className="px-2 text-center text-[11px] leading-tight text-haze">{meta.name}</span>
          </div>
        ) : (
          <img
            src={meta.poster}
            alt={meta.name}
            loading="lazy"
            decoding="async"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className={`h-full w-full object-cover transition duration-300 group-hover:scale-[1.04] ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}

        {rating && (
          <div className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 backdrop-blur-sm">
            <Star size={10} className="fill-amber-300" />
            {rating}
          </div>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug text-slate-200 group-hover:text-white">
        {meta.name}
      </p>
      {year && <p className="text-[11px] text-haze">{year}</p>}
    </Link>
  )
}

export function PosterSkeleton({ width = 'w-[152px]' }) {
  return (
    <div className={`${width} shrink-0`}>
      <div className="skeleton aspect-[2/3] w-full" />
      <div className="skeleton mt-2 h-3 w-4/5" />
      <div className="skeleton mt-1.5 h-2.5 w-1/3" />
    </div>
  )
}
