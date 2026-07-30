import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Compass, Loader2, Puzzle } from 'lucide-react'
import { addonsApi, catalogApi } from '../api/orion.js'
import PosterCard, { PosterSkeleton } from '../components/PosterCard.jsx'

// Addons return a page at a time; 20 is the protocol's de facto page size.
const PAGE_HINT = 20

/**
 * Browse a single catalog at a time with its own genre list, rather than the
 * fixed shelves on Home. This is where catalogs that *require* a genre become
 * usable at all — they cannot be rendered as a shelf.
 */
export default function Discover() {
  const [catalogs, setCatalogs] = useState(null)
  const [type, setType] = useState(null)
  const [selectedKey, setSelectedKey] = useState(null)
  const [genre, setGenre] = useState('')

  const [metas, setMetas] = useState([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [error, setError] = useState(null)

  const requestRef = useRef(0)
  const sentinelRef = useRef(null)

  const load = useCallback(async () => {
    setCatalogs(await catalogApi.catalogs())
  }, [])

  useEffect(() => {
    load()
    return addonsApi.onChanged(load)
  }, [load])

  const types = useMemo(() => [...new Set((catalogs || []).map((entry) => entry.type))], [catalogs])

  // Default to the first type and its first catalog once they arrive.
  useEffect(() => {
    if (!catalogs || catalogs.length === 0) return
    if (type && types.includes(type)) return
    setType(types[0] ?? null)
  }, [catalogs, types, type])

  const forType = useMemo(
    () => (catalogs || []).filter((entry) => entry.type === type),
    [catalogs, type],
  )

  useEffect(() => {
    if (forType.length === 0) return
    if (selectedKey && forType.some((entry) => entry.key === selectedKey)) return
    setSelectedKey(forType[0].key)
    setGenre('')
  }, [forType, selectedKey])

  const selected = useMemo(
    () => (catalogs || []).find((entry) => entry.key === selectedKey) || null,
    [catalogs, selectedKey],
  )

  // A catalog that requires a genre needs one chosen before it returns anything.
  useEffect(() => {
    if (selected?.requiresGenre && !genre && selected.genres.length > 0) setGenre(selected.genres[0])
  }, [selected, genre])

  const fetchPage = useCallback(
    async (skip) => {
      if (!selected) return null
      const token = ++requestRef.current
      const result = await catalogApi.load({
        uid: selected.uid,
        type: selected.type,
        catalogId: selected.catalogId,
        skip,
        genre: genre || null,
      })
      return token === requestRef.current ? result : null
    },
    [selected, genre],
  )

  useEffect(() => {
    if (!selected) return undefined
    if (selected.requiresGenre && !genre) return undefined

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
  }, [fetchPage, selected, genre])

  const loadMore = useCallback(async () => {
    if (loading || loadingMore || exhausted || metas.length === 0) return
    if (!selected?.paginated) return setExhausted(true)

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
  }, [loading, loadingMore, exhausted, metas, selected, fetchPage])

  // Infinite scroll rather than a button, so browsing stays continuous.
  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return undefined

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMore()
      },
      { rootMargin: '600px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [loadMore])

  if (catalogs === null) {
    return (
      <div className="page py-6">
        <div className="skeleton mb-5 h-9 w-72" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-4 gap-y-6">
          {Array.from({ length: 14 }, (_, index) => (
            <PosterSkeleton key={index} width="w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (catalogs.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <div className="rounded-2xl bg-ink-850 p-4 text-accent ring-1 ring-white/5">
          <Puzzle size={26} />
        </div>
        <h1 className="mt-5 text-[15px] font-semibold text-slate-100">Nothing to browse yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-haze">
          Discover lists the catalogs your installed addons publish. Install a metadata addon and they appear here.
        </p>
        <Link
          to="/addons"
          className="focus-ring mt-6 rounded-lg bg-accent/15 px-4 py-2 text-[13px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/25"
        >
          Open the addon manager
        </Link>
      </div>
    )
  }

  return (
    <div className="page py-6 pb-24">
      <div className="mb-4 flex items-center gap-2.5">
        <Compass size={17} className="text-accent" />
        <h1 className="text-[15px] font-semibold text-slate-100">Discover</h1>
        {(loading || loadingMore) && <Loader2 size={14} className="animate-spin text-accent" />}
        {!loading && metas.length > 0 && (
          <span className="text-[11px] uppercase tracking-wider text-ink-500">
            {metas.length} {metas.length === 1 ? 'title' : 'titles'}
            {exhausted ? '' : ' · scroll for more'}
          </span>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <Picker label="Type" value={type || ''} onChange={setType} options={types.map((entry) => [entry, entry])} />

        <Picker
          label="Catalog"
          value={selectedKey || ''}
          onChange={setSelectedKey}
          options={forType.map((entry) => [entry.key, `${entry.name} — ${entry.addonName}`])}
          wide
        />

        {selected?.genres?.length > 0 && (
          <Picker
            label={selected.requiresGenre ? 'Genre (required)' : 'Genre'}
            value={genre}
            onChange={setGenre}
            options={[
              ...(selected.requiresGenre ? [] : [['', 'Any genre']]),
              ...selected.genres.map((entry) => [entry, entry]),
            ]}
          />
        )}
      </div>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-[13px] text-rose-300">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-4 gap-y-6">
        {loading
          ? Array.from({ length: 14 }, (_, index) => <PosterSkeleton key={index} width="w-full" />)
          : metas.map((meta) => <PosterCard key={`${meta.id}-${meta.type}`} meta={meta} width="w-full" />)}
        {loadingMore &&
          Array.from({ length: 6 }, (_, index) => <PosterSkeleton key={`more-${index}`} width="w-full" />)}
      </div>

      {!loading && metas.length === 0 && !error && (
        <p className="rounded-lg bg-ink-850 px-4 py-8 text-center text-[13px] text-haze ring-1 ring-white/5">
          This catalog returned nothing{genre ? ` for ${genre}` : ''}.
        </p>
      )}

      <div ref={sentinelRef} className="h-px" />
    </div>
  )
}

function Picker({ label, value, onChange, options, wide = false }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] uppercase tracking-wider text-ink-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={`focus-ring rounded-lg bg-ink-850 px-3 py-2 text-[13px] text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40 ${
          wide ? 'max-w-[340px]' : ''
        }`}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  )
}
