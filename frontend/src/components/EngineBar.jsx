import { Loader2, Radio, Square, Users } from 'lucide-react'
import { formatBytes, formatSpeed } from '../api/orion.js'

const PHASE_LABEL = {
  connecting: 'Connecting to swarm',
  buffering: 'Buffering head of file',
  streaming: 'Streaming to VLC',
}

/**
 * Live status for the P2P engine. Visible only while a torrent is active, and
 * always offers a hard stop so a swarm is never left running unnoticed.
 */
export default function EngineBar({ engine, onStop }) {
  if (!engine.active) return null

  const buffering = engine.phase === 'buffering' && engine.buffer
  const settled = engine.phase === 'streaming'

  // While prebuffering, the meaningful number is how much of the opening and
  // the container index has landed — not overall file progress.
  const percent = buffering
    ? Math.min(100, Math.round(
        (((engine.buffer.headDone / Math.max(1, engine.buffer.headTarget)) +
          (engine.buffer.tailTotal ? engine.buffer.tailPresent / engine.buffer.tailTotal : 1)) /
          2) * 100,
      ))
    : Math.min(100, Math.round((engine.progress || 0) * 100))

  const label = buffering
    ? `Buffering start + index${engine.buffer.tailTotal ? ` · tail ${engine.buffer.tailPresent}/${engine.buffer.tailTotal}` : ''}`
    : PHASE_LABEL[engine.phase] || 'Working'

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-900/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 px-6 py-3">
        <div className="shrink-0 text-accent">
          {settled ? <Radio size={18} /> : <Loader2 size={18} className="animate-spin" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <p className="truncate text-[13px] font-medium text-slate-200">{engine.name || 'Preparing stream'}</p>
            <span className="shrink-0 text-[11px] uppercase tracking-wider text-ink-500">{label}</span>
          </div>

          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink-700">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 text-[12px] text-haze">
          <span className="tabular-nums">{percent}%</span>
          <span className="tabular-nums">{formatSpeed(engine.downloadSpeed)}</span>
          <span className="flex items-center gap-1 tabular-nums">
            <Users size={12} />
            {engine.numPeers}
          </span>
          {engine.length > 0 && (
            <span className="hidden tabular-nums sm:inline">
              {formatBytes(engine.downloaded)} / {formatBytes(engine.length)}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={onStop}
          className="focus-ring flex shrink-0 items-center gap-1.5 rounded-lg bg-ink-700 px-3 py-1.5 text-[12px] font-medium text-slate-200 transition hover:bg-rose-500/20 hover:text-rose-200"
        >
          <Square size={12} />
          Stop
        </button>
      </div>
    </div>
  )
}
