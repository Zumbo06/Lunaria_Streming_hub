import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Puzzle } from 'lucide-react'
import { addonsApi, catalogApi, playApi, progressApi } from '../api/orion.js'
import { useProfile } from '../components/ProfileProvider.jsx'
import ContinueWatching from '../components/ContinueWatching.jsx'
import Shelf from '../components/Shelf.jsx'
import { PosterSkeleton } from '../components/PosterCard.jsx'

/** Home dashboard: one shelf per catalog the installed addons expose (UI 3.1). */
export default function Home() {
  const { current } = useProfile()
  const [shelves, setShelves] = useState(null)
  const [resumable, setResumable] = useState([])

  const load = useCallback(async () => {
    setShelves(await catalogApi.shelves())
  }, [])

  const loadResumable = useCallback(async () => {
    setResumable(await progressApi.continueWatching(20))
  }, [])

  useEffect(() => {
    load()
    return addonsApi.onChanged(load)
  }, [load])

  useEffect(() => {
    loadResumable()
    // A position is committed when VLC closes, so refresh on that rather than
    // polling while something is still playing.
    return playApi.onEnded(loadResumable)
  }, [loadResumable, current?.id])

  if (shelves === null) {
    return (
      <div className="page py-6">
        {Array.from({ length: 3 }, (_, row) => (
          <section key={row} className="mb-8">
            <div className="skeleton mb-3 h-4 w-40" />
            <div className="flex gap-4 overflow-hidden">
              {Array.from({ length: 8 }, (_, index) => (
                <PosterSkeleton key={index} />
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  if (shelves.length === 0 && resumable.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center px-6 py-24 text-center">
        <div className="rounded-2xl bg-ink-850 p-4 text-accent ring-1 ring-white/5">
          <Puzzle size={28} />
        </div>
        <h1 className="mt-5 text-lg font-semibold text-slate-100">No catalogs yet</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-haze">
          Orion shows whatever your installed addons publish. Install a metadata addon — or re-enable one you turned
          off — and its shelves will appear here.
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
      <ContinueWatching entries={resumable} onChanged={loadResumable} />
      {shelves.map((shelf) => (
        <Shelf key={shelf.key} shelf={shelf} />
      ))}
    </div>
  )
}
