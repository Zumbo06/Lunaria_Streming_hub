import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { settingsApi } from '../api/orion.js'

export const THEMES = [
  {
    id: 'midnight',
    name: 'Midnight',
    description: 'Deep blue-grey. The default.',
    swatch: ['#08090d', '#161a24', '#6f8dff'],
  },
  {
    id: 'oled',
    name: 'OLED black',
    description: 'True #000 background with lifted separators and brighter muted text. Saves power and gives infinite contrast on an OLED panel.',
    swatch: ['#000000', '#141418', '#7c9aff'],
  },
]

const ThemeContext = createContext(null)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used inside <ThemeProvider>')
  return context
}

function apply(theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * Themes are a single `data-theme` attribute on <html>; every colour in the app
 * resolves through CSS variables scoped to it, so switching is instant and
 * needs no re-render of the tree.
 */
export default function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('midnight')

  useEffect(() => {
    settingsApi.get().then((settings) => {
      const stored = settings?.theme === 'oled' ? 'oled' : 'midnight'
      setThemeState(stored)
      apply(stored)
    })
  }, [])

  const setTheme = useCallback(async (next) => {
    // Paint first so the click feels instant; persistence follows.
    apply(next)
    setThemeState(next)
    await settingsApi.save({ theme: next })
  }, [])

  const value = useMemo(() => ({ theme, setTheme, themes: THEMES }), [theme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
