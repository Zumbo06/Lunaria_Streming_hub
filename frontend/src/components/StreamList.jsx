import { HardDrive, Loader2, Play, Share2, Users, Zap } from 'lucide-react'
import Badge from './Badge.jsx'

const RESOLUTION_TONE = {
  '4K': 'accent',
  '1080p': 'green',
  '720p': 'default',
  SD: 'muted',
  Unknown: 'muted',
}

/**
 * Stream links grouped by resolution, each row carrying the size, seeder count
 * and quality tags parsed out of the addon payload (REQ-2.3, UI 3.1).
 */
export default function StreamList({ groups, busyStreamId, onPlay }) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.resolution}>
          <div className="mb-2.5 flex items-center gap-2.5">
            <Badge tone={RESOLUTION_TONE[group.resolution] || 'default'} className="px-2.5 py-1 text-[12px]">
              {group.resolution}
            </Badge>
            <span className="text-[11px] uppercase tracking-wider text-ink-500">
              {group.streams.length} {group.streams.length === 1 ? 'source' : 'sources'}
            </span>
          </div>

          <ul className="space-y-1.5">
            {group.streams.map((stream) => (
              <StreamRow
                key={`${group.resolution}-${stream.id}`}
                stream={stream}
                busy={busyStreamId === stream.id}
                disabled={Boolean(busyStreamId) && busyStreamId !== stream.id}
                onPlay={onPlay}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function StreamRow({ stream, busy, disabled, onPlay }) {
  const isDirect = stream.kind !== 'p2p'
  const KindIcon = isDirect ? Zap : Share2

  return (
    <li>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => onPlay(stream)}
        className="focus-ring group flex w-full items-center gap-3 rounded-lg bg-ink-850 px-3.5 py-3 text-left ring-1 ring-white/5 transition enabled:hover:bg-ink-800 enabled:hover:ring-accent/30 disabled:opacity-50"
      >
        <span
          className={`shrink-0 rounded-md p-1.5 ${
            isDirect ? 'bg-emerald-500/10 text-emerald-300' : 'bg-accent/10 text-accent-soft'
          }`}
          title={isDirect ? 'Direct HTTP source — starts instantly' : 'P2P source — buffered by the local engine'}
        >
          <KindIcon size={14} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-slate-200 group-enabled:group-hover:text-white">
            {stream.filename}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {stream.cached === true && <Badge tone="green">CACHED</Badge>}
            {stream.sizeLabel && (
              <Badge tone="muted">
                <HardDrive size={10} />
                {stream.sizeLabel}
              </Badge>
            )}
            {typeof stream.seeders === 'number' && (
              <Badge tone={stream.seeders > 20 ? 'green' : stream.seeders > 0 ? 'amber' : 'red'}>
                <Users size={10} />
                {stream.seeders}
              </Badge>
            )}
            {stream.multiAudio && <Badge tone="accent">MULTI</Badge>}
            {(stream.languages || []).slice(0, 4).map((language) => (
              <Badge key={language} tone="accent" title={`Audio: ${language}`}>
                {language}
              </Badge>
            ))}
            {(stream.languages || []).length > 4 && (
              <Badge tone="muted" title={stream.languages.join(', ')}>
                +{stream.languages.length - 4}
              </Badge>
            )}
            {stream.tags.map((tag) => (
              <Badge key={tag} tone={tag === 'CAM' ? 'red' : 'default'}>
                {tag}
              </Badge>
            ))}
            {stream.provider && <Badge tone="muted">{stream.provider}</Badge>}
            <span className="text-[11px] text-ink-500">{stream.addonName}</span>
          </div>
        </div>

        <span className="shrink-0 text-ink-500 transition group-enabled:group-hover:text-accent">
          {busy ? <Loader2 size={18} className="animate-spin text-accent" /> : <Play size={18} />}
        </span>
      </button>
    </li>
  )
}
