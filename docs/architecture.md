# How it works

```
browser / TV / phone (public/)  <->  server.js  <->  src/meta.js       catalog and artwork metadata, disk-cached
                                                <->  src/sources.js    torrent search providers, ranked
                                                <->  src/engine.js     torrent client, library, storage cap
                                                <->  src/local.js      your own media folders
                                                <->  src/transcode.js  ffprobe, on-demand HLS, hardware encoder
                                                <->  src/subs.js       subtitle providers
                                                <->  src/state.js      profiles, progress, My List, settings
                                                <->  src/images.js     poster proxy with disk cache
```

## Play flow

1. `POST /api/play` picks, in order: a matching local file, an existing download of the same episode, the best-ranked torrent not on the client's `exclude` list.
2. The client polls status while `/api/info` probes the file with ffprobe. If nothing arrives for 25 s (40 s to find the torrent), the client excludes that source and the server picks the next, up to five times. Stalled torrents with no data are removed.
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

**Sync.** `src/sync.js` (in a worker thread) reads three 3-minute audio windows from the downloaded start of the file, turns them into a speech-strength signal and cross-correlates it with the cue times (FFT). Windows that agree give a constant offset, ones that move steadily give drift, and groups give a splice. `public/js/syncmap.js` applies the result; while playing, the player asks `/api/sub/sync?at=` for a fresh window about every 75 s.

**Translation.** `src/translate.js` translates an English subtitle with the Bergamot engine and its public models (MPL-2.0, npm `@browsermt/bergamot-translator`) in a pool of worker threads. Models are checked against their SHA-256 and cached, results are cached per subtitle and language, and the result is served as an ordinary WebVTT file at `/api/sub/translate?src=&to=`. Leaving a translation cancels the work.

**Better translation (optional).** `src/translate-hq.js` (setting `bestTranslation`) installs NLLB-200 distilled 600M through transformers.js into `data/translate/hq` on demand and runs it in child processes, on the GPU through WebGPU when a fast one is found, else on the CPU. `translateBetter` serves the standard translation at once and improves it from the playhead; improved lines are saved so a restart resumes. The NLLB-200 weights are licensed CC BY-NC 4.0, so this option is for personal use.

## Audio

ffprobe lists audio tracks with language, title and default flag. The player starts on the track in the title's `originalLanguage` (from the production country, or Japanese for anime), skipping tracks titled as a dub or commentary, and falls back to the file's default flag. A track other than the file's own default always goes through HLS.

## Interface

Vanilla ES modules, no build step. `nav.js` handles arrow-key navigation and the Back key for TV remotes. The player draws its own controls and subtitles and supports Cast, AirPlay, Media Session, Picture-in-Picture and wake lock. `sw.js` caches the shell, catalog data and posters for offline browsing; bump its `VERSION` when a shell file changes. Per-title player options live in `localStorage` under `title:<profile>:<type>:<id>`.

## Tests

`npm test` runs unit tests, an offline end-to-end test (local seeder, download, probe, HLS, subtitles; needs `ffmpeg` on the path), library, profile API, HTTP client, sync and translation tests, and static checks of the frontend. `npm run lint` runs ESLint.
