import { useEffect, useRef } from 'react'
import { HardDrive, History, Loader2, Play, Share2, Sparkles, Users, Zap } from 'lucide-react'
import Badge from './Badge.jsx'

const HDR_TAGS = new Set(['HDR', 'HDR10', 'HDR10+', 'DV', 'HLG'])

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
export default function StreamList({ groups, busyStreamId, highlightStreamId, onPlay }) {
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
                highlighted={Boolean(highlightStreamId) && highlightStreamId === stream.id}
                onPlay={onPlay}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function StreamRow({ stream, busy, disabled, highlighted, onPlay }) {
  const isDirect = stream.kind !== 'p2p'
  const KindIcon = isDirect ? Zap : Share2
  const row = useRef(null)

  // The whole point of marking the previous release is not having to hunt for
  // it, so bring it into view rather than only colouring it.
  useEffect(() => {
    if (highlighted) row.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [highlighted])

  return (
    <li ref={row}>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => onPlay(stream)}
        className={`focus-ring group flex w-full items-center gap-3 rounded-lg px-3.5 py-3 text-left ring-1 transition enabled:hover:bg-ink-800 enabled:hover:ring-accent/30 disabled:opacity-50 ${
          highlighted ? 'bg-accent/10 ring-accent/50' : 'bg-ink-850 ring-white/5'
        }`}
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
            {highlighted && (
              <Badge tone="accent" title="This is the release you watched this with last time">
                <History size={10} />
                WATCHED LAST TIME
              </Badge>
            )}
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
            {stream.hdrFormat && (
              <Badge
                tone="amber"
                title={
                  stream.hdrFormat === 'DV'
                    ? 'Dolby Vision — mpv handles the dynamic metadata; VLC passes the HDR10 layer through'
                    : `${stream.hdrFormat} — launched with HDR arguments for your chosen player`
                }
              >
                <Sparkles size={10} />
                {stream.hdrFormat}
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
            {/* HDR variants get their own badge above, so they are dropped here. */}
            {stream.tags
              .filter((tag) => !HDR_TAGS.has(tag))
              .map((tag) => (
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
