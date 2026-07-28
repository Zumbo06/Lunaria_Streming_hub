import { useEffect, useState } from 'react'
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Home, Puzzle, Search, Settings, X } from 'lucide-react'

const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/addons', label: 'Addons', icon: Puzzle },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export default function TopBar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [term, setTerm] = useState('')

  const onSearchPage = location.pathname === '/search'

  // Keep the field in step with the URL when arriving via back/forward.
  useEffect(() => {
    if (onSearchPage) setTerm(searchParams.get('q') || '')
  }, [onSearchPage, searchParams])

  // Every keystroke rewrites the query so results track the field live
  // (REQ-1.3); `replace` keeps the history stack from filling with fragments.
  function onChange(event) {
    const value = event.target.value
    setTerm(value)

    if (!value.trim()) {
      if (onSearchPage) navigate('/search', { replace: true })
      return
    }
    navigate(`/search?q=${encodeURIComponent(value)}`, { replace: onSearchPage })
  }

  function clear() {
    setTerm('')
    navigate('/search', { replace: true })
  }

  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-ink-950/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-6 px-6">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="focus-ring rounded text-[15px] font-bold tracking-[0.2em] text-slate-100"
        >
          ORION
        </button>

        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `focus-ring flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition ${
                  isActive ? 'bg-ink-800 text-white' : 'text-haze hover:bg-ink-850 hover:text-slate-200'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="relative ml-auto w-[340px]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" />
          <input
            type="search"
            value={term}
            onChange={onChange}
            placeholder="Search movies, series, anime…"
            aria-label="Search"
            className="focus-ring w-full rounded-lg bg-ink-850 py-2 pl-9 pr-8 text-[13px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 transition focus:bg-ink-800 focus:ring-accent/40"
          />
          {term && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={clear}
              className="focus-ring absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-ink-500 transition hover:text-slate-300"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
