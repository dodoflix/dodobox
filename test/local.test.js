import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('local')
process.env.DATA_DIR = path.join(tmp, 'data'); process.env.HOME = tmp
process.env.NO_SPEEDTEST = '1'
process.env.NO_UPDATE_CHECK = '1'; process.env.NO_DHT = '1'; process.env.NO_MDNS = '1'; process.env.MIN_LOCAL_BYTES = '1000'
let base; let items
const get = (p, init) => fetch(base + p, init)
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a])

before(async () => {
  const dir = path.join(tmp, 'Videos'); fs.mkdirSync(dir)
  const src = ['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=8', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8']
  ff(...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', path.join(dir, 'Direct.Movie.2020.1080p.mp4'))
  ff(...src, '-c:v', 'libx264', '-c:a', 'ac3', path.join(dir, 'Show.Name.S01E02.mkv'))
  // Subtitle files beside the videos: own episode (two places), another episode, and the movie's.
  const srt = text => `1\n00:00:01,000 --> 00:00:03,000\n${text}\n`
  fs.mkdirSync(path.join(dir, 'Subs', 'Show.Name.S01E02'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'Show.Name.S01E02.en.srt'), srt('Hello local'))
  fs.writeFileSync(path.join(dir, 'Subs', 'Show.Name.S01E02', '2_Turkish.srt'), srt('Merhaba'))
  fs.writeFileSync(path.join(dir, 'Show.Name.S01E03.en.srt'), srt('Wrong episode'))
  fs.writeFileSync(path.join(dir, 'Direct.Movie.2020.1080p.fr.srt'), srt('Bonjour'))
  const local = await import('../src/local.js')
  local.hooks.match = async p => p.kind === 'movie' ? { type: 'movie', mid: 'tt100', name: 'Direct Movie', poster: null, year: 2020 } : { type: 'series', mid: 'tt200', name: 'Show Name', poster: null, year: 2019 }
  const { start } = await import('../server.js')
  const srv = await start(0)
  base = `http://127.0.0.1:${srv.address().port}`
  await local.rescan()
  items = await (await get('/api/local')).json()
})

after(async () => { const { stop } = await import('../server.js'); await stop(); fs.rmSync(tmp, { recursive: true, force: true }) })

test('scan finds and matches both files without exposing paths', () => {
  assert.equal(items.length, 2)
  assert.ok(items.every(i => !('path' in i)))
  const ep = items.find(i => i.type === 'series')
  assert.equal(ep.season, 1); assert.equal(ep.episode, 2); assert.equal(ep.mid, 'tt200')
})

test('local status is immediately ready', async () => {
  const s = await (await get(`/api/status/${items[0].id}`)).json()
  assert.equal(s.phase, 'done'); assert.equal(s.progress, 1); assert.equal(s.local, true)
})

test('local files stream with range support', async () => {
  const r = await get(`/raw/${items[0].id}/0`, { headers: { range: 'bytes=10-59' } })
  assert.equal(r.status, 206)
  assert.equal((await r.arrayBuffer()).byteLength, 50)
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
})

test('mp4 H.264/AAC plays directly, mkv/ac3 goes through HLS', async () => {
  const mp4 = items.find(i => i.type === 'movie'); const mkv = items.find(i => i.type === 'series')
  assert.equal((await (await get(`/api/info/${mp4.id}`)).json()).direct, true)
  const info = await (await get(`/api/info/${mkv.id}`)).json()
  assert.equal(info.direct, false)
  const seg = Buffer.from(await (await get(`/hls/${mkv.id}/0/seg0.ts?h=480`)).arrayBuffer())
  assert.equal(seg[0], 0x47)
})

test('subtitle files beside a local video are listed for it and served as WebVTT', async () => {
  const mkv = items.find(i => i.type === 'series'); const mp4 = items.find(i => i.type === 'movie')
  const info = await (await get(`/api/info/${mkv.id}`)).json()
  assert.deepEqual(info.sidecar.map(x => [x.name, x.lang]).sort(), [['2_Turkish.srt', 'tur'], ['Show.Name.S01E02.en.srt', 'eng']])
  assert.ok(info.sidecar.every(x => !('path' in x)), 'no file paths leave the server')
  const en = info.sidecar.find(x => x.lang === 'eng')
  const r = await get(`/api/sub/file/${mkv.id}/${en.i}`)
  assert.equal(r.status, 200)
  assert.match(await r.text(), /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:03\.000\nHello local/)
  assert.equal((await get(`/api/sub/file/${mkv.id}/9999`)).status, 404, 'only listed files can be read')
  const movie = await (await get(`/api/info/${mp4.id}`)).json()
  assert.deepEqual(movie.sidecar.map(x => [x.name, x.lang]), [['Direct.Movie.2020.1080p.fr.srt', 'fre']])
})

test('unknown local ids and bad ranges are handled', async () => {
  assert.equal((await get('/raw/l0000000000000000/0')).status, 404)
  const r = await get(`/raw/${items[0].id}/0`, { headers: { range: 'bytes=99999999-' } })
  assert.equal(r.status, 416)
})

test('profile API round trip over HTTP', async () => {
  const p = await (await get('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Eve' }) })).json()
  assert.ok(p.id)
  assert.equal((await get('/api/me')).status, 401)
  const h = { 'x-profile': p.id, 'content-type': 'application/json' }
  await get('/api/progress', { method: 'PUT', headers: h, body: JSON.stringify({ type: 'movie', id: 'tt100', name: 'Direct Movie', pos: 10, dur: 100 }) })
  const me = await (await get('/api/me', { headers: h })).json()
  assert.equal(me.recent[0].id, 'tt100')
  assert.equal((await (await get(`/api/profiles/${p.id}`, { method: 'DELETE' })).json()).ok, true)
})

test('image proxy refuses unknown hosts', async () => {
  assert.equal((await get('/img?u=' + encodeURIComponent('https://evil.example/x.jpg'))).status, 400)
})
