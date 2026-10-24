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
process.env.NO_UPDATE_CHECK = '1'
process.env.NO_DHT = '1'
process.env.NO_MDNS = '1'
process.env.ALLOWED_HOSTS = 'nas.example.com'
process.env.HOME = tmp

let seeder, srv, engine, base, hash, packHash, packMagnet
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

  // A pack with subtitle files next to the videos: one for the episode being watched, one for another episode.
  const pack = path.join(tmp, 'Pack'); fs.mkdirSync(path.join(pack, 'Subs', 'Show.S01E05'), { recursive: true })
  for (const n of [5, 6]) fs.copyFileSync(path.join(src, 'Show.S01E02.mkv'), path.join(pack, `Show.S01E0${n}.mkv`))
  fs.writeFileSync(path.join(pack, 'Show.S01E05.en.srt'), '1\n00:00:01,000 --> 00:00:03,000\nHello sidecar\n')
  fs.writeFileSync(path.join(pack, 'Show.S01E06.en.srt'), '1\n00:00:01,000 --> 00:00:03,000\nWrong episode\n')
  fs.writeFileSync(path.join(pack, 'Subs', 'Show.S01E05', '2_Turkish.srt'), '1\n00:00:01,000 --> 00:00:03,000\nMerhaba\n')
  const pt = await new Promise(r => seeder.seed(pack, { announce: [] }, r))
  packHash = pt.infoHash
  packMagnet = `magnet:?xt=urn:btih:${packHash}&x.pe=127.0.0.1:${seeder.address().port}`

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

test('subtitle files inside the torrent are listed for the episode and served as WebVTT', async (t) => {
  engine.add({ hash: packHash, magnet: packMagnet, ctx: { type: 'series', id: 'tt2', title: 'Show', season: 1, episode: 5 } })
  t.after(() => engine.remove(packHash))
  const info = await until(async () => { const r = await get(`/api/info/${packHash}`); return r.ok && r.json() })
  assert.deepEqual(info.sidecar.map(s => [s.name, s.lang]).sort(), [['2_Turkish.srt', 'tur'], ['Show.S01E05.en.srt', 'eng']])
  const en = info.sidecar.find(s => s.lang === 'eng')
  const r = await get(`/api/sub/file/${packHash}/${en.i}`)
  assert.equal(r.status, 200)
  const vtt = await r.text()
  assert.match(vtt, /^WEBVTT/)
  assert.match(vtt, /00:00:01\.000 --> 00:00:03\.000\nHello sidecar/)
})

test('watch party endpoints: idle by default, bad requests refused, events stream', async () => {
  assert.equal((await (await get('/api/party')).json()).active, false)
  const post = (p, body) => get(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post('/api/party/join', { code: 'nope' })).status, 400)
  assert.equal((await post('/api/party/send', { k: 'pl', pos: 1 })).status, 409)
  assert.equal((await post('/api/party/start', { item: { type: 'game', id: 'x' } })).status, 400)
  assert.equal((await (await post('/api/party/leave', {})).json()).ok, true)
  const sse = await get('/api/party/events')
  assert.equal(sse.headers.get('content-type'), 'text/event-stream')
  const reader = sse.body.getReader()
  assert.match(new TextDecoder().decode((await reader.read()).value), /"type":"status"/)
  await reader.cancel()
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
  assert.match(vtt, /00:01\.0\d\d --> 00:03\.0\d\d/)
  assert.match(vtt, /Hello e2e/)
})

test('HLS master playlist can carry a subtitle rendition, served as WebVTT aligned to the stream', async () => {
  const sub = `/api/sub/embedded/${hash}/0/0`
  const master = await (await get(`/hls/${hash}/0/index.m3u8?sub=${encodeURIComponent(sub)}&sl=eng&sn=English`)).text()
  assert.match(master, /TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="eng"/)
  assert.match(master, /SUBTITLES="subs"\nmedia\.m3u8/)
  assert.match(await (await get(`/hls/${hash}/0/media.m3u8`)).text(), /seg0\.ts/)
  const subs = await (await get(`/hls/${hash}/0/subs.m3u8?sub=${encodeURIComponent(sub)}`)).text()
  assert.match(subs, /#EXT-X-ENDLIST/)
  const vtt = await (await get(`/hls/${hash}/0/sub.vtt?sub=${encodeURIComponent(sub)}`)).text()
  assert.match(vtt, /^WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00\.000\n/)
  assert.match(vtt, /Hello e2e/)
})

test('HLS subtitle requests that name no real subtitle are refused', async () => {
  assert.equal((await get(`/hls/${hash}/0/sub.vtt?sub=${encodeURIComponent('http://evil.example/x.srt')}`)).status, 400)
  assert.equal((await get(`/hls/${hash}/0/sub.vtt`)).status, 400)
})

test('subtitle sync has nothing to measure in a file too short for any audio window', async () => {
  const q = new URLSearchParams({ hash, file: '0', src: `/api/sub/embedded/${hash}/0/0` })
  assert.deepEqual(await (await get(`/api/sub/sync?${q}`)).json(), { pending: true })
  assert.deepEqual(await (await get(`/api/sub/sync?${q}&at=5`)).json(), { probe: null, ahead: true })
})

test('translation endpoints answer while nothing is translating', async () => {
  assert.deepEqual(await (await get('/api/sub/translate/status?src=%2Fnothing&to=tr')).json(), { stage: 'idle', pct: 0 })
  assert.equal(typeof (await (await get('/api/translate/better')).json()), 'object')
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
  assert.deepEqual(fs.readdirSync(dl, { recursive: true }), [])
})

test('the adult filter hides adult-marked titles from the viewer\'s lists', async () => {
  const { cached } = await import('../src/meta.js')
  await cached('meta6:anime:al:900001', 1e6, async () => ({ id: 'al:900001', genres: ['Comedy', 'Hentai'] }))
  await cached('meta6:anime:al:900002', 1e6, async () => ({ id: 'al:900002', genres: ['Comedy'] }))
  await cached('meta6:movie:tt9000001', 1e6, async () => ({ id: 'tt9000001', genres: ['Adult', 'Comedy'] }))
  await cached('meta6:series:tt9000002', 1e6, async () => ({ id: 'tt9000002', genres: ['Drama'] }))
  const { id } = await (await get('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Adult filter' }) })).json()
  for (const [type, tid] of [['anime', 'al:900001'], ['anime', 'al:900002'], ['movie', 'tt9000001'], ['series', 'tt9000002']]) await get('/api/list', { method: 'PUT', headers: { 'content-type': 'application/json', 'x-profile': id }, body: JSON.stringify({ item: { type, id: tid, name: tid }, on: true }) })
  const ids = async () => (await (await get('/api/me', { headers: { 'x-profile': id } })).json()).list.map(x => x.id).sort()
  assert.deepEqual(await ids(), ['al:900001', 'al:900002', 'tt9000001', 'tt9000002'])
  await get('/api/me', { method: 'PATCH', headers: { 'content-type': 'application/json', 'x-profile': id }, body: JSON.stringify({ settings: { adultFilter: true } }) })
  assert.deepEqual(await ids(), ['al:900002', 'tt9000002'], 'the profile setting decides, even before the page has sent its header')
})

test('a profile PIN guards the profile and nothing else', async () => {
  const J = { 'content-type': 'application/json' }
  const call = async (p, { method = 'GET', headers = {}, body } = {}) => { const r = await get(p, { method, headers: { ...J, ...headers }, body: body && JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) } }
  const { id } = (await call('/api/profiles', { method: 'POST', body: { name: 'Pinned' } })).body
  const { body: { id: other } } = await call('/api/profiles', { method: 'POST', body: { name: 'Neighbour' } })
  const set = await call('/api/me/pin', { method: 'PUT', headers: { 'x-profile': id }, body: { pin: '12' } })
  assert.equal(set.status, 400, 'a PIN is 4 to 8 digits')
  const made = await call('/api/me/pin', { method: 'PUT', headers: { 'x-profile': id }, body: { pin: '2468' } })
  assert.equal(made.status, 200); assert.ok(made.body.token)
  assert.equal((await call('/api/profiles')).body.find(p => p.id === id).locked, true)
  assert.equal(JSON.stringify((await call('/api/profiles')).body).includes('hash'), false, 'the hash never leaves the server')
  // Without the token the profile is nobody: its data, its settings and its identity are closed.
  assert.deepEqual((await call('/api/me', { headers: { 'x-profile': id } })).body, { error: 'Locked' })
  assert.equal((await call('/api/list', { method: 'PUT', headers: { 'x-profile': id }, body: { item: { type: 'movie', id: 'tt1', name: 'x' }, on: true } })).status, 401)
  assert.equal((await call('/api/profiles/' + id, { method: 'DELETE', headers: { 'x-profile': other } })).status, 401, 'another profile cannot delete it')
  assert.equal((await call('/api/me', { headers: { 'x-profile': id, 'x-token': made.body.token } })).body.hasPin, true)
  // Downloads and playing do not belong to a profile.
  assert.equal((await call('/api/library', { headers: { 'x-profile': id } })).status, 200)
  // A wrong PIN is refused, and after five in a row so is the right one for a while.
  for (let i = 0; i < 5; i++) assert.equal((await call(`/api/profiles/${id}/unlock`, { method: 'POST', body: { pin: '0000' } })).status, 403)
  assert.equal((await call(`/api/profiles/${id}/unlock`, { method: 'POST', body: { pin: '2468' } })).status, 429)
  // Locking ends the session; changing the PIN needs the current one and ends the others.
  await call(`/api/profiles/${id}/lock`, { method: 'POST', headers: { 'x-profile': id, 'x-token': made.body.token } })
  assert.equal((await call('/api/me', { headers: { 'x-profile': id, 'x-token': made.body.token } })).status, 401)
  const { body: { id: two } } = await call('/api/profiles', { method: 'POST', body: { name: 'Second' } })
  const t2 = (await call('/api/me/pin', { method: 'PUT', headers: { 'x-profile': two }, body: { pin: '1357' } })).body.token
  const h2 = { 'x-profile': two, 'x-token': t2 }
  assert.equal((await call('/api/me/pin', { method: 'PUT', headers: h2, body: { pin: '9999', current: '0000' } })).status, 403)
  const changed = await call('/api/me/pin', { method: 'PUT', headers: h2, body: { pin: '9999', current: '1357' } })
  assert.equal((await call('/api/me', { headers: h2 })).status, 401, 'the old session ended')
  assert.equal((await call('/api/me', { headers: { 'x-profile': two, 'x-token': changed.body.token } })).status, 200)
  const gone = await call('/api/me/pin', { method: 'PUT', headers: { 'x-profile': two, 'x-token': changed.body.token }, body: { pin: '', current: '9999' } })
  assert.equal(gone.status, 200)
  assert.equal((await call('/api/me', { headers: { 'x-profile': two } })).status, 200, 'without a PIN the profile is open again')
})

test('requests from another site, and from a made-up hostname, are refused', async () => {
  const { request } = await import('node:http')
  const hit = (method, path, headers) => new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: new URL(base).port, method, path, headers }, res => { res.resume(); resolve(res.statusCode) })
    r.on('error', reject); r.end(method === 'POST' ? '{}' : undefined)
  })
  assert.equal(await hit('POST', '/api/party/leave', { 'sec-fetch-site': 'cross-site' }), 403)
  assert.equal(await hit('POST', '/api/party/leave', { origin: 'https://evil.example' }), 403)
  assert.equal(await hit('POST', '/api/party/leave', { 'sec-fetch-site': 'same-origin' }), 200)
  assert.equal(await hit('POST', '/api/party/leave', { origin: base }), 200)
  assert.equal(await hit('POST', '/api/party/leave', {}), 200, 'no browser headers: a script or a TV app')
  assert.equal(await hit('GET', '/api/party', { host: 'evil.example' }), 421)
  assert.equal(await hit('GET', '/api/party', { host: 'localhost:3000' }), 200)
  assert.equal(await hit('GET', '/api/party', { host: 'evil.example', 'x-forwarded-for': '1.2.3.4', 'x-forwarded-host': 'localhost' }), 421, 'a page can set forwarded headers itself')
  for (const host of ['dodobox.local', 'nas', 'tv.lan', '192.168.1.5:3000', '[::1]:3000', 'NAS.EXAMPLE.COM']) assert.equal(await hit('GET', '/api/party', { host }), 200, host)
  for (const host of ['attacker.com', 'x.nip.io', 'dodobox.local.evil.com', 'tv.lan.evil.com']) assert.equal(await hit('GET', '/api/party', { host }), 421, host)
})

test('the log holds requests, torrent events, ffmpeg runs and page errors, and no PINs', async () => {
  await get('/api/log', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ level: 'error', msg: 'video element error', f: { code: 4 } }) })
  const text = fs.readFileSync(path.join(process.env.DATA_DIR, 'logs', 'dodobox.log'), 'utf8')
  for (const want of [/\[start\] listening/, /\[http\] GET \/api\/library/, /\[torrent\] ready hash=/, /\[probe\] ok/, /\[transcode\] segment/, /\[client\] video element error code=4/, /\[lock\] wrong PIN/]) assert.match(text, want)
  assert.doesNotMatch(text, /1357|9999/)
})
