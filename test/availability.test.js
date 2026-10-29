import test from 'node:test'
import assert from 'node:assert/strict'
import { aniItem, cineItem } from '../src/meta.js'

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

test('cancelled and unreleased titles have nothing to play', () => {
  assert.equal(aniItem(entry({ status: 'CANCELLED', format: 'MOVIE', episodes: 1, nextAiringEpisode: null })).unplayable, 'Cancelled')
  assert.equal(aniItem(entry({ status: 'NOT_YET_RELEASED', nextAiringEpisode: null, episodes: null })).unplayable, 'Not released yet')
  assert.equal(aniItem(entry({ status: 'RELEASING', nextAiringEpisode: { episode: 1 } })).unplayable, 'Not released yet', 'running but nothing aired')
  assert.equal(aniItem(entry({ status: 'RELEASING', nextAiringEpisode: { episode: 3 } })).unplayable, null)
  assert.equal(aniItem(entry({ status: 'FINISHED', nextAiringEpisode: null })).unplayable, null)
})

test('a movie dated in the future is not playable, a released one is', () => {
  const future = new Date(Date.now() + 90 * 864e5).toISOString()
  assert.equal(cineItem({ id: 'tt1', name: 'Soon', released: future, year: String(new Date(future).getFullYear()) }, 'movie').unplayable, 'Not released yet')
  assert.equal(cineItem({ id: 'tt2', name: 'Old', released: '2001-05-05T00:00:00.000Z', year: '2001' }, 'movie').unplayable, null)
  assert.equal(cineItem({ id: 'tt3', name: 'Show', released: future, year: '2030' }, 'series').unplayable, null, 'series are judged by their episodes')
})

test('a catalog runtime with junk beside the number shows as plain minutes', () => {
  const run = runtime => cineItem({ id: 'tt1', name: 'Show', runtime }, 'series').runtime
  assert.equal(run('32S min'), '32 min')
  assert.equal(run('45 min'), '45 min')
  assert.equal(run('1h 30min'), '1h 30min')
  assert.equal(run('soon'), null)
  assert.equal(run(undefined), null)
})

test('a value built while a source failed is kept for a minute, not for hours', async () => {
  const { cached, markPartial } = await import('../src/meta.js')
  const { mock } = await import('node:test')
  mock.timers.enable({ apis: ['Date'], now: Date.now() })
  try {
    let calls = 0
    const ask = () => cached('test:partial-value', 12 * 3600e3, async () => { calls++; return calls === 1 ? markPartial([1]) : [1, 2] })
    assert.deepEqual(await ask(), [1])
    assert.deepEqual(await ask(), [1], 'asked again at once: served from the cache')
    assert.equal(calls, 1)
    mock.timers.tick(61e3)
    assert.deepEqual(await ask(), [1, 2], 'a minute later it is asked for again')
    mock.timers.tick(3600e3)
    assert.deepEqual(await ask(), [1, 2], 'a complete value stays')
    assert.equal(calls, 2)
  } finally { mock.timers.reset() }
})
