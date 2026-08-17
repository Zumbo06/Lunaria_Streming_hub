import { useMemo } from 'react'
import { CheckCircle2 } from 'lucide-react'

/**
 * LogoLoadingBar
 *
 * Renders the Lunaria brand mark (orbital ring + crescent disc) transformed into
 * a dynamic loading bar:
 * - Outer orbital ring sweeps clockwise from 0% to 100% (circumference: 2 * PI * 34 ~= 213.63px)
 * - Inner crescent fills from bottom to top with glowing liquid gradient
 * - Ambient radial glow pulses proportionally with download speed & peers
 * - Center stage displays live percentage and buffer metrics
 */
export default function LogoLoadingBar({
  progress = 0,
  phase = 'connecting',
  downloadSpeed = 0,
  numPeers = 0,
  headBuffer = null,
  tailBuffer = null,
  isDirect = false,
  playerName = 'player',
  className = '',
}) {
  const isSettled = phase === 'streaming' || phase === 'playing' || phase === 'ready'
  const isConnecting = phase === 'connecting' || phase === 'starting-engine'
  const isBuffering = phase === 'buffering'

  // Progress clamped between 0 and 100
  const normalizedProgress = isSettled ? 100 : Math.min(100, Math.max(0, Math.round(progress)))

  // SVG parameters for 120x120 viewBox
  const radius = 34
  const circumference = 2 * Math.PI * radius // ~213.63
  // Stroke dashoffset: 213.63 = 0%, 0 = 100%
  const strokeOffset = circumference - (normalizedProgress / 100) * circumference

  // Vertical fill height for crescent: circle cx=60, cy=60, r=34 => y ranges from 94 (bottom) to 26 (top)
  // Fill height spans 68px.
  const fillHeight = (normalizedProgress / 100) * 68
  const clipY = 94 - fillHeight

  // Intensity of ambient glow based on speed & peers
  const glowIntensity = useMemo(() => {
    if (isSettled) return 1.0
    if (downloadSpeed > 10 * 1024 * 1024) return 0.95
    if (downloadSpeed > 2 * 1024 * 1024) return 0.8
    if (downloadSpeed > 0) return 0.65
    return isConnecting ? 0.5 : 0.4
  }, [downloadSpeed, isConnecting, isSettled])

  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      {/* Brand Mark Container */}
      <div className="relative flex items-center justify-center">
        {/* Ambient Radial Bloom */}
        <div
          className="pointer-events-none absolute -inset-10 rounded-full transition-all duration-700"
          style={{
            background: `radial-gradient(circle at 50% 50%, rgb(var(--accent) / ${
              glowIntensity * 0.45
            }) 0%, rgb(var(--accent-soft) / ${glowIntensity * 0.15}) 45%, transparent 70%)`,
            transform: isSettled ? 'scale(1.25)' : isBuffering ? 'scale(1.1)' : 'scale(1)',
          }}
        />

        {/* Outer Pulsing Aura in Connecting / Buffering */}
        {(isConnecting || (isBuffering && downloadSpeed > 0)) && (
          <div
            className="pointer-events-none absolute -inset-4 animate-ping rounded-full opacity-20"
            style={{
              background: 'radial-gradient(circle, rgb(var(--accent-soft)) 0%, transparent 70%)',
              animationDuration: isConnecting ? '2.4s' : '1.6s',
            }}
          />
        )}

        {/* SVG Logo Loading Bar */}
        <div className="relative h-32 w-32 drop-shadow-[0_0_24px_rgba(111,141,255,0.4)] transition-transform duration-500 hover:scale-105 sm:h-36 sm:w-36">
          <svg viewBox="0 0 120 120" className="h-full w-full overflow-visible" aria-hidden="true">
            <defs>
              {/* Crescent Mask: Base disc minus the offset cutout disc */}
              <mask id="logo-crescent-mask">
                <circle cx="60" cy="60" r="34" fill="#ffffff" />
                <circle cx="79" cy="49" r="30" fill="#000000" />
              </mask>

              {/* Dynamic Vertical Liquid Fill Clip Path */}
              <clipPath id="logo-liquid-fill-clip">
                <rect x="20" y={clipY} width="80" height={fillHeight + 4} />
              </clipPath>

              {/* Glowing Gradient Sheen */}
              <linearGradient id="logo-accent-gradient" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="rgb(var(--accent-dim, 61 77 143))" />
                <stop offset="60%" stopColor="rgb(var(--accent, 111 141 255))" />
                <stop offset="100%" stopColor="rgb(var(--accent-soft, 142 164 255))" />
              </linearGradient>

              {/* Radiant Success Gradient */}
              <linearGradient id="logo-success-gradient" x1="0" y1="1" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="50%" stopColor="#34d399" />
                <stop offset="100%" stopColor="#6ee7b7" />
              </linearGradient>

              {/* Shimmer Wave Filter */}
              <linearGradient id="logo-wave-sheen" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="transparent" />
                <stop offset="50%" stopColor="rgba(255, 255, 255, 0.4)" />
                <stop offset="100%" stopColor="transparent" />
              </linearGradient>
            </defs>

            {/* Base Background Track Ring (Faint Orbit) */}
            <circle
              cx="60"
              cy="60"
              r="34"
              fill="none"
              stroke="rgb(var(--ink-700))"
              strokeWidth="2"
              strokeDasharray="4 4"
              className="opacity-40"
            />

            {/* Indeterminate Spinning Halo in Connecting Phase */}
            {isConnecting && (
              <circle
                cx="60"
                cy="60"
                r="34"
                fill="none"
                stroke="url(#logo-accent-gradient)"
                strokeWidth="2.5"
                strokeDasharray="70 143.6"
                strokeLinecap="round"
                className="origin-center animate-spin"
                style={{ animationDuration: '1.8s' }}
              />
            )}

            {/* Active Progress Orbital Ring (Fills 0% -> 100% clockwise from 12 o'clock) */}
            {!isConnecting && (
              <circle
                cx="60"
                cy="60"
                r="34"
                fill="none"
                stroke={isSettled ? 'url(#logo-success-gradient)' : 'url(#logo-accent-gradient)'}
                strokeWidth={isSettled ? '3' : '2.5'}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
                transform="rotate(-90 60 60)"
                className="transition-[stroke-dashoffset] duration-300 ease-out"
                style={{
                  filter: isSettled
                    ? 'drop-shadow(0 0 8px rgba(52, 211, 153, 0.7))'
                    : 'drop-shadow(0 0 6px rgba(111, 141, 255, 0.6))',
                }}
              />
            )}

            {/* Base Dim Crescent Silhouette */}
            <circle
              cx="60"
              cy="60"
              r="34"
              fill="rgb(var(--ink-700))"
              mask="url(#logo-crescent-mask)"
              className="opacity-40"
            />

            {/* Filled Liquid Crescent (Clips from bottom to top according to progress) */}
            <g mask="url(#logo-crescent-mask)">
              <circle
                cx="60"
                cy="60"
                r="34"
                fill={isSettled ? 'url(#logo-success-gradient)' : 'url(#logo-accent-gradient)'}
                clipPath={!isSettled && normalizedProgress < 100 ? 'url(#logo-liquid-fill-clip)' : undefined}
                className="transition-all duration-300 ease-out"
              />

              {/* Glowing Laser Horizon Line at the fluid meniscus */}
              {!isSettled && normalizedProgress > 0 && normalizedProgress < 100 && (
                <rect
                  x="26"
                  y={clipY - 1}
                  width="68"
                  height="2.5"
                  fill="#ffffff"
                  className="animate-pulse opacity-85 shadow-[0_0_8px_#ffffff]"
                />
              )}
            </g>

            {/* Center Checkmark / Sparkle icon when ready */}
            {isSettled && (
              <g className="origin-center animate-risein">
                <circle cx="60" cy="60" r="14" fill="rgba(16, 185, 129, 0.2)" />
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Numerical Percentage & Phase Title */}
      <div className="mt-5 flex flex-col items-center">
        <div className="flex items-baseline gap-1.5">
          {isSettled ? (
            <span className="flex items-center gap-2 text-2xl font-bold tracking-tight text-emerald-400 sm:text-3xl">
              <CheckCircle2 size={24} className="animate-bounce text-emerald-400" />
              Ready
            </span>
          ) : isConnecting ? (
            <span className="animate-pulse text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
              Connecting…
            </span>
          ) : (
            <>
              <span className="text-3xl font-extrabold tracking-tight text-white tabular-nums sm:text-4xl drop-shadow-md">
                {normalizedProgress}
              </span>
              <span className="text-xl font-bold text-accent-soft">%</span>
            </>
          )}
        </div>

        {/* Phase Subtitle */}
        <p className="mt-1 text-[13px] font-medium text-slate-300">
          {isSettled
            ? `Launching ${playerName}…`
            : isDirect
            ? 'Resolving stream link…'
            : isConnecting
            ? numPeers > 0
              ? `Found ${numPeers} ${numPeers === 1 ? 'peer' : 'peers'} · gathering metadata`
              : 'Searching swarm for peers…'
            : isBuffering && headBuffer
            ? `Buffering stream header (${headBuffer})`
            : `Buffering stream…`}
        </p>

        {/* Sleek Horizontal Micro-Bar */}
        <div className="relative mt-3 h-1.5 w-64 overflow-hidden rounded-full bg-ink-800 ring-1 ring-white/10 sm:w-80">
          {isConnecting ? (
            <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-accent to-transparent" />
          ) : (
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isSettled ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-accent shadow-[0_0_8px_rgba(111,141,255,0.8)]'
              }`}
              style={{ width: `${normalizedProgress}%` }}
            />
          )}
        </div>

        {/* Sub-chunk Details (Head & Tail buffer pieces if available) */}
        {isBuffering && (headBuffer || tailBuffer) && (
          <div className="mt-2 flex items-center gap-3 text-[11.5px] text-haze">
            {headBuffer && <span>Head: {headBuffer}</span>}
            {headBuffer && tailBuffer && <span className="text-ink-600">·</span>}
            {tailBuffer && <span>Tail index: {tailBuffer}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
