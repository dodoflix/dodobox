# Backend plan: finding the right thing to play

What the [benchmarks](benchmarks.md) say about the source, matching and ranking code, and the changes that follow.
Each section names the code it replaces, the numbers it must reach, and what it depends on. Every change is accepted
by running the matching `npm run bench` command, not by argument.

## What the measurements show

1. **Ids beat names.** Torrentio answers movies and series by IMDb id and anime by Kitsu id, AnimeTosho by AniDB
   episode id. Those answers are already the right title and episode, so name matching is only needed for text-search
   sources. The anime path today (Nyaa text search, matched by regex) needs four or five queries per lookup against a
   rate-limited host, still leaves 4 of the 29 hard titles without a release, and returns the best releases far less
   often than the Kitsu path (see top-5 recall in the results). The id path answers all of them with one call of
   about 50 ms.
2. **Old and long-tail series live in season packs.** A single-episode text query finds almost nothing for a show like
   Lost or Friends; "Season N" and "complete" queries find a pack for every title tried. The pack then needs the right
   file picked, which the current `pickFile` often gets wrong.
3. **There is no second id-keyed source for movies and series.** TorrentsDB rate-limits to a hard 429, Peerflix returns
   unseeded rows, EZTV only knows recent episodes. Torrentio is a single point of failure, so the text tier is the
   fallback and has to be good rather than decorative.
4. **Name matching is the weakest part of the code.** Five title helpers and five episode helpers normalise names
   differently; on the corpus the current filters accept 30% of the valid anime releases while a single tokenizer
   accepts over 80% at the same false-positive rate.
5. **Waiting for every source costs seconds.** The slowest source sets the answer time, and one failing primary adds
   the full timeout. A short deadline with late results merged into the cache removes both.
6. **Reported seeders can be stale.** A tracker scrape of the top candidates costs about 250 ms and catches dead ones.

## Changes, in dependency order

Landed: `src/release.js`, the single release-name parser, `src/ids.js`, and the two-tier lookups in `src/sources.js` for
movies, series and anime (see [how it works](architecture.md)). The sections below are what is left; their acceptance numbers come from the commands
named in each.

### Orchestration: `findSources`

- The id-keyed source is the primary. When it answers with at least three usable rows, wait until the 300 ms mark for its
  tier-mates, then return; never later than the whole tier finishing. Late results merge into the cached list and the
  next call sees them. Do not return on whichever source answers first: a fast text source wins that race with only
  60 to 70% of the top results (`orchestrate`, "first answer").
- A 429 or timeout from the primary starts the fallback tier immediately instead of at the end of the timeout.
- Keep the 90-minute list cache, add a short negative cache for "nothing found", and prefetch the next episode's list
  when playback starts.
- Done when: `orchestrate` shows p95 time to answer at or under 300 ms with a failing primary, with the same top-5 recall
  as waiting for everything once late results land.

### Ranking: `score` and `rank`

- Compute per-row features once at ingest (resolution, codec, remux, dub language, size per runtime) instead of
  re-running regexes inside the sort comparator.
- Hard gates first (seeded, not a cam, not another language, bitrate fits the line, right season), relaxed in stages
  only when nothing passes; then a small additive score for resolution fit, seeders, codec and size.
- Scrape the top 15 candidates over UDP trackers (`bench/lib/tracker.js` is the working implementation), merge the live
  counts, cache per hash for ten minutes, and keep the existing measured-speed race for the final three.
- Done when: `rank` is at least as good as today in every scenario and `ms per rank` drops by an order of magnitude.

### Search: `src/meta.js` `catalog`

- Ask IMDb suggest and Cinemeta together and fuse the two rankings, instead of Cinemeta only when IMDb returns nothing.
  Typos and abbreviations ("lotr fellowship") stop returning a confident wrong title.
- Done when: `search` shows the fused top-3 at least as good as the better single source.

## Order of work

1. Orchestration deadline and cache changes.
2. Ranking rewrite with the tracker scrape.
3. Search fusion.

Each step lands as its own change with the before and after numbers of the relevant command in the description.

## Risks and limits

- Torrentio is the only id-keyed source for movies and series. If it goes away, the fallback tier carries everything
  and recall drops to what `fallback` reports. Re-run `sources` and `coverage` when a replacement appears.
- Fribb and ani.zip are community data. A new show can be missing from both for a few days; the fallback tier covers it.
- AnimeTosho has no stable rate limit; treat it as best effort and never block a play on it.
- The benchmark pools relevance over the sources it queries, so a source the pool does not know about cannot score
  well. Add new sources to `bench/lib/providers.js` before judging them.
- Subtitles: AnimeTosho lists extracted subtitle tracks per release, but their download host does not resolve. Embedded
  tracks and the existing providers remain the subtitle path.
