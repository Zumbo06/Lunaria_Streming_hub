import { useState } from 'react'
import { Check, ImagePlus, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useProfile } from './ProfileProvider.jsx'
import Avatar, { pickAvatarImage } from './Avatar.jsx'

const AVATARS = ['🍿', '🎬', '🎧', '🐙', '🦊', '🐺', '🌙', '⚡', '🎯', '🧸', '👾', '🛸']
const COLORS = ['#6f8dff', '#ff7a59', '#37c98b', '#ffb020', '#c17aff', '#4ec5d4']

/** "Who's watching" — shown at launch whenever more than one profile exists. */
export default function ProfileGate() {
  const { profiles, select, create, update, remove } = useProfile()
  // null when nothing is open, 'new' for the create form, otherwise the
  // profile being edited.
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState(null)

  async function submit(details) {
    setError(null)

    if (editing === 'new') {
      const profile = await create(details)
      setEditing(null)
      if (profile) await select(profile.id)
      return
    }

    await update({ id: editing.id, ...details })
    setEditing(null)
  }

  async function deleteProfile() {
    const result = await remove(editing.id)

    // The main process refuses to delete the last profile; that rule lives
    // there, so its wording is what gets shown.
    if (result?.ok === false) {
      setError(result.error)
      return
    }
    setEditing(null)
  }

  return (
    // Rises in as the launch screen fades over the top of it, so the two read
    // as one movement rather than a cut.
    <div className="flex h-full animate-risein flex-col items-center justify-center bg-ink-950 px-6">
      <h1 className="text-[15px] font-bold tracking-[0.2em] text-slate-300">LUNARIA</h1>
      <p className="mt-6 text-2xl font-semibold text-white">Who’s watching?</p>

      <div className="mt-10 flex flex-wrap items-start justify-center gap-7">
        {profiles.map((profile) => (
          <div key={profile.id} className="group relative w-[112px]">
            <button
              type="button"
              onClick={() => select(profile.id)}
              className="focus-ring flex w-full flex-col items-center gap-3 rounded-xl p-2"
            >
              <Avatar
                profile={profile}
                size={92}
                rounded="rounded-2xl"
                className="ring-2 ring-transparent transition group-hover:scale-[1.04] group-hover:ring-white/70"
              />
              <span className="truncate text-[13px] font-medium text-haze transition group-hover:text-white">
                {profile.name}
              </span>
            </button>

            <button
              type="button"
              aria-label={`Edit ${profile.name}`}
              title="Edit profile"
              onClick={() => {
                setError(null)
                setEditing(profile)
              }}
              className="focus-ring absolute right-0 top-0 rounded-lg bg-ink-900/90 p-1.5 text-slate-300 opacity-0 ring-1 ring-white/10 backdrop-blur transition hover:text-white focus:opacity-100 group-hover:opacity-100"
            >
              <Pencil size={13} />
            </button>
          </div>
        ))}

        {!editing && (
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="focus-ring group flex w-[112px] flex-col items-center gap-3 rounded-xl p-2"
          >
            <span className="flex h-[92px] w-[92px] items-center justify-center rounded-2xl bg-ink-850 text-ink-500 ring-1 ring-white/5 transition group-hover:bg-ink-800 group-hover:text-slate-200">
              <Plus size={30} />
            </span>
            <span className="text-[13px] font-medium text-haze transition group-hover:text-white">Add profile</span>
          </button>
        )}
      </div>

      {editing && (
        <ProfileForm
          key={editing === 'new' ? 'new' : editing.id}
          profile={editing === 'new' ? null : editing}
          error={error}
          onSubmit={submit}
          onDelete={deleteProfile}
          onCancel={() => {
            setError(null)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

/** One form for both creating and editing — the fields are identical. */
function ProfileForm({ profile, error, onSubmit, onDelete, onCancel }) {
  const [name, setName] = useState(profile?.name || '')
  const [avatar, setAvatar] = useState(profile?.avatar || AVATARS[0])
  const [avatarImage, setAvatarImage] = useState(profile?.avatarImage || null)
  const [color, setColor] = useState(profile?.color || COLORS[0])
  const [imageError, setImageError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const isNew = !profile

  async function submit(event) {
    event.preventDefault()
    if (!name.trim() || busy) return

    setBusy(true)
    try {
      await onSubmit({ name: name.trim(), avatar, avatarImage, color })
    } finally {
      setBusy(false)
    }
  }

  async function chooseImage() {
    setImageError(null)
    const result = await pickAvatarImage()
    if (result.dataUrl) setAvatarImage(result.dataUrl)
    else if (result.error) setImageError(result.error)
  }

  return (
    <form onSubmit={submit} className="mt-10 w-full max-w-sm rounded-xl bg-ink-900 p-5 ring-1 ring-white/5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[14px] font-semibold text-slate-100">{isNew ? 'New profile' : 'Edit profile'}</h2>
        <button
          type="button"
          onClick={onCancel}
          className="focus-ring rounded p-1 text-ink-500 transition hover:text-slate-300"
          aria-label="Cancel"
        >
          <X size={15} />
        </button>
      </div>

      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Name"
        maxLength={40}
        className="focus-ring w-full rounded-lg bg-ink-850 px-3 py-2 text-[13px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
      />

      <p className="mb-2 mt-4 text-[12px] font-medium text-slate-300">Picture</p>
      <div className="flex items-center gap-3">
        <Avatar profile={{ avatar, avatarImage, color }} size={52} rounded="rounded-xl" className="shrink-0" />
        <button
          type="button"
          onClick={chooseImage}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-850 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-ink-800"
        >
          <ImagePlus size={13} />
          {avatarImage ? 'Change image' : 'Use an image'}
        </button>
        {avatarImage && (
          <button
            type="button"
            onClick={() => setAvatarImage(null)}
            aria-label="Remove image"
            className="focus-ring rounded p-1.5 text-ink-500 transition hover:text-rose-300"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>
      {imageError && <p className="mt-1.5 text-[11.5px] text-rose-300">{imageError}</p>}

      <p className="mb-2 mt-4 text-[12px] font-medium text-slate-300">
        {avatarImage ? 'Emoji (used if the image is removed)' : 'Emoji'}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {AVATARS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setAvatar(option)}
            className={`focus-ring h-9 w-9 rounded-lg text-lg transition ${
              avatar === option ? 'bg-accent/20 ring-1 ring-accent/50' : 'bg-ink-850 hover:bg-ink-800'
            }`}
          >
            {option}
          </button>
        ))}
      </div>

      <p className="mb-2 mt-4 text-[12px] font-medium text-slate-300">Colour</p>
      <div className="flex gap-2">
        {COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Colour ${option}`}
            onClick={() => setColor(option)}
            style={{ backgroundColor: option }}
            className={`focus-ring flex h-7 w-7 items-center justify-center rounded-full transition ${
              color === option ? 'ring-2 ring-white' : 'opacity-70 hover:opacity-100'
            }`}
          >
            {color === option && <Check size={13} className="text-ink-950" />}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-[11.5px] text-rose-300">{error}</p>}

      <button
        type="submit"
        disabled={!name.trim() || busy}
        className="focus-ring mt-5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent/20 px-4 py-2.5 text-[13px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/30 disabled:opacity-40"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        {isNew ? 'Create and continue' : 'Save changes'}
      </button>

      {/* Deleting a profile takes its watchlist and history with it, so it
          never happens on a single click. */}
      {!isNew &&
        (confirmingDelete ? (
          <div className="mt-3 rounded-lg bg-rose-500/5 px-3 py-2.5 ring-1 ring-rose-500/20">
            <p className="text-[12px] leading-snug text-rose-200">
              Delete <span className="font-semibold">{profile.name}</span>? Its watchlist and watch history go with it.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onDelete}
                className="focus-ring rounded-md bg-rose-500/20 px-3 py-1.5 text-[12px] font-medium text-rose-200 ring-1 ring-rose-500/30 transition hover:bg-rose-500/30"
              >
                Delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="focus-ring rounded-md bg-ink-850 px-3 py-1.5 text-[12px] font-medium text-slate-300 transition hover:bg-ink-800"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="focus-ring mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-medium text-ink-500 transition hover:text-rose-300"
          >
            <Trash2 size={13} />
            Delete this profile
          </button>
        ))}
    </form>
  )
}
