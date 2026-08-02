import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * The scroll container is reused across routes, so without this, opening a
 * title from halfway down Home lands you halfway down the detail page.
 * Search is exempt: results update as you type and yanking the view to the top
 * on every keystroke would fight the user.
 */
export default function ScrollReset({ containerRef }) {
  const { pathname } = useLocation()

  useEffect(() => {
    if (pathname === '/search') return
    containerRef.current?.scrollTo({ top: 0 })
  }, [pathname, containerRef])

  return null
}
