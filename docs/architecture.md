# How it works

```
browser / TV / phone (public/)  <->  server.js  <->  src/meta.js       Cinemeta + IMDb suggestions, AniList (MAL ids), disk-cached
                                                <->  src/sources.js    Torrentio, apibay, Nyaa, ranked
                                                <->  src/engine.js     WebTorrent, library, storage cap
                                                <->  src/local.js      own media folders, filename matching
                                                <->  src/transcode.js  ffprobe, on-demand HLS, hardware encoder
                                                <->  src/subs.js       OpenSubtitles (Stremio addon and REST), YIFY
                                                <->  src/state.js      profiles, progress, My List, settings
                                                <->  src/images.js     poster proxy with disk cache
```

## Play flow

1. The client calls `POST /api/play`, sending its screen size and any forced quality. The server picks, in order: a matching local file, an existing download of the same episode, the best-ranked torrent not on the client's `exclude` list.
   Ranking weighs resolution, seeders and codec, and checks that the release's bitrate (size divided by runtime) fits the machine's measured internet speed (`src/speed.js`). 4K scores high only when the line can carry it and the screen is 4K; a forced quality in Settings overrides the bandwidth penalty. On the viewer's side, `bandwidth.js` times a download from the server, and Auto quality caps the stream height when the connection is slower than the file's bitrate.
2. The client polls status while `/api/info` probes the file with ffprobe as soon as the file is known; the probe's reads steer the torrent toward the pieces it needs. If nothing arrives for 25 s (40 s to find the torrent), the client excludes that source and the server picks the next one, up to five times. Stalled torrents with no data are removed.
3. `/raw/:id/:file` serves bytes with range support. MP4/WebM with H.264 and AAC plays directly. Anything else goes through HLS: a VOD playlist of 6 s segments, each encoded on request by ffmpeg reading `/raw`, with the next two warmed. The encoder is chosen at start (NVENC, VideoToolbox, VAAPI, else x264) by test-encoding a frame.
4. Progress is saved to the server per profile every few seconds. Halfway through an episode the next one starts downloading. Near the end an Up Next card appears.
5. The oldest unwatched downloads are removed when the storage limit is reached.

## Reliability and caching

All outbound requests go through `src/http.js`: retries with jittered backoff (honouring Retry-After), a per-provider rate limit, a short circuit breaker for a provider that keeps failing, and merging of identical requests in flight. Catalog and detail data live in a persistent stale-while-revalidate cache (`src/meta.js`): a known answer is returned instantly, refreshed in the background when old, and kept for up to a week if the provider is down. Torrent searches are cached for 90 minutes, subtitle lists for 6 hours, subtitle files, posters and translations on disk. The browser retries its own GETs, keeps a 10 minute cache, and warms the next page while you scroll.

## Choosing a source

`src/sources.js` ranks every candidate: resolution, seeders, bitrate against the line's measured speed and against a per-resolution target (set by the viewer's Download size mode), codec, dubbed-audio releases, disc remuxes and speeds measured earlier. On play the top few are started together for a few seconds and the fastest real downloader wins; the others are removed. Magnets carry a fixed tracker list plus a community list of healthy trackers refreshed twice a day (several old public trackers answered nothing).

## Streaming to every device

Browsers get the file directly when it is a real mp4/webm with H.264/VP9/AV1 video and AAC/MP3/Opus audio; everything else is transcoded on demand to HLS segments (H.264 High 4.1 with no B-frames, AAC stereo) that Safari's native player accepts. If native HLS fails, hls.js is tried, and the other way round.

## Subtitle sync

`src/sync.js` (run in a worker thread by `src/sync-worker.js`) reads three 3-minute audio windows from the downloaded start of the file, turns them into a speech-strength signal and cross-correlates that with the subtitle's cue times (FFT). Frame-rate ratios are tried on the middle window; windows that agree give a constant offset, ones that move steadily give drift, and groups give a splice. `public/js/syncmap.js` applies the result in the player and to HLS subtitle tracks. While playing, the player asks `/api/sub/sync?at=` for a single fresh window (`syncProbe`) about every 75 s and merges it into the model (`classify`).

## Subtitle translation

`src/translate.js` translates an English subtitle with Bergamot (the engine and models of Firefox Translations, MPL-2.0; npm package `@browsermt/bergamot-translator`). The WebAssembly runs in a pool of worker threads on the server, models come from Mozilla's public model registry (checked against their SHA-256) and are cached, results are cached per subtitle and language. Fragments of one sentence are translated together and the result shared back to the subtitles. `/api/sub/translate?src=&to=` serves the result as an ordinary WebVTT subtitle, so sync, casting and everything else treat it like any other file.

Optional better quality (`src/translate-hq.js`, setting `bestTranslation`): NLLB-200 distilled 600M through transformers.js 4, installed on demand into `data/translate/hq` (never part of the app install; the NLLB-200 weights are licensed CC BY-NC 4.0, so this option is for personal use) and run in child processes: on the graphics card through WebGPU (Vulkan, Direct3D or Metal, no CUDA install; fp16) when a quick one is found, else on the CPU (q8, low priority). The install records which in `data/translate/hq/ready`. `translateBetter` serves the standard translation at once and improves it line by line from the playhead (`at`); each response carries `x-hq-done` and, while the engine is being fetched, `x-hq-prep`, and the player fetches it again every 20 s until done. Improved lines are saved per subtitle so a restart resumes.

## Home shelves

`/api/shelves` lists the shelves for a profile and `/api/shelf` fills one, loaded as it scrolls into view. Weekly Top 10 charts (global and per country) come from Netflix's open chart files (`src/charts.js`; the country file is parsed once a day) and are matched to IMDb titles by search.

## Downloads and ratings

`src/downloads.js` queues download requests (title, episode or season) and starts a few at a time through the same play path, pinned so eviction skips them. One torrent can hold several downloads (episodes of a pack), so the engine tracks one row per file. Ratings and watch history live per profile in `src/state.js`; `/api/picks` builds the "Because you liked" rows from rated genres. The queue is in memory; started downloads persist in the library file.

## Built-in subtitles

`GET /api/sub/embedded/:hash/:file/:track` extracts a track with ffmpeg, reading the file from disk rather than through the torrent stream (a seek into pieces that are not there would wait forever). While the file is still downloading only the unbroken start counts (`readablePrefix` in `src/engine.js`, whole verified pieces from the first byte): later pieces leave holes that cut the track short. The answer says how many seconds it reaches in `x-covered` and the player asks again as the download grows. `/api/status` reports the same prefix as `readable`, so the subtitle menu enables a built-in track only when the server can serve it. Finished results are kept in `data/subs`.

## Audio

`ffprobe` lists the audio tracks with their language, title and default flag. The player starts on the track in the title's `originalLanguage` (from the production country in Cinemeta, `countryOfOrigin` in AniList; anime defaults to Japanese), avoiding titles that mention a dub or commentary, and falls back to the file's default flag. A track other than the file's own default always goes through HLS.

## Interface

Vanilla ES modules, no build step. `ambient.js` samples the poster for the page glow. `nav.js` implements arrow-key spatial navigation and the Back key for TV remotes. The player draws its own controls and subtitles, and speaks Google Cast, AirPlay, Media Session, Picture-in-Picture and wake lock. `sw.js` caches the shell, catalog data and posters for offline browsing; bump its `VERSION` when a shell file changes. Per-title player options live in `localStorage` under `title:<profile>:<type>:<id>`.

## Tests

`npm test` runs unit tests, an offline end-to-end test (local seeder, download, probe, HLS, subtitles; needs `ffmpeg` on the path), library, profile API, HTTP client, subtitle sync and translation tests, and static checks of the frontend modules. `npm run lint` runs ESLint.
