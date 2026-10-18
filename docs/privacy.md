# Privacy policy

Dodobox is software you run yourself. The project runs no servers for it, has no accounts and collects no data: no analytics, no telemetry, no crash reports.

## What stays on your computer

Profiles, watch progress, My List, ratings, settings, downloads and caches live in the data folder of the machine that runs Dodobox. Nothing in it is sent to the authors.

## What leaves your computer

Your server contacts other services to do its job: catalog and artwork providers, torrent and subtitle sources, intro and credits timing databases (AniSkip, IntroDB), anime id lists, tracker lists, an internet speed test, and GitHub to look for a new release. Those services see your IP address and the request (a title, an id, a search). They have their own privacy policies. Torrent downloads share your IP address with other peers. Watch parties find each other through public trackers and DHT, so members' IP addresses are visible to one another; party messages are encrypted with a key made from the party code.

## Discord Rich Presence

While Dodobox is open, the server tells the Discord app on the same computer that you are browsing, or, while a video plays or is paused, the title, its poster address, the season and episode, and the playback time. Discord shows it on your profile according to your Discord activity settings. In a watch party it also sends the number of members and a hash of the party code, never the code itself. Turn it off per profile in Settings (it is asked about when a profile is first set up), or for the whole server with `NO_DISCORD=1`. The Discord application used for this has no bot and receives no data from Dodobox.

## Contact

Questions: open an issue at https://github.com/dodoflix/dodobox/issues.
