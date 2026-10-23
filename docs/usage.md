# Using Dodobox

## First run

Start the server and open its address (the start scripts open it for you; with `npm start` open the printed address yourself). Create a profile and go through three short pages: language and subtitles, what you like, and privacy. Each person keeps their own Continue Watching, My List and preferences.

## Desktop app

Each [release](https://github.com/dodoflix/dodobox/releases) has installers for Windows (setup and portable), macOS (Apple silicon and Intel, `.dmg`) and Linux x64 (`AppImage`, `.deb`). The app is just the server: it sits in the system tray and has no window of its own. Click the tray icon to open Dodobox in your browser. The tray menu also copies the address for phones and TVs, turns on "Start when I sign in" (Windows and macOS), shows the data folder, shows the log file and quits. Data lives in the app's folder for your user.

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

- **Episodes**: series have an episode list button with thumbnails and progress. Long seasons are listed in ranges of 24 episodes, as on the title page. Back always returns to the title page.
- **Skip intro and next episode**: a Skip intro (or Skip recap) button shows while that part plays, and `s` presses it. When the credits start, the Up next card counts down and starts the next episode; Not now keeps you on the credits. Markers come from the file's own chapters, AniSkip (anime) and IntroDB (series), so a title nobody has marked has none, and the card then appears 28 seconds before the end.
- **Another version**: Try another version in the quality or settings menu drops the current version and finds the next best one, from where you are, even when playback is fine.
- **Playback stats**: press `i`, or use Playback stats in the quality or settings menu, for a panel with the file, how it is played (direct or converted), codecs, decoded and shown size, dropped frames, buffer, your measured link, and the torrent: release name, where it was found, info hash, contents, peers, upload and download speed. The copy button puts it on the clipboard for a bug report. It stays on until closed.
- **Remembered per title**: the subtitle you picked (or Off), its timing and Auto sync result per episode, the audio track, quality, speed, Auto sync and subtitle size are kept in this browser, per profile.
- **Audio**: starts on the title's original language, skipping dubs and commentaries. The track marked "Default" is the one Dodobox would choose.
- **Subtitles**: picking a language only lists its files; choose a file on the right. Changing the subtitle stops an auto-translation that is still running.

## Watch party

Watch the same thing at the same time as friends who have Dodobox, up to 12 people per party (the panel shows how many are in, and the pill by your profile button has it as a tooltip). Open the profile menu, Watch party, Start a party, and send the code it shows; nothing needs to be playing. The party stays open while you pick episodes: whoever presses play first sets what everyone watches, the others get a Join button, and moving on to the next episode of the same show takes everyone along. Friends open the profile menu, Watch party, type the code and press Join (or press the paste button; a code inside a copied message is picked out of it). Anyone can pause, play or seek and everyone follows. The panel also has a chat; new messages show over the picture for a few seconds while it is closed. Type `:fire:` or `:)` (or use the smiley button) for emoji, hover a message (or tap it on a phone) to react to it, and links show as small pills; a link to a picture loads only when you tap it, so nothing contacts that site on its own. A small people badge next to your profile shows you are in a party and reopens it; the people icon in the player does the same.

Each person's Dodobox plays the video itself (a party does not stream your copy), so everyone needs the title to be available to them. Friends start on the same version you chose when their Dodobox also finds it, so the timing matches. The code finds the party on the torrent network and encrypts what is sent, so keep it between friends. You can also set a password when starting a party; friends then type it next to the code, and without it they cannot find the party at all. A wrong password looks the same as an empty party ("Looking for your friends..."). The party ends for you when you press Leave party or quit Dodobox. If two people cannot connect, one of them is probably behind a strict router; try again from another network. Dodobox has no login, so anyone on your home network can also see the code.

## Discord

When Discord runs on the same computer as the server, it shows, in your interface language, that you are browsing, or what is playing or paused with its poster and a timer. In a watch party it also shows how many are in it. It has Get Dodobox and Releases buttons (other people see them, you do not). It is on by default: switch it off per profile in Settings, Discord, or for the whole server with `NO_DISCORD=1`. Joining a party from Discord is not supported, because the join secret would pass the party code, which is also its encryption key, through Discord.

## Subtitles

Subtitles are searched in your language and English and ranked by how closely each file matches the version playing. Built-in tracks appear while the video is still downloading, greyed out ("after more download") until enough of the start has arrived. Subtitle files that come in the same download (next to the video or in a `Subs` folder) are listed too, under their file name.

**Auto sync** (switch in the subtitle menu) fixes online subtitles that are a few seconds off, run at a different frame rate, or are cut differently. It compares when speech happens in short stretches of the downloaded audio, starting with the stretch where you are, with when the subtitle appears, at low priority, and keeps checking while you watch. The result is kept per episode, so continuing later starts in sync without another download. Re-sync, next to the switch, forgets that result and measures again around where you are, for a subtitle that came out wrong. Built-in subtitles are already in sync and are left alone. Timing -0.5/+0.5 works on top.

**Auto-translated** appears in the subtitle menu for every interface language: the English subtitle translated by the server with an open-source engine (about 20 MB per language, downloaded the first time, then stored in `data/translate`). Quality suits everyday dialogue and is rougher for slang and names. The entry shows "Preparing the language... 40%" while the model downloads, then "Translating... 60%".

OpenSubtitles limits how many files one connection may download per day. When that runs out, the player offers **Connect**, and Settings has an **OpenSubtitles account** row: sign in once (per profile) with an [opensubtitles.org](https://www.opensubtitles.org) account that has a VIP membership and that profile's downloads continue under it. Accounts without VIP get no downloads from OpenSubtitles this way; Settings and the player say so.

Settings has **Best translation quality** (off by default). It installs a larger translator the first time (about 2 GB in `data/translate/hq`), then improves the subtitle in the background from where you are watching. It uses the graphics card if there is a working one, otherwise the processor, which is much slower.

## Profile PIN

Optional, per profile: set it on the privacy page of the first-run setup or later in Settings, Profile lock (4 to 8 digits; changing or removing it asks for the current one). A profile with a PIN asks for it when someone picks it, and the server refuses its list, history, progress, ratings and settings to anyone without it, so another device on the network cannot read them either. What is not tied to a profile stays open to everyone: downloads, the files on the server and playing a title. Switching profile ends the session, a PIN session lasts 30 days in the browser it was entered in, and after five wrong PINs in a row the profile refuses every try for 30 seconds, longer each time. The PIN is stored hashed (scrypt). A forgotten PIN is reset by whoever runs the server: stop it and delete the `pin` entry of that profile in `data/state.json`.

## Adult content filter

Off by default, in Settings and first-run setup. When on, titles marked as adult (Hentai anime, "Adult" movies and series) are left out of browse lists, shelves, search, your list, continue watching, history, downloads and the library. A title you open directly is never blocked. When off, adult-marked anime is also searched on sukebei for sources.

## Download size

Balanced (default) avoids huge files: a 4K or 1080p version is fine, a 10 GB episode is not. Smallest prefers compact encodes. Best quality accepts very large files such as disc remuxes. Several of the best versions race for a few seconds when you press play or download, and the fastest wins.

## Library, ratings and downloads

Rate a title with the thumbs and heart under its description; tapping the same one clears it. Liked titles add "Because you liked ..." rows to Home. Library shows what you are watching, My List, your ratings and history. Remove a title from history with the x on its card, or from its own page; it also leaves Continue watching.

The download button on a movie, an episode, or "Download season" saves it to the server without playing it. Downloads you start yourself are never removed to free space; delete them from Library. In Library each download can be paused, resumed or moved to the front; a prioritized download goes first and the others wait until it finishes. On a long season shown in episode ranges the button reads "Download episodes" and saves the range on screen.

## Your own files

Dodobox looks in your Videos and Movies folders (and `MEDIA_DIR`) and matches files such as `Movie.Name.2019.mkv` or `Show.S01E02.mkv` to posters and details. Matched files appear under "On your server" and play instantly. Subtitle files beside a video (`Movie.en.srt`, or in a `Subs` folder) show up in the player's subtitle menu. Add more folders in Settings.

## Settings you may want

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Use `127.0.0.1` to allow only this computer. There is no login: anyone on your network can use it |
| `DATA_DIR` | `./data` | Downloads, profiles and caches |
| `MEDIA_DIR` | none | An extra folder of your own media |
| `DODOBOX_ENCODER` | automatic | Force `libx264` if a graphics-card encoder misbehaves |
| `OPEN` | unset | Set to `1` to open a browser on start (the start scripts do) |
| `FFMPEG` | automatic | Path to ffmpeg. A system install is used when present, else the bundled build |
| `VAAPI_DEVICE` | `/dev/dri/renderD128` | Device used by the VAAPI hardware encoder |
| `MAX_TRANSCODES` | `3` | Video segments encoded at the same time |
| `MIN_LOCAL_BYTES` | `30000000` | Smallest file counted as a video when scanning your own folders |
| `TRANSLATE_BEAM` | `5` | Beam size of the subtitle translator (lower is faster, rougher) |
| `NO_DHT` | unset | Turn off DHT and local peer discovery |
| `DISCORD_CLIENT_ID` | built-in | Discord application used for Rich Presence (browsing, playing or paused, when Discord runs on the same computer as the server) |
| `NO_DISCORD` | unset | Do not show what is playing in Discord |
| `ALLOWED_HOSTS` | unset | Comma-separated extra hostnames the server answers to (a reverse proxy or tunnel name). Addresses, `localhost`, single-word names and `.local`, `.lan` names always work; other names are refused to stop DNS rebinding |
| `NO_MDNS` | unset | Do not announce `dodobox.local` on the network |
| `NO_SPEEDTEST` | unset | Skip measuring the server's internet speed at start |
| `NO_UPDATE_CHECK` | unset | Do not look for a newer release |

Everything else (storage limit, subtitle language, quality, download size) is in Settings. Quality is Auto by default: Dodobox picks the best version your line and screen can use. Choose 4K, 1080p, 720p or Data saver to force it.

## Troubleshooting

- **A title takes long to start**: Dodobox tries another version by itself after a stall. Slow swarms are normal for rare titles.
- **"Nothing is available"**: no sources have seeders for it right now.
- **Phone cannot reach the address**: both devices must be on the same Wi-Fi; guest networks often isolate devices. Allow Node through the firewall.
- Metadata, torrent search and subtitles come from third-party services. If one is blocked on your network its results are missing.

## Logs

The server writes a log to `data/logs/dodobox.log` (up to 8 MB, then it moves to `dodobox.log.old`). It records requests, torrent and ffmpeg activity, searches, subtitles, watch parties, updates, startup settings, and errors from the player page, with timestamps. PINs, party codes and chat text are never written, but titles and addresses are, so skim it before sending. In the desktop app, tray menu, **Show log file** opens its folder; send that file when reporting a problem.

`LOG_LEVEL=info` (or `warn`, `error`) keeps the file smaller; the default is `debug`.
