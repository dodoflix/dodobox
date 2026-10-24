// The torrent engine against a local seeder: a pack with two episodes and a subtitle file, no internet.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import WebTorrent from 'webtorrent'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('engine')
Object.assign(process.env, { DATA_DIR: path.join(tmp, 'data'), NO_DHT: '1' })

let seeder; let engine; let magnet; let hash; let web; let base
const ctx = (episode, id = 'tt1') => ({ type: 'series', id, title: 'Show', season: 1, episode })
const until = async (fn, ms = 20000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 50)) } }

before(async () => {
  const dir = path.join(tmp, 'Show.S01.pack'); fs.mkdirSync(dir)
  for (const n of [1, 2]) fs.writeFileSync(path.join(dir, `Show.S01E0${n}.mkv`), crypto.randomBytes(400e3))
  fs.writeFileSync(path.join(dir, 'Show.S01E01.en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHello\n')
  seeder = new WebTorrent({ dht: false, lsd: false, utp: false })
  const t = await new Promise(r => seeder.seed(dir, { announce: [] }, r))
  hash = t.infoHash
  magnet = `magnet:?xt=urn:btih:${hash}&x.pe=127.0.0.1:${seeder.address().port}`
  engine = await import('../src/engine.js')
  web = http.createServer((req, res) => engine.serve(hash, +req.url.slice(1), req, res)).listen(0)
  await new Promise(r => web.once('listening', r))
  base = `http://127.0.0.1:${web.address().port}`
})
after(async () => {
  web.close(); await engine.shutdown(); await new Promise(r => seeder.destroy(r))
  fs.rmSync(tmp, { recursive: true, force: true })
})

test('a pack is added, the asked episode is chosen and downloaded, and its status says so', async () => {
  const e = engine.add({ hash, magnet, ctx: ctx(1), pinned: true })
  assert.equal(e.hash, hash)
  const st = await until(() => { const s = engine.status(hash, true); return s.phase === 'done' && s })
  assert.match(st.name, /S01E01\.mkv$/)
  assert.equal(st.progress, 1); assert.equal(st.readable, st.length); assert.equal(st.pinned, true)
  assert.equal(engine.findEntry(ctx(1)).hash, hash)
  assert.equal(engine.findEntry(ctx(9)), null)
  assert.equal(engine.library().length, 1)
  assert.equal(engine.storage().used, st.length)
  assert.ok(engine.stats().torrents >= 1 && engine.details().length >= 1)
  assert.ok(fs.existsSync(engine.filePath(hash, st.fileIdx)))
  assert.deepEqual(engine.readableRuns(hash, st.fileIdx), [[0, st.length]])
  assert.equal(engine.readablePrefix(hash, st.fileIdx), st.length)
  assert.equal(engine.readablePrefix(hash, 99), 0)
})

test('a subtitle file inside the pack is listed for the episode and can be read', async () => {
  const [sub] = engine.sidecars(hash)
  assert.equal(sub.lang, 'eng')
  const { buf } = await engine.readSidecar(hash, sub.i)
  assert.match(buf.toString(), /Hello/)
  assert.throws(() => engine.readSidecar(hash, engine.status(hash, true).fileIdx), /unknown subtitle file/)
})

test('bytes are served with range support, and unknown files are not', async () => {
  const idx = engine.status(hash, true).fileIdx
  const part = await fetch(`${base}/${idx}`, { headers: { range: 'bytes=10-19' } })
  assert.equal(part.status, 206)
  assert.equal((await part.arrayBuffer()).byteLength, 10)
  assert.equal((await fetch(`${base}/77`)).status, 503)
})

test('a second episode of a pinned pack becomes its own row, with its own pause and priority', async () => {
  engine.add({ hash, magnet, ctx: ctx(2), pinned: true })
  const rows = await until(() => { const r = engine.library(); return r.length === 2 && r.every(x => x.phase === 'done') && r })
  const [one, two] = [rows.find(r => r.ctx.episode === 1), rows.find(r => r.ctx.episode === 2)]
  assert.notEqual(one.fileIdx, two.fileIdx)
  assert.equal(engine.hold(hash, two.fileIdx, true), true)
  assert.equal(engine.status(hash, true, two.fileIdx).held, true)
  assert.equal(engine.prioritize(hash, two.fileIdx, true), true)
  assert.equal(engine.status(hash, true, two.fileIdx).priority, true)
  assert.equal(engine.prioritizeCtx(ctx(2), false), true)
  assert.equal(engine.prioritizeCtx(ctx(9), true), false)
  assert.equal(engine.hold(hash, two.fileIdx, false), true)
  assert.equal(engine.hold('f'.repeat(40), 0, true), false)
  assert.equal(engine.prioritize('f'.repeat(40), 0, true), false)
  engine.touch(hash, two.fileIdx)
  engine.reject(hash, two.fileIdx, 'wrong episode')
  assert.equal(engine.status(hash, true, two.fileIdx).phase, 'error')
  assert.equal(engine.findEntry(ctx(2)), null, 'a rejected file is not offered again')
  engine.reject('f'.repeat(40), 0, 'nothing')
  assert.equal(await engine.remove(hash, two.fileIdx), true)
  assert.equal(engine.library().length, 1)
})

test('a download nobody pinned is retargeted to another episode of the same pack', async () => {
  await engine.remove(hash)
  engine.add({ hash, magnet, ctx: ctx(1) })
  await until(() => engine.status(hash, true).phase === 'done')
  engine.add({ hash, magnet, ctx: ctx(2) })
  const st = await until(() => { const s = engine.status(hash, true); return /S01E02/.test(s.name || '') && s.phase === 'done' && s })
  assert.equal(st.pinned, false)
  engine.pin(hash)
  assert.equal(engine.status(hash, true).pinned, true)
  engine.pin('f'.repeat(40))
})

test('a download resumed part way through still completes, and a resume point is ignored where it does not apply', async () => {
  const dir = path.join(tmp, 'Film.2020.1080p'); fs.mkdirSync(dir)
  fs.writeFileSync(path.join(dir, 'Film.2020.1080p.mkv'), crypto.randomBytes(3e6))
  const film = await new Promise(r => seeder.seed(dir, { announce: [] }, r))
  const m = `magnet:?xt=urn:btih:${film.infoHash}&x.pe=127.0.0.1:${seeder.address().port}`
  engine.add({ hash: film.infoHash, magnet: m, ctx: { type: 'movie', id: 'tt2', title: 'Film', year: 2020 } })
  seeder.throttleUpload(200e3) // slow enough to see what arrives first
  engine.resumeAt(film.infoHash, undefined, 0.75) // before the file list is known
  // The last piece of a file arrives early whatever the order, so only a stretch of some size says where the download began.
  const run = await until(() => engine.readableRuns(film.infoHash, 0).find(([a, b]) => b - a > 100e3))
  assert.ok(run[0] > 0.7 * 3e6, `the download began at ${run[0]}, not at the resume point`)
  seeder.throttleUpload(-1)
  const st = await until(() => { const s = engine.status(film.infoHash, true); return s.phase === 'done' && s })
  assert.equal(st.progress, 1)
  engine.resumeAt(film.infoHash, st.fileIdx, 0.5) // done: nothing left to order
  engine.resumeAt(film.infoHash, st.fileIdx, 0)
  engine.resumeAt('f'.repeat(40), 0, 0.5)
  assert.equal(await engine.remove(film.infoHash), true)
})

test('the idle and watching rules decide who pauses', () => {
  const now = 1e6
  assert.equal(engine.pauseReason({ pinned: false, added: now - 60e3, lastUsed: 0 }, now, false, false), 'idle')
  assert.equal(engine.pauseReason({ pinned: false, added: now - 1e3, lastUsed: 0 }, now, false, false), null)
  assert.equal(engine.pauseReason({ pinned: true, held: true, lastUsed: 0 }, now, false, false), 'user')
  assert.equal(engine.pauseReason({ pinned: true, lastUsed: 0 }, now, true, false), 'watching')
  assert.equal(engine.pauseReason({ pinned: true, lastUsed: 0 }, now, false, true), 'priority')
  assert.equal(engine.pauseReason({ pinned: true, lastUsed: now - 1e3, held: true }, now, true, true), null)
})

test('a torrent without metadata is only given up on after ten minutes of this run, not of the last one', () => {
  const now = 1e9; const boot = now - 5e3
  const old = { pinned: false, added: now - 3600e3, lastUsed: now - 1800e3 }
  assert.equal(engine.lostMetadata(old, now, boot), false, 'just restarted: the metadata has not had time to arrive')
  assert.equal(engine.lostMetadata(old, now + 11 * 60e3, boot), true)
  assert.equal(engine.lostMetadata({ ...old, pinned: true }, now + 11 * 60e3, boot), false)
})

test('a library.json that cannot be parsed is kept aside when the engine starts', () => {
  const dir = tmpdir('engine-lib')
  fs.writeFileSync(path.join(dir, 'library.json'), '{"abc":{"hash"')
  const run = spawnSync(process.execPath, ['-e', "const e = await import('./src/engine.js'); await e.shutdown()"], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.ok(fs.readdirSync(dir).some(f => f.startsWith('library.json.unreadable-')))
})

test('the storage cap removes the least recently used downloads that nobody pinned or touched lately', async () => {
  await engine.remove(hash)
  engine.add({ hash, magnet, ctx: ctx(1) })
  await until(() => engine.status(hash, true).phase === 'done')
  await engine.evict(1e12)
  assert.equal(engine.library().length, 1, 'under the cap nothing goes')
  await engine.evict(0)
  assert.equal(engine.library().length, 1, 'something used a moment ago stays')
  assert.equal(await engine.remove('f'.repeat(40)), false)
  assert.equal(await engine.remove(hash), true)
  assert.deepEqual(fs.readdirSync(path.join(process.env.DATA_DIR, 'downloads'), { recursive: true }), [])
})
