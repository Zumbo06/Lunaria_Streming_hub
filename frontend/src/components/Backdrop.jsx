/**
 * Landscape artwork shown whole. Stretched across a wide, short frame, a 16:9
 * backdrop is cropped down to a band through its middle and looks zoomed right
 * in — the wider the window, the worse. Instead the artwork keeps its own shape
 * against the right edge and fades in from the left, over a blurred copy of
 * itself that fills the rest of the frame with the same colours.
 */
export default function Backdrop({ src, eager = false, className = '' }) {
  if (!src) return null

  const loading = eager ? 'eager' : 'lazy'

  return (
    <div aria-hidden="true" className={`absolute inset-0 overflow-hidden ${className}`}>
      <img
        src={src}
        alt=""
        loading={loading}
        decoding="async"
        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl saturate-150"
      />
      <img
        src={src}
        alt=""
        loading={loading}
        decoding="async"
        className="absolute inset-y-0 right-0 aspect-video h-full max-w-full object-cover [mask-image:linear-gradient(to_right,transparent,#000_35%)]"
      />
    </div>
  )
}
