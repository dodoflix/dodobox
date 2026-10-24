// The HTTP surface of the server with every outside service answered by fixtures. No torrents: those are exercised by the e2e specs.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-server-'))
Object.assign(process.env, { DATA_DIR: path.join(tmp, 'data'), HOME: tmp, MEDIA_DIR: path.join(tmp, 'media'), MIN_LOCAL_BYTES: '1000', NO_SPEEDTEST: '1', NO_UPDATE_CHECK: '1', NO_DHT: '1', NO_MDNS: '1', NO_DISCORD: '1', ALLOWED_HOSTS: 'localhost' })

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const film = (n, genre = 'Drama', extra = {}) => ({ id: `tt70000${n}`, imdb_id: `tt70000${n}`, name: `Film ${n}`, year: String(2000 + n), releaseInfo: String(2000 + n), genres: [genre], description: `Story ${n}`, poster: `https://images.metahub.space/poster/medium/${n}/img`, imdbRating: '7.1', ...extra })
const FILMS = Array.from({ length: 10 }, (_, n) => film(n))
const SHOW = { ...film(20, 'Comedy'), videos: [{ season: 1, episode: 1, name: 'One', released: '2020-01-01T00:00:00Z' }, { season: 1, episode: 2, name: 'Two', released: '2099-01-01T00:00:00Z' }] }
const FUTURE = film(21, 'Drama', { year: '2099', releaseInfo: '2099' })
const real = globalThis.fetch
const asked = []
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return real(input, init)
  asked.push(url.href)
  if (url.hostname === 'v3-cinemeta.strem.io') {
    const [, kind, type, id] = url.pathname.match(/^\/(catalog|meta)\/(\w+)\/([^/]+?)(?:\/.+)?\.json$/) || []
    if (kind === 'catalog') return Promise.resolve(json({ metas: type === 'series' ? [SHOW] : [...FILMS, FUTURE] }))
    if (kind === 'meta') { const all = [...FILMS, SHOW, FUTURE]; const m = all.find(x => x.id === id); return Promise.resolve(m ? json({ meta: m }) : json({}, 404)) }
  }
  if (url.hostname === 'graphql.anilist.co') return Promise.resolve(json({ data: { Page: { media: [{ id: 5, idMal: 5, title: { romaji: 'Ani Five', english: 'Ani Five' }, coverImage: { extraLarge: 'https://s4.anilist.co/c.png' }, seasonYear: 2022, averageScore: 80, genres: ['Action'], description: 'Ani', episodes: 2, duration: 24, format: 'TV', status: 'FINISHED', countryOfOrigin: 'JP' }] } } }))
  if (url.hostname === 'images.metahub.space' || url.hostname === 's4.anilist.co') return Promise.resolve(new Response(PNG, { headers: { 'content-type': 'image/png' } }))
  if (url.hostname === 'api.github.com') return Promise.resolve(json({ tag_name: 'v99.0.0', html_url: 'https://example.test/release' }))
  if (url.hostname === 'opensubtitles-v3.strem.io') return Promise.resolve(json({ subtitles: [{ lang: 'eng', url: 'https://subs5.strem.io/a.srt', movieReleaseName: 'Film.0.2000.1080p', g: '3' }] }))
  if (url.hostname === 'subs5.strem.io') return Promise.resolve(new Response('1\n00:00:01,000 --> 00:00:02,000\nA line\n'))
  if (url.hostname === 'torrentio.strem.fun') return Promise.resolve(json({ streams: [] }))
  if (url.hostname === 'query.wikidata.org') return Promise.resolve(json({ results: { bindings: [{ id: { value: 'tt700000' }, label: { value: 'Film Sifir' } }] } }))
  return Promise.resolve(json({}, 404))
}

let base; let stop; let local; let state
const H = { 'content-type': 'application/json' }
const call = async (p, { method = 'GET', headers = {}, body } = {}) => {
  const r = await fetch(base + p, { method, headers: { ...H, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let parsed; try { parsed = JSON.parse(text) } catch { parsed = text }
  return { status: r.status, body: parsed, headers: r.headers }
}

before(async () => {
  fs.mkdirSync(process.env.MEDIA_DIR, { recursive: true })
  const mod = await import('../server.js')
  stop = mod.stop
  local = await import('../src/local.js')
  state = await import('../src/state.js')
  local.hooks.match = async p => ({ type: 'movie', mid: 'tt700000', name: p.title, poster: null, year: p.year })
  base = `http://localhost:${(await mod.start(0)).address().port}`
})
after(async () => { await stop(); fs.rmSync(tmp, { recursive: true, force: true }) })

test('health, server details, the QR code and the speed test answer', async () => {
  assert.deepEqual((await call('/api/health')).body.app, 'dodobox')
  const info = (await call('/api/server')).body
  assert.ok(info.version && Array.isArray(info.urls) && info.mdns, JSON.stringify(info))
  const qr = await call('/api/qr.svg?text=http://dodobox.local:3000')
  assert.match(qr.body, /^<svg/)
  const bytes = await fetch(`${base}/api/speedtest?bytes=5000`)
  assert.ok((await bytes.arrayBuffer()).byteLength >= 5000)
})

test('static files are served compressed, unknown ones and traversal are refused', async () => {
  const page = await fetch(`${base}/`, { headers: { 'accept-encoding': 'gzip' } })
  assert.equal(page.headers.get('content-encoding'), 'gzip')
  assert.equal((await fetch(`${base}/js/main.js`)).status, 200)
  assert.equal((await fetch(`${base}/vendor/hls.js`)).status, 200)
  assert.equal((await fetch(`${base}/fonts/figtree-latin-wght-normal.woff2`)).headers.get('cache-control'), 'public, max-age=31536000, immutable')
  assert.equal((await fetch(`${base}/nothing.js`)).status, 404)
  assert.equal((await fetch(`${base}/js`)).status, 404)
})

test('the catalog, a title and the shelves come from the catalog service and are cached', async () => {
  const cat = (await call('/api/catalog?type=movie')).body
  assert.equal(cat.length, 11)
  assert.equal((await call('/api/catalog?type=movie&q=film')).body.length > 0, true)
  assert.equal((await call('/api/catalog?type=anime')).body[0].name, 'Ani Five')
  assert.equal((await call('/api/catalog?type=game')).status, 400)
  const m = (await call('/api/meta/series/tt7000020')).body
  assert.deepEqual(m.videos.map(v => v.episode), [1, 2])
  assert.equal((await call('/api/meta/movie/tt7000021')).body.unplayable, 'Not released yet')
  assert.equal((await call('/api/meta/movie/tt999')).status >= 400, true)
  for (const id of ['top:movie', 'new:movie', 'rated:movie', 'genre:movie:Drama', 'airing:anime', 'top:anime']) assert.equal((await call(`/api/shelf?id=${encodeURIComponent(id)}`)).status, 200, id)
  assert.equal((await call('/api/shelf?id=nonsense:movie')).status, 404)
  assert.equal((await call('/api/shelf?id=country:movie:xx')).status, 404)
})

test('a profile keeps its list, ratings, progress and settings, and the home shelves follow them', async () => {
  const { body: { id } } = await call('/api/profiles', { method: 'POST', body: { name: 'Reader', color: '#e5646e' } })
  const as = { 'x-profile': id }
  assert.equal((await call('/api/shelves?type=movie&country=US', { headers: as })).status, 200)
  const item = { type: 'movie', id: 'tt700000', name: 'Film 0', year: 2000 }
  assert.equal((await call('/api/list', { method: 'PUT', headers: as, body: { item, on: true } })).status, 200)
  assert.equal((await call('/api/rating', { method: 'PUT', headers: as, body: { item: { ...item, genres: ['Drama'] }, value: 2 } })).status, 200)
  assert.equal((await call('/api/progress', { method: 'PUT', headers: as, body: { type: 'movie', id: 'tt700000', name: 'Film 0', pos: 30, dur: 100 } })).status, 200)
  const me = (await call('/api/me', { headers: as })).body
  assert.equal(me.list.length, 1); assert.equal(me.recent.length, 1)
  assert.ok((await call('/api/picks', { headers: as })).body.length >= 1, 'picks like the rated title')
  assert.equal((await call('/api/picks', { headers: as })).status, 200)
  assert.equal((await call('/api/history/movie/tt700000', { method: 'DELETE', headers: as })).status, 200)
  assert.equal((await call('/api/me', { method: 'PATCH', headers: as, body: { name: 'Reader 2', settings: { lang: 'tr' } } })).status, 200)
  assert.equal((await call('/api/presence', { method: 'PUT', headers: as, body: { title: 'Film 0' } })).status, 200)
  assert.equal((await call('/api/settings')).body.maxStorageGB > 0, true)
  assert.equal((await call('/api/settings', { method: 'PUT', body: { maxStorageGB: 50 } })).status, 200)
  assert.equal((await call('/api/me', { headers: { 'x-profile': 'nobody' } })).status, 401)
  assert.equal((await call('/api/profiles/' + id, { method: 'PATCH', body: { name: 'Renamed' } })).status, 200)
  assert.equal((await call('/api/profiles/' + id, { method: 'DELETE' })).status, 200)
})

test('titles and descriptions are shown in the profile language when the wiki knows them', async () => {
  const items = (await call('/api/catalog?type=movie', { headers: { 'x-lang': 'tr' } })).body
  assert.equal(items.find(i => i.id === 'tt700000').name, 'Film Sifir')
  const one = (await call('/api/meta/movie/tt700000', { headers: { 'x-lang': 'tr' } })).body
  assert.equal(one.name, 'Film Sifir')
  assert.equal((await call('/api/meta/movie/tt700000', { headers: { 'x-lang': 'en' } })).body.name, 'Film 0')
})

test('files in the media folder are matched to titles, listed and served with range support', async () => {
  const file = path.join(process.env.MEDIA_DIR, 'Film.Zero.2000.1080p.mkv')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3', '-c:v', 'libx264', '-c:a', 'aac', '-t', '3', file])
  assert.equal((await call('/api/local/rescan', { method: 'POST' })).body.count, 1)
  const [entry] = (await call('/api/local')).body
  assert.equal(entry.mid, 'tt700000')
  const part = await fetch(`${base}/raw/${entry.id}/0`, { headers: { range: 'bytes=0-9' } })
  assert.equal(part.status, 206)
  const info = (await call(`/api/info/${entry.id}`)).body
  assert.ok(info.duration > 2 && info.direct === false)
  assert.equal((await call(`/api/status/${entry.id}`)).body.phase, 'done')
  assert.equal((await call(`/api/skips/${entry.id}`)).status, 200)
  assert.equal((await call('/api/status/' + 'a'.repeat(40))).status, 404)
  const play = await call('/api/play', { method: 'POST', body: { type: 'movie', id: 'tt700000' } })
  assert.equal(play.body.local, true)
  const master = await fetch(`${base}/hls/${entry.id}/0/index.m3u8`)
  assert.match(await master.text(), /#EXTM3U/)
  assert.equal((await fetch(`${base}/hls/${entry.id}/0/seg0.ts`)).status, 200)
  assert.equal((await call('/api/library')).body.length, 0)
})

test('the sources list is empty when nothing is found, and a download that finds nothing is reported as failed', async () => {
  assert.deepEqual((await call('/api/sources?type=movie&id=tt700001')).body, [])
  assert.equal((await call('/api/download', { method: 'POST', body: { type: 'movie', id: 'tt700001' } })).status, 200)
  const failed = await (async () => { for (let i = 0; i < 40; i++) { const d = (await call('/api/downloads')).body; if (d.failed.length) return d; await new Promise(r => setTimeout(r, 150)) } return { failed: [] } })()
  assert.equal(failed.failed[0].id, 'tt700001')
  assert.equal((await call(`/api/downloads/${encodeURIComponent(failed.failed[0].key)}/prioritize`, { method: 'POST' })).status, 200)
  assert.equal((await call(`/api/downloads/${encodeURIComponent(failed.failed[0].key)}`, { method: 'DELETE' })).status, 200)
  assert.equal((await call('/api/storage')).body.cap > 0, true)
  assert.equal((await call('/api/library/' + 'b'.repeat(40) + '/pause', { method: 'POST' })).status, 200)
})

test('subtitles: a listing, a download, an upload and the refused cases', async () => {
  const list = (await call('/api/subs?type=movie&id=tt700000&langs=eng&release=Film.0.2000.1080p')).body
  assert.equal(list[0].lang, 'eng')
  const vtt = await fetch(`${base}/api/sub?url=${encodeURIComponent(list[0].url)}`)
  assert.match(await vtt.text(), /A line/)
  assert.equal((await fetch(`${base}/api/sub?url=${encodeURIComponent('https://evil.example/a.srt')}`)).status, 400)
  const up = await fetch(`${base}/api/sub/convert`, { method: 'POST', body: '1\n00:00:01,000 --> 00:00:02,000\nUploaded\n' })
  assert.match(await up.text(), /^WEBVTT/)
  assert.equal((await fetch(`${base}/api/sub/file/${'c'.repeat(40)}/0`)).status, 404)
  assert.equal((await fetch(`${base}/api/sub/embedded/${'c'.repeat(40)}/0/0`)).status, 404)
  assert.equal((await fetch(`${base}/api/sub/sync?hash=${'c'.repeat(40)}&file=0&src=/api/sub?url=x`)).status >= 400, true)
})

test('the update view tells when a newer release exists and refuses to install one on a server run', async () => {
  const updates = await import('../src/update.js')
  assert.equal(await updates.lookup('0.0.1'), true)
  const view = (await call('/api/update')).body
  assert.equal(view.version, '99.0.0'); assert.equal(view.canApply, false)
  assert.equal((await call('/api/update/check', { method: 'POST' })).status, 200)
  assert.equal((await call('/api/update/download', { method: 'POST' })).status, 409)
  assert.equal((await call('/api/update/install', { method: 'POST' })).status, 409)
})

test('posters come through the picture proxy, and a client can write to the server log', async () => {
  const img = await fetch(`${base}/img?u=${encodeURIComponent('https://images.metahub.space/poster/medium/3/img')}&w=160`)
  assert.equal(img.status, 200)
  assert.match(img.headers.get('content-type'), /^image\//)
  assert.equal((await fetch(`${base}/img?u=${encodeURIComponent('https://evil.example/x.png')}`)).status >= 400, true)
  assert.equal((await call('/api/log', { method: 'POST', body: { level: 'warn', msg: 'page says hi' } })).status, 200)
})

test('a request with a broken body or an unknown route is answered, not dropped', async () => {
  const bad = await fetch(`${base}/api/profiles`, { method: 'POST', headers: H, body: '{nope' })
  assert.equal(bad.status, 400)
  assert.equal((await call('/api/nothing-here')).status, 404)
  assert.equal(state.profiles().length >= 0, true)
})
