import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { profilesApi } from '../api/orion.js'
import ProfileGate from './ProfileGate.jsx'

const ProfileContext = createContext(null)

export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('useProfile must be used inside <ProfileProvider>')
  return context
}

/**
 * Owns which profile the app is reading and writing. Watchlist and history are
 * per profile in the main process, so nothing below this renders until one is
 * chosen.
 */
export default function ProfileProvider({ children }) {
  const [profiles, setProfiles] = useState(null)
  const [current, setCurrent] = useState(null)
  const [confirmed, setConfirmed] = useState(false)

  const refresh = useCallback(async () => {
    const [list, active] = await Promise.all([profilesApi.list(), profilesApi.current()])
    setProfiles(list)
    setCurrent(active)
    return list
  }, [])

  useEffect(() => {
    refresh()
    return profilesApi.onChanged(({ profiles: list, current: active }) => {
      setProfiles(list)
      setCurrent(active)
    })
  }, [refresh])

  const select = useCallback(async (id) => {
    const profile = await profilesApi.select(id)
    if (profile) {
      setCurrent(profile)
      setConfirmed(true)
    }
    return profile
  }, [])

  const create = useCallback(
    async (details) => {
      const profile = await profilesApi.create(details)
      await refresh()
      return profile
    },
    [refresh],
  )

  const update = useCallback(
    async (details) => {
      const profile = await profilesApi.update(details)
      await refresh()
      return profile
    },
    [refresh],
  )

  const remove = useCallback(
    async (id) => {
      const result = await profilesApi.remove(id)
      await refresh()
      return result
    },
    [refresh],
  )

  const value = useMemo(
    () => ({ profiles: profiles || [], current, select, create, update, remove, refresh, switchProfile: () => setConfirmed(false) }),
    [profiles, current, select, create, update, remove, refresh],
  )

  if (profiles === null) {
    return <div className="flex h-full items-center justify-center bg-ink-950" />
  }

  return (
    <ProfileContext.Provider value={value}>
      {confirmed && current ? children : <ProfileGate />}
    </ProfileContext.Provider>
  )
}
