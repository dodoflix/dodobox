import test from 'node:test'
import assert from 'node:assert/strict'
import { matchRelease, isPack, isEpisode, seasonOf, titleVerdict, hasWords, pickFile, parse } from '../src/release.js'

const anime = (name, episode, extra = {}) => matchRelease({ name }, { kind: 'anime', episode, ...extra }, { noTitle: true })
const series = (name, season, episode) => matchRelease({ name }, { kind: 'series', season, episode }, { noTitle: true })

test('anime episode matching', () => {
  assert.ok(anime('[GroupA] Sousou no Frieren - 03 (1080p) [7EF3F175].mkv', 3))
  assert.ok(anime('[GroupB] Show 2nd Season - 03 [1080p][ENG]', 3))
  assert.ok(anime('[Group] Show - 03v2 [720p]', 3))
  assert.ok(!anime('[GroupA] Show - 13 (1080p)', 3))
  assert.ok(!anime('[GroupA] Show - 30 (1080p)', 3))
  assert.ok(!anime('[Group] Show - 05 [1080p]', 8))
  assert.ok(anime('[Group] Show (01-12) [1080p] Batch', 7))
  assert.ok(!anime('[Group] Show (01-12) [1080p]', 14))
})

test('series episode matching', () => {
  assert.ok(series('Breaking.Bad.S01E02.720p', 1, 2))
  assert.ok(series('Breaking Bad 1x02', 1, 2))
  assert.ok(!series('Breaking.Bad.S01E12.720p', 1, 2))
  assert.ok(!series('Breaking.Bad.S10E02', 1, 2))
  assert.ok(series('Show.S01.COMPLETE.1080p', 1, 7), 'a season pack holds the episode')
  assert.ok(!series('Show.S02.COMPLETE.1080p', 1, 7), 'but another season does not')
  assert.ok(series('Show.S01E01-E04.1080p', 1, 3), 'multi-episode files and ranges')
})

test('season detection', () => {
  assert.equal(seasonOf('[GroupA] Sousou no Frieren S2 - 03'), 2)
  assert.equal(seasonOf('Show 2nd Season - 03'), 2)
  assert.equal(seasonOf('Show Season 3'), 3)
  assert.equal(seasonOf('[Group] Show - 03 [1080p]'), 1)
})

test('packs are told apart from single episodes', () => {
  assert.equal(isPack('[GroupB] Tantei wa Mou, Shindeiru Season 2 - 01 [1080p CR WEB-DL AVC AAC]'), false)
  assert.equal(isPack('[GroupE] The Detective Is Already Dead (2021) (Season 1) [BDRip] [1080p]'), true)
  assert.equal(isPack('[Group] Show (01-12) [1080p] Batch'), true)
  assert.equal(isPack('[GroupA] Show - 03 (1080p) [ABCD1234].mkv'), false)
  assert.equal(isPack('[Lia] One Piece - 0001-1000 [WEB 1080p] [BATCH]'), true)
})

test('a release is the title, not a longer title containing it', () => {
  const is = (name, title, year) => matchRelease({ name }, { kind: 'series', title, season: 1, episode: 2, year })
  assert.ok(matchRelease({ name: 'The.Prince.S01.COMPLETE.720p.HMAX.WEBRip' }, { kind: 'series', title: 'The Prince', season: 1, episode: 2 }))
  assert.ok(is('Prince S01E02 1080p', 'The Prince'))
  assert.ok(is('[Grp] The Prince (2023) S01E01-E03 1080p', 'The Prince'))
  assert.ok(is('1883.S01E02.720p', '1883'))
  for (const n of ['The.Dragon.Prince.S01E02.1080p', 'The Fresh Prince Of Bel-Air S01E02', 'The.Prince.of.Tennis.S01E02', 'Andrew The Problem Prince 2023 S01E02']) assert.ok(!is(n, 'The Prince'), n)
})

test('movies: the title and the year both have to fit', () => {
  const movie = (name, opt) => matchRelease({ name }, { kind: 'movie', title: 'The Matrix', year: 1999 }, opt)
  assert.ok(movie('The.Matrix.1999.1080p'))
  assert.ok(!movie('Matrix.Reloaded.2003'))
  assert.ok(!movie('The.Matrix.Resurrections.2021.1080p'))
  assert.ok(!movie('The.Matrix.2003.1080p'), 'another year')
  assert.ok(movie('The.Matrix.1080p'))
  assert.ok(!movie('The.Matrix.1080p', { requireYear: true }), 'a text search must find the year')
  assert.ok(hasWords('The.Matrix.1999.1080p', 'The Matrix'))
  assert.ok(!hasWords('Matrix.Reloaded', 'The Matrix'))
})

test('anime releases of a different show are rejected even when the title and episode number match', () => {
  const titles = ['ONE PIECE']
  assert.equal(titleVerdict('[GroupA] One Piece Log - Fish-Man Island Saga - 01 (1080p) [7FC26310].mkv', titles), 'other')
  assert.equal(titleVerdict('[GroupA] One Piece Fan Letter - 01 (1080p).mkv', titles), 'other')
  assert.equal(titleVerdict('[GroupC] One Piece - 01 [1080p].mkv', titles), 'same')
  assert.equal(titleVerdict('[GroupB] One Piece - 1000 [1080p][Multiple Subtitle].mkv', titles), 'same')
  assert.equal(titleVerdict('[GroupD] One Piece (1999) - S01E01.mkv', titles), 'same')
  // later seasons and parts keep working, and unfamiliar naming is left to the search
  assert.equal(titleVerdict('[GroupA] 86 - Eighty Six (Part 2) - 03 (1080p).mkv', ['86 EIGHTY-SIX Part 2', '86: Eighty Six Part 2']), 'same')
  // ... but the later part is not the first one
  assert.equal(titleVerdict('[GroupB] 86 Eighty-Six Part 2 - 01 [1080p]', ['86 EIGHTY-SIX', '86: Eighty Six']), 'other')
  assert.equal(titleVerdict('[GroupB] 86 Eighty-Six - 02 [1080p]', ['86 EIGHTY-SIX', '86: Eighty Six']), 'same')
  assert.equal(titleVerdict('[Group] Some Show Season 1 - 02', ['Some Show']), 'same')
  assert.equal(titleVerdict('[GroupA] Re Zero kara Hajimeru Isekai Seikatsu - 01.mkv', ['Re:ZERO -Starting Life in Another World-']), 'unknown')
  assert.equal(titleVerdict('[GroupA] Sword Art Online Alternative - Gun Gale Online - 01.mkv', ['Sword Art Online']), 'other')
  assert.equal(titleVerdict('[Xera] Koisuru One Piece - 01 (1080p) [FDD755D9]', titles), 'other')
})

test('anime batches with four-digit ranges only count for episodes inside them', () => {
  assert.equal(anime('[GroupB] One Piece - 0892 ~ 1089 [1080p][BATCH][Multiple Subtitle]', 1), false)
  assert.equal(anime('[GroupB] One Piece - 0892 ~ 1089 [1080p][BATCH][Multiple Subtitle]', 1000), true)
  assert.equal(anime('[Lia] One Piece - 0001-1000 [WEB 1080p] [BATCH]', 1), true)
})

test('season-style episode ranges (S01E01-16) are ranges too', () => {
  const n = '[ToonsHub] One Piece S01E01-16 1080p NF WEB-DL MULTi AAC2.0 H.264 (REMASTERED, Multi-Audio, Complete)'
  assert.equal(anime(n, 100), false)
  assert.equal(anime(n, 12), true)
})

test('anime released under several numberings: local, TVDB season and absolute', () => {
  const frieren2 = { tvdbSeason: 2, tvdbEpisode: 3, abs: 31 }
  assert.ok(anime('[Judas] Sousou no Frieren - S02E03.mkv', 3, frieren2))
  assert.ok(anime('[9volt] Sousou no Frieren - 31 (S02E03) (WEB 1080p)', 3, frieren2))
  assert.ok(anime('[Group] Sousou no Frieren - 31 [1080p]', 3, frieren2), 'absolute number')
  assert.ok(!anime('[Group] Sousou no Frieren - 03 [1080p]', 3, frieren2), 'season 1 episode 3 is not season 2 episode 3')
  assert.ok(!anime('[Group] Sousou no Frieren S1 - 05 [1080p]', 3, frieren2))
  assert.ok(anime('Attack on Titan (Shingeki no Kyojin) The Final Season - 08 (67)', 8, { tvdbSeason: 4, tvdbEpisode: 8, abs: 67 }))
})

test('extras share a show\'s name and numbers but are not its episodes', () => {
  const t = { kind: 'anime', title: 'Show', titles: ['Show'], episode: 3 }
  assert.ok(matchRelease({ name: '[G] Show - 03 [1080p].mkv' }, t))
  for (const n of ['[G] Show - NCOP03.mkv', '[G] Show - SP03 [1080p].mkv', '[G] Show - Recap 03.mkv', '[G] Show - OVA 03.mkv']) assert.ok(!matchRelease({ name: n }, t), n)
})

test('subtitle files named after the episode', () => {
  assert.ok(isEpisode('Show.S01E02.en.srt', { type: 'series', season: 1, episode: 2 }))
  assert.ok(!isEpisode('Show.S01E03.en.srt', { type: 'series', season: 1, episode: 2 }))
  assert.ok(!isEpisode('Show.S01E01-07.1080p', { type: 'series', season: 1, episode: 2 }), 'a range is a pack')
  assert.ok(isEpisode('[G] Show - 02.eng.ass', { type: 'anime', episode: 2 }))
  assert.ok(!isEpisode('[G] Show - 12.eng.ass', { type: 'anime', episode: 2 }))
})

test('file picking inside torrents', () => {
  const files = [
    { name: 'Show/Show.S01E01.mkv', length: 300 }, { name: 'Show/Show.S01E02.mkv', length: 310 },
    { name: 'Show/Sample/sample.mkv', length: 5 }, { name: 'Show/readme.txt', length: 1 }
  ]
  assert.equal(pickFile(files, { type: 'series', season: 1, episode: 2 }), 1)
  assert.equal(pickFile(files, { type: 'series', season: 1, episode: 9 }), -1)
  assert.equal(pickFile(files, { type: 'series', season: 1, episode: 9, fileIdx: 0 }), 0)
  assert.equal(pickFile(files, { type: 'movie' }), 1)
  assert.equal(pickFile([{ name: 'a.mkv', length: 1 }], { type: 'series', season: 1, episode: 4 }), 0)
  assert.equal(pickFile([{ name: 'x.txt', length: 1 }], { type: 'movie' }), -1)
})

test('file picking in anime packs follows the pack\'s own numbering and skips extras', () => {
  const file = (name, length = 100) => ({ name, length })
  const local = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map(n => file(`[Erai-raws] Kaguya 3 - ${n} [1080p].mkv`))
  assert.equal(pickFile(local, { type: 'anime', episode: 4 }), 3, 'not "- 10", which a loose digit match would find')
  const extras = [file('[DB]86 Part 2_-_NCED13_(10bit).mkv', 900), file('[DB]86 Part 2_-_NCOP01_(10bit).mkv', 900), file('[DB]86 Part 2_-_02_(10bit).mkv')]
  assert.equal(pickFile(extras, { type: 'anime', episode: 2 }), 2)
  const lateRange = Array.from({ length: 12 }, (_, i) => file(`Naruto Shippuden - ${274 + i} - Title.mkv`))
  assert.equal(pickFile(lateRange, { type: 'anime', episode: 5 }), -1, 'the pack does not hold episode 5')
  assert.equal(pickFile(lateRange, { type: 'anime', episode: 5, fileIdx: 3 }), 3, 'unless the source says which file')
  const absolute = Array.from({ length: 12 }, (_, i) => file(`[G] Show - ${25 + i} [1080p].mkv`))
  assert.equal(pickFile(absolute, { type: 'anime', episode: 3, abs: 27 }), 2, 'a pack numbered 25 to 36 holds absolute numbers')
  const bySeason = [file('Show - S02E01.mkv'), file('Show - S02E02.mkv'), file('Show - S01E02.mkv')]
  assert.equal(pickFile(bySeason, { type: 'anime', episode: 2, tvdbSeason: 2, tvdbEpisode: 2 }), 1)
})

test('a name is parsed once and the result is shared', () => {
  assert.equal(parse('[G] Show - 03 [1080p].mkv'), parse('[G] Show - 03 [1080p].mkv'))
})
