// The HTTP surface of the server with every outside service answered by fixtures. No torrents: those are exercised by the e2e specs.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('server')
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
  if (url.hostname === 'tr.wikipedia.org') return Promise.resolve(json({ type: 'standard', extract: 'Bu, ozeti Vikipedi tarafindan verilen ve altmis karakterden uzun olan bir aciklama metnidir.' }))
  if (url.hostname === 'query.wikidata.org') return Promise.resolve(json({ results: { bindings: [{ id: { value: 'tt700000' }, label: { value: 'Film Sifir' }, an: { value: 'Film Sifir (film)' } }] } }))
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
  local.hooks.match = async p => ({ type: 'movie', mid: /spicy/i.test(p.title) ? 'tt700099' : 'tt700000', name: p.title, poster: null, year: p.year })
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
  assert.match(one.description, /Vikipedi/)
  assert.equal(one.localized, true)
  assert.equal((await call('/api/meta/movie/tt700000', { headers: { 'x-lang': 'en' } })).body.name, 'Film 0')
})

test('files in the media folder are matched to titles, listed and served with range support', async () => {
  const file = path.join(process.env.MEDIA_DIR, 'Film.Zero.2000.1080p.mkv')
  // Long enough (over two minutes) for subtitle sync to have something to measure, with a built-in text track that has enough cues to be a reference.
  const cues = Array.from({ length: 45 }, (_, n) => `${n + 1}\n00:${String(Math.floor(n * 3 / 60)).padStart(2, '0')}:${String(n * 3 % 60).padStart(2, '0')},000 --> 00:${String(Math.floor((n * 3 + 1) / 60)).padStart(2, '0')}:${String((n * 3 + 1) % 60).padStart(2, '0')},000\nLine ${n + 1}\n`).join('\n')
  fs.writeFileSync(path.join(tmp, 'cues.srt'), cues)
  fs.writeFileSync(path.join(process.env.MEDIA_DIR, 'Film.Zero.2000.1080p.en.srt'), cues)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2:duration=140', '-f', 'lavfi', '-i', 'sine=duration=140', '-i', path.join(tmp, 'cues.srt'), '-c:v', 'libx264', '-c:a', 'aac', '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-t', '140', file])
  assert.equal((await call('/api/local/rescan', { method: 'POST' })).body.count, 1)
  const [entry] = (await call('/api/local')).body
  assert.equal(entry.mid, 'tt700000')
  const part = await fetch(`${base}/raw/${entry.id}/0`, { headers: { range: 'bytes=0-9' } })
  assert.equal(part.status, 206)
  const info = (await call(`/api/info/${entry.id}`)).body
  assert.ok(info.duration > 130 && info.direct === false)
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

const localFilm = async () => (await call('/api/local')).body[0]

test('subtitles beside a local film and inside it are served as WebVTT', async () => {
  const film = await localFilm()
  const info = (await call(`/api/info/${film.id}`)).body
  assert.equal(info.sidecar[0].lang, 'eng')
  assert.match(await (await fetch(`${base}/api/sub/file/${film.id}/${info.sidecar[0].i}`)).text(), /^WEBVTT[\s\S]*Line 1/)
  const embedded = await fetch(`${base}/api/sub/embedded/${film.id}/0/0`)
  assert.match(await embedded.text(), /Line 45/)
  assert.equal(embedded.headers.get('x-covered'), 'full')
  assert.match(await (await fetch(`${base}/api/sub/embedded/${film.id}/0/0`)).text(), /Line 1/, 'the second read comes from the saved copy')
})

test('the HLS playlist can carry a subtitle rendition, from a file or from a language search', async () => {
  const film = await localFilm()
  const sub = `/api/sub/embedded/${film.id}/0/0`
  const master = await (await fetch(`${base}/hls/${film.id}/0/index.m3u8?sub=${encodeURIComponent(sub)}&sl=eng&sn=English&a=0&h=360`)).text()
  assert.match(master, /TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="eng"/)
  assert.match(await (await fetch(`${base}/hls/${film.id}/0/media.m3u8?a=0`)).text(), /#EXT-X-ENDLIST/)
  assert.match(await (await fetch(`${base}/hls/${film.id}/0/subs.m3u8?sub=${encodeURIComponent(sub)}`)).text(), /sub\.vtt\?sub=/)
  const own = await (await fetch(`${base}/hls/${film.id}/0/sub.vtt?sub=${encodeURIComponent(sub)}`)).text()
  assert.match(own, /^WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n/)
  const found = await (await fetch(`${base}/hls/${film.id}/0/sub.vtt?sl=eng&t=movie&mid=tt700000`)).text()
  assert.match(found, /A line/)
  assert.equal((await fetch(`${base}/hls/${film.id}/0/sub.vtt?sl=tur&t=movie&mid=tt700000`)).status, 404)
  assert.equal((await fetch(`${base}/hls/${film.id}/0/sub.vtt?sl=eng`)).status, 400)
  assert.equal((await fetch(`${base}/hls/${film.id}/0/sub.vtt?sub=${encodeURIComponent('/api/other')}`)).status, 400)
  assert.equal((await fetch(`${base}/hls/${film.id}/0/sub.vtt?sub=${encodeURIComponent('/api/sub/file/zzz/0')}`)).status >= 400, true)
})

test('subtitle sync measures a subtitle against the film and the built-in track, and answers for the playhead', async () => {
  const film = await localFilm()
  const info = (await call(`/api/info/${film.id}`)).body
  const q = new URLSearchParams({ hash: film.id, file: '0', src: `/api/sub/file/${film.id}/${info.sidecar[0].i}` })
  const first = (await call(`/api/sub/sync?${q}`)).body
  assert.equal(first.pending, undefined, JSON.stringify(first))
  assert.equal(first.partial, false)
  assert.deepEqual((await call(`/api/sub/sync?${q}`)).body, first, 'the second ask is the cached answer')
  assert.equal(JSON.stringify((await call(`/api/sub/sync?${q}&fresh=1&near=60`)).body).includes('pending'), false)
  const probe = (await call(`/api/sub/sync?${q}&at=70&ratio=1&expected=0`)).body
  assert.ok('probe' in probe, JSON.stringify(probe))
})

test('translation is refused for languages it has no model for and fails cleanly when no model can be fetched', async () => {
  const film = await localFilm()
  const src = encodeURIComponent(`/api/sub/embedded/${film.id}/0/0`)
  assert.equal((await call(`/api/sub/translate?src=${src}&to=xx`)).status, 400)
  assert.equal((await call(`/api/sub/translate?src=${encodeURIComponent('/api/other')}&to=tr`)).status, 400)
  assert.equal((await call(`/api/sub/translate?src=${src}&to=tr`)).status >= 400, true)
  assert.deepEqual((await call('/api/translate/langs')).body, [])
  assert.deepEqual((await call(`/api/sub/translate/status?src=${src}&to=tr`)).body.stage !== undefined, true)
  assert.equal((await call('/api/sub/translate/stop', { method: 'POST', body: { src: `/api/sub/embedded/${film.id}/0/0`, to: 'tr' } })).status, 200)
  assert.equal(typeof (await call('/api/translate/better')).body, 'object')
})

test('a profile PIN is set, checked, throttled and removed', async () => {
  const { body: { id } } = await call('/api/profiles', { method: 'POST', body: { name: 'Locked' } })
  assert.equal((await call(`/api/profiles/${id}/unlock`, { method: 'POST', body: {} })).body.token, '', 'no PIN: nothing to unlock')
  assert.equal((await call('/api/profiles/nobody/unlock', { method: 'POST', body: { pin: '1' } })).status, 404)
  assert.equal((await call('/api/me/pin', { method: 'PUT', headers: { 'x-profile': id }, body: { pin: '12' } })).status, 400)
  const set = await call('/api/me/pin', { method: 'PUT', headers: { 'x-profile': id }, body: { pin: '2468' } })
  assert.ok(set.body.token)
  const auth = { 'x-profile': id, 'x-token': set.body.token }
  assert.equal((await call('/api/me/pin', { method: 'PUT', headers: auth, body: { pin: '1357', current: '0000' } })).status, 403)
  assert.equal((await call(`/api/profiles/${id}/unlock`, { method: 'POST', body: { pin: '2468' } })).status, 200)
  for (let i = 0; i < 5; i++) await call(`/api/profiles/${id}/unlock`, { method: 'POST', body: { pin: '9999' } })
  assert.equal((await call(`/api/profiles/${id}/unlock`, { method: 'POST', body: { pin: '2468' } })).status, 429)
  assert.equal((await call('/api/me/pin', { method: 'PUT', headers: auth, body: { pin: '', current: '2468' } })).status, 429)
})

test('the adult filter hides adult titles from the library and local files', async () => {
  const { cached } = await import('../src/meta.js')
  await cached('meta6:movie:tt700099', 1e6, async () => ({ id: 'tt700099', name: 'Spicy', genres: ['Adult'] }))
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2:duration=2', '-t', '2', path.join(process.env.MEDIA_DIR, 'Spicy.Film.2001.mkv')])
  assert.equal((await call('/api/local/rescan', { method: 'POST' })).body.count, 2)
  const hidden = { 'x-adult-filter': '1' }
  assert.deepEqual((await call('/api/local', { headers: hidden })).body.map(e => e.mid), ['tt700000'])
  assert.equal((await call('/api/local')).body.length, 2)
  assert.deepEqual((await call('/api/library', { headers: hidden })).body, [])
  assert.deepEqual((await call('/api/downloads', { headers: hidden })).body.queue, [])
})

test('a watch party can be started as a lobby, followed over server-sent events and left', async () => {
  const { party } = await import('../src/party.js')
  party.options = { trackers: [], dht: false }
  const started = await call('/api/party/start', { method: 'POST', body: { password: 'pw' } })
  assert.equal(started.body.active, true)
  assert.equal(started.body.locked, true)
  const events = await fetch(`${base}/api/party/events`)
  const reader = events.body.getReader()
  const first = new TextDecoder().decode((await reader.read()).value)
  assert.match(first, /"type":"status"[\s\S]*"active":true/)
  await reader.cancel()
  assert.equal((await call('/api/party/start', { method: 'POST', body: { item: { type: 'movie', id: 'tt700000', title: 'Film 0' }, hash: 'f'.repeat(40) } })).status, 409)
  assert.equal((await call('/api/party/leave', { method: 'POST', body: {} })).status, 200)
  const again = await call('/api/party/start', { method: 'POST', body: { item: { type: 'movie', id: 'tt700000', title: 'Film 0' }, hash: 'f'.repeat(40), pos: 12 } })
  assert.equal(again.body.now.item.id, 'tt700000')
  assert.equal(again.body.now.source, null, 'an unknown torrent is not shared')
  await call('/api/party/leave', { method: 'POST', body: {} })
})
