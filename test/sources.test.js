import test from 'node:test'
import assert from 'node:assert/strict'
import { findSources, runTiers } from '../src/sources.js'

const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const HASH = n => String(n).padStart(40, '0')
const stream = (n, name, size = '1.4 GB') => ({ name: 'Torrentio\n1080p', title: `${name}\n👤 50 💾 ${size} ⚙️ TestHost`, infoHash: HASH(n) })

// Stubs the network: `torrentio` is what Torrentio answers, the rest answers text searches. Returns the requested hosts.
function stub (torrentio, { tpb = [], knaben = [] } = {}) {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async url => {
    const u = new URL(url); calls.push(u.hostname)
    if (u.hostname === 'torrentio.strem.fun') return json({ streams: torrentio })
    if (u.hostname === 'apibay.org') return json(tpb)
    if (u.hostname === 'api.knaben.org') return json({ hits: knaben })
    if (u.hostname === 'movies-api.accel.li') return json({ data: { movies: [] } })
    return new Response('not stubbed', { status: 404 })
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}

test('movies: a healthy id-keyed answer is enough, and stray files in it are dropped', async () => {
  const net = stub([
    stream(1, 'The.Stub.Movie.2001.1080p.BluRay.x264'), stream(2, 'The.Stub.Movie.2001.720p.WEB'), stream(3, 'The Stub Movie 2001 2160p'),
    stream(4, '2019-10-30_Stub Costume Haul_1.m4v', '40 MB'), stream(5, 'The.Stub.Movie.1975.1080p')
  ])
  try {
    const list = await findSources({ type: 'movie', id: 'tt9000001', title: 'The Stub Movie', year: 2001 })
    assert.deepEqual(new Set(net.calls), new Set(['torrentio.strem.fun']), 'no text search when the first tier is healthy')
    assert.deepEqual(list.map(r => r.infoHash).sort(), [HASH(1), HASH(2), HASH(3)])
  } finally { net.restore() }
})

test('series: text searches for the episode, the season and the whole series run only when the id-keyed source is thin', async () => {
  const pack = (n, name, seeders) => ({ name, seeders: String(seeders), info_hash: HASH(n), size: '9000000000' })
  const net = stub([], {
    tpb: [pack(10, 'Stub.Show.S02.COMPLETE.1080p', 40), pack(11, 'Stub.Show.S01E05.1080p', 30), pack(12, 'Other.Show.S02E03.1080p', 90)],
    knaben: [{ title: 'Stub Show Complete Series 1080p', hash: HASH(13), seeders: 25, bytes: 5e10 }]
  })
  try {
    const list = await findSources({ type: 'series', id: 'tt9000002', title: 'Stub Show', season: 2, episode: 3 })
    assert.ok(net.calls.includes('apibay.org') && net.calls.includes('api.knaben.org'))
    assert.equal(net.calls.filter(h => h === 'apibay.org').length, 3, 'episode, season and complete queries')
    assert.deepEqual(list.map(r => r.infoHash).sort(), [HASH(10), HASH(13)], 'another episode and another show are dropped')
    assert.ok(list.every(r => r.pack), 'both are packs, so the engine picks the file')
  } finally { net.restore() }
})

const row = (n, seeders = 30) => ({ title: `Stub.Show.S01E01.${n}`, release: `Stub.Show.S01E01.${n}`, infoHash: HASH(n), seeders, size: 1e9, quality: 1080 })
const later = (ms, rows) => new Promise(resolve => setTimeout(() => resolve(rows), ms))
const laterFail = ms => new Promise((_, reject) => setTimeout(() => reject(new Error('429')), ms))

test('lookup: a healthy primary returns at the deadline, slow tier-mates top up afterwards', async () => {
  let searched = false
  const t0 = Date.now()
  const r = await runTiers({ first: [later(20, [row(1), row(2), row(3)]), later(1500, [row(4)])], fallback: () => { searched = true; return [] } }, { deadline: 200 })
  assert.ok(Date.now() - t0 < 600, 'does not wait for the slow source')
  assert.equal(r.rows.length, 3)
  assert.equal(searched, false)
  assert.equal((await r.done).length, 4, 'the late row is delivered through done')
})

test('lookup: a failing primary starts the name searches at once, not after the slow tier-mates', async () => {
  const started = []
  const t0 = Date.now()
  const r = await runTiers({
    first: [laterFail(10), later(1500, [row(4)])],
    fallback: () => { started.push(Date.now() - t0); return [later(30, [row(5), row(6), row(7)])] }
  }, { deadline: 200, cap: 400 })
  assert.ok(started[0] < 200, `fallback started after ${started[0]} ms`)
  assert.equal(r.failed, true)
  assert.ok(r.rows.length >= 3 && Date.now() - t0 < 900, 'returns at the cap with what the searches found')
})
