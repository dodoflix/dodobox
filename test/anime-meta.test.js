import test from 'node:test'
import assert from 'node:assert/strict'
import { aniItem } from '../src/meta.js'

const entry = extra => ({ id: 1, title: { romaji: 'Show', english: 'Show' }, coverImage: { extraLarge: '' }, format: 'TV', episodes: 12, status: 'RELEASING', ...extra })

test('a running anime lists only the episodes that have aired', () => {
  assert.equal(aniItem(entry({ nextAiringEpisode: { episode: 2 } })).videos.length, 1, 'episode 2 airs next, so one is out')
  assert.equal(aniItem(entry({ nextAiringEpisode: { episode: 8 } })).videos.length, 7)
})

test('a finished anime lists its whole run, an unaired one nothing', () => {
  assert.equal(aniItem(entry({ status: 'FINISHED', nextAiringEpisode: null })).videos.length, 12)
  assert.equal(aniItem(entry({ status: 'NOT_YET_RELEASED', nextAiringEpisode: { episode: 1 } })).videos.length, 0)
  assert.equal(aniItem(entry({ episodes: null, nextAiringEpisode: null })).videos.length, 0, 'no count and no schedule')
})
