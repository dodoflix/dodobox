// Library rows of the torrent engine against a local seeder: removal, folders, failed rows. No internet.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import WebTorrent from 'webtorrent'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('engine-library')
const data = path.join(tmp, 'data')
Object.assign(process.env, { DATA_DIR: data, NO_DHT: '1' })

let seeder; let engine
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)) } }
const ctx = (episode, id = 'tt1') => ({ type: 'series', id, title: 'Show', season: 1, episode })
const seed = (parent, name, files) => {
  const dir = path.join(tmp, parent, name); fs.mkdirSync(dir, { recursive: true })
  for (const f of files) fs.writeFileSync(path.join(dir, f), crypto.randomBytes(300e3))
  return new Promise(r => seeder.seed(dir, { announce: [] }, t => r({ hash: t.infoHash, magnet: `magnet:?xt=urn:btih:${t.infoHash}&x.pe=127.0.0.1:${seeder.address().port}` })))
}
const done = (hash, file) => until(() => { const s = engine.status(hash, true, file); return s?.phase === 'done' && s })

let pack; let legacy
before(async () => {
  seeder = new WebTorrent({ dht: false, lsd: false, utp: false })
  pack = await seed('p', 'Show.S01.pack', ['Show.S01E01.mkv', 'Show.S01E02.mkv'])
  legacy = await seed('l', 'Old.Show.S01E01', ['Old.Show.S01E01.mkv'])
  // A library written before torrents had folders of their own: its files sit directly in downloads/.
  fs.mkdirSync(path.join(data, 'downloads'), { recursive: true })
  fs.writeFileSync(path.join(data, 'library.json'), JSON.stringify({ [legacy.hash]: { hash: legacy.hash, magnet: legacy.magnet, ctx: ctx(1, 'tt0'), added: 1 } }))
  engine = await import('../src/engine.js')
})
after(async () => { await engine.shutdown(); await new Promise(r => seeder.destroy(r)); fs.rmSync(tmp, { recursive: true, force: true }) })

test('a library entry from before per-torrent folders keeps downloading into the shared folder', async () => {
  const st = await done(legacy.hash)
  assert.equal(engine.filePath(legacy.hash, st.fileIdx), path.join(data, 'downloads', 'Old.Show.S01E01', 'Old.Show.S01E01.mkv'))
  assert.equal(await engine.remove(legacy.hash), true)
  assert.equal(fs.existsSync(path.join(data, 'downloads', 'Old.Show.S01E01')), false)
})

test('two torrents with a same-named file keep separate copies, and removing one leaves the other', async () => {
  const a = await seed('x', 'Same.Release', ['Same.mkv'])
  const b = await seed('y', 'Same.Release', ['Same.mkv'])
  assert.notEqual(a.hash, b.hash)
  engine.add({ hash: a.hash, magnet: a.magnet, ctx: ctx(1, 'tt-a'), pinned: true })
  engine.add({ hash: b.hash, magnet: b.magnet, ctx: ctx(1, 'tt-b'), pinned: true })
  const [sa, sb] = [await done(a.hash), await done(b.hash)]
  const [fa, fb] = [engine.filePath(a.hash, sa.fileIdx), engine.filePath(b.hash, sb.fileIdx)]
  assert.notEqual(fa, fb)
  const keep = fs.readFileSync(fb)
  assert.equal(await engine.remove(a.hash), true)
  assert.equal(fs.existsSync(fa), false)
  assert.deepEqual(fs.readFileSync(fb), keep)
  assert.equal(fs.existsSync(path.dirname(path.dirname(fa))), false, 'the removed torrent leaves no folder behind')
  await engine.remove(b.hash)
})

test('removing the same torrent twice at once finishes both calls', async () => {
  const s = await seed('r', 'Twice.Release', ['Twice.mkv'])
  engine.add({ hash: s.hash, magnet: s.magnet, ctx: ctx(1, 'tt-r') })
  await done(s.hash)
  const both = await Promise.race([Promise.all([engine.remove(s.hash), engine.remove(s.hash)]), new Promise((_, no) => setTimeout(() => no(new Error('a removal never finished')), 10000))])
  assert.deepEqual(both, [true, true])
  assert.equal(engine.status(s.hash, true), null)
  assert.equal(await engine.remove(s.hash), false)
})

test('a rejected main file fails only its own row, and removing it promotes a healthy episode', async () => {
  engine.add({ hash: pack.hash, magnet: pack.magnet, ctx: ctx(1), pinned: true })
  engine.add({ hash: pack.hash, magnet: pack.magnet, ctx: ctx(2), pinned: true })
  const rows = await until(() => { const r = engine.library().filter(x => x.hash === pack.hash); return r.length === 2 && r.every(x => x.phase === 'done') && r })
  const [one, two] = [rows.find(r => r.ctx.episode === 1), rows.find(r => r.ctx.episode === 2)]
  engine.reject(pack.hash, one.fileIdx, 'This video is a different title')
  assert.equal(engine.status(pack.hash, true, one.fileIdx).phase, 'error')
  assert.equal(engine.status(pack.hash, true, two.fileIdx).phase, 'done')
  assert.equal(engine.status(pack.hash, true, two.fileIdx).error, undefined)
  assert.deepEqual(engine.findEntry(ctx(2)), { hash: pack.hash, file: two.fileIdx })
  assert.equal(engine.findEntry(ctx(1)), null)
  assert.equal(await engine.remove(pack.hash, one.fileIdx), true)
  const left = engine.library().filter(x => x.hash === pack.hash)
  assert.equal(left.length, 1)
  assert.equal(left[0].phase, 'done', 'the promoted episode does not inherit the failure')
  assert.equal(left[0].ctx.episode, 2)
  assert.deepEqual(engine.findEntry(ctx(2)), { hash: pack.hash, file: two.fileIdx })
})

test('an episode the pack does not contain is listed as failed and is not offered again', async () => {
  engine.add({ hash: pack.hash, magnet: pack.magnet, ctx: ctx(9), pinned: true })
  const row = await until(() => engine.library().find(x => x.hash === pack.hash && x.ctx.episode === 9))
  assert.equal(row.phase, 'error')
  assert.equal(row.error, 'No playable file found in torrent')
  assert.equal(engine.findEntry(ctx(9)), null)
  assert.equal(row.key, `${pack.hash}:e1x9`)
  assert.equal(engine.status(pack.hash, true, row.key.split(':')[1]).phase, 'error')
  assert.equal(await engine.remove(pack.hash, row.key.split(':')[1]), true, 'the failed row can be dropped on its own')
  assert.equal(engine.library().filter(x => x.hash === pack.hash).length, 1)
})

test('an unpinned download retargeted to an episode the pack does not contain is failed', async () => {
  const s = await seed('u', 'Unpinned.Pack', ['Unpinned.S01E01.mkv', 'Unpinned.S01E02.mkv'])
  engine.add({ hash: s.hash, magnet: s.magnet, ctx: ctx(1, 'tt-u') })
  await done(s.hash)
  engine.add({ hash: s.hash, magnet: s.magnet, ctx: ctx(9, 'tt-u') })
  const st = engine.status(s.hash, true)
  assert.equal(st.phase, 'error')
  assert.equal(engine.findEntry(ctx(9, 'tt-u')), null)
  await engine.remove(s.hash)
})

test('discarding a race row takes only that episode and leaves the torrent in the library', async () => {
  engine.add({ hash: pack.hash, magnet: pack.magnet, ctx: ctx(1), pinned: true })
  await until(() => engine.library().filter(x => x.hash === pack.hash).length === 2)
  assert.equal(engine.discardRow(pack.hash, ctx(1)), true)
  assert.equal(engine.discardRow(pack.hash, ctx(1)), false)
  assert.equal(engine.discardRow('f'.repeat(40), ctx(1)), false)
  const left = engine.library().filter(x => x.hash === pack.hash)
  assert.equal(left.length, 1)
  assert.equal(left[0].phase, 'done')
})

test('removing rows twice or together never takes a row that was not named', async () => {
  const s = await seed('d', 'Rows.Pack', ['Rows.S01E01.mkv', 'Rows.S01E02.mkv', 'Rows.S01E03.mkv'])
  for (const n of [1, 2, 3]) engine.add({ hash: s.hash, magnet: s.magnet, ctx: ctx(n, 'tt-d'), pinned: true })
  const rows = await until(() => { const r = engine.library().filter(x => x.hash === s.hash); return r.length === 3 && r.every(x => x.phase === 'done') && r })
  const at = n => rows.find(r => r.ctx.episode === n).fileIdx
  assert.deepEqual(await Promise.all([engine.remove(s.hash, at(1)), engine.remove(s.hash, at(1))]), [true, false], 'the second delete of a gone row is a no-op')
  assert.deepEqual(engine.library().filter(x => x.hash === s.hash).map(r => r.ctx.episode), [2, 3])
  assert.deepEqual(await Promise.all([engine.remove(s.hash, at(2)), engine.remove(s.hash, at(3))]), [true, true])
  assert.equal(engine.status(s.hash, true), null, 'both named rows are gone, and with them the torrent')
})

test('rows for episodes the pack lacks are named by episode, so deleting one leaves the other', async () => {
  engine.add({ hash: pack.hash, magnet: pack.magnet, ctx: ctx(8), pinned: true })
  engine.add({ hash: pack.hash, magnet: pack.magnet, ctx: ctx(9), pinned: true })
  const lib = () => engine.library().filter(x => x.hash === pack.hash)
  assert.deepEqual(lib().map(r => [r.ctx.episode, r.key.split(':')[1]]).filter(([, k]) => k[0] === 'e'), [[8, 'e1x8'], [9, 'e1x9']])
  assert.equal(await engine.remove(pack.hash, 'e1x9'), true)
  assert.deepEqual(lib().map(r => r.ctx.episode), [2, 8], 'the first missing episode is still listed')
  assert.equal(await engine.remove(pack.hash, 'e1x9'), false)
  assert.equal(await engine.remove(pack.hash, 'e1x8'), true)
  assert.equal(lib().length, 1)
})

test('discarding a race row gives back the pin the race put on an unpinned torrent', async () => {
  const s = await seed('v', 'Pin.Pack', ['Pin.S01E01.mkv', 'Pin.S01E02.mkv'])
  engine.add({ hash: s.hash, magnet: s.magnet, ctx: ctx(1, 'tt-v') })
  await done(s.hash)
  engine.add({ hash: s.hash, magnet: s.magnet, ctx: ctx(2, 'tt-v'), pinned: true })
  assert.equal(engine.status(s.hash, true).pinned, true)
  assert.equal(engine.discardRow(s.hash, ctx(2, 'tt-v'), false), true)
  assert.equal(engine.status(s.hash, true).pinned, false)
  await engine.remove(s.hash)
})
