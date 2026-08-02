import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  Plus,
  Puzzle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { addonsApi } from '../api/orion.js'
import Badge from '../components/Badge.jsx'

/**
 * Addon manager (UI 3.1). Manifest URLs are never rendered raw — the main
 * process hands back a masked display string plus an opaque uid, so a Debrid
 * token embedded in a configured URL stays out of the page (NFR 5.2).
 */
export default function Addons() {
  const [addons, setAddons] = useState([])
  const [url, setUrl] = useState('')
  const [adding, setAdding] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setAddons(await addonsApi.list())
  }, [])

  useEffect(() => {
    load()
    return addonsApi.onChanged(setAddons)
  }, [load])

  async function add(event) {
    event.preventDefault()
    if (!url.trim() || adding) return

    setAdding(true)
    setError(null)

    const result = await addonsApi.add(url.trim())
    if (result.ok) {
      setAddons(result.addons)
      setUrl('')
    } else {
      setError(result.error)
    }
    setAdding(false)
  }

  async function refresh() {
    setRefreshing(true)
    setAddons(await addonsApi.refresh())
    setRefreshing(false)
  }

  async function move(index, direction) {
    const next = [...addons]
    const target = index + direction
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    setAddons(next)
    await addonsApi.reorder(next.map((addon) => addon.uid))
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8 pb-24">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-100">Addons</h1>
          <p className="mt-1 text-[13px] text-haze">
            Lunaria carries no catalog of its own — every title and stream below comes from an addon you install here.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-ink-700 disabled:opacity-50"
        >
          <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <form onSubmit={add} className="mb-3 flex gap-2">
        <input
          type="text"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="stremio://… or https://…/manifest.json"
          spellCheck={false}
          className="focus-ring flex-1 rounded-lg bg-ink-850 px-3.5 py-2.5 text-[13px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 transition focus:bg-ink-800 focus:ring-accent/40"
        />
        <button
          type="submit"
          disabled={adding || !url.trim()}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-accent/20 px-4 py-2.5 text-[13px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/30 disabled:opacity-40"
        >
          {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Install
        </button>
      </form>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-[12px] text-rose-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="space-y-2">
        {addons.map((addon, index) => (
          <AddonRow
            key={addon.uid}
            addon={addon}
            first={index === 0}
            last={index === addons.length - 1}
            onMove={(direction) => move(index, direction)}
            onToggle={() => addonsApi.toggle(addon.uid, !addon.enabled)}
            onRemove={() => addonsApi.remove(addon.uid)}
          />
        ))}

        {addons.length === 0 && (
          <div className="flex flex-col items-center rounded-xl bg-ink-850 px-6 py-14 text-center ring-1 ring-white/5">
            <Puzzle size={24} className="text-ink-500" />
            <p className="mt-4 text-[13px] text-haze">No addons installed. Paste a manifest URL above to begin.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function AddonRow({ addon, first, last, onMove, onToggle, onRemove }) {
  return (
    <div
      className={`flex items-start gap-3.5 rounded-xl bg-ink-850 p-3.5 ring-1 transition ${
        addon.enabled ? 'ring-white/5' : 'opacity-55 ring-white/5'
      }`}
    >
      <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-ink-800 ring-1 ring-white/5">
        {addon.logo ? (
          <img src={addon.logo} alt="" decoding="async" className="h-full w-full object-contain p-1" />
        ) : (
          <Puzzle size={17} className="text-ink-500" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold text-slate-100">{addon.name}</h3>
          {addon.version && <span className="text-[11px] text-ink-500">v{addon.version}</span>}
          {addon.configured && (
            <Badge tone="green" title="This manifest URL carries credentials, stored encrypted on disk">
              <ShieldCheck size={10} />
              CONFIGURED
            </Badge>
          )}
          {addon.error && (
            <Badge tone="red">
              <AlertTriangle size={10} />
              UNREACHABLE
            </Badge>
          )}
        </div>

        {addon.description && (
          <p className="mt-1 line-clamp-2 text-[12px] leading-snug text-haze">{addon.description}</p>
        )}

        <p className="mt-1.5 truncate font-mono text-[11px] text-ink-500" title={addon.displayUrl}>
          {addon.displayUrl}
        </p>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {addon.resources.map((resource) => (
            <Badge key={resource} tone="muted">
              {resource}
            </Badge>
          ))}
          {addon.types.slice(0, 4).map((type) => (
            <Badge key={type}>{type}</Badge>
          ))}
          {addon.catalogCount > 0 && <Badge tone="muted">{addon.catalogCount} catalogs</Badge>}
        </div>

        {addon.error && <p className="mt-2 text-[11.5px] text-rose-300">{addon.error}</p>}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Move up"
            disabled={first}
            onClick={() => onMove(-1)}
            className="focus-ring rounded p-1 text-ink-500 transition enabled:hover:text-slate-200 disabled:opacity-30"
          >
            <ChevronUp size={15} />
          </button>
          <button
            type="button"
            aria-label="Move down"
            disabled={last}
            onClick={() => onMove(1)}
            className="focus-ring rounded p-1 text-ink-500 transition enabled:hover:text-slate-200 disabled:opacity-30"
          >
            <ChevronDown size={15} />
          </button>
          <button
            type="button"
            aria-label="Remove addon"
            onClick={onRemove}
            className="focus-ring rounded p-1 text-ink-500 transition hover:text-rose-300"
          >
            <Trash2 size={15} />
          </button>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={addon.enabled}
          aria-label={addon.enabled ? 'Disable addon' : 'Enable addon'}
          onClick={onToggle}
          className={`focus-ring relative h-5 w-9 rounded-full transition ${
            addon.enabled ? 'bg-accent/70' : 'bg-ink-600'
          }`}
        >
          <span
            className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
              addon.enabled ? 'left-[18px]' : 'left-0.5'
            }`}
          />
        </button>
      </div>
    </div>
  )
}
