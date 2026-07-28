# Orion

A lightweight desktop client that speaks the **Stremio Addon Protocol**, aggregates catalogs and stream links from the addons you install, and hands every playable source to **VLC**. Orion ships no internal player, hosts no content, and indexes nothing — all catalog and stream data comes from addon manifests you add yourself.

Built to [SRs.txt](SRs.txt).

## Requirements

- **Node.js 22+** (WebTorrent 3 requires it; the app is developed on Node 25)
- **VLC Media Player** installed on the host

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
| [electron/vlc.js](electron/vlc.js) | Cross-platform VLC discovery and detached launch |
| [electron/config.js](electron/config.js) | Settings + addon list, encrypted through the OS keychain |
| [electron/subtitles.js](electron/subtitles.js) | `subtitles` resource, language-code names, track download for VLC |
| [electron/library.js](electron/library.js) | Profiles, watchlist and watch history in SQLite, payloads encrypted |
| [electron/main.js](electron/main.js) | Window, IPC surface, engine and playback-session lifecycle |

### Design notes

**The engine runs in its own process.** `child_process.fork` keeps swarm I/O and piece hashing off the UI event loop, and lets the whole engine — sockets, temp files and all — be hard-killed when the window closes. Only one torrent is active at a time.

**It streams; it does not download.** Two things would otherwise pull the whole film. First, `client.add` selects the entire torrent on ready, so the engine passes `deselect: true` to suppress that. Second — and less obvious — players request *open-ended* ranges (`bytes=N-`), and WebTorrent's own HTTP server answers those by selecting every piece from `N` to EOF. So Orion does not use `createServer()`: it runs its own handler that assembles each response from a series of bounded `createReadStream({ start, end })` reads. Each read selects only its own slice and releases it when done or when the client aborts, so at most one "Read-ahead" window (default 24 MB) is ever queued.

**Playback waits for the head *and the tail*.** Both containers keep their seek index at the end of the file — an MP4's trailing `moov` atom, a Matroska file's Cues/SeekHead — and VLC's second request is invariably a seek to the last few hundred bytes, measured identically for `.mp4` and `.mkv`. Prioritising only the head makes the player open, fail to find an index, and sit there doing nothing. The engine prebuffers both ends before handing over a URL.

**A stream that is not ready is never handed to VLC.** If the opening and the index have not arrived within the buffer timeout, the engine raises an error naming what it got, how many peers it found and at what speed — instead of reporting success and letting VLC open onto a stalled stream. Poorly-seeded sources now fail loudly and early rather than looking like a broken player.

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
- **IPC**: all 42 invoked channels have handlers, no orphans, all 14 bridge namespaces exported

## Known issues

- **`ECONNRESET` / `ERR_STREAM_PREMATURE_CLOSE` lines with `ORION_DEBUG=1` are normal.** VLC aborts an in-flight response every time it seeks; the gateway logs the reset and moves on. They are not playback failures.
- **`npm audit` reports advisories** in the `electron-builder` toolchain (`minimatch`/`brace-expansion`/`ejs`) and in `webtorrent → torrent-discovery → bittorrent-tracker → ip`. No non-breaking upstream fix exists; do **not** run `npm audit fix --force`, which downgrades WebTorrent out of range.

## Legal

Orion is a client only. It hosts, indexes and caches no content, and ships with no scrapers of its own — it renders whatever the addons you install return. You are responsible for the addons you add and the content you access through them.
