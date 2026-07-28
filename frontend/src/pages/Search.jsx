import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, SearchX } from 'lucide-react'
import { nextRequestId, searchApi } from '../api/orion.js'
import PosterCard, { PosterSkeleton } from '../components/PosterCard.jsx'

const DEBOUNCE_MS = 280

/**
 * Live search across every catalog that advertises the `search` extra. Results
 * are painted per addon as they answer rather than after the slowest one
 * (REQ-1.3, NFR 5.1).
 */
export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q') || ''

  const [metas, setMetas] = useState([])
  const [errors, setErrors] = useState([])
  const [loading, setLoading] = useState(false)
  const activeRequest = useRef(null)

  useEffect(() => {
    const unsubscribe = searchApi.onPartial(({ requestId, metas: partial }) => {
      if (requestId !== activeRequest.current) return
      setMetas(partial)
    })
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!query.trim()) {
      activeRequest.current = null
      setMetas([])
      setErrors([])
      setLoading(false)
      return undefined
    }

    setLoading(true)
    const handle = setTimeout(async () => {
      const requestId = nextRequestId()
      activeRequest.current = requestId

      const result = await searchApi.query(query, requestId)
      if (activeRequest.current !== requestId) return

      setMetas(result.metas || [])
      setErrors(result.errors || [])
      setLoading(false)
    }, DEBOUNCE_MS)

    return () => clearTimeout(handle)
  }, [query])

  if (!query.trim()) {
    return (
      <EmptyMessage
        icon={SearchX}
        title="Search your addons"
        body="Start typing in the field above. Every installed catalog that supports search is queried at once."
      />
    )
  }

  const showSkeletons = loading && metas.length === 0

  return (
    <div className="mx-auto max-w-[1500px] px-6 py-6 pb-24">
      <div className="mb-5 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold text-slate-100">
          Results for <span className="text-accent-soft">“{query}”</span>
        </h1>
        {!showSkeletons && (
          <span className="text-[11px] uppercase tracking-wider text-ink-500">
            {metas.length} {metas.length === 1 ? 'title' : 'titles'}
            {loading && ' · still searching'}
          </span>
        )}
      </div>

      {errors.length > 0 && (
        <div className="mb-5 flex flex-col gap-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[12px] text-amber-300">
          {errors.map((entry) => (
            <div key={entry.addon} className="flex items-center gap-2">
              <AlertTriangle size={13} />
              <span>
                {entry.addon}: {entry.error}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-4 gap-y-6">
        {showSkeletons
          ? Array.from({ length: 14 }, (_, index) => <PosterSkeleton key={index} width="w-full" />)
          : metas.map((meta) => <PosterCard key={`${meta.id}-${meta.type}`} meta={meta} width="w-full" />)}
      </div>

      {!loading && metas.length === 0 && (
        <EmptyMessage
          icon={SearchX}
          title="Nothing matched"
          body="No installed catalog returned a title for that query. A different metadata addon may cover it."
        />
      )}
    </div>
  )
}

function EmptyMessage({ icon: Icon, title, body }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
      <div className="rounded-2xl bg-ink-850 p-4 text-ink-500 ring-1 ring-white/5">
        <Icon size={26} />
      </div>
      <h2 className="mt-5 text-[15px] font-semibold text-slate-100">{title}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-haze">{body}</p>
    </div>
  )
}
