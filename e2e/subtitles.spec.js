import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { boot, shutdown, stub, resetStubs, json, LONG, MOVIE, SYNC_LAG } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
after(shutdown)

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
async function until (fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn(); if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 250))
  }
}

test('a subtitle that runs late is measured against the audio of the film and shifted back', async () => {
  const played = await (await post('/api/play', { type: 'movie', id: LONG.id })).json()
  const hash = played.hash
  await until(async () => (await (await fetch(`${base}/api/status/${hash}`)).json()).phase === 'done')
  const info = await until(async () => { const r = await fetch(`${base}/api/info/${hash}`); return r.ok && r.json() })
  assert.equal(info.sidecar.length, 1)
  const src = `/api/sub/file/${hash}/${info.sidecar[0].i}`
  const q = new URLSearchParams({ hash, file: String(info.fileIdx ?? 0), src })
  const res = await until(async () => { const r = await (await fetch(`${base}/api/sub/sync?${q}`)).json(); return !r.pending && r })
  assert.ok(res.anchors?.length, JSON.stringify(res))
  assert.ok(Math.abs(res.anchors[0].d + SYNC_LAG) < 0.15, `offset ${res.anchors[0].d}`)
  // a second ask is answered from the cache, and the playhead probe works too
  assert.deepEqual((await (await fetch(`${base}/api/sub/sync?${q}`)).json()).anchors, res.anchors)
  const probe = await (await fetch(`${base}/api/sub/sync?${q}&at=100&ratio=1&expected=${-SYNC_LAG}`)).json()
  assert.ok('probe' in probe, JSON.stringify(probe))
})

const ZIP = Buffer.from('UEsDBBQAAAAIAHq4Tl2sKpPYBAAAAAIAAAAKAAAAcmVhZG1lLnR4dMvIBABQSwMEFAAAAAgAerhOXbqqp4AnAAAALwAAAA0AAABtb3ZpZS50dXIuc3J0M+QyMLACIUMdAwMDBV1dOwWogBFIgMs3tSgjMSlRIeXwnrzKRC4AUEsBAhQDFAAAAAgAerhOXawqk9gEAAAAAgAAAAoAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS50eHRQSwECFAMUAAAACAB6uE5duqqngCcAAAAvAAAADQAAAAAAAAAAAAAAgAEsAAAAbW92aWUudHVyLnNydFBLBQYAAAAAAgACAHMAAAB+AAAAAAA=', 'base64')
const SRT = text => `1\n00:00:01,000 --> 00:00:03,000\n${text}\n`
const row = (lang, name, rating) => `<tr data-id="1"><td class="rating-cell">${rating}</td><td class="flag-cell"><span class="sub-lang">${lang}</span></td><td><a href="/subtitles/${name}"><span class="text-muted">subtitle</span> Night.Harbor.2020.1080p</a></td></tr>`
const restRow = (n, lang) => ({ SubLanguageID: lang, SubFormat: 'srt', SubDownloadLink: `https://dl.opensubtitles.org/en/download/src-api/vrf-1/sid-${n}.gz`, MovieReleaseName: 'Night.Harbor.2020.1080p.WEB-DL', SubDownloadsCnt: '900', SubRating: '8.0', SubEncoding: 'UTF-8' })

test('subtitles from the addon, OpenSubtitles and yify are merged, ranked and served as WebVTT', async () => {
  stub('opensubtitles-v3.strem.io', () => json({ subtitles: [{ lang: 'eng', url: 'https://subs5.strem.io/a.srt', movieReleaseName: 'Night.Harbor.2020.1080p.WEB-DL', g: '5' }] }))
  stub('rest.opensubtitles.org', url => json(url.pathname.endsWith('sublanguageid-tur') ? [restRow(11, 'tur')] : []))
  stub('yifysubtitles.ch', url => url.pathname.startsWith('/movie-imdb/') ? new Response(`<table>${row('Turkish', 'night-harbor-turkish', 9)}</table>`) : new Response(ZIP))
  stub('subs5.strem.io', () => new Response(SRT('From the addon')))
  stub('dl.opensubtitles.org', () => new Response(zlib.gzipSync(SRT('From the search API'))))
  const list = await (await fetch(`${base}/api/subs?type=movie&id=${MOVIE.id}&langs=eng,tur&release=Night.Harbor.2020.1080p.WEB-DL`)).json()
  assert.deepEqual(list.map(s => s.lang).sort(), ['eng', 'tur', 'tur'])
  const text = async s => (await fetch(`${base}/api/sub?url=${encodeURIComponent(s.url)}&enc=${s.enc || ''}`)).text()
  const bodies = await Promise.all(list.map(text))
  for (const b of bodies) assert.match(b, /^WEBVTT/)
  assert.ok(bodies.some(b => /From the addon/.test(b)))
  assert.ok(bodies.some(b => /From the search API/.test(b)))
  assert.ok(bodies.some(b => /Merhaba/.test(b)))
  assert.equal((await fetch(`${base}/api/sub?url=${encodeURIComponent('https://evil.example/x.srt')}`)).status, 400)
  resetStubs()
})

test('once the anonymous download quota is used up, the profile account takes over and others see the files as limited', async () => {
  const rpc = (status, data = '') => new Response(`<methodResponse><params><param><value><struct><member><name>status</name><value><string>${status}</string></value></member><member><name>token</name><value><string>tok</string></value></member><member><name>data</name><value><string>${data}</string></value></member></struct></value></param></params></methodResponse>`)
  stub('opensubtitles-v3.strem.io', () => json({ subtitles: [] }))
  stub('rest.opensubtitles.org', () => json([restRow(22, 'eng')]))
  stub('dl.opensubtitles.org', () => new Response('quota', { status: 404 }))
  stub('api.opensubtitles.org', (url, init) => /LogIn/.test(init.body) ? (/wrong/.test(init.body) ? rpc('401 Unauthorized') : rpc('200 OK')) : rpc('200 OK', zlib.gzipSync(SRT('Through the account')).toString('base64')))
  const mine = await (await post('/api/profiles', { name: 'Quota', color: '#e5646e' })).json()
  const other = await (await post('/api/profiles', { name: 'Other', color: '#6fb7e9' })).json()
  const as = (p, id) => ({ 'x-profile': id, 'content-type': 'application/json' })
  const put = (id, body) => fetch(`${base}/api/opensubtitles`, { method: 'PUT', headers: as(0, id), body: JSON.stringify(body) })
  assert.equal((await put(mine.id, { user: 'nina', pass: 'wrong' })).status, 401)
  assert.equal((await put(mine.id, { user: '', pass: '' })).status, 400)
  assert.equal((await put(mine.id, { user: 'nina', pass: 'right' })).status, 200)
  assert.equal((await (await fetch(`${base}/api/opensubtitles`, { headers: as(0, mine.id) })).json()).user, 'nina')
  const q = `type=movie&id=${MOVIE.id}&langs=eng&release=Night.Harbor.2020.1080p.WEB-DL`
  const listed = await (await fetch(`${base}/api/subs?${q}`, { headers: as(0, mine.id) })).json()
  const url = encodeURIComponent(listed[0].url)
  // the first anonymous attempt hits the 404 quota wall and falls through to the account
  const viaAccount = await fetch(`${base}/api/sub?url=${url}`, { headers: as(0, mine.id) })
  assert.match(await viaAccount.text(), /Through the account/)
  const stranger = await fetch(`${base}/api/sub?url=${encodeURIComponent('https://dl.opensubtitles.org/en/download/src-api/vrf-1/sid-99.gz')}`, { headers: as(0, other.id) })
  assert.equal(stranger.status, 429)
  assert.equal((await (await fetch(`${base}/api/subs?${q}`, { headers: as(0, other.id) })).json())[0].limited, true)
  assert.equal((await fetch(`${base}/api/opensubtitles`, { method: 'DELETE', headers: as(0, mine.id) })).status, 200)
  assert.equal((await (await fetch(`${base}/api/opensubtitles`, { headers: as(0, mine.id) })).json()).user, null)
  resetStubs()
})
