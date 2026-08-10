// Takes down the launch screen in index.html.
//
// The markup is there rather than in a component so it paints on the first
// frame; this is the other half of that arrangement — the app says when there
// is finally something behind it worth looking at.

// The mark's own animation runs to about 1.15s. Dismissing before it finishes
// reads as a glitch rather than as speed, so a fast start waits for the motion
// to land — and then holds the finished mark for a beat, which is what makes a
// launch screen feel deliberate instead of merely slow. Measured from
// navigation start, which `performance.now()` already counts from.
const MINIMUM_VISIBLE_MS = 2250

// If the app never reports itself ready — an IPC that never answers, a throw
// during the first render — the launch screen must not become a permanent lid
// over a working window.
const FAILSAFE_MS = 8000

const FADE_MS = 420

let dismissed = false
let failsafe = null

function removeNow() {
  const splash = document.getElementById('splash')
  if (!splash) return

  splash.classList.add('is-leaving')
  // Dropped entirely rather than left at opacity 0: it covers the whole window
  // and would otherwise keep swallowing clicks and sitting in the a11y tree.
  window.setTimeout(() => splash.remove(), FADE_MS)
}

/**
 * Fades the launch screen out, no earlier than the animation can finish.
 * Safe to call more than once and safe to call when there is no splash — a
 * dev-server reload after the first mount has already removed it.
 */
export function dismissSplash() {
  if (dismissed) return
  dismissed = true

  window.clearTimeout(failsafe)

  const remaining = Math.max(0, MINIMUM_VISIBLE_MS - performance.now())
  if (remaining === 0) removeNow()
  else window.setTimeout(removeNow, remaining)
}

/** Arms the failsafe. Called once, from the entry point. */
export function watchSplash() {
  if (!document.getElementById('splash')) return

  failsafe = window.setTimeout(() => {
    console.warn('[splash] App never reported ready — dismissing so the window is usable.')
    dismissSplash()
  }, FAILSAFE_MS)
}
