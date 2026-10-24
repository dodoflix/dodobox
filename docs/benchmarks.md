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
| `throttle` | no (needs Linux `unshare`, `tc`) | Real engine against local seeders on a shaped line: does the automatic pick start and keep playing (`--alg base,repo`, `--line`, `--rtt`, `--loss`, `--keep`) |
| `orchestrate` | no (needs `sources --set core`) | Simulated lookup plans with injected failures: time to answer and recall |
| `app` | yes | The app's own `findSources()` on the gold titles, cold: seeded results and time |
| `scrape` | yes | Live tracker seeder counts against the numbers sources report |
| `subs` | no (`--snapshot` needs network) | Subtitle ranking: does the top pick match the timing of the release being played; `--grid` fits the weights, `--weights` tries a set |
| `sync` | no | Auto sync: window length, window count and where in the file the audio comes from (`--grow`: answers as the download grows, `--track`: with the built-in track); right, wrong or no answer, and audio read. Synthetic audio on real cue times, or your own videos with `--media a.mkv,b.mkv` (`--win`, `--count`, `--place start,resume,full`, `--verbose`) |
| `search` | yes | Title search relevance and latency |
| `idmap` | yes | Anime id mapping coverage and agreement |
| `skips` | yes | Skip markers (intro, recap, ending): AniSkip and IntroDB coverage by popularity; with `--server url`, chapter marks and file lengths of real releases through a running app (use a throwaway `DATA_DIR`) |

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

### Slow and distant lines (`throttle`)

Seven candidate releases (a dead one, a popular one with slow peers, a 40 GB remux, one whose peer is far away, and four
ordinary ones), each backed by a local seeder with its own peer rate, behind a line cap and a round-trip delay set with
`tc` in a user namespace. The pick runs the real ranking, race and engine; playback is simulated as buffering 3 MB, then
draining at the release's bitrate for 40 s. A profile counts as a stall when it rebuffers for more than 2 s in total.
`base` is the behaviour before the speed probe and race changes, `repo` is the code in `src/`.

| line | RTT | base pick | base stalled | repo pick | repo stalled |
|---|---|---|---|---|---|
| 2 Mbps | 20 ms | 1080p 9.7 Mbps | 30 s | 720p 2.2 Mbps | 0 s |
| 2 Mbps | 400 ms | 1080p 4.2 Mbps | 24 s | 720p 2.2 Mbps | 11 s |
| 5 Mbps | 20 ms | 1080p 9.7 Mbps | 20 s | 720p 2.2 Mbps | 0 s |
| 5 Mbps | 400 ms | 1080p 6.1 Mbps | 30 s | 720p 2.2 Mbps | 0 s |
| 10 Mbps | 20 ms | 1080p 9.7 Mbps | 0 s | 1080p 4.2 Mbps | 0 s |
| 10 Mbps | 400 ms | 1080p 6.1 Mbps | 30 s | 1080p 4.2 Mbps | 7 s |
| 25 Mbps | 20 ms | 1080p 9.7 Mbps | 0 s | 1080p 9.7 Mbps | 0 s |
| 25 Mbps | 400 ms | 1080p 6.1 Mbps | 30 s | 1080p 9.7 Mbps | 13 s |

Stalls fall from 6 of 8 profiles to 3 of 8, median start from 26 s to 22 s. Two causes in the old code: the 25 MB speed probe
cannot finish under about 13 Mbps, so a slow line read as unknown and nothing was penalised for its bitrate; and the
6.5 s race ended before a distant link had ramped up, so every rival looked alike and the most-seeded one won. What
remains is the engine's request pipeline growing slowly at 400 ms: the right release is picked and starts, then
rebuffers during the ramp. At 2 Mbps the 2.2 Mbps release is chosen over a 1.3 Mbps one that has a very distant
peer (an extra 1 s round trip); a stronger over-the-line penalty was tried and moved that case from a stall to never
starting, so it was dropped. The probe's 13 Mbps limit is modelled, not measured (it needs the Cloudflare endpoint).

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

### Skip markers (`skips`)

Where an intro, a recap or the ending of an episode can be found. AniSkip (anime, by MAL id) and IntroDB (series, by IMDb
id) are community databases of times, 40 titles from each of three popularity bands, three episodes per anime (first,
middle, next to last) and two per series (episode 2 of the first season, episode 3 of the latest).

| source and band | opening / intro | ending / outro | either | titles with any |
|---|---|---|---|---|
| AniSkip, popular | 94% | 89% | 98% | 100% |
| AniSkip, middle | 81% | 79% | 93% | 100% |
| AniSkip, long tail | 29% | 40% | 49% | 73% |
| IntroDB, popular | 63% | 69% | 83% | 90% |
| IntroDB, middle | 39% | 39% | 54% | 58% |
| IntroDB, long tail | 33% | 37% | 41% | 45% |

Both answer in about 50 ms (p95 66 ms and 54 ms) with no errors. An AniSkip opening lasts 88 to 91 s (median 90) and the
ending starts at 0.89 to 0.94 of the episode. IntroDB hits mostly rest on one submission (88%), so they are less
certain than AniSkip's. AniSkip lists recaps for 10% of popular lookups, IntroDB for 26%.

The file itself (`--server`, the 30 gold series and anime episodes through the app, 27 fetched in time): 74% carry
chapters, 59% carry chapters named like an intro, opening, ending or credits ("Opening", "OP", "ED", "Credits",
"Intro"). Anime releases do so far more often (11 of 17) than series releases (4 of 10, mostly "Credits"). The chapters
are in the container header, so they are known as soon as the file is probed.

A time from a database is only right for a video of the length it was recorded on. Of 16 anime with an AniSkip entry, the
recorded length was within 2 s of the file for 63%, within 10 s for 81%; two were 38 and 40 s off. Asking AniSkip at the
file's own length still answered for 94%, so its own tolerance is much wider than what is safe to trust. Reading audio to
find the markers ourselves would cost about 0.3 to 0.45 s of decoding per 5 minutes of audio, which is cheap, but it needs
two episodes of the same show on disk to compare and was not built.

### The app itself (`app --set edge`)

`findSources()` from `src/sources.js` on the 90 hard titles, cold, one at a time.

| kind | titles | with a seeded release | with 20 or more seeders | p50 ms | p95 ms |
|---|---|---|---|---|---|
| movie | 30 | 30 | 30 | 350 | 535 |
| series | 30 | 30 | 28 | 349 | 366 |
| anime | 30 | 30 | 29 | 474 | 850 |

The time includes the tracker scrape of the best fifteen candidates (about 250 ms) and, for anime, the first-use ani.zip
lookup. A second request for the same title is served from the cache in a few milliseconds.

### Subtitle ranking (`subs`)

No subtitle is labelled, so the oracle is leave-one-out. A file X stands for "the file for the release being played" (every
file was uploaded for some release and synced to it). The ranker sees X's release name only. A candidate is acceptable
when it is sound (at least 60% of its siblings' median cue count, reaches 80% of their median end, under 0.5% broken
characters, under 4% sound-effect lines) and 60% or more of its cue starts sit within 0.5 s of X's. Chance agreement is
about 20%. Cases: the four most downloaded sound files of each title and language, against the others of the group.

Snapshot: 5 films (Matrix, Oppenheimer, Dune: Part Two, Parasite, Casablanca) in English, Turkish and Spanish, 14 files each,
216 files, 54 cases. A random pick is acceptable 27% of the time.

| ranker | top-1 acceptable | mean reciprocal rank |
|---|---|---|
| previous score (similarity, downloads, forced) | 22/54 (41%) | 0.58 |
| shipped `scoreSub` | 40/54 (74%) | 0.82 |

Weights fitted by `--grid` and scored with each title left out in turn: 35/54 (65%). Dropping one signal from the fitted
set: release similarity 29/54, hearing-impaired penalty 34/54, film frame rate 36/54, trusted uploader 37/54, rating 37/54.
Downloads add nothing once the release name is compared (41/54 without them); they stay as a small tie-break for a playing release with no name.

Limits: films only (the download host stopped answering after about 220 files, a quota, so series and anime are missing;
`--snapshot` resumes), and the oracle shares the ranker's idea that a similar release name means a similar cut and treats
sound-effect lines as a defect, which is also what the hearing-impaired penalty encodes. The film frame-rate penalty is
untested on TV releases, where 25 fps is common.

### Auto sync (`sync`)

Question: how much audio, in how many windows and from which part of the file does it take to fix a subtitle, and does it
still work when the viewer resumed in the middle and the start of the file was never downloaded?

Two corpora. Synthetic: the cue times of 6 real feature-length subtitle files from `subs.json.gz` drive speech bursts over
a music bed and sound effects (clean, music, action), 36 trials per row. Real: the audio of 3 of the maintainer's own
downloads (one live-action film, two anime episodes), with the film's embedded subtitle track as the subtitle, 18 trials
per row. A trial shifts the subtitle by 0.7 to 25 s, half of them also converted from 23.976 to 25 fps, and the answer is
right when the corrected times are within 0.5 s across the film, wrong when it is off by more with confidence 0.35 or
more (what the player accepts), none when it gives up. The real films are judged against the offset each track measures at
full strength, since a release is never timed to the frame (the live-action track is about 1 s late on its own audio).
"Place" is what is on disk: `start` the first 10 minutes, `resume` 5 minutes around the playhead, `full` everything.

| place | window | windows | real: right / wrong / none | synthetic: right / wrong / none | audio read (real) |
|---|---|---|---|---|---|
| full | 60 s | 3 | 61 / 22 / 17 % | 69 / 3 / 28 % | 290 s |
| full | 90 s | 2 | 100 / 0 / 0 % | 86 / 3 / 11 % | 240 s |
| full | 120 s | 1 | 67 / 0 / 33 % | 72 / 0 / 28 % | 120 s |
| full | 120 s | 2 | 100 / 0 / 0 % | 92 / 0 / 8 % | 280 s |
| full | 120 s | 3 | 100 / 0 / 0 % | 92 / 0 / 8 % | 400 s |
| full | 180 s | 3 (previous) | not run | 92 / 0 / 8 % | 540 s |
| resume | 60 s | 3 | 78 / 6 / 17 % | 64 / 6 / 31 % | 180 s |
| resume | 90 s | 2 | 89 / 0 / 11 % | 67 / 0 / 33 % | 180 s |
| resume | 120 s | 3 | 100 / 0 / 0 % | 78 / 0 / 22 % | 240 s |
| resume | 180 s | 3 | 100 / 0 / 0 % | 83 / 3 / 14 % | 273 s |
| start | 120 s | 3 | 67 / 0 / 33 % | 75 / 0 / 25 % | 360 s |

- Window length: 60 s is unreliable on real audio, 120 s is where the answer stops improving (180 s reads half as much again
  for the same result), so the default went from 180 s to 120 s and a stretch under 90 s is not measured.
- Windows: one is a coin flip on real audio; two agree on the constant cases; three also tell drift and splices apart, so
  three stay.
- Where: the stretch around the playhead works as well as the whole file (100% at 120 s and up on the real films), while the
  first 10 minutes alone give 67% at best (openings and theme songs carry little speech). Before, a resume had nothing to
  read: the start of the file was missing, so the sync waited for a download that never came.
- A defect the real films exposed: with two windows the answer was a straight line through two noisy points (0.4 s apart,
  480 s apart), and extrapolating its slope over the film gave confident answers 1 to 3 s off (33% right at 120 s x 2). Two
  windows that differ by noise are now one constant offset.
- Cost: a sync of three 120 s windows takes 2 to 4 s of low-priority CPU per subtitle on the real films, mostly ffmpeg decoding.

Limits: the synthetic audio is not a film (its music case is the hard one and causes most of the 'none' answers), the real
set is three films, so a row moves by 6 points per trial, and the real files are not in the repository: pass your own with
`--media`. Dubbed audio against the original-language subtitle still correlates, as the two anime show.

### Auto sync while the download grows (`sync --grow`)

Question: what does it cost to answer sooner? A file is read at 2, 3, 4, 5, 7, 10 and 15 minutes of readable audio (the viewer is
at 1:40), once by the previous pass (all or nothing, run again from scratch each time) and once by the incremental pass
(windows measured earlier are kept, only unseen stretches are read, candidate windows overlap by half). Offsets are
realistic: 40% within 0.3 s, 30% up to 4 s, 30% up to 25 s; half of the trials are also 23.976 to 25 fps. An answer is right
when the subtitle is within 0.5 s from the playhead to five minutes ahead (a rough answer cannot know about drift further on).
A second set of trials pairs the audio with another episode's subtitle, where any answer is wrong.

| readable | synthetic, previous right / wrong | synthetic, incremental right / wrong | audio read per pass, previous / incremental |
|---|---|---|---|
| 3 min | 75 / 0 % | 72 / 0 % | 180 s / 90 s |
| 4 min | 67 / 8 % | 67 / 6 % | 218 s / 27 s |
| 5 min | 72 / 3 % | 75 / 0 % | 240 s / 120 s |
| 7 min | 67 / 6 % | 78 / 3 % | 360 s / 153 s |
| 10 min | 81 / 0 % | 83 / 0 % | 360 s / 153 s |
| 15 min | 78 / 0 % | 86 / 0 % | 360 s / 240 s |

- Carrying the evidence gives 8 to 11 points more right answers once 7 to 15 minutes are readable, and reads a third to almost nine tenths less audio
  per pass, because a pass only measures what the last one did not.
- On two real films (12 trials) it ends better (75 / 0 % against 50 / 25 % at 15 minutes) but is worse between 4 and 5 minutes
  (0 to 25 % right against 25 to 50 %), so the early minutes are not faster on real audio.
- A subtitle for another episode still gets an answer about a quarter of the time at 2 to 4 minutes readable, falling to under
  10% at 10 minutes, with or without the change: one weak window is not enough to tell "wrong episode" from "weak speech". The
  menu now says "Does not match this video" when nothing lined up.
- Tried and removed: answering from one weak window (acceptable up to 3 or 12 s of offset) while waiting for more. On synthetic
  audio it added 5 to 9 points of right answers at 2 to 5 minutes and cost 3 to 5 points of wrong answers and 5 to 14 points more
  false answers for another episode's subtitle; on real films it added nothing. An in-step subtitle is already right with no
  answer, so the rough answer only helps the out-of-step ones, and those are the ones noise hurts.

### Auto sync with the video's built-in track (`sync --grow --track`)

Question: does a text track built into the video help? Its cue times are timed to the audio, so measuring the downloaded subtitle
against them needs no audio decoding. Same trials as above, except that the downloaded subtitle and the built-in track are the
same speech cut differently (edges moved up to 0.25 s, 4% of cues dropped, 4% split in two), and the track is readable for the
first 85% of the readable part, up to 8 minutes.

| readable | synthetic, audio only right / wrong | synthetic, audio and track right / wrong | real films, audio only | real films, audio and track |
|---|---|---|---|---|
| 3 min | 64 / 0 % | 100 / 0 % | 0 / 0 % | 100 / 0 % |
| 4 min | 64 / 6 % | 97 / 3 % | 25 / 17 % | 100 / 0 % |
| 5 min | 75 / 0 % | 97 / 3 % | 33 / 8 % | 100 / 0 % |
| 7 min | 72 / 6 % | 97 / 3 % | 67 / 8 % | 100 / 0 % |
| 10 min | 78 / 0 % | 97 / 3 % | 50 / 8 % | 100 / 0 % |
| 15 min | 83 / 0 % | 97 / 3 % | 67 / 17 % | 100 / 0 % |

- From 3 minutes readable the answer is right in 97 to 100% of the trials, in the music and action mixes that defeat the audio
  alone (33% right at 5 minutes in the music mix, 92% with the track).
- A subtitle for another episode gets no answer at all from 3 minutes on (audio alone: 8% to 22% false answers): against the track
  the right subtitle peaks at 0.65 or more and another episode's at 0.45 or less, so the track is judged on that peak, and a
  track that covers minutes without a lock stops a lone weak audio window from being trusted.
- Before 2 minutes of the track are readable it changes nothing, and a video without a text track (picture subtitles do not
  count) gets the audio result. In the maintainer's library about 4 in 10 readable files had one.
- The pairs differ from real life in one way that matters: a real downloaded subtitle can be cut or timed further from the
  release's own track than 0.25 s, which lowers the peak. The thresholds have room (0.55 against 0.65 and 0.45), but the
  figures above are the favourable end.

### Not pursued

- AnimeTosho lists extracted subtitle tracks (14 to 22 languages on recent releases), but the attachment host redirects
  to `storage.animetosho.org`, which does not resolve, in a browser as well. Embedded tracks stay the anime subtitle path.
- OpenSubtitles hash-exact lookup was not tested: the addon route with `videoHash` answered an error.
