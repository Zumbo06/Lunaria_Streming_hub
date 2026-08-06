// Is frontend/dist older than the sources that produce it?
//
// run.bat used to rebuild only when dist was missing entirely, so any edit to
// the interface was silently ignored until someone deleted the folder by hand.
// Exits 0 when a rebuild is needed, 1 when the build is current.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const built = path.join(root, 'frontend', 'dist', 'index.html')

// Everything that feeds a build. Config files matter as much as source: a
// changed Tailwind or Vite config changes the output without touching src/.
const WATCH_DIRS = ['frontend/src']
const WATCH_FILES = [
  'frontend/index.html',
  'frontend/vite.config.js',
  'frontend/tailwind.config.js',
  'frontend/postcss.config.js',
  'frontend/package.json',
]

function newestIn(dir) {
  let newest = 0
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const stamp = entry.isDirectory() ? newestIn(full) : statTime(full)
    if (stamp > newest) newest = stamp
  }
  return newest
}

function statTime(file) {
  try {
    return fs.statSync(file).mtimeMs
  } catch {
    return 0
  }
}

const builtAt = statTime(built)

// No build at all — definitely needs one.
if (builtAt === 0) process.exit(0)

let sourceAt = 0
for (const dir of WATCH_DIRS) sourceAt = Math.max(sourceAt, newestIn(path.join(root, dir)))
for (const file of WATCH_FILES) sourceAt = Math.max(sourceAt, statTime(path.join(root, file)))

process.exit(sourceAt > builtAt ? 0 : 1)
