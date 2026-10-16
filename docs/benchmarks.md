# Benchmarks

`bench/` measures the backend pieces that decide whether the right thing plays: which sources know a title, whether a
release name is the requested episode, which file of a pack to open, how results are ranked, and how long a lookup
takes when a source is slow. It is a developer tool: nothing in it ships, and CI does not run it.

Run `npm run bench -- <command> [--flag value]`. `data` must run once; commands that read stored answers say which
command produces them.

| command | needs network | what it answers |
|---|---|---|
| `data` | yes | Downloads the Fribb anime id list and the ani.zip episode tables into `bench/.cache` |
| `resolve` | yes | Rebuilds `gold/edge.json` from `gold/edge-spec.js` (IMDb and AniList lookups); read the printed matches |
| `sources --set core\|edge` | yes | Asks every source about every gold title and stores the rows (`--only a,b`, `--reps n`) |
| `coverage --set core\|edge` | no | Per source: titles answered, top-5 recall, latency; best source order; `--lists` names the titles with no or one source |
| `fallback` | yes | Which text-query shapes find a seeded release when the id-keyed source has nothing (edge set) |
| `reliability` | yes | 60 lookups per source, 8 at a time: rate limits, errors, queueing |
| `snapshots` | yes | Rebuilds `snapshots/corpus.json.gz` and `snapshots/packs.json.gz` |
| `match` | no | Release matchers on the corpus: recall and false positives (`--dump matcher:kind`) |
| `pick` | no | File choice inside real multi-file torrents (`--show n` prints disagreements) |
| `rank` | no (needs `sources --set core`) | Top result under seven viewer situations, and ranking time |
| `orchestrate` | no (needs `sources --set core`) | Simulated lookup plans with injected failures: time to answer and recall |
| `app` | yes | The app's own `findSources()` on the gold titles, cold: seeded results and time |
| `scrape` | yes | Live tracker seeder counts against the numbers sources report |
| `search` | yes | Title search relevance and latency |
| `idmap` | yes | Anime id mapping coverage and agreement |

## Method

**Gold sets.** `gold/core.js` is 40 titles that behave normally (8 movies, 12 series episodes, 20 anime entries).
`gold/edge.json` is 90 hard ones, generated from `gold/edge-spec.js`: remakes sharing a title, one-word titles, digits
and punctuation, silent films, foreign originals, anime in the IMDb series catalog, long-running anime with absolute
numbering, split cours, sequels, old batch-only shows, spin-offs with the same prefix, brand-new releases.

**Labels without a name parser.** Sources keyed by an id return releases for exactly that title and episode: Torrentio by
`imdb:season:episode` or `kitsu:episode`, AnimeTosho by the AniDB episode id (from ani.zip). `snapshots` stores those
rows as the positives for their target. Single-file releases of the neighbouring episodes or of other shows are the
negatives. No matcher under test produced a label.

**Hits.** A release counts when it has at least 5 seeders and is right: for id-keyed sources the title is trusted and only
numbering (and the year for movies) is checked; for text-search sources the full tokenizer match has to pass. Top-5 recall
is the share of the five most seeded relevant releases, pooled over all sources, that a source returns. The pool is
biased toward whatever the id-keyed sources return.

**Candidates and baselines.** `match` and `pick` run `src/release.js` itself, so they report on what ships, next to the
optional third-party parsers in `candidates/`. `candidates/rank-repo.js` runs the current `score()` and
`candidates/rank-gates.js` is the ranker under evaluation. A candidate that wins moves into `src/` and the bench follows.

## Extending

- A new source: add an adapter to `lib/providers.js` returning `{ ok, status, ms, rows }`, add it to `ID_KEYED` if its
  answer is keyed by an id, then run `sources` and `coverage`.
- A new matcher, picker or ranker: add a file to `candidates/` with the same shape as its neighbours and list it in the
  command that uses it.
- A new hard title: add it to `gold/edge-spec.js`, run `resolve`, check the printed ids, then `sources --set edge`.
- Fixtures drift as services change. Rebuild with `snapshots` and commit the two `.gz` files together with the numbers
  they change in the results section below.
- Rate limits: `sources` pauses 200 ms between calls and retries 429s; keep sweeps sequential, running two at once
  poisons both.

## Results

Numbers below come from one run of each command; services and their rate limits move, so re-run before relying on a
decimal. `bench/snapshots/` fixes the matcher, picker and ranking inputs, so those results reproduce exactly.

### Sources (`coverage`)

Titles with at least one seeded, correct release, and top-5 recall of the pooled best releases.

| kind | source | core set | edge set | top-5 recall (edge) | p50 ms |
|---|---|---|---|---|---|
| movie | Torrentio | 8/8 | 30/30 | 99% | 47 |
| movie | YTS | 8/8 | 30/30 | 41% | 213 |
| movie | Knaben text | 8/8 | 29/30 | 65% | 171 |
| movie | TPB text | 8/8 | 27/30 | 39% | 49 |
| series | Torrentio | 12/12 | 30/30 | 99% | 45 |
| series | TPB or Knaben, episode query | 11/12 | 19/30 | 3% | 50 to 110 |
| series | EZTV | 5/12 | 6/30 | 0% | 182 |
| anime | Torrentio by Kitsu id | 20/20 | 30/30 | 81% | 46 |
| anime | Torrentio by IMDb id | 18/19 | 27/27 | 69% | 46 |
| anime | AnimeTosho by AniDB show id | 19/20 | 28/30 | 29% | 463 |
| anime | AnimeTosho by AniDB episode id | 16/18 | 16/29 | 22% | 466 |
| anime | Nyaa text (what the app uses) | 12/20 | 14/30 | 10% | 303 |

Best source order by top-5 recall, edge set: anime Torrentio-Kitsu 81%, then AnimeTosho episode id 90%, then AnimeTosho
show id 99%; movies and series Torrentio 99%, then one text source for 100%.

TorrentsDB answered 429 on every call and Peerflix returned no seeded releases; SubsPlease, nekobt and TokyoTosho found
nothing usable. They stay in `lib/providers.js` so a later run can re-test them.

Single-source titles in the edge set (`coverage --set edge --lists`): 11 of the 30 series (Lost, Archer, Friends, Lupin,
Castlevania, Terriers and others) have a seeded single-episode release only from Torrentio, and one anime (Trigun) only
from the Kitsu path.

### Text fallback (`fallback`)

Series, titles with a seeded release, out of 30:

| query shape | TPB | Knaben | torrents-csv |
|---|---|---|---|
| episode (`Show S05E14`) | 19 | 19 | 7 |
| season (`Show S05`) | 26 | 26 | 25 |
| season word (`Show Season 5`) | 28 | 27 | 23 |
| complete (`Show complete`) | 29 | 29 | 24 |
| any shape, any source | 30 | | |

Anime on Nyaa, out of 29: episode 13, batch 16, plain title 16, English-title batch 20; all shapes together find 25. The
four misses are old shows (Trigun, Code Geass R2, Fullmetal Alchemist 2003, Dr. Stone: Stone Wars).

### Reliability (`reliability`, 60 calls, 8 in flight)

Torrentio answered 429 to 9 of 59 once the burst passed about 50 calls; Nyaa answered 429 to 51 of 60; TorrentsDB to all;
AnimeTosho never failed but serialises requests (p50 5.3 s under load, 0.5 s alone). TPB, Knaben, YTS and EZTV were clean.
The app's per-host limiter in `src/http.js` is what keeps normal use under these limits.

### Release matching (`match`)

Recall on releases the id-keyed services returned for the exact target; false positives on adjacent-episode and
other-show negatives.

| matcher | movie | series | anime | FP adjacent episode | us per call |
|---|---|---|---|---|---|
| regex helpers in `src/sources.js` (before `src/release.js`) | 80% | 70% | 30% | 0.7 to 1.0% | 3 to 4 |
| `parse-torrent-title` | 87% | 86% | 26% | 0 to 1.9% | 13 to 44 |
| `@ctrl/video-filename-parser` | 87% | 85% | 66% | 55% on series | 33 to 78 |
| `anitomyscript` (wasm) | | | 80% | 0.3% | 9 |
| `src/release.js` | 89% | 93% | 82% | 0.9 to 1.9% | 5 to 19 |

Most remaining misses are releases whose title is translated ("Scissione", "Duna") although the id already proved the
match: title matching is skipped for id-keyed sources. Text-search precision was checked by reading about 90 accepted
releases from TPB and Nyaa; all were the right title. One known hole: "Vol 05" reads as episode 5.

### File choice in packs (`pick`)

54 real anime batch torrents, 642 tasks (one per early episode).

| picker | tasks with no file | tasks with a file |
|---|---|---|
| `pickFile` before `src/release.js` | 405 | 37% |
| `pickFile` in `src/release.js` | 86 | 87% |

The earlier picker answered with a file in the wrong episode in many of its answers (Kaguya-sama episodes 4 to 9 all
return episode 10; Naruto episodes 1 to 12 return episode 274 from a pack that starts later). The new one returns -1
when the pack does not contain the episode, reads whether the pack numbers by season, absolutely or locally, and skips
openings, endings and specials. Where it still differs from `anitomyscript`, the cause is an extra the other parser
took, or a TVDB/AniDB numbering conflict that no parser can settle.

### Ranking (`rank`)

20 movie and series titles, seven viewer situations. Both rankers put an acceptable release first every time. The current
score picks a release at a lower resolution than the best acceptable one in 7 of 20 titles on a 100 Mbps line with a 4K
screen, 4 of 20 in lossless mode and 2 of 20 on a 4 Mbps line; the gated ranker picks the best resolution every time.
Ranking time is 1.2 to 1.5 ms against 0.04 to 0.13 ms. The oracle encodes the same product rules the gated ranker was
written from, so treat the accuracy gain as indicative and the time as measured.

### Orchestration (`orchestrate`)

Simulated from the measured per-source latencies, 10% of primary calls failing (half of them quickly with a 429, half
after the 9 s timeout).

| plan, strategy | movie p50 / p95 ms | anime p50 / p95 ms | anime top-5 recall at return |
|---|---|---|---|
| today, wait for all | 94 / 280 (9000 with a failure) | 356 / 504 (9000) | 24% |
| id-first, wait for all | 93 / 279 (9000) | 516 / 740 (9000) | 97% |
| id-first, first answer | 70 / 198 | 67 / 93 | 81% |
| id-first, 300 ms deadline | 93 / 288 | 300 / 300 | 81% |

"First answer" looks fastest but on movies and series it returns on whichever source is quickest, which is a text source
holding 57 to 72% of the best releases: the primary id-keyed source must define the answer. Late results are not counted
in the recall at return; in the app they refresh the cached list.

### Live seeders (`scrape`)

40 hashes in 160 to 210 ms from the three fastest trackers; all seven answered. Reported against live seeders had a
median ratio of 0.94 and a p10 of 0.41. Largest drops on one title: 340 reported, 20 live; 307 reported, 7 live; 88
reported, 2 live. A scrape of the top candidates before ranking removes those.

### Title search (`search`)

30 queries including typos and abbreviations. IMDb suggest 28 first / 29 in the top three, Cinemeta 29 / 30, TVmaze (series
only) 13 of 15. Fusing IMDb suggest and Cinemeta by reciprocal rank gives 28 first and 30 in the top three. Warm latency is
about 45 ms for each. The two single-source misses differ ("lotr fellowship" fails IMDb, "dark" fails both as first
result), which is the argument for asking both.

### Id mapping (`idmap`)

Top 300 AniList entries. Fribb anime-lists, 7.5 MB read once: IMDb 300, TVDB 287, AniDB 300, Kitsu 300, MAL 300, no
network at lookup time. ani.zip (60 asked): all found, 58 with IMDb, p50 100 ms, answers 429 after about 60 quick calls;
it is the only source with per-episode AniDB, TVDB and absolute numbers. animeapi.my.id answered 30 of 60. Where two
sources have an IMDb id they agree every time.

### The app itself (`app --set edge`)

`findSources()` from `src/sources.js` on the 90 hard titles, cold, one at a time.

| kind | titles | with a seeded release | with 20 or more seeders | p50 ms | p95 ms |
|---|---|---|---|---|---|
| movie | 30 | 30 | 30 | 350 | 535 |
| series | 30 | 30 | 28 | 349 | 366 |
| anime | 30 | 30 | 29 | 474 | 850 |

The time includes the tracker scrape of the best fifteen candidates (about 250 ms) and, for anime, the first-use ani.zip
lookup. A second request for the same title is served from the cache in a few milliseconds.

### Not pursued

- AnimeTosho lists extracted subtitle tracks (14 to 22 languages on recent releases), but the attachment host redirects
  to `storage.animetosho.org`, which does not resolve, in a browser as well. Embedded tracks stay the anime subtitle path.
- OpenSubtitles hash-exact lookup was not tested: the addon route with `videoHash` answered an error.
