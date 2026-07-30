import { Route, Routes } from 'react-router-dom'
import PlayerProvider from './components/PlayerProvider.jsx'
import ProfileProvider from './components/ProfileProvider.jsx'
import TopBar from './components/TopBar.jsx'
import Home from './pages/Home.jsx'
import Discover from './pages/Discover.jsx'
import Detail from './pages/Detail.jsx'
import SearchPage from './pages/Search.jsx'
import Watchlist from './pages/Watchlist.jsx'
import Addons from './pages/Addons.jsx'
import SettingsPage from './pages/Settings.jsx'

export default function App() {
  return (
    <ProfileProvider>
      <PlayerProvider>
        <div className="flex h-full flex-col bg-ink-950">
          <TopBar />
          <main className="flex-1 overflow-y-auto">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/title/:type/:id" element={<Detail />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/addons" element={<Addons />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Routes>
          </main>
        </div>
      </PlayerProvider>
    </ProfileProvider>
  )
}
