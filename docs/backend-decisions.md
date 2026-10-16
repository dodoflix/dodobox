# Backend decisions

How source discovery, release matching and ranking got to their current shape, what was measured to get there, and what
was deliberately left alone. Numbers come from the [benchmarks](benchmarks.md); how it fits together today is in
[how it works](architecture.md).

## What the measurements showed

1. **Ids beat names.** Torrentio answers movies and series by IMDb id and anime by Kitsu id; AnimeTosho answers by AniDB
   episode id. Those answers are already the right title and episode, so name matching is only needed for text-search
   sources. Nyaa text search, the only anime source before, needed four or five queries per lookup against a rate-limited
   host, left 4 of the 29 hard titles without a release, and returned the best releases far less often than the Kitsu path.
2. **Old and long-tail series live in season packs.** A single-episode text query finds almost nothing for a show like
   Lost or Friends; "Season N" and "complete" queries find a pack for every title tried. The pack then needs the right
   file picked, which the earlier `pickFile` often got wrong.
3. **There is no second id-keyed source for movies and series.** TorrentsDB rate-limits to a hard 429, Peerflix returns
   unseeded rows, EZTV only knows recent episodes. Torrentio is a single point of failure, so the text tier is the fallback
   and has to work on its own.
4. **Name matching was the weakest part.** Five title helpers and five episode helpers normalised names differently; on the
   corpus they accepted 30% of valid anime releases where one tokenizer accepts 82% at the same false-positive rate.
5. **Waiting for every source costs seconds.** The slowest source set the answer time, and one failing primary added the
   full timeout.
6. **Reported seeders can be stale.** Listed with 340 seeders, live 20; listed with 307, live 7.

## What changed

- `src/release.js`: one parser for torrent and file names (title, episode under any numbering, pack, file choice).
- `src/ids.js`: offline AniList to Kitsu / AniDB / IMDb / TVDB mapping and per-episode numbering.
- `src/sources.js`: two-tier lookups. The id-keyed source answers first; names are searched only when it returns fewer than
  three seeded releases, starting at once if the primary fails. The answer returns 300 ms after the primary, later answers
  top up the cached list, "nothing found" is remembered for five minutes unless a source errored, and the next episode's
  list is fetched when playback starts.
- `src/tracker.js`: live seeder counts for the best fifteen candidates from UDP trackers, used when two trackers agree.
- `src/meta.js`: title search asks IMDb suggest and the catalog together and fuses the rankings.

End to end on the 90 hard titles (`npm run bench -- app --set edge`): a seeded release for all 90, p50 350 to 470 ms cold.

## Left alone

- **The ranking formula.** A rewritten ranker with hard gates picked a higher resolution in a few more scenarios, but that
  is a product preference (a healthy 1080p over a thin 4K), not a defect, and ranking time was never a cost (1 ms). The
  tracker scrape was the part that changed outcomes, and it sits in front of the existing score. The candidate stays in
  `bench/candidates/rank-gates.js` and `rank` compares it.
- **Subtitles.** The existing providers, embedded tracks and sidecars stay. AnimeTosho lists extracted subtitle tracks, but
  their download host does not resolve.
- **TorrentsDB, Peerflix, SubsPlease, nekobt, TokyoTosho, torrents-csv.** No measurable gain. Their adapters stay in
  `bench/lib/providers.js` so a later run can re-test them.

## Risks

- Torrentio is the only id-keyed source for movies and series. If it goes away the text tier carries everything and recall
  drops to what `fallback` reports. Re-run `sources` and `coverage` when a replacement appears.
- Fribb and ani.zip are community data. A brand-new show can be missing from both for a few days; the name searches cover it.
- AnimeTosho serialises requests and has no stable rate limit; no play waits on it beyond the deadline.
- The benchmark pools relevance over the sources it queries, so a source it does not know about cannot score well. Add new
  sources to `bench/lib/providers.js` before judging them.
