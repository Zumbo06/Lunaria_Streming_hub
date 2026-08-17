import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Settings,
  Trash2,
} from 'lucide-react'
import { downloadsApi, formatAgo, formatBytes } from '../api/orion.js'
import { usePlayer } from '../components/PlayerProvider.jsx'
import Badge from '../components/Badge.jsx'

export default function Downloads() {
  const { pushToast } = usePlayer()
  const [loading, setLoading] = useState(true)
  const [files, setFiles] = useState([])
  const [downloadDir, setDownloadDir] = useState('')
  const [totalSizeBytes, setTotalSizeBytes] = useState(0)
  const [query, setQuery] = useState('')
  const [deletingPath, setDeletingPath] = useState(null)
  const [playingPath, setPlayingPath] = useState(null)

  async function loadDownloads() {
    setLoading(true)
    try {
      const res = await downloadsApi.list()
      if (res.ok) {
        setFiles(res.files || [])
        setDownloadDir(res.downloadDir || '')
        setTotalSizeBytes(res.totalSizeBytes || 0)
      } else {
        pushToast({ tone: 'error', title: 'Could not load downloads', message: res.error })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: 'Error', message: err.message })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadDownloads()
  }, [])

  async function handlePlay(file) {
    setPlayingPath(file.path)
    try {
      const res = await downloadsApi.play(file.path)
      if (res.ok) {
        pushToast({
          tone: 'success',
          title: `Playing in ${res.player || 'player'}`,
          message: file.filename,
        })
      } else {
        pushToast({ tone: 'error', title: 'Playback error', message: res.error })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: 'Playback error', message: err.message })
    } finally {
      setPlayingPath(null)
    }
  }

  async function handleDelete(file) {
    if (!window.confirm(`Delete "${file.filename}" from disk?`)) return
    setDeletingPath(file.path)
    try {
      const res = await downloadsApi.delete(file.path)
      if (res.ok) {
        setFiles((current) => current.filter((f) => f.path !== file.path))
        setTotalSizeBytes((prev) => Math.max(0, prev - file.sizeBytes))
        pushToast({ tone: 'info', title: 'File deleted', message: file.filename })
      } else {
        pushToast({ tone: 'error', title: 'Could not delete', message: res.error })
      }
    } catch (err) {
      pushToast({ tone: 'error', title: 'Error', message: err.message })
    } finally {
      setDeletingPath(null)
    }
  }

  const filteredFiles = useMemo(() => {
    if (!query.trim()) return files
    const q = query.toLowerCase()
    return files.filter((f) => f.filename.toLowerCase().includes(q))
  }, [files, query])

  return (
    <div className="page py-8">
      {/* Header Banner */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">Downloads</h1>
          <p className="mt-1 text-[13px] text-haze">
            {files.length} {files.length === 1 ? 'file' : 'files'} · {formatBytes(totalSizeBytes) || '0 B'} used for offline media
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={loadDownloads}
            disabled={loading}
            className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-850 px-3.5 py-2 text-[13px] font-medium text-slate-200 ring-1 ring-white/5 transition hover:bg-ink-800"
            title="Refresh list"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {downloadDir && (
            <button
              type="button"
              onClick={() => downloadsApi.openFolder()}
              className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-850 px-3.5 py-2 text-[13px] font-medium text-slate-200 ring-1 ring-white/5 transition hover:bg-ink-800"
              title="Open folder in Explorer"
            >
              <FolderOpen size={14} />
              <span>Open Folder</span>
            </button>
          )}

          <Link
            to="/settings"
            className="focus-ring flex items-center gap-1.5 rounded-lg bg-accent/15 px-3.5 py-2 text-[13px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/25"
          >
            <Settings size={14} />
            <span>Download Settings</span>
          </Link>
        </div>
      </div>

      {/* Search Filter */}
      {files.length > 0 && (
        <div className="mb-6 max-w-md">
          <div className="relative">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-haze" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter downloaded files…"
              className="focus-ring w-full rounded-xl bg-ink-850 py-2.5 pl-10 pr-4 text-[13px] text-slate-100 placeholder-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
            />
          </div>
        </div>
      )}

      {/* Main Content */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-20 w-full" />
          ))}
        </div>
      ) : files.length === 0 ? (
        <div className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-ink-850 text-haze ring-1 ring-white/10">
            <HardDrive size={30} />
          </div>
          <h2 className="mt-5 text-base font-semibold text-slate-100">No offline downloads yet</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-haze">
            When <span className="font-medium text-accent-soft">Keep downloads</span> is turned on in Settings, streams will be saved locally so you can play them without an internet connection.
          </p>
          <Link
            to="/settings"
            className="focus-ring mt-6 flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[13px] font-semibold text-ink-950 transition hover:bg-accent-soft"
          >
            <Settings size={15} />
            Turn on Keep Downloads
          </Link>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="rounded-xl bg-ink-850 p-8 text-center text-sm text-haze ring-1 ring-white/5">
          No files match your filter &ldquo;{query}&rdquo;.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredFiles.map((file) => (
            <div
              key={file.path}
              className="group relative flex flex-col justify-between rounded-2xl bg-ink-850/80 p-4 ring-1 ring-white/5 transition hover:bg-ink-800/90 hover:ring-accent/30"
            >
              <div>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-800 text-accent-soft group-hover:bg-accent/15">
                    <Film size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3
                      className="truncate text-[13.5px] font-semibold text-slate-200 group-hover:text-white"
                      title={file.filename}
                    >
                      {file.filename}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-haze">
                      <Badge tone="muted">{formatBytes(file.sizeBytes)}</Badge>
                      <Badge tone="accent">{file.ext.replace('.', '').toUpperCase()}</Badge>
                      {file.modifiedAt && <span>{formatAgo(file.modifiedAt)}</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/5 pt-3">
                <button
                  type="button"
                  onClick={() => downloadsApi.reveal(file.path)}
                  className="focus-ring flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-haze transition hover:bg-ink-700 hover:text-slate-200"
                  title="Show in folder"
                >
                  <Folder size={13} />
                  <span className="hidden sm:inline">Folder</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleDelete(file)}
                  disabled={deletingPath === file.path}
                  className="focus-ring flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-300/80 transition hover:bg-rose-500/15 hover:text-rose-200"
                  title="Delete file"
                >
                  {deletingPath === file.path ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Trash2 size={13} />
                  )}
                  <span className="hidden sm:inline">Delete</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePlay(file)}
                  disabled={playingPath === file.path}
                  className="focus-ring flex items-center gap-1.5 rounded-lg bg-accent/20 px-3.5 py-1.5 text-xs font-semibold text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/30 hover:text-white"
                >
                  {playingPath === file.path ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Play size={13} className="fill-current" />
                  )}
                  <span>Play</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
