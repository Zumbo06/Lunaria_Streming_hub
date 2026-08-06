# Lunaria

A desktop client that speaks the **Stremio Addon Protocol**. It aggregates catalogs and stream links from the addons you install, runs its own sequential BitTorrent engine, and hands every playable source to an external **VLC** or **mpv**.

Lunaria ships no internal player, hosts no content, and indexes nothing. Every title and every stream comes from an addon manifest you added yourself.

Built to [SRs.txt](SRs.txt).

> **A note on the name.** The product is Lunaria; the code is not renamed. Module names, the `window.orion` bridge, the `ORION_DEBUG` flag, the `orion-` temp prefix and the `# >>> Orion HDR settings` markers in `mpv.conf` all keep their original identifiers deliberately — renaming them would invalidate existing config files and `mpv.conf` blocks on disk.

---

## Contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [How it works](#how-it-works)
- [Features](#features)
- [Configuration](#configuration)
- [Design notes](#design-notes)
- [Troubleshooting](#troubleshooting)
- [What has been verified](#what-has-been-verified)
- [Known issues](#known-issues)
- [Legal](#legal)

---

## Requirements

| | |
| --- | --- |
| **Node.js 22+** | WebTorrent 3 requires it. Developed on Node 25.2.1. |
| **A player** | VLC (default) or mpv, selectable in Settings. |
| **Electron 43** | Installed by setup; bundles Node 24, whose built-in `node:sqlite` is what the library uses — no native module, no rebuild step. |

mpv is the better choice for HDR and needs no installation: an extracted portable folder is detected automatically.

---

## Quick start

### Windows

```bat
setup.bat    :: one time — checks Node, installs everything, builds the
             ::            interface, reports which players it found
run.bat      :: start Lunaria
dev.bat      :: start with hot reload (Vite dev server + Electron)
debug.bat    :: start with the console visible and engine logging on
dist.bat     :: package a distributable build into electron\dist
```

`setup.bat` refuses to continue on Node older than 22 and warns if neither player is present, since Lunaria decodes nothing itself. mpv is located through Lunaria's own discovery, so an extracted portable folder is found without being installed.

### Any platform

```bash
npm run install:all
npm run dev       # Vite dev server + Electron
npm start         # build the frontend, then run Electron against dist/
npm run dist      # package with electron-builder
```

---

## How it works

```
┌──────────────────────────┐   HTTP/JSON    ┌──────────────────────┐
│  Renderer (React/Vite)   │ ◀───────────── │  Stremio addons      │
│  Home · Detail · Search  │    via main    │  Cinemeta, Torrentio │
└───────────┬──────────────┘                └──────────────────────┘
            │ contextBridge (uid handles only)
┌───────────▼──────────────┐
│  Electron main           │
│  addons · streams ·      │
│  players · library       │
└─────┬──────────────┬─────┘
      │ fork()       │ spawn(detached)
┌─────▼─────────┐  ┌─▼──────────────────────┐
│ WebTorrent    │  │ VLC / mpv              │
│ engine        │──▶ http://127.0.0.1:8080/ │
│ (sequential)  │  │ s/<token>/media.mkv    │
└───────────────┘  └────────────────────────┘
```

### Main process

| File | Role |
| --- | --- |
| [electron/main.js](electron/main.js) | Window, IPC surface, engine and playback-session lifecycle, auto-advance |
| [electron/addons.js](electron/addons.js) | Addon protocol: manifest parsing, `catalog`/`meta`/`stream` URL shapes, concurrent fan-out, episode ordering |
| [electron/streams.js](electron/streams.js) | Splits `url` (Debrid/HTTP) from `infoHash` (P2P); parses size, seeders, resolution, tags; builds magnets |
| [electron/engine/server.mjs](electron/engine/server.mjs) | Forked WebTorrent process: sequential piece strategy + loopback HTTP gateway |
| [electron/players.js](electron/players.js) | Routes launch/status to the selected player; HDR decisions |
| [electron/vlc.js](electron/vlc.js) | VLC discovery, detached launch, HTTP control interface |
| [electron/mpv.js](electron/mpv.js) | mpv discovery, HDR and cache arguments, JSON IPC over a named pipe |
| [electron/mpvconf.js](electron/mpvconf.js) | Writes the managed HDR block into a portable build's `mpv.conf` |
| [electron/subtitles.js](electron/subtitles.js) | `subtitles` resource, language-code names, track download |
| [electron/library.js](electron/library.js) | Profiles, watchlist and watch history in SQLite, payloads encrypted |
| [electron/config.js](electron/config.js) | Settings + addon list, encrypted through the OS keychain |
| [electron/preload.js](electron/preload.js) | The renderer's only route to the system |

### Renderer

| Area | Files |
| --- | --- |
| Pages | `Home` · `Discover` · `Detail` · `Search` · `Watchlist` · `Addons` · `Settings` |
| Playback | `PlayerProvider` (engine state, toasts, resume, auto-advance) · `EngineBar` · `StreamList` |
| Library | `ProfileProvider` · `ProfileGate` · `ContinueWatching` · `Avatar` |
| Chrome | `TopBar` · `HeroPanel` · `Shelf` · `PosterCard` · `ThemeProvider` · `ScrollReset` |

---

## Features

**Catalogs**

- Home shelves built from whatever your addons publish, plus a rotating hero panel
- Discover browses one catalog at a time with genre selectors and infinite scroll — including catalogs that *require* a genre and therefore cannot be a shelf
- Search fans out across every search-capable addon

**Streaming**

- Sources grouped by resolution with size, seeders, provider, HDR format and audio languages parsed out of the addon payload
- Bounded sequential streaming — never a full download
- Head *and* tail prebuffering, so the player finds its seek index
- Optional keeping of finished downloads, to a directory of your choosing

**Playback**

- VLC or mpv, equal citizens: engine, subtitles, resume and progress tracking work the same either way
- Real HDR handling, honest about what each player can and cannot do
- Preferred audio language selects the track *inside* the file, not just the release
- Subtitles from any `subtitles` addon, injectable mid-playback on mpv

**Library**

- Multiple profiles with emoji or image avatars, editable from the launch screen
- Watchlist and Continue watching, driven by real player positions
- Resume with the exact release you watched last time
- Auto-advance to the next episode after a cancellable countdown
- Everything encrypted at rest

---

## Configuration

Settings live in `config.json` under the Electron user-data directory; the addon list and anything sensitive is encrypted separately.

| Setting | Default | Notes |
| --- | --- | --- |
| `theme` | `midnight` | Or `oled` — true black, lifted contrast |
| `player` | `vlc` | Or `mpv` |
| `vlcPath` / `mpvPath` | auto | Override discovery |
| `hdrMode` | `auto` | `auto` \| `force` \| `off` |
| `hdrPassthrough` | `true` | Announce HDR to the display |
| `hdrToneMap` | `clip` | Curve for whatever mapping remains |
| `mpvHdrOptions` | — | Extra lines kept inside the managed `mpv.conf` block |
| `vlcExtraArgs` / `mpvExtraArgs` | — | Appended after everything Lunaria composes |
| `networkCaching` | `3000` | **VLC only** — see [Players](#players) |
| `enginePort` | `8080` | First port tried; probes upward if taken |
| `downloadDir` | temp | Where pieces land |
| `keepDownloads` | `false` | Survive teardown instead of being wiped |
| `headBufferBytes` | 4 MB | Rounded up to whole pieces |
| `tailBufferBytes` | 8 MB | Rounded up to whole pieces |
| `readaheadBytes` | 24 MB | Raised to two pieces when they are larger |
| `bufferTimeoutMs` | `120000` | Measured as *stall*, not elapsed time |
| `trackProgress` | `true` | Enables the player's control interface |
| `resumePlayback` | `true` | Start at the saved position |
| `resumeAction` | `play` | Or `highlight` — open the title with the saved release marked |
| `autoPlayNext` | `true` | Queue the next episode after a 10 s cancellable countdown |
| `preferredAudioLanguages` | `[]` | Ordered; ranks sources and picks the in-file track |
| `preferredSubtitleLanguages` | `['English']` | |
| `addonTimeoutMs` | `8000` | Per-addon request deadline |

---

## Design notes

### The engine runs in its own process

`child_process.fork` keeps swarm I/O and piece hashing off the UI event loop, and lets the whole engine — sockets, temp files and all — be hard-killed when the window closes. Only one torrent is active at a time.

### It streams; it does not download

Two things would otherwise pull the whole film.

1. `client.add` selects the entire torrent on ready, so the engine passes `deselect: true` to suppress that.
2. Less obviously, players request *open-ended* ranges (`bytes=N-`), and WebTorrent's own HTTP server answers those by selecting every piece from `N` to EOF.

So Lunaria does not use `createServer()`. It runs its own handler that assembles each response from a series of bounded `createReadStream({ start, end })` reads. Each read selects only its own slice and releases it when done or when the client aborts, so at most one read-ahead window is ever queued.

### The response body must be one stream

An early version served each read-ahead window with its own `pipeline(window, res, { end: false })` call. It looked equivalent and passed every short test, but broke real playback: the client saw the body finish after the first window while `Content-Length` promised the whole file. mpv logs this as

```
[curl] Transferred a partial file, retrying (#1) from 25165872
```

— `25165872` being exactly 24 MB past the requested offset, i.e. one window. The player would keep going on buffered data for a minute or two, exhaust it, retry, and eventually give up. Piping repeatedly into the same response also attached a fresh set of cleanup listeners per window, leaking them on a long file.

The body is now a single `Readable` that advances through windows internally, so the client sees one uninterrupted response. Back-pressure still bounds the download — when the player's cache fills, the stream pauses and the swarm goes idle at 0 KB/s.

### Playback waits for the head *and* the tail

Both containers keep their seek index at the end of the file — an MP4's trailing `moov` atom, a Matroska file's Cues/SeekHead — and a player's second request is invariably a seek to the last few hundred bytes, measured identically for `.mp4` and `.mkv`. Prioritising only the head makes the player open, fail to find an index, and sit there. The engine prebuffers both ends before handing over a URL.

### Readiness is counted in pieces, not in `file.downloaded`

WebTorrent's `file.downloaded` sums *every* piece of the file, including the tail pieces the engine deliberately fetches at the same time. Gating on `file.downloaded >= headTarget` therefore lets the tail satisfy the head:

| | piece size | head target | tail fetch | outcome |
| --- | --- | --- | --- | --- |
| 1080p, 8 GB | ~2 MB | 4 MB = 2 pieces | 4 pieces = 8 MB | head is small and `critical`, usually lands first — worked by luck |
| 4K, 60 GB | ~32 MB | 4 MB = **1 piece** | 1 piece = **32 MB** | the tail alone clears the target; playback declared ready with **nothing** at the start of the file |

Worse, `releasePrebuffer` then deselects the head — dropping the one piece the player is about to ask for. Both windows are now measured the same way, by counting present pieces.

### Timeouts measure stalling, not elapsed time

A 32 MB piece legitimately takes minutes on a modest swarm. A fixed 120 s deadline abandoned streams that were never stuck. The engine's buffer deadline and the main process's guard timer are both pushed out whenever bytes actually arrive, so a dead swarm still fails after one full timeout of silence while a slow-but-alive one is left alone.

### A stream that is not ready is never handed to a player

If the opening and the index have not arrived, the engine raises an error naming what it got, how many pieces, how many peers and at what speed — instead of reporting success and letting the player open onto a stalled stream. Poorly-seeded sources fail loudly and early rather than looking like a broken player.

### Players

Both players are equal citizens. mpv reports its position over JSON IPC on a named pipe, the counterpart to VLC's HTTP interface.

**`networkCaching` is a VLC setting and is not translated to mpv.** VLC's `--network-caching` is a jitter buffer in milliseconds. mpv's `--cache-secs` is a *prefetch cap* whose own default is `3600000`, because mpv bounds the cache by bytes instead:

```
--cache-secs              Double (0 to any) (default: 3600000)
--demuxer-max-bytes       ByteSize (default: 150.000 MiB)
```

An earlier version converted 3000 ms into `--cache-secs=3`, telling mpv to hold three seconds of video. At 1080p that is ~4 MB and survives; at 4K remux bitrates it is under a second of cushion, so playback would clear the prebuffer and then freeze the first time the swarm dipped. mpv now keeps its own unlimited default and gets a byte cap sized for 4K — `--demuxer-max-bytes=512MiB`, `--demuxer-max-back-bytes=128MiB`.

### HDR is honest about what each player can do

The release name is parsed for HDR10, HDR10+, HLG and Dolby Vision, and arguments are added only when a release actually advertises it (`auto`), always (`force`), or never (`off`).

- **VLC 3 is passthrough-only.** It gets `--vout=direct3d11 --avcodec-hw=d3d11va`, the output path capable of handing HDR10 metadata to the display. VLC 3 has *no* tone-mapping controls, so HDR only looks right if Windows is already in HDR mode — on an SDR display it will look washed out, and the UI says so rather than pretending otherwise.
- **mpv does it properly.** `--vo=gpu-next` (libplacebo) plus `--gpu-api=d3d11` and `--hwdec=auto-safe`, then a passthrough hint and a tone-mapping curve — which are **independent controls**, not an either/or. An HDR display still needs a curve for whatever peak brightness it cannot physically reach, so `target-colorspace-hint=yes` and `tone-mapping=bt.2446a` together is valid and useful; an earlier version treated choosing a curve as turning passthrough off, silently degrading output. `clip` leaves the mapping entirely to the display. Dolby Vision needs no extra flag — libplacebo applies the dynamic metadata itself under `gpu-next`, and mpv exposes no DV-specific option.

For black level specifically the lever is `target-contrast` (`auto | inf | 10-1e+07`), not the curve: the default assumes a finite contrast ratio and lifts blacks, while `inf` suits OLED. Set it in **Extra mpv HDR options**, where it is validated, kept across rewrites, and suppresses the generated default for the same key.

### Portable mpv gets a real config file

Settings can write those same HDR settings into `portable_config/mpv.conf` beside `mpv.exe`, so they apply when mpv is opened directly too. Only the block between the `# >>> Orion HDR settings` markers is managed — anything else survives a rewrite, and a pre-existing `mpv.conf` is backed up to `.bak` first. Creating `portable_config` makes mpv stop reading `%APPDATA%\mpv`; the UI warns when that folder has contents.

Three things about that file were settled by testing rather than assumption, each of which silently breaks a hand-written config:

- **The HDR condition keys on the transfer function.** `profile-cond=p.max_luma > 203` logs *"Property 'max-luma' was not found"* and never fires; `p.video_params.max_luma` raises no error but never fires either, even on a file reporting `max-luma=1000`. Only `p.video_params.gamma == "pq" or "hlg"` actually triggers.
- **A profile section swallows everything after it.** Any line appended below `[orion-hdr]` would apply to HDR files only. The managed block therefore closes with `[default]`.
- **mpv decodes in software by default.** `hwdec=auto-safe` is included; it resolves to `d3d11va` here, which matters for the 4K HEVC that HDR releases invariably are.

### Subtitles

**They are downloaded, not linked.** Subtitle addons return a URL per track, but `--sub-file` accepts a local path only — passing the URL silently does nothing, which is why an installed OpenSubtitles addon previously appeared to do nothing at all. The chosen track is fetched to a scratch file before launch and passed with `--sub-file`, alongside the flag that stops unrelated `.srt` files in the download folder being picked up too (`--no-sub-autodetect-file` on VLC, `--sub-auto=no` on mpv), then deleted on quit. A failed subtitle download never blocks the film.

**They can be injected mid-playback on mpv.** While something is already playing, mpv will take a track over its IPC channel (`sub-add … select`), so a different language can be dropped in without restarting the stream. VLC's HTTP interface has no equivalent, so the UI only offers the button for mpv.

### Languages

**The preferred language also selects the audio track inside the file.** Multi-audio releases carry several tracks and both players default to the first, which is rarely the wanted one. The language list is converted to the codes containers actually tag tracks with — three-letter ISO 639-2 first, since Matroska and MP4 almost always use that form, with two-letter as fallback — and passed as `--alang` to mpv and `--audio-language` to VLC. The same happens for subtitles. This is independent of which release was chosen: picking the source stays the user's decision.

**Preferred audio language ranks sources, it does not filter them.** An ordered list is compared against what each release advertises, and a matching source outranks cached status, seeder count and size — a pristine remux in the wrong language is not the better pick. Detection is name-based, so roughly two thirds of releases carry no language tag at all; those are ranked lower but never removed. The detail panel additionally narrows to the best match, but only when a source actually offers it, with a one-click way back.

### Discover exposes catalogs Home cannot

Home renders shelves, which only works for catalogs that need no input. Catalogs declaring a *required* `genre` extra — Cinemeta's "New" has 107 genre options for film and 67 for series — return nothing until one is chosen, so they can never be a shelf. Discover picks one catalog at a time with its own type/catalog/genre selectors and infinite scroll.

### Continue watching comes from the player, not guesswork

Lunaria decodes nothing, so the only truthful source of a playback position is the player itself. Each launch enables VLC's HTTP control interface on a loopback-bound random port with a random per-session password, or mpv's JSON IPC pipe; main polls every 5 s, commits the position, and resumes with `--start-time` / `--start`. When the interface stops answering the player has been closed — the last position is committed and the swarm is torn down, so nothing keeps downloading after viewing ends.

Each write also records *how* it was watched: the release and subtitle ride along inside the encrypted payload, so a card can resume the same file rather than re-querying every addon and possibly landing on a different one. Entries written before that was recorded simply open the title page.

### Auto-advance

When an episode finishes, the next one is resolved from the series meta — same season, then the first of the next, skipping anything not yet aired. The release is chosen by the protocol's own `bingeGroup` first, then the same addon at the same resolution, then the top of the ranked list. Nothing launches immediately: a toast counts down for ten seconds with a Cancel button, and starting anything by hand cancels a pending countdown so a queued episode can never take the player over mid-stream.

### Privacy and security

**The gateway is token-gated and says nothing about what you are watching.** The URL is `/s/<random-token>/media.mkv` — no title, no filename, no infohash. Requests without the token get 403 (constant-time compare), the token rotates on every stream, and the extension is kept only because players use it as a demuxer hint.

**The library is encrypted at rest.** `library.db` holds titles, ids, posters, release names and profile names in `safeStorage`-encrypted payload blobs; only what is needed to index and sort — profile id, salted key hash, timestamps, percent — stays readable. Lookup keys are hashed with a per-install random salt, so a known IMDb id cannot be matched against the file.

**Addon URLs never reach the renderer.** Torrentio and friends encode Debrid API keys directly into the manifest path. The main process stores the addon list encrypted via `safeStorage` (DPAPI / Keychain / libsecret), addresses addons to the UI by an opaque `uid`, and only ever sends a masked display string.

---

## Troubleshooting

**Start with `debug.bat`.** `run.bat` launches detached, so nothing is visible but the toast. `debug.bat` keeps the console open with `ORION_DEBUG=1`; copy any line marked `[engine]`, `[engine ERR]` or `[gateway]` when reporting a failure.

| Symptom | Where to look |
| --- | --- |
| Player opens, then freezes after a while | Free space on the temp/download drive — an hour of 4K writes 20–40 GB |
| "Not enough of this torrent arrived" | Peer and speed counts are in the message; try a source with more seeders or raise the buffer timeout |
| Nothing appears on Home | No catalog addon installed or all disabled — check the addon manager |
| Continue watching stays empty | `trackProgress` disabled, or the player's control interface is blocked |
| HDR looks washed out on VLC | Expected: VLC 3 cannot tone-map. Switch to mpv, or put Windows in HDR mode |

---

## What has been verified

Checked against live endpoints on Windows 11 / Node 25.2.1 / Electron 43.2.0.

<details>
<summary><strong>Addon protocol and catalogs</strong></summary>

- Cinemeta manifest → 4 home shelves; catalog paginates via `skip`; search returns results for `batman`
- Series metadata resolves 128 episodes for `tt0944947`, with per-episode stream ids (`tt0944947:1:1`)
- Torrentio returns 57 sources for `tt0133093`, grouped **4K:20 · 1080p:33 · 720p:1 · Unknown:3**, with size/seeders/provider/tags parsed out of the title payload
- 8 Cinemeta catalogs described correctly, including the two that *require* a genre (107 and 67 options); genre filtering and genre+pagination both return results
- 21 of 57 live Torrentio sources carry language tags, resolving flag emoji and title text (`English, Italian, Portuguese, Spanish, French, Hindi` off one 4K remux); multi-audio detected separately

</details>

<details>
<summary><strong>Engine and gateway</strong></summary>

- Buffers sequentially and serves seekable ranges: `206` + `Accept-Ranges: bytes`, exact 1 MB range reads, mid-file seeks, and `200` + full `Content-Length` without a Range header
- **Real VLC playback**, headless (`--intf dummy`) against the gateway on a 123.3 MB file: VLC transcoded **1188 KB of decoded video frames** to disk in 15 s and exited `0` — the full demux/decode path, not just the socket
- **Streaming stays bounded while playing**: that same run pulled **10.7 MB of 123.3 MB (17.5%)**. With a GUI VLC open, the engine reaches a full buffer and drops to **0 KB/s**
- **MKV behaves exactly like MP4**: a 72.4 MB Matroska decoded to **1464 KB** of frames, with VLC requesting `bytes=0-`, then the final 169 bytes for the Cues, then back to byte 123
- **Long playback**: mpv played 200 s with **three** HTTP requests total and no retries — the response crosses window boundaries in place (`window 2: 25165872-50331695`) rather than ending. No "partial file" warning, no listener-leak warnings; only 56 MB of 123 MB fetched, idling at 0 KB/s whenever the player's cache was full
- **Slow/dead sources fail loudly**: an unreachable torrent raises `Timed out fetching torrent metadata — no peers responded` instead of reporting ready
- **Gateway auth**: valid token serves `206`; missing, wrong, truncated and old-style paths all get `403`; VLC still decodes with the filename stripped from the URL

</details>

<details>
<summary><strong>Players, HDR and subtitles</strong></summary>

- VLC discovery resolves `C:\Program Files\VideoLAN\VLC\vlc.exe` and composes the argv from REQ-4.3
- **VLC control**: reports true duration, position advances while playing, goes silent when VLC exits, and `--start-time=75` resumes at 75 s
- **mpv, against a real build** (0.41.0, libplacebo v7): every flag emitted is accepted (a deliberately bogus control flag is rejected); JSON IPC reports `state=playing len=120s`, position advances `0.5s → 4.5s`, goes null the moment mpv exits, and `--start=75` resumes at **75.5 s**
- **Portable mpv**: an extracted build on the Desktop is found in 22 ms, `mpv.com` is corrected to `mpv.exe`, a non-mpv executable and a missing path are both rejected with a reason, and the same launch/IPC/resume suite passes against it
- **Cache flags**: `--cache-secs` default confirmed as `3600000` and `--demuxer-max-bytes` as 150 MiB via `--list-options`; the replacement set (`--demuxer-max-bytes=512MiB --demuxer-max-back-bytes=128MiB`) is accepted by the binary, and a dry run of the argument builder shows no `--cache-secs` is emitted
- **HDR**: format detection correct across HDR10+/DV/HDR10/HLG/SDR names; `auto`/`force`/`off` behave; VLC emits exactly `--vout=direct3d11 --avcodec-hw=d3d11va` and **no invented tone-mapping flags**
- **Option validation**: `tone-mapping-mode=hybrid` and garbage are rejected with mpv's own error text, while `tone-mapping=bt.2446a` and `gamut-mapping-mode=perceptual` pass
- **mpv.conf**: written into `portable_config/`, then confirmed *loaded and applied* by querying the running player. Against a genuinely PQ-tagged file: `current-vo=gpu-next`, `hwdec-current=d3d11va`, `target-colorspace-hint=true`, `tone-mapping=clip`, no parse errors. Against an SDR file the HDR profile correctly does **not** fire. User lines outside the managed block survive a rewrite, and removal leaves the rest intact
- **Audio track selection**, against a purpose-built 3-track file (`eng`, `tur`, `ger`, English deliberately first so "first track" and "preferred track" differ): no preference selects `aid 1` / `eng`; Turkish selects `aid 2`; German selects `aid 3`; a language the file lacks falls back to a real track rather than silence
- **Preferred audio language**: with Turkish preferred, the single Turkish source among 57 sorts first in its resolution group; untagged sources are ranked lower, never dropped
- **Subtitles**: OpenSubtitles v3 returns 27 tracks for `tt0133093` and 94 for `tt0944947:1:1`; codes resolve to names (`ger → German`, `pob → Portuguese (BR)`), preferred languages sort first, and a picked track downloads to a real 99 KB `.srt` and is removed on cleanup
- **Subtitle injection**: `sub-add` over mpv's IPC adds a track to a *playing* mpv (track count 2 → 3, selected, titled with its language); a missing file and a dead pipe both fail cleanly

</details>

<details>
<summary><strong>Library, profiles and resume</strong></summary>

- Profiles, watchlist and continue-watching round-trip; a series collapses to its latest episode, finished titles drop off the row, profiles stay isolated — and no title, id or profile name appears anywhere in `library.db`
- **Avatars**: local images round-trip through the encrypted payload, survive unrelated updates, clear back to the emoji on request — and the image bytes are not readable in `library.db`
- **Saved releases** (10 checks): a P2P source round-trips with `infoHash`, `fileIdx` and trackers intact and rebuilds a valid magnet from the snapshot alone; a Debrid source keeps its URL; the subtitle survives; an entry written *without* a source comes back clean so the UI falls back; a finished episode leaves the resume row and becomes the up-next anchor; a finished film does not. Nothing about the release — infohash, filename, tracker host — is readable in `library.db`
- **Episode ordering** (8 checks): mid-season, season boundary, missing `id`, out-of-order `videos`, specials, unknown episode, films, and undated episodes all resolve correctly; unaired episodes are never offered

</details>

<details>
<summary><strong>Wiring</strong></summary>

- All **56** invoked IPC channels have handlers, no orphans in either direction, **15** bridge namespaces exported
- `setup.bat` completes end-to-end with exit 0, detecting VLC and portable mpv through Lunaria's own discovery

</details>

> Not yet verified end-to-end: sustained 4K HDR playback after the piece-accounting and mpv cache fixes. The flags and the arithmetic are checked; the hour-long session is not.

---

## Known issues

- **`ECONNRESET` / `ERR_STREAM_PREMATURE_CLOSE` lines with `ORION_DEBUG=1` are normal.** Players abort an in-flight response every time they seek; the gateway logs the reset and moves on. They are not playback failures.
- **`npm audit` reports advisories** in the `electron-builder` toolchain (`minimatch`/`brace-expansion`/`ejs`) and in `webtorrent → torrent-discovery → bittorrent-tracker → ip`. No non-breaking upstream fix exists; do **not** run `npm audit fix --force`, which downgrades WebTorrent out of range.
- **A long 4K session fills the temp drive.** Bounded streaming caps how far *ahead* it fetches, not the total written — watching a 60 GB remux through writes 60 GB. Point `downloadDir` at a drive with room.

---

## Legal

Lunaria is a client only. It hosts, indexes and caches no content, and ships with no scrapers of its own — it renders whatever the addons you install return. You are responsible for the addons you add and the content you access through them.
