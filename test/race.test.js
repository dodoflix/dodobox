import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('race')
process.env.DATA_DIR = tmp
process.env.NO_DHT = '1'
const { race, rivalsOf, racing } = await import('../src/race.js')
const { measured } = await import('../src/sources.js')
const engine = await import('../src/engine.js')

const row = (h, over = {}) => ({ infoHash: h.repeat(40).slice(0, 40), size: 4e9, seeders: 100, title: `Movie 1080p ${h}`, ...over })
const A = row('a'); const B = row('b')
const ctx = { mbps: 5, runtimeMin: 110 }

// status timelines: f(secondsSinceStart) -> { speed, downloaded, phase }
// A version is in the library before the race when it is listed in `existing`; the others appear when the race starts them.
function run (t, rivals, lines, c = ctx, existing = [], pinned = []) {
  t.mock.timers.enable({ apis: ['Date'], now: 0 })
  const removed = []; const discarded = []; const started = new Set(existing)
  const status = h => (started.has(h) ? { ...lines[h](Date.now() / 1000), pinned: pinned.includes(h) } : null)
  const wait = async ms => t.mock.timers.tick(ms)
  return race(rivals, r => started.add(r.infoHash), c, { status, remove: async h => { removed.push(h) }, discard: (h, x, p) => { discarded.push([h, x, p]) }, wait }).then(winner => ({ winner, removed, discarded, ms: Date.now() }))
}

test('metadata-less rival is not remembered as slow and loses', async t => {
  measured.clear()
  const r = await run(t, [A, B], {
    [A.infoHash]: () => ({ speed: 0, downloaded: 0, phase: 'metadata' }),
    [B.infoHash]: s => ({ speed: 300e3, downloaded: 300e3 * s, phase: 'downloading' })
  })
  assert.equal(r.winner, B)
  assert.equal(measured.has(A.infoHash), false)
  assert.equal(measured.get(B.infoHash).bps, 300e3)
  assert.deepEqual(r.removed, [A.infoHash])
})

test('rivals still climbing are given time to separate on a distant link', async t => {
  measured.clear()
  // both look alike for 10 s, then B keeps climbing while A flattens at 100 kB/s
  const a = s => ({ speed: Math.min(100e3, 10e3 * 1.3 ** s), downloaded: 0, phase: 'downloading' })
  const b = s => ({ speed: Math.min(2e6, 10e3 * 1.3 ** s), downloaded: 0, phase: 'downloading' })
  const r = await run(t, [A, B], { [A.infoHash]: a, [B.infoHash]: b })
  assert.equal(r.winner, B)
  assert.ok(r.ms > 6500, `kept racing past the base window: ${r.ms}`)
  assert.ok(r.ms <= 20000)
})

test('nobody fast: the best of a slow lot is chosen at the deadline', async t => {
  const r = await run(t, [A, B], {
    [A.infoHash]: () => ({ speed: 40e3, downloaded: 80e3, phase: 'downloading' }),
    [B.infoHash]: () => ({ speed: 90e3, downloaded: 200e3, phase: 'downloading' })
  })
  assert.equal(r.winner, B)
})

test('only two race on a slow line', () => {
  const list = ['a', 'b', 'c'].map(h => row(h))
  assert.equal(rivalsOf(list, list[0], { mbps: 5 }).length, 2)
  assert.equal(rivalsOf(list, list[0], { mbps: 50 }).length, 3)
})

test('rivals are listed as racing only while the race runs', async t => {
  measured.clear()
  const seen = []
  const r = await run(t, [A, B], {
    [A.infoHash]: s => { seen.push(racing.has(A.infoHash)); return { speed: 2e6, downloaded: s * 2e6, phase: 'downloading' } },
    [B.infoHash]: () => ({ speed: 0, downloaded: 0, phase: 'metadata' })
  })
  assert.ok(seen.length && seen.every(Boolean))
  assert.equal(racing.size, 0)
  assert.equal(r.winner, A)
})

test('a losing version that was already in the library only loses the row the race added', async t => {
  measured.clear()
  const c = { ...ctx, season: 1, episode: 2 }
  const r = await run(t, [A, B], {
    [A.infoHash]: () => ({ speed: 0, downloaded: 0, phase: 'downloading' }),
    [B.infoHash]: s => ({ speed: 2e6, downloaded: s * 2e6, phase: 'downloading' })
  }, c, [A.infoHash])
  assert.equal(r.winner, B)
  assert.deepEqual(r.removed, [], 'the pack is not removed')
  assert.deepEqual(r.discarded, [[A.infoHash, c, false]], 'the pack was not pinned before, so the race gives the pin back')
})

test('a losing pinned version is discarded as pinned', async t => {
  measured.clear()
  const c = { ...ctx, season: 1, episode: 2 }
  const r = await run(t, [A, B], {
    [A.infoHash]: () => ({ speed: 0, downloaded: 0, phase: 'downloading' }),
    [B.infoHash]: s => ({ speed: 2e6, downloaded: s * 2e6, phase: 'downloading' })
  }, c, [A.infoHash], [A.infoHash])
  assert.deepEqual(r.discarded, [[A.infoHash, c, true]])
})

test.after(async () => { await engine.shutdown(); fs.rmSync(tmp, { recursive: true, force: true }) })
