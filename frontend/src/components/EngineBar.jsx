import { Maximize2, Radio, Square, Users, Wifi } from 'lucide-react'
import { formatBytes, formatSpeed } from '../api/orion.js'

const PHASE_LABEL = {
  connecting: 'Connecting to swarm',
  buffering: 'Buffering head of file',
  streaming: 'Streaming to player',
}

/**
 * Live status for the P2P engine at the bottom of the screen.
 * Visible while a stream is active or minimized, and allows reopening
 * the full connection visualizer screen.
 */
export default function EngineBar({ engine, onStop, onExpand }) {
  if (!engine.active) return null

  const buffering = engine.phase === 'buffering' && engine.buffer
  const settled = engine.phase === 'streaming'

  // While prebuffering, the meaningful number is how much of the opening and
  // the container index has landed — not overall file progress.
  const percent = buffering
    ? Math.min(
        100,
        Math.round(
          (((engine.buffer.headDone / Math.max(1, engine.buffer.headTarget)) +
            (engine.buffer.tailTotal ? engine.buffer.tailPresent / engine.buffer.tailTotal : 1)) /
            2) *
            100,
        ),
      )
    : Math.min(100, Math.round((engine.progress || 0) * 100))

  const label = buffering
    ? `Buffering start + index${
        engine.buffer.tailTotal ? ` · tail ${engine.buffer.tailPresent}/${engine.buffer.tailTotal}` : ''
      }`
    : PHASE_LABEL[engine.phase] || 'Working'

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-900/95 shadow-2xl backdrop-blur">
      <div className="page flex items-center gap-4 px-6 py-3">
        {/* Brand Mark / Radio indicator */}
        <button
          type="button"
          onClick={onExpand}
          className="focus-ring group flex shrink-0 items-center justify-center rounded-lg p-1 transition hover:bg-white/5"
          title="Open full stream screen"
        >
          <div className="relative flex items-center justify-center">
            {settled ? (
              <Radio size={18} className="text-emerald-400" />
            ) : (
              <div className="relative h-5 w-5">
                <div className="absolute inset-0 animate-ping rounded-full bg-accent/20" />
                <div className="h-5 w-5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
              </div>
            )}
          </div>
        </button>

        {/* Info & Progress Bar */}
        <div
          onClick={onExpand}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onExpand?.()}
          className="min-w-0 flex-1 cursor-pointer select-none"
          title="Click to expand stream screen"
        >
          <div className="flex items-baseline gap-2">
            <p className="truncate text-[13px] font-semibold text-slate-200 hover:text-white">
              {engine.name || 'Active Stream'}
            </p>
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-accent-soft">{label}</span>
          </div>

          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                settled ? 'bg-emerald-400' : 'bg-accent'
              }`}
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        {/* Live Metrics */}
        <div className="flex shrink-0 items-center gap-4 text-[12px] text-haze">
          <span className="font-bold text-slate-200 tabular-nums">{percent}%</span>
          <span className="flex items-center gap-1 font-medium text-slate-300 tabular-nums">
            <Wifi size={12} className="text-accent-soft" />
            {formatSpeed(engine.downloadSpeed)}
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            <Users size={12} className="text-emerald-400" />
            {engine.numPeers}
          </span>
          {engine.length > 0 && (
            <span className="hidden tabular-nums md:inline">
              {formatBytes(engine.downloaded)} / {formatBytes(engine.length)}
            </span>
          )}
        </div>

        {/* Expand full screen button */}
        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="focus-ring flex shrink-0 items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 transition hover:bg-ink-700 hover:text-white"
            title="Expand to full loading screen"
          >
            <Maximize2 size={12} />
            <span className="hidden sm:inline">Expand</span>
          </button>
        )}

        {/* Stop Button */}
        <button
          type="button"
          onClick={onStop}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-1.5 text-[12px] font-medium text-slate-200 transition hover:bg-rose-500/20 hover:text-rose-200"
          title="Stop swarm and stream"
        >
          <Square size={12} />
          Stop
        </button>
      </div>
    </div>
  )
}
