const TONES = {
  default: 'bg-ink-700 text-slate-300',
  muted: 'bg-ink-800 text-haze',
  accent: 'bg-accent/15 text-accent-soft ring-1 ring-accent/30',
  green: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25',
  amber: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/25',
  red: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/25',
}

export default function Badge({ children, tone = 'default', className = '', title }) {
  return (
    <span title={title} className={`pill ${TONES[tone] || TONES.default} ${className}`}>
      {children}
    </span>
  )
}
