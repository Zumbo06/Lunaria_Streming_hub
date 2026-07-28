import { useCallback, useEffect, useState } from 'react'
import { Bookmark, Trash2 } from 'lucide-react'
import { watchlistApi } from '../api/orion.js'
import { useProfile } from '../components/ProfileProvider.jsx'
import PosterCard from '../components/PosterCard.jsx'

export default function Watchlist() {
  const { current } = useProfile()
  const [items, setItems] = useState(null)

  const load = useCallback(async () => {
    setItems(await watchlistApi.get())
  }, [])

  useEffect(() => {
    load()
  }, [load, current?.id])

  async function remove(item) {
    setItems(await watchlistApi.remove(item.type, item.id))
  }

  if (items === null) {
    return (
      <div className="page py-8">
        <div className="skeleton h-6 w-40" />
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center px-6 py-24 text-center">
        <div className="rounded-2xl bg-ink-850 p-4 text-ink-500 ring-1 ring-white/5">
          <Bookmark size={26} />
        </div>
        <h1 className="mt-5 text-[15px] font-semibold text-slate-100">
          {current?.name}’s watchlist is empty
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-haze">
          Open any title and use “Add to watchlist” to keep it here. Each profile has its own list.
        </p>
      </div>
    )
  }

  return (
    <div className="page py-6 pb-24">
      <div className="mb-5 flex items-baseline gap-3">
        <h1 className="text-[15px] font-semibold text-slate-100">Watchlist</h1>
        <span className="text-[11px] uppercase tracking-wider text-ink-500">
          {items.length} {items.length === 1 ? 'title' : 'titles'} · {current?.name}
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-4 gap-y-6">
        {items.map((item) => (
          <div key={`${item.type}-${item.id}`} className="group/item relative">
            <PosterCard meta={item} width="w-full" />
            <button
              type="button"
              onClick={() => remove(item)}
              aria-label={`Remove ${item.name} from watchlist`}
              className="focus-ring absolute right-1.5 top-1.5 rounded-md bg-black/70 p-1.5 text-slate-300 opacity-0 backdrop-blur transition hover:text-rose-300 group-hover/item:opacity-100"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
