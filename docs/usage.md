# Using Dodobox

## First run

Start the server and open its address (the start scripts open it for you; with `npm start` open the printed address yourself). Create a profile and pick your language, subtitles and what you like. Each person keeps their own Continue Watching, My List and preferences.

## Desktop app

Each [release](https://github.com/dodoflix/dodobox/releases) has installers for Windows (setup and portable), macOS (Apple silicon and Intel, `.dmg`) and Linux x64 (`AppImage`, `.deb`). The app is just the server: it sits in the system tray and has no window of its own. Click the tray icon to open Dodobox in your browser. The tray menu also copies the address for phones and TVs, turns on "Start when I sign in" (Windows and macOS), shows the data folder and quits. Data lives in the app's folder for your user.

The installers are not signed yet, so the system warns on first run:

- **Windows**: SmartScreen says "Windows protected your PC". Choose More info, Run anyway.
- **macOS**: open the app with right-click, Open. If it says the app is damaged, run `xattr -cr /Applications/Dodobox.app`.
- **Linux**: `chmod +x` the AppImage. If it exits at once on a recent Ubuntu, start it with `--no-sandbox`. Some desktops (GNOME) hide tray icons without an extension; starting the app again opens the page, and `Dodobox --quit` stops it.

"Best translation quality" is not available in the app (it installs through npm); use the server install for it.

## Other devices

Open the address the server prints (for example `http://192.168.1.20:3000`, or `http://dodobox.local:3000`) on the same Wi-Fi. Settings shows a QR code for it.

| Device | How |
| --- | --- |
| iPhone / iPad | Open in Safari, Share, Add to Home Screen. |
| Android phone | Open in Chrome, menu, Add to Home screen. |
| Smart TV or Android TV with a browser | Open the address. The layout switches to large text and works with the remote. Settings has a TV layout switch if it is not detected. |
| Android TV app | See [apps/android](../apps/android/README.md). It finds the server by itself. |
| Chromecast | Press the cast button in the player on a phone or laptop (Chrome). |
| Apple TV | Play on an iPhone, iPad or Mac in Safari and press the AirPlay button. |

## Updates

Dodobox checks the releases page for a newer version now and then.

- **Desktop app**: it asks whether to update. On Windows (installer) and Linux (AppImage) choosing "Update now" downloads it, then offers to restart. The portable exe, the `.deb` and the macOS builds are not signed, so for those it opens the download page. "Check for updates" in the tray menu checks right away.
- **Docker, npm and source**: it only writes a line in the log with how to update (`docker pull ghcr.io/dodoflix/dodobox:latest`, then recreate the container). Settings shows the new version next to the current one.
- Set `NO_UPDATE_CHECK=1` to turn the check off.

Phones and laptops use plain HTTP on the local network, so "install as app" gives a bookmark-style shortcut. That is a browser rule for non-HTTPS addresses.

## The player

- **Episodes**: series have an episode list button with thumbnails and progress. Back always returns to the title page.
- **Remembered per title**: the subtitle you picked (or Off), its timing per episode, the audio track, quality, speed, Auto sync and subtitle size are kept in this browser, per profile.
- **Audio**: starts on the title's original language, skipping dubs and commentaries. The track marked "Default" is the one Dodobox would choose.
- **Subtitles**: picking a language only lists its files; choose a file on the right. Changing the subtitle stops an auto-translation that is still running.

## Subtitles

Subtitles are searched in your language and English and ranked by how closely each file matches the version playing. Built-in tracks appear while the video is still downloading, greyed out ("after more download") until enough of the start has arrived. Subtitle files that come in the same download (next to the video or in a `Subs` folder) are listed too, under their file name.

**Auto sync** (switch in the subtitle menu) fixes online subtitles that are a few seconds off, run at a different frame rate, or are cut differently. It compares when speech happens in short stretches of the downloaded audio with when the subtitle appears, at low priority, and keeps checking while you watch. Built-in subtitles are already in sync and are left alone. Timing -0.5/+0.5 works on top.

**Auto-translated** appears in the subtitle menu for every interface language: the English subtitle translated by the server with an open-source engine (about 20 MB per language, downloaded the first time, then stored in `data/translate`). Quality suits everyday dialogue and is rougher for slang and names. The entry shows "Preparing the language... 40%" while the model downloads, then "Translating... 60%".

Settings has **Best translation quality** (off by default). It installs a larger translator the first time (about 2 GB in `data/translate/hq`), then improves the subtitle in the background from where you are watching. It uses the graphics card if there is a working one, otherwise the processor, which is much slower.

## Adult content filter

Off by default, in Settings and first-run setup. When on, titles marked as adult are left out of browse lists, shelves and search. A title you open directly is never blocked.

## Download size

Balanced (default) avoids huge files: a 4K or 1080p version is fine, a 10 GB episode is not. Smallest prefers compact encodes. Best quality accepts very large files such as disc remuxes. Several of the best versions race for a few seconds when you press play, and the fastest wins.

## Library, ratings and downloads

Rate a title with the thumbs and heart under its description; tapping the same one clears it. Liked titles add "Because you liked ..." rows to Home. Library shows what you are watching, My List, your ratings and history.

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
| `NO_UPDATE_CHECK` | unset | Do not look for a newer release |

Everything else (storage limit, subtitle language, quality, download size) is in Settings. Quality is Auto by default: Dodobox picks the best version your line and screen can use. Choose 4K, 1080p, 720p or Data saver to force it.

## Troubleshooting

- **A title takes long to start**: Dodobox tries another version by itself after a stall. Slow swarms are normal for rare titles.
- **"Nothing is available"**: no sources have seeders for it right now.
- **Phone cannot reach the address**: both devices must be on the same Wi-Fi; guest networks often isolate devices. Allow Node through the firewall.
- Metadata, torrent search and subtitles come from third-party services. If one is blocked on your network its results are missing.
