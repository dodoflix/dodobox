# How it works

```
browser / TV / phone (public/)  <->  server.js  <->  src/meta.js       catalog and artwork metadata, disk-cached
                                                <->  src/sources.js    torrent search providers, ranked
                                                <->  src/engine.js     torrent client, library, storage cap
                                                <->  src/local.js      your own media folders
                                                <->  src/transcode.js  stream probe, on-demand HLS, hardware encoder
                                                <->  src/subs.js       subtitle providers
                                                <->  src/state.js      profiles, progress, My List, settings
                                                <->  src/images.js     poster proxy with disk cache
```

## Play flow

1. `POST /api/play` picks, in order: a matching local file, an existing download of the same episode, the best-ranked torrent not on the client's `exclude` list.
2. The client polls status while `/api/info` probes the file with ffmpeg. If nothing arrives for 25 s (40 s to find the torrent), the client excludes that source and the server picks the next, up to five times. Stalled torrents with no data are removed.
3. `/raw/:id/:file` serves bytes with range support. MP4/WebM with H.264 and AAC plays directly; anything else goes through HLS (6 s segments encoded on request by ffmpeg, the next two warmed). The encoder is chosen at start (NVENC, VideoToolbox, VAAPI, else x264) by test-encoding a frame.
4. Progress is saved per profile every few seconds. Halfway through an episode the next one starts downloading. The oldest unwatched downloads are removed when the storage limit is reached.

## Choosing a source

`src/sources.js` ranks candidates by resolution, seeders, codec, language, and whether the bitrate fits the line's measured speed (`src/speed.js`) and the viewer's Download size mode. On play the top few start together for a few seconds and the fastest real downloader wins; the others are removed. Magnets carry a fixed tracker list plus a community list of healthy trackers refreshed twice a day.

## Streaming to every device

Browsers get the file directly when it is a real mp4/webm with H.264/VP9/AV1 video and AAC/MP3/Opus audio. Everything else is transcoded to H.264 High 4.1 (no B-frames) and AAC stereo HLS that Safari's native player accepts; if native HLS fails hls.js is tried, and the other way round.

## Reliability and caching

Outbound requests go through `src/http.js`: retries with jittered backoff, a per-provider rate limit, a circuit breaker, and merging of identical requests in flight. Catalog data lives in a stale-while-revalidate cache (`src/meta.js`): served at once, refreshed in the background, kept up to a week if the provider is down. Torrent searches are cached for 90 minutes, subtitle lists for 6 hours; subtitle files, posters and translations are cached on disk.

## Subtitles

**Built-in tracks.** `GET /api/sub/embedded/:hash/:file/:track` extracts a track with ffmpeg, reading the file from disk rather than the torrent stream (a seek into missing pieces would wait forever). While downloading, only the unbroken start counts (`readablePrefix` in `src/engine.js`); `x-covered` says how many seconds the answer reaches, and `/api/status` reports the same prefix as `readable`, so the menu enables a track only when the server can serve it. Finished results are kept in `data/subs`.

**Files in the torrent, and beside local files.** `src/sidecar.js` picks the `.srt`, `.ass`, `.ssa` and `.vtt` files of the torrent (or, for a local video, of its folder and `Subs` folder) that belong to the watched file (same name, a folder named for the episode, or any file when the torrent has one video) and guesses the language from the name. `/api/info` lists them, `/api/sub/file/:hash/:idx` reads one through the torrent (its few pieces jump the queue) and serves WebVTT. They match the release's own timing, so Auto sync leaves them alone like built-in tracks.

**Sync.** `src/sync.js` (in a worker thread) reads three 3-minute audio windows from the downloaded start of the file, turns them into a speech-strength signal and cross-correlates it with the cue times (FFT). Windows that agree give a constant offset, ones that move steadily give drift, and groups give a splice. `public/js/syncmap.js` applies the result; while playing, the player asks `/api/sub/sync?at=` for a fresh window about every 75 s.

**Translation.** `src/translate.js` translates an English subtitle with the Bergamot engine and its public models (MPL-2.0, npm `@browsermt/bergamot-translator`) in a pool of worker threads. Models are checked against their SHA-256 and cached, results are cached per subtitle and language, and the result is served as an ordinary WebVTT file at `/api/sub/translate?src=&to=`. Leaving a translation cancels the work.

**Better translation (optional).** `src/translate-hq.js` (setting `bestTranslation`) installs NLLB-200 distilled 600M through transformers.js into `data/translate/hq` on demand and runs it in child processes, on the GPU through WebGPU when a fast one is found, else on the CPU. `translateBetter` serves the standard translation at once and improves it from the playhead; improved lines are saved so a restart resumes. The NLLB-200 weights are licensed CC BY-NC 4.0, so this option is for personal use.

## Audio

ffmpeg's report lists audio tracks with language, title and default flag. The player starts on the track in the title's `originalLanguage` (from the production country, or Japanese for anime), skipping tracks titled as a dub or commentary, and falls back to the file's default flag. A track other than the file's own default always goes through HLS.

## Watch party

`src/party.js` joins a party by code. The code (80 random bits) goes through scrypt into a 20-byte torrent id and a 32-byte key. The server adds that id as a magnet-only torrent on its own small torrent client (the public WebRTC trackers and DHT find the other members, WebRTC gets through routers), and talks over a BitTorrent extension message (`dodobox_party`). Every message is AES-256-GCM sealed with the key, numbered per sender and timestamped, deduplicated, and passed on to the other neighbours, so members who cannot reach each other directly are bridged by one who can reach both. Messages are `hi` (presence), `st` (what is playing), `ld` (changed title), `pl`, `pa`, `sk` (play, pause, seek) and `tk` (heartbeat from whoever acted last). Titles and versions from other members are validated before they reach the page; the version is only an info hash, and `/api/play` accepts a version this server did not find itself only when it is the party's current one.

The page (`public/js/party.js`) reads `/api/party/events` (server-sent events) and posts `/api/party/send`. The player reports its own play, pause and seek, and ignores the echo of what it just did on someone else's say. A party can start empty (a lobby): the first player to start fills it with `ld`/`st`, and when the next episode of the same title is loaded by someone, players already on that title follow. A joiner starts on the party's version and position.

## Interface

Vanilla ES modules, no build step. `nav.js` handles arrow-key navigation and the Back key for TV remotes. The player draws its own controls and subtitles and supports Cast, AirPlay, Media Session, Picture-in-Picture and wake lock. `sw.js` caches the shell, catalog data and posters for offline browsing; bump its `VERSION` when a shell file changes. Per-title player options live in `localStorage` under `title:<profile>:<type>:<id>`.

## Desktop app

`desktop/main.js` is a tray-only Electron app: it sets `DATA_DIR` to the user data folder, starts `server.js` in the same process (on a free port if 3000 is taken) and offers a tray menu. It has no window; the page opens in the system browser. Starting it again opens the page, or quits with `--quit`. Packaged with electron-builder without an asar archive, so the worker and WebAssembly files stay plain files; `desktop/prune.cjs` drops other platforms' ffprobe and native prebuilds and ad-hoc signs the macOS app. Electron emits `ready` only after the entry module finishes evaluating, so the entry must not await it at the top level. Updates: the app uses `electron-updater` against the releases page. It never downloads on its own: `autoDownload` is off and the user is asked first. Only the Windows installer and the Linux AppImage can replace themselves, so the workflow uploads `latest.yml` and `latest-linux.yml` next to the installers (the macOS file is skipped: unsigned builds cannot self-update and the two architectures would overwrite each other). Server runs (Docker, npm) and the desktop builds that cannot replace themselves (macOS, portable, `.deb`) use `src/update.js`, which compares the latest release with `package.json` and logs a hint; the desktop app turns it into a question that opens the download page. On those builds `electron-updater` is never started, since it would look for `latest-mac.yml` and similar files that are not published. The release workflow builds each platform on its own runner (the bundled ffmpeg is the runner's) and attaches the installers to the release.

## Data versions

Everything Dodobox keeps is versioned, so a release can change how it is stored and upgrade existing installs by itself.

- **Server:** `data/schema.json` holds the data version: how many migrations the folder has been through. Each migration is a file in `src/migrations` named for the version it produces (`002-...js`), listed in order in `src/migrations/index.js`; a test checks the files and the list agree. `src/data.js` runs the ones a folder has not seen at startup, before any module reads its files, and every module that loads from the data folder imports it first. An install that skipped releases runs each missing step in turn. A folder with files but no version file is version 0, so `001-baseline` is what versions existing installs; an empty folder is stamped current. Before the first step the JSON files are copied to `data/backups` (the newest three are kept, caches excluded); if a step throws, the files and version are put back and Dodobox stops with a message. A data folder from a newer Dodobox is refused, so an older version never edits it. Steps get `read`, `write` (atomic) and `drop` (for caches) and must cope with missing files.
- **Browser:** `STORE_STEPS` in `public/js/util.js` does the same for `localStorage`, tracked under the `dbx-schema` key.

To change a stored shape: add the next numbered file and list it, write a test with the old shape, and leave older files as they are.

## Tests

`npm test` runs unit tests, an offline end-to-end test (local seeder, download, probe, HLS, subtitles; needs `ffmpeg` on the path), library, profile API, HTTP client, sync and translation tests, and static checks of the frontend. `npm run lint` runs ESLint.
