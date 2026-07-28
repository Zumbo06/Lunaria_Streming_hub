import { appApi } from '../api/orion.js'

/** Renders a profile's picture if it has one, otherwise its emoji. */
export default function Avatar({ profile, size = 40, rounded = 'rounded-lg', className = '' }) {
  if (!profile) return null

  const style = {
    width: size,
    height: size,
    backgroundColor: `${profile.color}22`,
    boxShadow: `inset 0 0 0 1px ${profile.color}55`,
  }

  if (profile.avatarImage) {
    return (
      <span className={`block overflow-hidden ${rounded} ${className}`} style={style}>
        <img src={profile.avatarImage} alt="" className="h-full w-full object-cover" />
      </span>
    )
  }

  return (
    <span
      className={`flex items-center justify-center ${rounded} ${className}`}
      style={{ ...style, fontSize: Math.round(size * 0.46) }}
    >
      {profile.avatar}
    </span>
  )
}

const MAX_EDGE = 256

/**
 * Opens the picker and returns a square, downscaled data URL. Shrinking here
 * rather than in main keeps the stored payload small — the raw file can be
 * many megabytes and it all ends up inside an encrypted database row.
 */
export async function pickAvatarImage() {
  const result = await appApi.chooseImage()
  if (!result?.dataUrl) return result?.error ? { error: result.error } : { cancelled: true }

  try {
    const dataUrl = await downscale(result.dataUrl)
    return { dataUrl }
  } catch (err) {
    return { error: err.message || 'That image could not be read' }
  }
}

function downscale(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => {
      // Centre-crop to a square, then fit inside MAX_EDGE.
      const edge = Math.min(image.width, image.height)
      const sx = (image.width - edge) / 2
      const sy = (image.height - edge) / 2
      const target = Math.min(edge, MAX_EDGE)

      const canvas = document.createElement('canvas')
      canvas.width = target
      canvas.height = target

      const context = canvas.getContext('2d')
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, sx, sy, edge, edge, 0, 0, target, target)

      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }

    image.onerror = () => reject(new Error('That file is not a readable image'))
    image.src = dataUrl
  })
}
