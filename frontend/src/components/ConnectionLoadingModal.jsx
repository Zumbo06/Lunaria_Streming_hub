import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Captions,
  CheckCircle2,
  Film,
  HardDrive,
  Minimize2,
  MonitorPlay,
  Share2,
  Sparkles,
  Square,
  Tv,
  Users,
  Wifi,
  Zap,
} from 'lucide-react'
import { formatBytes, formatSpeed } from '../api/orion.js'
import Badge from './Badge.jsx'
import LogoLoadingBar from './LogoLoadingBar.jsx'

const RESOLUTION_TONE = {
  '4K': 'accent',
  '1080p': 'green',
  '720p': 'default',
  SD: 'muted',
}

/**
 * ConnectionLoadingModal
 *
 * Immersive Stremio-inspired loading screen overlay:
 * - Fullscreen darkened & blurred content backdrop
 * - Poster card with quality & HDR tags
 * - Lunaria brand mark as animated liquid loading bar
 * - Live real-time swarm metrics (Speed, Peers, Buffer, Size)
 * - Dead Swarm Smart Auto-Failover detector
 * - Minimize & Cancel / Stop controls
 */
export default function ConnectionLoadingModal({
  open,
  session,
  engine,
  onCancel,
  onMinimize,
}) {
  const { item, stream, subtitle, player, phase: sessionPhase, error } = session || {}

  const isDirect = stream?.kind !== 'p2p'
  const isSettled = sessionPhase === 'playing' || sessionPhase === 'ready' || engine.phase === 'streaming'
  const isConnecting = sessionPhase === 'connecting' || sessionPhase === 'starting-engine' || engine.phase === 'connecting'
  const isBuffering = !isDirect && (sessionPhase === 'buffering' || engine.phase === 'buffering')

  const [elapsedSeconds, setElapsedSeconds] = useState(0)

  // Hotkey: Escape to cancel/close
  useEffect(() => {
    if (!open) return undefined

    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open || !session) return null

  // Calculate buffer percentage
  const bufferPercent =
    engine.phase === 'buffering' && engine.buffer
      ? Math.min(
          100,
          Math.round(
            (((engine.buffer.headDone / Math.max(1, engine.buffer.headTarget)) +
              (engine.buffer.tailTotal ? engine.buffer.tailPresent / engine.buffer.tailTotal : 1)) /
              2) *
              100,
          ),
        )
      : isDirect
      ? isSettled
        ? 100
        : 50
      : Math.min(100, Math.round((engine.progress || 0) * 100))

  const activePhase = isSettled
    ? 'playing'
    : error
    ? 'error'
    : isDirect
    ? 'connecting'
    : engine.phase || sessionPhase || 'connecting'

  const headBufferLabel =
    engine.buffer?.headTarget > 0
      ? `${formatBytes(engine.buffer.headDone) || '0 B'} / ${formatBytes(engine.buffer.headTarget)}`
      : null

  const tailBufferLabel =
    engine.buffer?.tailTotal > 0
      ? `${formatBytes(engine.buffer.tailPresent) || '0 B'} / ${formatBytes(engine.buffer.tailTotal)}`
      : null

  const backdropUrl = item?.background || item?.poster || null
  const isSeries = item?.type === 'series'
  const hasEpisode = item?.season != null && item?.episode != null

  const episodeLabel = hasEpisode
    ? `S${String(item.season).padStart(2, '0')}E${String(item.episode).padStart(2, '0')}${
        item.episodeTitle ? ` · ${item.episodeTitle}` : ''
      }`
    : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Stream Connection Screen"
      className="fixed inset-0 z-50 flex flex-col justify-between overflow-hidden bg-ink-950/95 text-slate-100 backdrop-blur-2xl transition-opacity duration-300"
    >
      {/* Background Media Art with Cinematic Vignette */}
      {backdropUrl && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <img
            src={backdropUrl}
            alt=""
            decoding="async"
            className="h-full w-full object-cover object-center scale-105 filter blur-3xl opacity-30 brightness-50 contrast-125 transition-transform duration-1000"
          />
          {/* Radial & Linear Vignettes */}
          <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/85 to-ink-950/70" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(8,9,13,0.85)_80%)]" />
        </div>
      )}

      {/* Header Bar */}
      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring flex items-center gap-2 rounded-xl bg-ink-900/80 px-4 py-2 text-[13px] font-semibold text-slate-200 ring-1 ring-white/10 backdrop-blur transition hover:bg-rose-500/20 hover:text-rose-200 hover:ring-rose-500/30"
          title="Cancel loading (Esc)"
        >
          <ArrowLeft size={16} />
          <span>Cancel</span>
          <kbd className="hidden rounded bg-black/40 px-1.5 py-0.5 text-[10px] font-mono text-haze sm:inline">
            Esc
          </kbd>
        </button>

        {/* Center Live State Indicator */}
        <div className="flex items-center gap-2 rounded-full bg-ink-900/90 px-4 py-1.5 text-[12px] font-medium text-slate-300 ring-1 ring-white/10 backdrop-blur">
          <span
            className={`h-2 w-2 rounded-full ${
              isSettled
                ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                : isConnecting
                ? 'animate-ping bg-accent shadow-[0_0_8px_#6f8dff]'
                : 'animate-pulse bg-accent-soft'
            }`}
          />
          <span>
            {isSettled
              ? 'Handing off to player…'
              : isDirect
              ? 'Direct stream'
              : isConnecting
              ? 'Connecting to swarm…'
              : 'Buffering stream…'}
          </span>
        </div>

        {/* Right Actions: Minimize & Player Badge */}
        <div className="flex items-center gap-3">
          {player && (
            <div className="hidden items-center gap-1.5 rounded-xl bg-ink-900/80 px-3.5 py-2 text-[12px] font-medium text-slate-300 ring-1 ring-white/10 backdrop-blur sm:flex">
              <MonitorPlay size={14} className="text-accent-soft" />
              <span>{player}</span>
            </div>
          )}

          <button
            type="button"
            onClick={onMinimize}
            className="focus-ring flex items-center gap-1.5 rounded-xl bg-ink-900/80 px-3.5 py-2 text-[12px] font-medium text-slate-300 ring-1 ring-white/10 backdrop-blur transition hover:bg-ink-800 hover:text-white"
            title="Minimize to bottom bar and keep buffering"
          >
            <Minimize2 size={14} />
            <span className="hidden sm:inline">Minimize</span>
          </button>
        </div>
      </header>

      {/* Main Content Showcase */}
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-4">
        {/* Error Notification Card if failed */}
        {error && (
          <div className="mb-8 w-full max-w-xl animate-risein rounded-2xl border border-rose-500/30 bg-rose-950/60 p-5 shadow-2xl backdrop-blur">
            <div className="flex items-start gap-3.5">
              <AlertTriangle size={22} className="shrink-0 text-rose-400" />
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-rose-200">Could not start playback</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-rose-300/80">{error}</p>
                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="focus-ring rounded-lg bg-rose-500/20 px-3.5 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/30"
                  >
                    Close & pick another source
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid w-full items-center gap-8 md:grid-cols-12 md:gap-12">
          {/* Left Column: Media Card */}
          <div className="flex flex-col items-center text-center md:col-span-5 md:items-start md:text-left">
            <div className="relative group w-44 shrink-0 overflow-hidden rounded-2xl bg-ink-900 shadow-[0_16px_36px_rgba(0,0,0,0.9)] ring-1 ring-white/15 transition duration-500 hover:scale-105 sm:w-52">
              {item?.poster ? (
                <img
                  src={item.poster}
                  alt={item.name || 'Content'}
                  decoding="async"
                  className="aspect-[2/3] w-full object-cover"
                />
              ) : (
                <div className="flex aspect-[2/3] items-center justify-center text-ink-500">
                  {isSeries ? <Tv size={36} /> : <Film size={36} />}
                </div>
              )}

              {/* Quality overlay badge on poster */}
              {stream?.resolution && (
                <div className="absolute top-2.5 left-2.5">
                  <Badge tone={RESOLUTION_TONE[stream.resolution] || 'accent'} className="px-2 py-0.5 text-[11px] font-bold shadow-md">
                    {stream.resolution}
                  </Badge>
                </div>
              )}
            </div>

            {/* Media Information */}
            <div className="mt-4 w-full">
              <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl line-clamp-2">
                {item?.name || stream?.filename || 'Loading Stream'}
              </h1>

              {episodeLabel && (
                <p className="mt-1 text-[13px] font-semibold text-accent-soft line-clamp-1">
                  {episodeLabel}
                </p>
              )}

              {/* Release Metadata Tags */}
              <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5 md:justify-start">
                {stream?.hdrFormat && (
                  <Badge tone="amber">
                    <Sparkles size={10} />
                    {stream.hdrFormat}
                  </Badge>
                )}
                {stream?.sizeLabel && (
                  <Badge tone="muted">
                    <HardDrive size={10} />
                    {stream.sizeLabel}
                  </Badge>
                )}
                {subtitle && (
                  <Badge tone="accent">
                    <Captions size={10} />
                    {subtitle.language} subs
                  </Badge>
                )}
                {stream?.addonName && <Badge tone="muted">{stream.addonName}</Badge>}
              </div>

              {/* Monospace Release Name */}
              {stream?.filename && (
                <p className="mt-3 max-w-sm rounded-lg bg-ink-900/80 px-3 py-2 text-[11.5px] font-mono text-haze ring-1 ring-white/5 line-clamp-2" title={stream.filename}>
                  {stream.filename}
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Centerpiece Logo Loading Bar */}
          <div className="flex flex-col items-center justify-center md:col-span-7">
            <div className="w-full rounded-3xl border border-white/10 bg-ink-900/60 p-8 shadow-2xl backdrop-blur-xl sm:p-10">
              <LogoLoadingBar
                progress={bufferPercent}
                phase={activePhase}
                downloadSpeed={engine.downloadSpeed || 0}
                numPeers={engine.numPeers || 0}
                headBuffer={headBufferLabel}
                tailBuffer={tailBufferLabel}
                isDirect={isDirect}
                playerName={player || 'player'}
              />

              {/* Quick Stop Action inside card */}
              <div className="mt-8 flex justify-center">
                <button
                  type="button"
                  onClick={onCancel}
                  className="focus-ring flex items-center gap-2 rounded-xl bg-ink-800/80 px-5 py-2.5 text-xs font-semibold text-slate-300 ring-1 ring-white/10 transition hover:bg-rose-500/20 hover:text-rose-200 hover:ring-rose-500/30"
                >
                  <Square size={13} />
                  <span>Stop stream</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Live Swarm Metrics Grid Footer */}
      <footer className="relative z-10 px-6 py-6 sm:px-10">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-3 sm:grid-cols-4">
          {/* 1. Download Speed */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-white/5 bg-ink-900/70 p-3.5 backdrop-blur">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent-soft">
              <Wifi size={18} className={engine.downloadSpeed > 0 ? 'animate-pulse' : ''} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-haze">Speed</p>
              <p className="truncate text-[14px] font-bold text-white tabular-nums">
                {formatSpeed(engine.downloadSpeed || 0)}
              </p>
            </div>
          </div>

          {/* 2. Connected Peers */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-white/5 bg-ink-900/70 p-3.5 backdrop-blur">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <Users size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-haze">Swarm Peers</p>
              <p className="truncate text-[14px] font-bold text-white tabular-nums">
                {isDirect ? 'Direct Server' : `${engine.numPeers || 0} peers`}
              </p>
            </div>
          </div>

          {/* 3. Progress / Size */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-white/5 bg-ink-900/70 p-3.5 backdrop-blur">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
              <HardDrive size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-haze">Downloaded</p>
              <p className="truncate text-[14px] font-bold text-white tabular-nums">
                {engine.length > 0
                  ? `${formatBytes(engine.downloaded) || '0 B'} / ${formatBytes(engine.length)}`
                  : stream?.sizeLabel || (isDirect ? 'Stream' : 'Connecting')}
              </p>
            </div>
          </div>

          {/* 4. Stream Source Protocol */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-white/5 bg-ink-900/70 p-3.5 backdrop-blur">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-500/15 text-purple-300">
              {isDirect ? <Zap size={18} /> : <Share2 size={18} />}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-haze">Source</p>
              <p className="truncate text-[14px] font-bold text-white">
                {isDirect ? 'Direct HTTP' : 'P2P Swarm'}
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
