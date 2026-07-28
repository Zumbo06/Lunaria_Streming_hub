import { useEffect, useState } from 'react'
import { Check, FolderOpen, Loader2, RotateCw, Search, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { appApi, settingsApi, vlcApi } from '../api/orion.js'
import { usePlayer } from '../components/PlayerProvider.jsx'

export default function SettingsPage() {
  const { pushToast } = usePlayer()

  const [settings, setSettings] = useState(null)
  const [info, setInfo] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    Promise.all([settingsApi.get(), appApi.info()]).then(([loadedSettings, loadedInfo]) => {
      setSettings(loadedSettings)
      setInfo(loadedInfo)
    })
  }, [])

  function update(patch) {
    setSettings((current) => ({ ...current, ...patch }))
    setDirty(true)
  }

  async function save() {
    setSaving(true)
    const saved = await settingsApi.save({
      vlcPath: settings.vlcPath || null,
      networkCaching: Number(settings.networkCaching) || 3000,
      vlcExtraArgs: settings.vlcExtraArgs || '',
      enginePort: Number(settings.enginePort) || 8080,
      downloadDir: settings.downloadDir || null,
      keepDownloads: Boolean(settings.keepDownloads),
      addonTimeoutMs: Number(settings.addonTimeoutMs) || 8000,
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
    const result = await vlcApi.detect()
    setDetecting(false)

    if (result.path) {
      setInfo((current) => ({ ...current, vlcPath: result.path }))
      pushToast({ tone: 'success', title: 'VLC found', message: result.path })
    } else {
      pushToast({
        tone: 'error',
        title: 'VLC not found',
        message: 'Nothing at the standard install paths. Use Browse to point at the executable.',
      })
    }
  }

  async function browseVlc() {
    const result = await vlcApi.locate()
    if (result.path) {
      setSettings((current) => ({ ...current, vlcPath: result.path }))
      setInfo((current) => ({ ...current, vlcPath: result.path }))
      pushToast({ tone: 'success', title: 'VLC set', message: result.path })
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
      <p className="mt-1 text-[13px] text-haze">Playback is handed to VLC; Orion never decodes media itself.</p>

      <Section title="VLC" subtitle="The external player every stream is sent to.">
        <Field label="Executable" hint="Left blank, Orion scans the standard install locations for this platform.">
          <div className="flex gap-2">
            <input
              type="text"
              value={settings.vlcPath || ''}
              onChange={(event) => update({ vlcPath: event.target.value })}
              placeholder={info.vlcPath || 'Auto-detect'}
              spellCheck={false}
              className="focus-ring min-w-0 flex-1 rounded-lg bg-ink-850 px-3 py-2 font-mono text-[12px] text-slate-200 placeholder:text-ink-500 ring-1 ring-white/5 focus:bg-ink-800 focus:ring-accent/40"
            />
            <IconButton onClick={browseVlc} icon={FolderOpen} label="Browse" />
            <IconButton onClick={detect} icon={detecting ? Loader2 : Search} label="Detect" spinning={detecting} />
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-haze">
            {info.vlcPath ? (
              <>
                <Check size={12} className="text-emerald-400" />
                <span className="font-mono">{info.vlcPath}</span>
              </>
            ) : (
              <span className="text-rose-300">No VLC install detected on this machine.</span>
            )}
          </p>
        </Field>

        <Field label="Network caching (ms)" hint="Passed as --network-caching. Raise it for unstable swarms.">
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
      </Section>

      <Section title="P2P engine" subtitle="The local loopback gateway that feeds torrent bytes to VLC.">
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

        <Field label="Buffer before launching (MB)" hint="How much of the file head must land before VLC is opened.">
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
          hint="MP4 and MKV both keep their seek index at the end, and VLC reads it before playing a single frame. Lower it only if sources are slow to start; too low and playback will not begin."
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
          hint="How long to wait for the opening and the index before giving up. Orion refuses to open VLC on a stream that is not ready, so a slow swarm reports an error here rather than a player that never starts."
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
