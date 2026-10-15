// Full path without internet: local seeder -> engine download -> probe -> raw range / HLS / subtitles.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import WebTorrent from 'webtorrent'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-e2e-'))
process.env.DATA_DIR = path.join(tmp, 'data')
process.env.NO_SPEEDTEST = '1'
process.env.NO_DHT = '1'
process.env.NO_MDNS = '1'
process.env.HOME = tmp

let seeder, srv, engine, base, hash
const get = (p, init) => fetch(base + p, init)

before(async () => {
  // MKV + H.264 + AC3 + embedded SRT: not browser-direct-playable, so it must go through HLS.
  const src = path.join(tmp, 'seed'); fs.mkdirSync(src)
  fs.writeFileSync(path.join(tmp, 'sub.srt'), '1\n00:00:01,000 --> 00:00:03,000\nHello e2e\n')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=14', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=14',
    '-i', path.join(tmp, 'sub.srt'), '-c:v', 'libx264', '-g', '24', '-c:a', 'ac3', '-c:s', 'srt', '-t', '14', path.join(src, 'Show.S01E02.mkv')])

  seeder = new WebTorrent({ dht: false, lsd: false, utp: false })
  const t = await new Promise(r => seeder.seed(path.join(src, 'Show.S01E02.mkv'), { announce: [] }, r))
  hash = t.infoHash
  const magnet = `magnet:?xt=urn:btih:${hash}&x.pe=127.0.0.1:${seeder.address().port}`

  const { start } = await import('../server.js')
  engine = await import('../src/engine.js')
  srv = await start(0)
  base = `http://127.0.0.1:${srv.address().port}`
  engine.add({ hash, magnet, ctx: { type: 'series', id: 'tt1', title: 'Show', season: 1, episode: 2 } })
})

after(async () => {
  const { stop } = await import('../server.js')
  await stop(); await new Promise(r => seeder.destroy(r))
  fs.rmSync(tmp, { recursive: true, force: true })
})

async function until (fn, ms = 30000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn(); if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 200))
  }
}

test('torrent downloads and reports done', async () => {
  const st = await until(async () => { const s = await (await get(`/api/status/${hash}`)).json(); return s.phase === 'done' && s })
  assert.equal(st.fileIdx, 0)
  assert.equal(st.progress, 1)
  assert.equal((await (await get('/api/library')).json()).length, 1)
})

test('range requests stream raw bytes', async () => {
  const r = await get(`/raw/${hash}/0`, { headers: { range: 'bytes=0-99' } })
  assert.equal(r.status, 206)
  assert.equal((await r.arrayBuffer()).byteLength, 100)
  assert.match(r.headers.get('content-range'), /^bytes 0-99\//)
})

test('probe flags mkv/ac3 for transcoding and lists embedded subs', async () => {
  const info = await (await get(`/api/info/${hash}`)).json()
  assert.equal(info.direct, false)
  assert.ok(info.duration > 13 && info.duration < 15)
  assert.equal(info.subs.length, 1)
})

test('HLS playlist and a segment decode to valid MPEG-TS H.264/AAC', async () => {
  const pl = await (await get(`/hls/${hash}/0/index.m3u8`)).text()
  assert.equal((pl.match(/seg\d+\.ts/g) || []).length, 3)
  const seg = Buffer.from(await (await get(`/hls/${hash}/0/seg1.ts`)).arrayBuffer())
  assert.equal(seg[0], 0x47)
  const f = path.join(tmp, 'seg1.ts'); fs.writeFileSync(f, seg)
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', f]))
  assert.deepEqual(out.streams.map(s => s.codec_name).sort(), ['aac', 'h264'])
  assert.ok(Math.abs(parseFloat(out.format.start_time) - 6) < 1.5, `segment starts near 6s, got ${out.format.start_time}`)
})

test('embedded subtitle extracts as WebVTT', async () => {
  const vtt = await (await get(`/api/sub/embedded/${hash}/0/0`)).text()
  assert.match(vtt, /^WEBVTT/)
  assert.match(vtt, /00:01\.000 --> 00:03\.000/)
  assert.match(vtt, /Hello e2e/)
})

test('uploaded SRT and ASS convert to WebVTT', async () => {
  const srt = await (await get('/api/sub/convert', { method: 'POST', body: '1\n00:00:01,000 --> 00:00:02,000\nHi\n' })).text()
  assert.match(srt, /^WEBVTT[\s\S]*00:00:01\.000/)
  const ass = '[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,ASS line\n'
  const vtt = await (await get('/api/sub/convert', { method: 'POST', body: ass })).text()
  assert.match(vtt, /^WEBVTT/)
  assert.match(vtt, /ASS line/)
})

test('subtitle proxy rejects foreign hosts', async () => {
  assert.equal((await get('/api/sub?url=' + encodeURIComponent('https://example.com/a.srt'))).status, 400)
})

test('static files do not escape the public dir', async () => {
  assert.equal((await get('/..%2fpackage.json')).status, 404)
  assert.equal((await get('/')).status, 200)
})

test('deleting from the library removes files', async () => {
  const dl = path.join(process.env.DATA_DIR, 'downloads')
  assert.ok(fs.readdirSync(dl).length > 0)
  assert.deepEqual(await (await get(`/api/library/${hash}`, { method: 'DELETE' })).json(), { ok: true })
  assert.equal(fs.readdirSync(dl).length, 0)
})
