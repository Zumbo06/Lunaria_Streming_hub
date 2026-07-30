import { useEffect, useState } from 'react'
import {
  Check, FileCog, FolderOpen, ImagePlus, Loader2, MonitorPlay, RotateCw, Search,
  ShieldCheck, ShieldOff, Trash2, UserPlus, X,
} from 'lucide-react'
import Badge from '../components/Badge.jsx'
import { appApi, playersApi, progressApi, settingsApi } from '../api/orion.js'
import { usePlayer } from '../components/PlayerProvider.jsx'
import { useProfile } from '../components/ProfileProvider.jsx'
import Avatar, { pickAvatarImage } from '../components/Avatar.jsx'

export default function SettingsPage() {
  const { pushToast } = usePlayer()
  const {
    profiles,
    current,
    create: createProfile,
    update: updateProfile,
    remove: removeProfile,
    select,
  } = useProfile()

  const [settings, setSettings] = useState(null)
  const [info, setInfo] = useState(null)
  const [stats, setStats] = useState(null)
  const [players, setPlayers] = useState(null)
  const [portable, setPortable] = useState([])
  const [mpvConf, setMpvConf] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    Promise.all([settingsApi.get(), appApi.info(), progressApi.stats(), playersApi.detect()]).then(
      ([loadedSettings, loadedInfo, loadedStats, detected]) => {
        setSettings(loadedSettings)
        setInfo(loadedInfo)
        setStats(loadedStats)
        setPlayers(detected.players)
      },
    )
    // Scanning the disk for extracted builds is slower, so it lands separately.
    playersApi.portable().then(setPortable)
    playersApi.mpvConfigStatus().then(setMpvConf)
  }, [current?.id])

  // The preview reflects the chosen tone-mapping mode, so refresh on change.
  useEffect(() => {
    if (settings?.hdrToneMap) playersApi.mpvConfigStatus().then(setMpvConf)
  }, [settings?.hdrToneMap, settings?.hdrPassthrough, settings?.mpvPath, settings?.mpvHdrOptions])

  async function checkMpvOptions() {
    const result = await playersApi.validateMpvOptions(settings.mpvHdrOptions || '')
    const bad = (result.results || []).filter((entry) => !entry.ok)

    pushToast(
      bad.length === 0
        ? { tone: 'success', title: 'All options valid', message: 'mpv accepts every line.' }
        : {
            tone: 'error',
            title: `${bad.length} option${bad.length === 1 ? '' : 's'} mpv does not know`,
            message: bad.map((entry) => entry.line).join(', '),
            duration: 0,
          },
    )
  }

  async function writeMpvConf() {
    const result = await playersApi.writeMpvConfig({
      passthrough: settings.hdrPassthrough !== false,
      toneMap: settings.hdrToneMap || 'clip',
      customOptions: settings.mpvHdrOptions || '',
    })

    if (!result.ok && result.results?.length) {
      pushToast({
        tone: 'error',
        title: 'Not written — invalid options',
        message: result.results.map((entry) => entry.line).join(', '),
        duration: 0,
      })
      return
    }
    if (result.ok) {
      setMpvConf(await playersApi.mpvConfigStatus())
      pushToast({
        tone: 'success',
        title: result.created ? 'mpv.conf created' : 'mpv.conf updated',
        message: result.path,
      })
    } else {
      pushToast({ tone: 'error', title: 'Could not write mpv.conf', message: result.error })
    }
  }

  async function removeMpvConf() {
    const result = await playersApi.removeMpvConfig()
    setMpvConf(await playersApi.mpvConfigStatus())
    pushToast(
      result.ok
        ? {
            tone: 'success',
            title: result.deletedFile ? 'mpv.conf removed' : 'HDR block removed',
            message: result.path,
          }
        : { tone: 'error', title: 'Could not remove', message: result.error },
    )
  }

  function revealMpvConf() {
    playersApi.revealMpvConfig()
  }

  // Every label below names the player that is actually selected, rather than
  // assuming VLC.
  const isMpv = (settings?.player || 'vlc') === 'mpv'
  const playerName = isMpv ? 'mpv' : 'VLC'
  const preferredAudio = settings?.preferredAudioLanguages || []

  function update(patch) {
    setSettings((current) => ({ ...current, ...patch }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const saved = await settingsApi.save({
      player: settings.player === 'mpv' ? 'mpv' : 'vlc',
      vlcPath: settings.vlcPath || null,
      mpvPath: settings.mpvPath || null,
      hdrMode: settings.hdrMode || 'auto',
      hdrPassthrough: settings.hdrPassthrough !== false,
      hdrToneMap: settings.hdrToneMap || 'clip',
      networkCaching: Number(settings.networkCaching) || 3000,
      vlcExtraArgs: settings.vlcExtraArgs || '',
      mpvExtraArgs: settings.mpvExtraArgs || '',
      enginePort: Number(settings.enginePort) || 8080,
      downloadDir: settings.downloadDir || null,
      keepDownloads: Boolean(settings.keepDownloads),
      addonTimeoutMs: Number(settings.addonTimeoutMs) || 8000,
      mpvHdrOptions: settings.mpvHdrOptions || '',
      preferredAudioLanguages: preferredAudio,
      trackProgress: settings.trackProgress !== false,
      resumePlayback: settings.resumePlayback !== false,
      headBufferBytes: Number(settings.headBufferBytes) || 4 * 1024 * 1024,
      tailBufferBytes: Number(settings.tailBufferBytes) || 8 * 1024 * 1024,
      readaheadBytes: Number(settings.readaheadBytes) || 24 * 1024 * 1024,
      bufferTimeoutMs: Number(settings.bufferTimeoutMs) || 120000,
    })
    setSettings(saved)
    setInfo(await appApi.info())
    setDirty(false)
    setSaving(false)
    pushToast({ tone: 'success', title: 'Settings saved' })
  }

  async function detect() {
    setDetecting(true)
    const [detected, portableBuilds] = await Promise.all([playersApi.detect(), playersApi.portable()])
    setPlayers(detected.players)
    setPortable(portableBuilds)
    setDetecting(false)

    const installed = Object.values(detected.players).filter((entry) => entry.installed)
    pushToast(
      installed.length > 0
        ? {
            tone: 'success',
            title: 'Players found',
            message: installed.map((entry) => entry.name).join(', '),
          }
        : {
            tone: 'error',
            title: 'No player found',
            message: 'Nothing at the standard install paths. Use Browse to point at an executable.',
          },
    )
  }

  async function browsePlayer(playerId) {
    const result = await playersApi.locate(playerId)
    if (result.path) {
      update(playerId === 'mpv' ? { mpvPath: result.path } : { vlcPath: result.path })
      setPlayers((await playersApi.detect()).players)
      pushToast({ tone: 'success', title: 'Player set', message: result.path })
    } else if (result.error) {
      pushToast({ tone: 'error', title: 'Not usable', message: result.error })
    }
  }

  async function browseDownloadDir() {
    const result = await appApi.chooseFolder()
    if (result.path) update({ downloadDir: result.path })
  }

  async function clearCache() {
    await appApi.clearCache()
    pushToast({ tone: 'success', title: 'Cached addon responses cleared' })
  }

  if (!settings || !info) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="skeleton h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8 pb-28">
      <h1 className="text-lg font-semibold text-slate-100">Settings</h1>
      <p className="mt-1 text-[13px] text-haze">
        Playback is handed to {playerName}; Orion never decodes media itself.
      </p>

      <Section title="Profiles" subtitle="Each profile keeps its own watchlist and watch history.">
        <div className="space-y-2">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={`flex items-center gap-3 rounded-lg p-2.5 ring-1 transition ${
                profile.id === current?.id ? 'bg-accent/10 ring-accent/30' : 'bg-ink-850 ring-white/5'
              }`}
            >
              <Avatar profile={profile} size={36} className="shrink-0" />

              <button
                type="button"
                onClick={async () => {
                  const result = await pickAvatarImage()
                  if (result.dataUrl) updateProfile({ id: profile.id, avatarImage: result.dataUrl })
                  else if (result.error) pushToast({ tone: 'error', title: 'Image not usable', message: result.error })
                }}
                aria-label={`Set a picture for ${profile.name}`}
                title="Use a local image"
                className="focus-ring shrink-0 rounded p-1 text-ink-500 transition hover:text-slate-200"
              >
                <ImagePlus size={14} />
              </button>

              {profile.avatarImage && (
                <button
                  type="button"
                  onClick={() => updateProfile({ id: profile.id, avatarImage: null })}
                  aria-label={`Remove picture for ${profile.name}`}
                  title="Remove picture"
                  className="focus-ring shrink-0 rounded p-1 text-ink-500 transition hover:text-rose-300"
                >
                  <Trash2 size={13} />
                </button>
              )}

              <input
                value={profile.name}
                onChange={(event) => updateProfile({ id: profile.id, name: event.target.value })}
                maxLength={40}
                aria-label={`Name for ${profile.name}`}
                className="focus-ring min-w-0 flex-1 rounded-md bg-transparent px-2 py-1 text-[13px] font-medium text-slate-200 hover:bg-ink-800 focus:bg-ink-800"
              />

              {profile.id === current?.id ? (
                <span className="shrink-0 text-[11px] uppercase tracking-wider text-accent-soft">Active</span>
              ) : (
                <button
                  type="button"
                  onClick={() => select(profile.id)}
                  className="focus-ring shrink-0 rounded-md px-2.5 py-1 text-[12px] font-medium text-haze transition hover:bg-ink-800 hover:text-slate-200"
                >
                  Use
                </button>
              )}

              <button
                type="button"
                disabled={profiles.length <= 1}
                onClick={async () => {
                  const result = await removeProfile(profile.id)
                  if (result?.ok === false) pushToast({ tone: 'error', title: 'Cannot remove', message: result.error })
                }}
                aria-label={`Delete ${profile.name}`}
                className="focus-ring shrink-0 rounded p-1 text-ink-500 transition enabled:hover:text-rose-300 disabled:opacity-30"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => createProfile({ name: `Profile ${profiles.length + 1}`, avatar: '👤' })}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-ink-700"
        >
          <UserPlus size={13} />
          Add profile
        </button>

        {stats && (
          <p className="text-[11.5px] text-ink-500">
            {current?.name}: {stats.watchlistCount} in watchlist · {stats.inProgress} in progress ·{' '}
            {stats.finished} finished · library {stats.encrypted ? 'encrypted' : 'stored in plain text'}
          </p>
        )}
      </Section>

      <Section title="Watch history" subtitle={`Positions come from ${playerName} itself while a stream is playing.`}>
        <Toggle
          label="Track playback position"
          hint={
            isMpv
              ? 'Enables mpv’s JSON IPC on a private named pipe. Without it, Continue watching stays empty.'
              : 'Enables VLC’s local control interface on a random port with a random password. Without it, Continue watching stays empty.'
          }
          checked={settings.trackProgress !== false}
          onChange={() => update({ trackProgress: settings.trackProgress === false })}
        />
        <Toggle
          label="Resume where I left off"
          hint={`Starts ${playerName} at the saved position (${isMpv ? '--start' : '--start-time'}) when you replay something you already began.`}
          checked={settings.resumePlayback !== false}
          onChange={() => update({ resumePlayback: settings.resumePlayback === false })}
        />
        <button
          type="button"
          onClick={async () => {
            await progressApi.clearAll()
            setStats(await progressApi.stats())
            pushToast({ tone: 'success', title: 'Watch history cleared', message: current?.name })
          }}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-rose-500/20 hover:text-rose-200"
        >
          <Trash2 size={13} />
          Clear this profile’s watch history
        </button>
      </Section>

      <Section title="Player" subtitle="Which external player streams are handed to.">
        <div className="grid gap-2 sm:grid-cols-2">
          {['vlc', 'mpv'].map((playerId) => {
            const entry = players?.[playerId]
            const selected = (settings.player || 'vlc') === playerId

            return (
              <button
                key={playerId}
                type="button"
                onClick={() => update({ player: playerId })}
                className={`focus-ring rounded-xl p-3.5 text-left ring-1 transition ${
                  selected ? 'bg-accent/10 ring-accent/40' : 'bg-ink-850 ring-white/5 hover:bg-ink-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <MonitorPlay size={15} className={selected ? 'text-accent-soft' : 'text-ink-500'} />
                  <span className="text-[13.5px] font-semibold text-slate-100">{entry?.name || playerId}</span>
                  {entry?.installed ? (
                    <Badge tone="green">INSTALLED</Badge>
                  ) : (
                    <Badge tone="muted">NOT FOUND</Badge>
                  )}
                  {entry?.hdrSupport === 'full' && <Badge tone="amber">FULL HDR</Badge>}
                  {entry?.portable && <Badge tone="muted">PORTABLE</Badge>}
                </div>
                <p className="mt-1.5 text-[11.5px] leading-snug text-haze">{entry?.hdrNote}</p>
                {entry?.version && (
                  <p className="mt-1.5 text-[11px] text-ink-500">
                    {entry.version}
                    {entry.libplacebo && ` · libplacebo ${entry.libplacebo}`}
                  </p>
                )}
                {entry?.path && <p className="mt-1 truncate font-mono text-[11px] text-ink-500">{entry.path}</p>}
              </button>
            )
          })}
        </div>

        {players && !players[settings.player || 'vlc']?.installed && (
          <p className="text-[11.5px] text-rose-300">
            {(settings.player || 'vlc') === 'mpv'
              ? 'mpv is not installed. Install it, or use Browse below to point at mpv.exe.'
              : 'VLC is not installed. Install it, or use Browse below to point at vlc.exe.'}
          </p>
        )}

        <Field label="VLC executable" hint="Left blank, Orion scans the standard install locations.">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.vlcPath || ''}
              onChange={(event) => update({ vlcPath: event.target.value })}
              placeholder={players?.vlc?.path || 'Auto-detect'}
              spellCheck={false}
              className="focus-ring min-w-0 flex-1 rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
            />
            <IconButton onClick={() => browsePlayer('vlc')} icon={FolderOpen} label="Browse" />
          </div>
        </Field>

        {portable.length > 0 && (
          <Field
            label="Portable mpv builds found"
            hint="Extracted folders detected on this machine. Pick one to use it without installing anything."
          >
            <div className="space-y-1.5">
              {portable.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => update({ mpvPath: entry.path, player: 'mpv' })}
                  className={`focus-ring flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left ring-1 transition ${
                    settings.mpvPath === entry.path
                      ? 'bg-accent/10 ring-accent/40'
                      : 'bg-ink-850 ring-white/5 hover:bg-ink-800'
                  }`}
                >
                  <MonitorPlay size={13} className="shrink-0 text-ink-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-slate-300">{entry.path}</span>
                    <span className="text-[11px] text-ink-500">
                      {entry.version}
                      {entry.libplacebo && ` · libplacebo ${entry.libplacebo}`}
                    </span>
                  </span>
                  {settings.mpvPath === entry.path && <Check size={13} className="shrink-0 text-accent-soft" />}
                </button>
              ))}
            </div>
          </Field>
        )}

        <Field label="mpv executable" hint="Left blank, Orion checks PATH, the scoop/winget/chocolatey locations, then any extracted portable folder.">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.mpvPath || ''}
              onChange={(event) => update({ mpvPath: event.target.value })}
              placeholder={players?.mpv?.path || 'Auto-detect'}
              spellCheck={false}
              className="focus-ring min-w-0 flex-1 rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
            />
            <IconButton onClick={() => browsePlayer('mpv')} icon={FolderOpen} label="Browse" />
            <IconButton onClick={detect} icon={detecting ? Loader2 : Search} label="Detect" spinning={detecting} />
          </div>
        </Field>
      </Section>

      <Section
        title="HDR"
        subtitle="Applied when a release advertises HDR10, HDR10+, HLG or Dolby Vision."
      >
        <Field
          label="When to use HDR arguments"
          hint="Auto reads the format out of the release name. Force is for releases that carry HDR without saying so."
        >
          <div className="flex gap-2">
            {[
              ['auto', 'Auto'],
              ['force', 'Always'],
              ['off', 'Never'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => update({ hdrMode: value })}
                className={`focus-ring rounded-lg px-3 py-1.5 text-[12px] font-medium transition ${
                  (settings.hdrMode || 'auto') === value
                    ? 'bg-accent/20 text-accent-soft ring-1 ring-accent/40'
                    : 'bg-ink-850 text-haze hover:bg-ink-800 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </Field>

        {isMpv && (
          <Toggle
            label="Announce HDR to the display (passthrough)"
            hint="On for an HDR display with Windows HDR enabled — mpv requests a PQ swapchain and sends the source metadata through. Turn it off only for a genuinely SDR display."
            checked={settings.hdrPassthrough !== false}
            onChange={() => update({ hdrPassthrough: settings.hdrPassthrough === false })}
          />
        )}

        <Field
          label="Tone-mapping curve"
          hint={
            isMpv
              ? 'Independent of passthrough: an HDR display still needs a curve for whatever peak brightness it cannot reach. `clip` leaves that entirely to the display.'
              : 'mpv only. VLC 3 has no tone-mapping controls — it can pass HDR through to an HDR display and nothing more.'
          }
        >
          <select
            value={settings.hdrToneMap || 'clip'}
            onChange={(event) => update({ hdrToneMap: event.target.value })}
            disabled={!isMpv}
            className="focus-ring w-72 rounded-lg bg-ink-850 px-3 py-2 text-[13px] text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40 disabled:opacity-40"
          >
            <option value="clip">clip — let the display map it</option>
            <option value="st2094-40">st2094-40 — HDR10+ dynamic metadata</option>
            <option value="bt.2446a">bt.2446a — ITU reference</option>
            <option value="bt.2390">bt.2390 — EBU reference</option>
            <option value="spline">spline — balanced</option>
            <option value="hable">hable — filmic</option>
            <option value="reinhard">reinhard — soft</option>
          </select>
        </Field>

        <Field
          label="Extra mpv HDR options"
          hint="One per line, without the leading dashes (e.g. gamut-mapping-mode=perceptual). Kept inside the managed block across rewrites, and checked against your mpv build before anything is written."
        >
          <textarea
            rows={3}
            value={settings.mpvHdrOptions || ''}
            onChange={(event) => update({ mpvHdrOptions: event.target.value })}
            placeholder={'gamut-mapping-mode=perceptual\ntarget-contrast=auto'}
            spellCheck={false}
            className="focus-ring w-full resize-y rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
          <button
            type="button"
            onClick={checkMpvOptions}
            disabled={!settings.mpvHdrOptions?.trim()}
            className="focus-ring mt-2 flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-ink-700 disabled:opacity-40"
          >
            <Check size={13} />
            Check these against mpv
          </button>
        </Field>

        <p className="rounded-lg bg-ink-850 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-haze ring-1 ring-white/5">
          <strong className="text-slate-300">VLC:</strong> adds{' '}
          <code className="text-accent-soft">--vout=direct3d11 --avcodec-hw=d3d11va</code>. HDR reaches the panel only
          if Windows itself is in HDR mode.
          <br />
          <strong className="text-slate-300">mpv:</strong> adds{' '}
          <code className="text-accent-soft">--vo=gpu-next --gpu-api=d3d11 --hwdec=auto-safe</code>, the passthrough
          hint, and your chosen curve.
        </p>

        {mpvConf?.ok && (
          <Field
            label="mpv.conf in the portable folder"
            hint="Writes the same HDR settings into portable_config/mpv.conf, so they also apply when you open mpv directly. Only the marked block is managed — anything else you put in the file is left alone."
          >
            <p className="mb-2 truncate font-mono text-[11px] text-ink-500">{mpvConf.path}</p>

            {mpvConf.shadow?.shadowed && (
              <p className="mb-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[11.5px] text-amber-300">
                Creating <code>portable_config</code> makes mpv ignore your existing config at{' '}
                <code>{mpvConf.shadow.dir}</code> ({mpvConf.shadow.entries.join(', ')}). Copy anything you need across
                first.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={writeMpvConf}
                className="focus-ring flex items-center gap-1.5 rounded-lg bg-accent/20 px-3 py-2 text-[12px] font-medium text-accent-soft ring-1 ring-accent/30 transition hover:bg-accent/30"
              >
                <FileCog size={13} />
                {mpvConf.managed ? 'Update mpv.conf' : 'Write mpv.conf'}
              </button>

              {mpvConf.exists && (
                <>
                  <IconButton onClick={revealMpvConf} icon={FolderOpen} label="Show file" />
                  {mpvConf.managed && (
                    <button
                      type="button"
                      onClick={removeMpvConf}
                      className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-rose-500/20 hover:text-rose-200"
                    >
                      <Trash2 size={13} />
                      Remove block
                    </button>
                  )}
                </>
              )}
            </div>

            <details className="mt-2.5">
              <summary className="cursor-pointer text-[11.5px] text-ink-500 transition hover:text-slate-300">
                Preview what gets written
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-ink-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300 ring-1 ring-white/5">
                {mpvConf.preview}
              </pre>
            </details>
          </Field>
        )}
      </Section>

      <Section title="Playback tuning" subtitle="Buffering and any extra flags to pass through.">
        <Field label="Network caching (ms)" hint="VLC --network-caching; converted to seconds for mpv --cache-secs.">
          <input
            type="number"
            min={0}
            step={500}
            value={settings.networkCaching}
            onChange={(event) => update({ networkCaching: event.target.value })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field label="Extra VLC arguments" hint="Appended after the URL and caching flag. Optional.">
          <input
            type="text"
            value={settings.vlcExtraArgs || ''}
            onChange={(event) => update({ vlcExtraArgs: event.target.value })}
            placeholder="--fullscreen --no-video-title-show"
            spellCheck={false}
            className="focus-ring w-full rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field label="Extra mpv arguments" hint="Appended after the URL and cache flags. Optional.">
          <input
            type="text"
            value={settings.mpvExtraArgs || ''}
            onChange={(event) => update({ mpvExtraArgs: event.target.value })}
            placeholder="--fullscreen --profile=gpu-hq"
            spellCheck={false}
            className="focus-ring w-full rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>
      </Section>

      <Section title="P2P engine" subtitle={`The local loopback gateway that feeds torrent bytes to ${playerName}.`}>
        <Field label="Gateway port" hint="Orion moves to the next free port if this one is taken.">
          <input
            type="number"
            min={1024}
            max={65535}
            value={settings.enginePort}
            onChange={(event) => update({ enginePort: event.target.value })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field label="Buffer before launching (MB)" hint={`How much of the file head must land before ${playerName} is opened.`}>
          <input
            type="number"
            min={1}
            max={256}
            value={Math.round((Number(settings.headBufferBytes) || 0) / (1024 * 1024))}
            onChange={(event) => update({ headBufferBytes: Number(event.target.value) * 1024 * 1024 })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field
          label="Index buffer at end of file (MB)"
          hint={`MP4 and MKV both keep their seek index at the end, and ${playerName} reads it before playing a single frame. Lower it only if sources are slow to start; too low and playback will not begin.`}
        >
          <input
            type="number"
            min={1}
            max={128}
            value={Math.round((Number(settings.tailBufferBytes) || 0) / (1024 * 1024))}
            onChange={(event) => update({ tailBufferBytes: Number(event.target.value) * 1024 * 1024 })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field
          label="Buffer timeout (seconds)"
          hint={`How long to wait for the opening and the index before giving up. Orion refuses to open ${playerName} on a stream that is not ready, so a slow swarm reports an error here rather than a player that never starts.`}
        >
          <input
            type="number"
            min={15}
            max={900}
            step={15}
            value={Math.round((Number(settings.bufferTimeoutMs) || 0) / 1000)}
            onChange={(event) => update({ bufferTimeoutMs: Number(event.target.value) * 1000 })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field
          label="Read-ahead (MB)"
          hint="How far ahead of the playhead the swarm may run. Orion selects only this window, so a film is streamed rather than downloaded in full."
        >
          <input
            type="number"
            min={4}
            max={2048}
            value={Math.round((Number(settings.readaheadBytes) || 0) / (1024 * 1024))}
            onChange={(event) => update({ readaheadBytes: Number(event.target.value) * 1024 * 1024 })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <Field
          label="Keep downloaded files"
          hint={
            settings.keepDownloads
              ? 'On: the rest of the file is fetched at low priority behind playback so what you keep is complete and playable, and it survives Stop.'
              : 'Off: Orion streams only the sliding window and deletes everything the moment the stream stops.'
          }
        >
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(settings.keepDownloads)}
            onClick={() => update({ keepDownloads: !settings.keepDownloads })}
            className={`focus-ring relative h-5 w-9 rounded-full transition ${
              settings.keepDownloads ? 'bg-accent/70' : 'bg-ink-600'
            }`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                settings.keepDownloads ? 'left-[18px]' : 'left-0.5'
              }`}
            />
          </button>
        </Field>

        <Field
          label="Download folder"
          hint={
            settings.keepDownloads
              ? 'Blank saves to your Downloads\\Orion folder.'
              : 'Blank uses a temporary folder that is wiped when the stream stops.'
          }
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.downloadDir || ''}
              onChange={(event) => update({ downloadDir: event.target.value })}
              placeholder="System temp folder"
              spellCheck={false}
              className="focus-ring min-w-0 flex-1 rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
            />
            <IconButton onClick={browseDownloadDir} icon={FolderOpen} label="Browse" />
            {settings.downloadDir && (
              <IconButton onClick={() => update({ downloadDir: null })} icon={Trash2} label="Clear" />
            )}
          </div>
        </Field>
      </Section>

      <Section
        title="Audio language"
        subtitle="Sources carrying one of these rank first, and the stream list filters to the best match when a release offers it."
      >
        <Field
          label="Preferred languages, in order"
          hint="Click to add or remove. Detection reads flag emoji and language words out of the release name, so a source with no language tag at all is never excluded — it just ranks lower."
        >
          {preferredAudio.length > 0 ? (
            <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
              {preferredAudio.map((entry, index) => (
                <span
                  key={entry}
                  className="flex items-center gap-1.5 rounded-lg bg-accent/15 py-1 pl-2 pr-1 text-[12px] font-medium text-accent-soft ring-1 ring-accent/30"
                >
                  <span className="text-[10px] tabular-nums text-accent-soft/70">{index + 1}</span>
                  {entry}
                  <button
                    type="button"
                    aria-label={`Remove ${entry}`}
                    onClick={() => update({ preferredAudioLanguages: preferredAudio.filter((x) => x !== entry) })}
                    className="focus-ring rounded p-0.5 transition hover:text-white"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mb-2.5 text-[11.5px] text-ink-500">
              None set — sources are ranked by cached status, seeders and size only.
            </p>
          )}

          <div className="max-h-40 overflow-y-auto rounded-lg bg-ink-850 p-2 ring-1 ring-white/5">
            <div className="flex flex-wrap gap-1.5">
              {(info.audioLanguages || [])
                .filter((entry) => !preferredAudio.includes(entry))
                .map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => update({ preferredAudioLanguages: [...preferredAudio, entry] })}
                    className="focus-ring rounded-md bg-ink-800 px-2 py-1 text-[12px] text-haze transition hover:bg-ink-700 hover:text-slate-200"
                  >
                    {entry}
                  </button>
                ))}
            </div>
          </div>
        </Field>
      </Section>

      <Section title="Addons" subtitle="How long Orion waits on each addon before moving on.">
        <Field label="Request timeout (ms)">
          <input
            type="number"
            min={1000}
            step={500}
            value={settings.addonTimeoutMs}
            onChange={(event) => update({ addonTimeoutMs: event.target.value })}
            className="focus-ring w-40 rounded-lg bg-ink-850 px-3 py-2 text-[13px] tabular-nums text-slate-200 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
          />
        </Field>

        <button
          type="button"
          onClick={clearCache}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-ink-700"
        >
          <RotateCw size={13} />
          Clear cached addon responses
        </button>
      </Section>

      <Section title="About">
        <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-[12px]">
          <dt className="text-ink-500">Platform</dt>
          <dd className="text-slate-300">{info.platform}</dd>
          <dt className="text-ink-500">Electron</dt>
          <dd className="text-slate-300">
            {info.versions.electron} · Node {info.versions.node} · Chromium {info.versions.chrome}
          </dd>
          <dt className="text-ink-500">Config folder</dt>
          <dd className="break-all font-mono text-[11px] text-slate-300">{info.userData}</dd>
          <dt className="text-ink-500">Token storage</dt>
          <dd className="flex items-center gap-1.5 text-slate-300">
            {info.encryptionAvailable ? (
              <>
                <ShieldCheck size={13} className="text-emerald-400" />
                Encrypted through the OS keychain
              </>
            ) : (
              <>
                <ShieldOff size={13} className="text-amber-400" />
                No keychain available — addon URLs stored as plain text
              </>
            )}
          </dd>
        </dl>
      </Section>

      <div className="sticky bottom-6 mt-8 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-accent/20 px-5 py-2.5 text-[13px] font-medium text-accent-soft ring-1 ring-accent/30 shadow-poster backdrop-blur transition hover:bg-accent/30 disabled:opacity-40"
        >
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <section className="mt-7 rounded-xl bg-ink-900 p-5 ring-1 ring-white/5">
      <h2 className="text-[14px] font-semibold text-slate-100">{title}</h2>
      {subtitle && <p className="mt-1 text-[12px] text-haze">{subtitle}</p>}
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="mb-1.5 block text-[12px] font-medium text-slate-300">{label}</label>
      {children}
      {hint && <p className="mt-1.5 text-[11.5px] leading-snug text-ink-500">{hint}</p>}
    </div>
  )
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={`focus-ring relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition ${
          checked ? 'bg-accent/70' : 'bg-ink-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
            checked ? 'left-[18px]' : 'left-0.5'
          }`}
        />
      </button>
      <div className="min-w-0">
        <p className="text-[12px] font-medium text-slate-300">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-ink-500">{hint}</p>}
      </div>
    </div>
  )
}

function IconButton({ onClick, icon: Icon, label, spinning }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="focus-ring flex shrink-0 items-center gap-1.5 rounded-lg bg-ink-800 px-3 py-2 text-[12px] font-medium text-slate-200 transition hover:bg-ink-700"
    >
      <Icon size={13} className={spinning ? 'animate-spin' : ''} />
      {label}
    </button>
  )
}
