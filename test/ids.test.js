import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceFribb } from '../src/ids.js'

test('the Fribb list is reduced to the ids playback needs', () => {
  const map = reduceFribb([
    { anilist_id: 154587, kitsu_id: 46474, anidb_id: 17617, imdb_id: ['tt22248376'], tvdb_id: 424536, season: { tvdb: 1, tmdb: 1 }, mal_id: 52991 },
    { anilist_id: 182255, kitsu_id: 49240, anidb_id: 18886, imdb_id: ['tt22248376'], tvdb_id: 424536, season: { tvdb: 2, tmdb: 1 } },
    { anilist_id: 99, kitsu_id: 1, imdb_id: 'tt1', season: {} },
    { kitsu_id: 5, anidb_id: 5 }
  ])
  assert.deepEqual(map[182255], { kitsu: 49240, anidb: 18886, imdb: 'tt22248376', tvdb: 424536, tvdbSeason: 2 })
  assert.equal(map[154587].tvdbSeason, 1)
  assert.deepEqual(map[99], { kitsu: 1, anidb: null, imdb: 'tt1', tvdb: null, tvdbSeason: null })
  assert.equal(Object.keys(map).length, 3, 'entries without an AniList id are left out')
})
