# Using Dodobox

## First run

Start the server and open its address (the start scripts open it for you; with `npm start` open the printed address yourself). Dodobox detects your device by itself (a phone gets a one-time tip about adding it to the home screen), then you create a profile and pick your language, subtitles and what you like. Everyone in the house adds their own; each keeps separate Continue Watching, My List and preferences.

## Other devices

Open the address the server prints (for example `http://192.168.1.20:3000`, or `http://dodobox.local:3000`) on the same Wi-Fi. Settings shows a QR code for it.

| Device | How |
| --- | --- |
| iPhone / iPad | Open in Safari, Share, Add to Home Screen. |
| Android phone | Open in Chrome, menu, Add to Home screen. |
| Smart TV or Android TV with a browser | Open the address. The layout switches to large text and works with the remote (arrows, OK, Back). Settings has a TV layout switch if it is not detected. |
| Android TV app | See [apps/android](../apps/android/README.md). It finds the server by itself. |
| Chromecast, Google TV | Press the cast button in the player on a phone or laptop (Chrome). |
| Apple TV | Play on an iPhone, iPad or Mac in Safari and press the AirPlay button. There is no native tvOS app. |

Phones and laptops are plain HTTP on the local network, so "install as app" gives a bookmark-style shortcut. That is a browser rule for non-HTTPS addresses.

## Trailers

On a computer or TV, a trailer plays quietly behind a featured title after a moment, and resting the pointer on a poster opens a small preview. Every title page has a Trailer button that plays it in Dodobox's own player, with sound and its own controls. Phones never autoplay trailers, to save data. Trailers come from YouTube and need an internet connection.

## Languages

Pick a language in the first-run questions or in Settings. The interface is translated into every language in that list, including right-to-left Arabic and Hebrew (English otherwise); titles and descriptions are translated from Wikipedia when an article exists in that language, otherwise the English text stays. Latin, Cyrillic, Greek, Vietnamese, Devanagari, Arabic and Hebrew text display correctly. Subtitles are searched in your language and English from three sources (Stremio's OpenSubtitles addon, OpenSubtitles and YIFY) and ranked by how closely each file matches the version playing.

## Subtitle sync

Auto sync (switch in the subtitle menu) fixes online subtitles that are a few seconds off, run at a different frame rate, or are cut differently. It compares when speech happens in short stretches of the audio with when the subtitle appears, reading only the already-downloaded start of the file at low priority, so playback is never slowed. It keeps checking while you watch (a new stretch about every 75 seconds) and corrects drift or a wrong first guess; a change is only applied once two looks agree. The Timing row shows the total shift and how much of it is automatic and how much is yours. Built-in subtitles are already in sync and are left alone. Timing -0.5/+0.5 still works on top.

## Subtitles in your language

Online subtitle sites have fewer languages for anime. Two things help: releases that already carry your language built in (many fansub groups list them as [ENG][SPA][TUR]...) are favoured when picking a version, and the subtitle menu always offers "Auto-translated": the English subtitle translated into your language by the server, so it works in every browser and on every TV, and the result is kept so a subtitle is only translated once. It uses the open-source models behind Firefox Translations (about 20 MB per language, downloaded the first time that language is used, then stored in `data/translate`). Quality is that of Firefox Translate: good for everyday dialogue, rougher for slang and names. It translates into every interface language. While it works the menu entry shows "Preparing the language... 40%" (first time only, while the model downloads) and then "Translating... 60%". Settings has "Best translation quality" (off by default): it installs a larger translator the first time (about 2 GB, kept in `data/translate/hq`; it uses the graphics card when the computer has one that works, which makes a film take minutes, and otherwise the processor, which takes much longer) (the line under the switch shows "Installing... 40%" and then "Installed and ready") and then improves the subtitle in the background, starting where you are watching, while the standard translation plays right away. On a CPU a whole film takes a while, so the menu shows "Improving quality... 40%".

## The player

- **Episodes**: series have an episode list button in the player. It shows the same thumbnails and progress as the title page, and switching keeps the Back button pointing at the title page.
- **Remembered per title**: the subtitle you picked (or Off), its timing for each episode, the audio track, quality, speed, Auto sync and subtitle size are kept in this browser, per profile, and come back the next time you open that title.
- **Audio**: it starts on the title's original language, skipping dubs and commentaries. The track marked "Default" in the menu is the one Dodobox would choose.
- **Subtitles**: picking a language in the subtitle menu only lists its files; choose a file on the right. Changing the subtitle stops an auto-translation that is still running.

## Adult content filter

Off by default, in Settings and in first-run setup. When on, anime that AniList marks as adult are left out of browse lists, shelves and search. A title you open directly is never blocked.

## Download size

Settings and first-run setup have a Download size choice. Balanced (default) avoids huge files: a 4K or 1080p version is fine, a 10 GB episode is not. Smallest prefers compact encodes that start fast and save space. Best quality accepts very large files, such as disc remuxes. Several of the best versions are also raced for a few seconds when you press play, and the one that really downloads fastest wins.

## Library, ratings and downloads

Rate a title with the thumbs and heart under its description; tapping the same one again clears it. Liking things adds "Because you liked ..." rows to Home. Library shows what you are watching, My List, what you loved and liked, and your watch history.

The download button on a movie, an episode, or "Download season" saves it to the server without playing it. Downloads you start yourself are never removed to free space; delete them from Library.

## Your own files

Dodobox looks in your Videos and Movies folders (and `MEDIA_DIR`) and matches files such as `Movie.Name.2019.mkv` or `Show.S01E02.mkv` to posters and details. Matched files appear under "On your server" and play instantly. Add more folders in Settings.

## Settings you may want

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Use `127.0.0.1` to allow only this computer. There is no login: anyone on your network can use it |
| `DATA_DIR` | `./data` | Downloads, profiles and caches |
| `MEDIA_DIR` | none | An extra folder of your own media |
| `DODOBOX_ENCODER` | automatic | Force `libx264` if a graphics-card encoder misbehaves |
| `OPEN` | unset | Set to `1` to open a browser on start (the start scripts do) |
| `FFMPEG`, `FFPROBE` | automatic | Paths to ffmpeg and ffprobe. A system install is used when present, else the bundled build |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | Device used by the VAAPI hardware encoder |
| `MAX_TRANSCODES` | `3` | Video segments encoded at the same time |
| `MIN_LOCAL_BYTES` | `30000000` | Smallest file counted as a video when scanning your own folders |
| `TRANSLATE_BEAM` | `5` | Beam size of the subtitle translator (lower is faster, rougher) |
| `NO_DHT` | unset | Turn off DHT and local peer discovery |
| `NO_MDNS` | unset | Do not announce `dodobox.local` on the network |
| `NO_SPEEDTEST` | unset | Skip measuring the server's internet speed at start |

Everything else (storage limit, subtitle language, quality, download size) is in the Settings page. Quality is Auto by default: Dodobox picks the best version your internet line and screen can use (4K only on a 4K screen with a fast line). Choose 4K, 1080p, 720p or Data saver to force it; the player menu changes it for the current video.

## Troubleshooting

- **A title takes long to start**: Dodobox tries another version by itself after a stall. Slow swarms are normal for rare titles.
- **"Nothing is available"**: no sources have seeders for it right now.
- **No subtitles for anime**: online lookup covers movies and series. Built-in tracks appear in the subtitle menu while the video is still downloading (marked "after more download" until that part has arrived), and you can load a file.
- **Phone cannot reach the address**: both devices must be on the same Wi-Fi; guest networks often isolate devices. Allow Node through the computer's firewall.
- Metadata and torrent search use third-party services (Cinemeta, AniList, IMDb suggestions, Torrentio, apibay, Nyaa, OpenSubtitles). If one is blocked on your network its results are missing.
