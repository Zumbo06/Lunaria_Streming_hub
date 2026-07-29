# Orion

A lightweight desktop client that speaks the **Stremio Addon Protocol**, aggregates catalogs and stream links from the addons you install, and hands every playable source to **VLC**. Orion ships no internal player, hosts no content, and indexes nothing — all catalog and stream data comes from addon manifests you add yourself.

Built to [SRs.txt](SRs.txt).

## Requirements

- **Node.js 22+** (WebTorrent 3 requires it; the app is developed on Node 25)
- **A player**: VLC (default) or **mpv**, selectable in Settings. mpv is the better choice for HDR, and needs no installation — an extracted portable folder is detected automatically.

## Setup

```bat
setup.bat        :: installs root, frontend and electron dependencies
run.bat          :: starts Vite + Electron in development mode
```

Or manually:

```bash
npm run install:all
npm run dev       # Vite dev server + Electron
npm start         # build the frontend, then run Electron against dist/
npm run dist      # package with electron-builder
```

## Architecture

```
┌──────────────────────────┐   HTTP/JSON    ┌──────────────────────┐
│  Renderer (React/Vite)   │ ◀───────────── │  Stremio addons      │
│  Home · Detail · Search  │    via main    │  Cinemeta, Torrentio │
└───────────┬──────────────┘                └──────────────────────┘
            │ contextBridge (uid handles only)
┌───────────▼──────────────┐
│  Electron main           │
│  addons · streams · vlc  │
└─────┬──────────────┬─────┘
      │ fork()       │ spawn(detached)
┌─────▼─────────┐  ┌─▼──────────────────┐
│ WebTorrent    │  │ VLC                │
│ engine        │──▶ http://127.0.0.1:  │
│ (sequential)  │  │ 8080/webtorrent/…  │
└───────────────┘  └────────────────────┘
```

| File | Role |
| --- | --- |
| [electron/addons.js](electron/addons.js) | Addon protocol: manifest parsing, `catalog`/`meta`/`stream` URL shapes, concurrent fan-out |
| [electron/streams.js](electron/streams.js) | Splits `url` (Debrid/HTTP) from `infoHash` (P2P); parses size, seeders, resolution, tags; builds magnets |
| [electron/engine/server.mjs](electron/engine/server.mjs) | Forked WebTorrent process: sequential piece strategy + loopback HTTP gateway |
| [electron/vlc.js](electron/vlc.js) | VLC discovery, detached launch, HTTP control interface |
| [electron/mpv.js](electron/mpv.js) | mpv discovery, HDR arguments, JSON IPC over a named pipe |
| [electron/players.js](electron/players.js) | Routes launch/status to the selected player; HDR decisions |
| [electron/mpvconf.js](electron/mpvconf.js) | Writes the managed HDR block into a portable build's `mpv.conf` |
| [electron/config.js](electron/config.js) | Settings + addon list, encrypted through the OS keychain |
| [electron/subtitles.js](electron/subtitles.js) | `subtitles` resource, language-code names, track download for VLC |
| [electron/library.js](electron/library.js) | Profiles, watchlist and watch history in SQLite, payloads encrypted |
| [electron/main.js](electron/main.js) | Window, IPC surface, engine and playback-session lifecycle |

### Design notes

**The engine runs in its own process.** `child_process.fork` keeps swarm I/O and piece hashing off the UI event loop, and lets the whole engine — sockets, temp files and all — be hard-killed when the window closes. Only one torrent is active at a time.

**It streams; it does not download.** Two things would otherwise pull the whole film. First, `client.add` selects the entire torrent on ready, so the engine passes `deselect: true` to suppress that. Second — and less obvious — players request *open-ended* ranges (`bytes=N-`), and WebTorrent's own HTTP server answers those by selecting every piece from `N` to EOF. So Orion does not use `createServer()`: it runs its own handler that assembles each response from a series of bounded `createReadStream({ start, end })` reads. Each read selects only its own slice and releases it when done or when the client aborts, so at most one "Read-ahead" window (default 24 MB) is ever queued.

**Playback waits for the head *and the tail*.** Both containers keep their seek index at the end of the file — an MP4's trailing `moov` atom, a Matroska file's Cues/SeekHead — and VLC's second request is invariably a seek to the last few hundred bytes, measured identically for `.mp4` and `.mkv`. Prioritising only the head makes the player open, fail to find an index, and sit there doing nothing. The engine prebuffers both ends before handing over a URL.

**A stream that is not ready is never handed to VLC.** If the opening and the index have not arrived within the buffer timeout, the engine raises an error naming what it got, how many peers it found and at what speed — instead of reporting success and letting VLC open onto a stalled stream. Poorly-seeded sources now fail loudly and early rather than looking like a broken player.

**HDR is honest about what each player can do.** The release name is parsed for HDR10, HDR10+, HLG and Dolby Vision, and arguments are added only when a release actually advertises it (`auto`), always (`force`), or never (`off`).

- **VLC 3 is passthrough-only.** It gets `--vout=direct3d11 --avcodec-hw=d3d11va`, which is the output path capable of handing HDR10 metadata to the display. VLC 3 has *no* tone-mapping controls, so HDR only looks right if Windows is already in HDR mode — on an SDR display it will look washed out, and the UI says so rather than pretending otherwise.
- **mpv does it properly.** `--vo=gpu-next` (libplacebo) plus `--gpu-api=d3d11`, then either `--target-colorspace-hint=yes` to pass HDR through untouched, or `--tone-mapping=<curve> --hdr-compute-peak=yes` to map it down for an SDR display. Dolby Vision needs no extra flag — libplacebo applies the dynamic metadata itself under `gpu-next`, and mpv exposes no DV-specific option.

**Portable mpv gets a real config file.** Settings can write those same HDR settings into `portable_config/mpv.conf` beside `mpv.exe`, so they apply when mpv is opened directly too, not only when Orion launches it. Only the block between the `# >>> Orion HDR settings` markers is managed — anything else in the file survives a rewrite, and a pre-existing `mpv.conf` is backed up to `.bak` before the first write. Creating `portable_config` makes mpv stop reading `%APPDATA%\mpv`; the UI warns when that folder has contents.

Three things about that file were settled by testing rather than assumption, each of which silently breaks a hand-written config:

- **The HDR condition keys on the transfer function.** `profile-cond=p.max_luma > 203` logs *"Property 'max-luma' was not found"* and never fires; `p.video_params.max_luma` raises no error but never fires either, even on a file reporting `max-luma=1000`. Only `p.video_params.gamma == "pq" or "hlg"` actually triggers — verified firing on a PQ file and staying off for SDR.
- **A profile section swallows everything after it.** Any line appended below `[orion-hdr]` would apply to HDR files only. The managed block therefore closes with `[default]`, which restores always-applied semantics — confirmed by appending `speed=1.25` and seeing it take effect on both HDR and SDR.
- **mpv decodes in software by default.** `hwdec=auto-safe` is included; it resolves to `d3d11va` here, which matters for the 4K HEVC that HDR releases invariably are.

Both players are equal citizens: engine, subtitles, resume and progress tracking all work the same either way. mpv reports its position over JSON IPC on a named pipe, the counterpart to VLC's HTTP interface.

**Subtitles are downloaded, not linked.** Subtitle addons return a URL per track, but VLC's `--sub-file` accepts a local path only — passing the URL silently does nothing, which is why an installed OpenSubtitles addon previously appeared to do nothing at all. The chosen track is fetched to a scratch file before launch, passed with `--sub-file` plus `--no-sub-autodetect-file` (so unrelated `.srt` files in the download folder are not picked up), and deleted on quit. A failed subtitle download never blocks the film.

**Continue watching comes from VLC, not guesswork.** Orion decodes nothing, so the only truthful source of a playback position is the player. Each launch enables VLC's HTTP control interface on a loopback-bound random port with a random per-session password; main polls it every 5 s, commits the position to the library, and resumes with `--start-time`. When the interface stops answering, VLC has been closed — the last position is committed and the swarm is torn down, so nothing keeps downloading after viewing ends.

**The gateway is token-gated and says nothing about what you are watching.** The URL is `/s/<random-token>/media.mkv` — no title, no filename, no infohash. Requests without the token get 403 (constant-time compare), the token rotates on every stream, and the extension is kept only because players use it as a demuxer hint.

**The library is encrypted at rest.** `library.db` holds titles, ids, posters and profile names in `safeStorage`-encrypted payload blobs; only what is needed to index and sort — profile id, salted key hash, timestamps, percent — stays readable. Lookup keys are hashed with a per-install random salt, so a known IMDb id cannot be matched against the file.

**Addon URLs never reach the renderer.** Torrentio and friends encode Debrid API keys directly into the manifest path. The main process stores the addon list encrypted via `safeStorage` (DPAPI / Keychain / libsecret), addresses addons to the UI by an opaque `uid`, and only ever sends a masked display string.

## Verified

Checked against live endpoints on Windows 11 / Node 25.2.1 / Electron 43.2.0:

- Cinemeta manifest → 4 home shelves; catalog paginates via `skip`; search returns results for `batman`
- Series metadata resolves 128 episodes for `tt0944947`, with per-episode stream ids (`tt0944947:1:1`)
- Torrentio returns 57 sources for `tt0133093`, grouped **4K:20 · 1080p:33 · 720p:1 · Unknown:3**, with size/seeders/provider/tags parsed out of the title payload
- Engine buffers sequentially and serves seekable ranges: `206` + `Accept-Ranges: bytes`, exact 1 MB range reads, mid-file seeks, and `200` + full `Content-Length` without a Range header
- **Real VLC playback**, headless (`--intf dummy`) against the gateway on a 123.3 MB file: VLC transcoded **1188 KB of decoded video frames** to disk in 15 s and exited `0` — the full demux/decode path works, not just the socket
- **Streaming stays bounded while playing**: that same run pulled **10.7 MB of 123.3 MB (17.5%)**. With a GUI VLC open, the engine reaches a full buffer and drops to **0 KB/s** rather than continuing to fetch
- **MKV behaves exactly like MP4**: a 72.4 MB Matroska served over the same Range logic decoded to **1464 KB** of frames, with VLC requesting `bytes=0-`, then the final 169 bytes for the Cues, then back to byte 123
- **Slow/dead sources fail loudly**: an unreachable torrent raises `Timed out fetching torrent metadata — no peers responded` instead of reporting ready; a healthy one only reports ready with head and tail both buffered
- VLC discovery resolves `C:\Program Files\VideoLAN\VLC\vlc.exe` and composes the argv from REQ-4.3
- **Languages**: 21 of 57 live Torrentio sources tagged, resolving flag emoji and title text (`English, Italian, Portuguese, Spanish, French, Hindi` off one 4K remux); multi-audio detected separately
- **Library**: profiles, watchlist and continue-watching round-trip, a series collapses to its latest episode, finished titles drop off the row, profiles stay isolated — and no title, id or profile name appears anywhere in `library.db`
- **Gateway**: valid token serves `206`; missing, wrong, truncated and old-style paths all get `403`; VLC still decodes with the filename stripped from the URL
- **VLC control**: reports true duration, position advances while playing, goes silent when VLC exits, and `--start-time=75` resumes at 75 s
- **Subtitles**: OpenSubtitles v3 returns 27 tracks for `tt0133093` and 94 for `tt0944947:1:1`; codes resolve to names (`ger → German`, `pob → Portuguese (BR)`), preferred languages sort first, and a picked track downloads to a real 99 KB `.srt` and is removed on cleanup
- **Avatars**: local images round-trip through the encrypted payload, survive unrelated updates, clear back to the emoji on request — and the image bytes are not readable in `library.db`
- **HDR**: format detection correct across HDR10+/DV/HDR10/HLG/SDR names; `auto`/`force`/`off` behave; VLC emits exactly `--vout=direct3d11 --avcodec-hw=d3d11va` and **no invented tone-mapping flags**; mpv emits passthrough and tone-mapped variants correctly, with Dolby Vision handled separately
- **mpv, against a real build** (0.41.0, libplacebo v7.365.0): every flag Orion emits is accepted (a deliberately bogus control flag is rejected); JSON IPC over the named pipe reports `state=playing len=120s`, position advances `0.5s → 4.5s`, goes null the moment mpv exits, and `--start=75` resumes at **75.5 s**
- **Portable mpv**: an extracted build on the Desktop is found in 22 ms, `mpv.com` is corrected to `mpv.exe`, a non-mpv executable and a missing path are both rejected with a reason, and the same launch/IPC/resume suite passes against it
- **mpv.conf**: written into `portable_config/`, then confirmed *loaded and applied* by querying the running player. Against a genuinely PQ-tagged file: `current-vo=gpu-next`, `hwdec-current=d3d11va`, `target-colorspace-hint=true`, `tone-mapping=clip`, no parse errors. Against an SDR file the HDR profile correctly does **not** fire (`target-colorspace-hint=auto`) while the global settings still apply. User lines outside the managed block survive a rewrite and stay global, the block swaps cleanly between passthrough and tone-mapping, and removal leaves the rest of the file intact
- **Players**: VLC discovered, mpv's absence reported cleanly rather than throwing, unreachable mpv IPC resolves null
- **Long playback**: mpv played 200 s from the gateway with **three** HTTP requests total and no retries — the response crosses window boundaries in place (`window 2: 25165872-50331695`) rather than ending. No "partial file" warning, no mpv errors, no listener-leak warnings; only 56 MB of 123 MB fetched, idling at 0 KB/s whenever the player's cache was full
- **IPC**: all 45 invoked channels have handlers, no orphans, all 15 bridge namespaces exported

### The response body must be one stream

An early version served each read-ahead window with its own `pipeline(window, res, { end: false })` call. It looked equivalent and passed every short test, but broke real playback: the client saw the body finish after the first window while `Content-Length` promised the whole file. mpv logs this as

```
[curl] Transferred a partial file, retrying (#1) from 25165872
```

— `25165872` being exactly 24 MB past the requested offset, i.e. one window. The player would keep going on buffered data for a minute or two, exhaust it, retry, and eventually give up and close. Piping repeatedly into the same response also attached a fresh set of cleanup listeners per window, leaking them on a long file.

The body is now a single `Readable` that advances through windows internally, so the client sees one uninterrupted response. Back-pressure still bounds the download — when the player's cache fills, the stream pauses and the swarm goes idle at 0 KB/s.

## Known issues

- **`ECONNRESET` / `ERR_STREAM_PREMATURE_CLOSE` lines with `ORION_DEBUG=1` are normal.** VLC aborts an in-flight response every time it seeks; the gateway logs the reset and moves on. They are not playback failures.
- **`npm audit` reports advisories** in the `electron-builder` toolchain (`minimatch`/`brace-expansion`/`ejs`) and in `webtorrent → torrent-discovery → bittorrent-tracker → ip`. No non-breaking upstream fix exists; do **not** run `npm audit fix --force`, which downgrades WebTorrent out of range.

## Legal

Orion is a client only. It hosts, indexes and caches no content, and ships with no scrapers of its own — it renders whatever the addons you install return. You are responsible for the addons you add and the content you access through them.
