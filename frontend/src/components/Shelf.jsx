import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight } from 'lucide-react'
import { catalogApi } from '../api/orion.js'
import PosterCard, { PosterSkeleton } from './PosterCard.jsx'

const PAGE_HINT = 20

/**
 * One catalog row. Each shelf owns its own fetch so a slow addon only delays
 * its own row and the rest of the dashboard keeps rendering (NFR 5.1).
 */
export default function Shelf({ shelf }) {
  const [metas, setMetas] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [error, setError] = useState(null)
  const railRef = useRef(null)
  const requestRef = useRef(0)

  const fetchPage = useCallback(
    async (skip) => {
      const token = ++requestRef.current
      const result = await catalogApi.load({
        uid: shelf.uid,
        type: shelf.type,
        catalogId: shelf.catalogId,
        skip,
      })
      if (token !== requestRef.current) return null
      return result
    },
    [shelf.uid, shelf.type, shelf.catalogId],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setMetas([])
    setExhausted(false)

    fetchPage(0).then((result) => {
      if (cancelled || !result) return
      if (!result.ok) setError(result.error)
      else {
        setMetas(result.metas)
        if (result.metas.length < PAGE_HINT) setExhausted(true)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [fetchPage])

  async function loadMore() {
    if (loadingMore || exhausted || !shelf.paginated || metas.length === 0) return
    setLoadingMore(true)

    const result = await fetchPage(metas.length)
    if (result?.ok) {
      const fresh = result.metas.filter((meta) => !metas.some((existing) => existing.id === meta.id))
      if (fresh.length === 0) setExhausted(true)
      else setMetas((current) => [...current, ...fresh])
    } else {
      setExhausted(true)
    }
    setLoadingMore(false)
  }

  function scrollBy(direction) {
    const rail = railRef.current
    if (!rail) return
    rail.scrollBy({ left: direction * rail.clientWidth * 0.85, behavior: 'smooth' })
  }

  function onScroll(event) {
    const rail = event.currentTarget
    if (rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 600) loadMore()
  }

  if (error && metas.length === 0) {
    return (
      <section className="mb-8">
        <ShelfHeading shelf={shelf} />
        <div className="flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      </section>
    )
  }

  if (!loading && metas.length === 0) return null

  return (
    <section className="mb-8 animate-risein">
      <div className="group/shelf relative">
        <ShelfHeading shelf={shelf} />

        <button
          type="button"
          aria-label="Scroll left"
          onClick={() => scrollBy(-1)}
          className="focus-ring absolute -left-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-ink-800/90 p-2 text-slate-300 ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-700 hover:text-white group-hover/shelf:block"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          aria-label="Scroll right"
          onClick={() => scrollBy(1)}
          className="focus-ring absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-ink-800/90 p-2 text-slate-300 ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-700 hover:text-white group-hover/shelf:block"
        >
          <ChevronRight size={18} />
        </button>

        <div ref={railRef} onScroll={onScroll} className="no-scrollbar flex gap-4 overflow-x-auto scroll-smooth pb-2">
          {loading
            ? Array.from({ length: 8 }, (_, index) => <PosterSkeleton key={index} />)
            : metas.map((meta) => <PosterCard key={`${meta.id}-${meta.name}`} meta={meta} />)}
          {loadingMore && Array.from({ length: 3 }, (_, index) => <PosterSkeleton key={`more-${index}`} />)}
        </div>
      </div>
    </section>
  )
}

function ShelfHeading({ shelf }) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="text-[15px] font-semibold tracking-tight text-slate-100">{shelf.name}</h2>
      <span className="text-[11px] uppercase tracking-wider text-ink-500">
        {shelf.type} · {shelf.addonName}
      </span>
    </div>
  )
}
