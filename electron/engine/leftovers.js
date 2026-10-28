// What a stream leaves on disk, and how to take it back off.
//
// Each stream keeps a small record in the journal folder of what it has written
// and whether any of it may be kept. The engine discards a stream by that record
// when it stops and then deletes the record. A record still there afterwards
// belongs to a stream that never got to — the app crashed, was ended from Task
// Manager, or the machine lost power — and the main process discards it at the
// next launch by the same rules, so a crash ends up where a clean stop would.
//
// Shared by the engine (ESM) and the main process (CommonJS), so it stays
// CommonJS and dependency-free.

const fs = require('fs')
const os = require('os')
const path = require('path')

const RECORD_EXTENSION = '.json'

function isInside(parent, target) {
  const relative = path.relative(parent, target)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/**
 * A record only ever names things inside the stream's own folder, and a folder
 * the stream owns outright is always an `orion-*` scratch folder in the system
 * temp directory. Anything else is a damaged or foreign record, and nothing is
 * deleted on its say-so.
 */
function isSafe(record) {
  if (!record || typeof record.dir !== 'string' || !path.isAbsolute(record.dir)) return false

  if (record.ownsDir) {
    return (
      path.dirname(path.resolve(record.dir)) === path.resolve(os.tmpdir()) &&
      path.basename(record.dir).startsWith('orion-')
    )
  }

  const entries = [...(record.files || []).map((file) => file?.path), ...(record.dirs || [])]
  return entries.every((entry) => typeof entry === 'string' && isInside(record.dir, entry))
}

/**
 * Removes what one stream wrote. A scratch folder it created goes whole. In a
 * folder the user chose, a file goes unless it was there before the stream
 * started, or downloads are being kept and the player actually read this one — a
 * stream that failed or was closed before playback keeps nothing. Folders the
 * stream created go once they are empty.
 *
 * Returns false when something that should have gone is still there (a file
 * still locked, say), so the record can be kept and tried again later.
 */
function discard(record) {
  if (!isSafe(record)) return true

  if (record.ownsDir) {
    try {
      fs.rmSync(record.dir, { recursive: true, force: true, maxRetries: 3 })
      return true
    } catch {
      return false
    }
  }

  let clean = true
  const keepWatched = Boolean(record.keep && record.delivered)

  for (const file of record.files || []) {
    if (file.preexisting || keepWatched) continue
    try {
      fs.rmSync(file.path, { force: true, maxRetries: 3 })
    } catch {
      clean = false
    }
  }

  // Deepest first; `rmdirSync` refuses a folder that still has anything in it,
  // which is exactly the folder that should stay.
  for (const dir of [...(record.dirs || [])].sort((a, b) => b.length - a.length)) {
    try {
      fs.rmdirSync(dir)
    } catch {
      /* not empty, or already gone */
    }
  }

  return clean
}

function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM: it exists, it just is not ours to signal.
    return err.code === 'EPERM'
  }
}

/**
 * Discards every stream in the journal whose engine is no longer running, and
 * returns the folders still in use by engines that are — another instance's
 * live stream must never be pulled out from under it.
 */
function sweep(journalDir) {
  const inUse = new Set()

  let names = []
  try {
    names = fs.readdirSync(journalDir).filter((name) => name.endsWith(RECORD_EXTENSION))
  } catch {
    return inUse
  }

  for (const name of names) {
    const recordPath = path.join(journalDir, name)

    let record = null
    try {
      record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    } catch {
      // Unreadable: written half-way when the engine died. Nothing in it can be
      // trusted, and an orphaned scratch folder is still caught by the
      // temp-folder sweep.
      fs.rmSync(recordPath, { force: true })
      continue
    }

    if (isRunning(record?.pid)) {
      if (typeof record.dir === 'string') inUse.add(path.resolve(record.dir))
      continue
    }

    if (discard(record)) fs.rmSync(recordPath, { force: true })
  }

  return inUse
}

module.exports = { RECORD_EXTENSION, discard, sweep }
