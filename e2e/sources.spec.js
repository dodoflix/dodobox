import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE, SERIES, ANIME, TWIN } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: ['twin'] })) })
after(shutdown)
afterEach(resetStubs)

const hash = n => String(n).padStart(40, 'a')
const sources = async q => (await fetch(`${base}/api/sources?${new URLSearchParams(q)}`)).json()
const torrentio = streams => () => json({ streams: streams.map(([name, n, seeders]) => ({ name: `Torrentio\n${/(\d+)p/.exec(name)?.[0] || '1080p'}`, title: `${name}\n\u{1F464} ${seeders} \u{1F4BE} 1.4 GB ⚙️ Fixture`, infoHash: hash(n) })) })

test('a movie the id-keyed source barely knows is searched by name on every other source, deduplicated and ranked', async () => {
  stub('torrentio.strem.fun', torrentio([['Night.Harbor.2020.1080p.WEB-DL', 1, 40]]))
  stub('movies-api.accel.li', () => json({ data: { movies: [{ title_long: 'Night Harbor (2020)', torrents: [{ hash: hash(2).toUpperCase(), quality: '720p', type: 'web', video_codec: 'x264', seeds: 12, size_bytes: 900e6 }] }] } }))
  stub('apibay.org', () => json([{ name: 'Night.Harbor.2020.2160p.UHD.BluRay', info_hash: hash(3), seeders: '9', size: '9000000000', imdb: MOVIE.id }, { name: 'Night.Harbor.2020.1080p.WEB-DL', info_hash: hash(1), seeders: '3', size: '1400000000' }, { name: 'Other.Film.2020.1080p', info_hash: hash(4), seeders: '99', size: '1000000000' }]))
  stub('api.knaben.org', () => json({ hits: [{ title: 'Night.Harbor.2020.1080p.BluRay.x265', hash: hash(5), seeders: 7, bytes: 2.1e9 }] }))
  const list = await sources({ type: 'movie', id: MOVIE.id })
  assert.deepEqual([...new Set(list.map(s => s.provider))].sort(), ['Fixture', 'Knaben', 'TPB', 'YTS'])
  assert.ok(list.length >= 4, JSON.stringify(list.map(s => s.title)))
  assert.equal(new Set(list.map(s => s.infoHash)).size, list.length)
  assert.ok(list.every(s => !('magnet' in s)))
  assert.ok(!list.some(s => /Other.Film/.test(s.title)))
})

test('a series episode is found in season packs and the complete series too', async () => {
  stub('torrentio.strem.fun', torrentio([]))
  stub('apibay.org', url => {
    const q = url.searchParams.get('q')
    return json(/complete/.test(q) ? [{ name: 'Paper.Lanterns.Complete.Series.1080p', info_hash: hash(7), seeders: '5', size: '40000000000' }] : /Season/.test(q) ? [{ name: 'Paper.Lanterns.S01.1080p.WEB-DL', info_hash: hash(6), seeders: '8', size: '12000000000' }] : [])
  })
  stub('api.knaben.org', () => json({ hits: [] }))
  const list = await sources({ type: 'series', id: SERIES.id, season: 1, episode: 2 })
  assert.deepEqual(list.map(s => s.pack), [true, true])
})

test('an anime episode is looked up by Kitsu and AniDB ids first and by name on Nyaa when those are thin', async () => {
  const item = (n, title, seeders) => `<item><title>${title}</title><nyaa:infoHash>${hash(n)}</nyaa:infoHash><nyaa:seeders>${seeders}</nyaa:seeders><nyaa:size>1.4 GiB</nyaa:size></item>`
  stub('torrentio.strem.fun', torrentio([]))
  stub('animetosho.org', url => json(url.search.includes('eid=') ? [{ title: '[Grp] Moon Station Nine - 01 [1080p]', torrent_name: '[Grp] Moon Station Nine - 01 [1080p].mkv', info_hash: hash(8), seeders: 30, total_size: 1.4e9, num_files: 1 }] : [{ title: '[Grp] Moon Station Nine (Batch) [1080p]', info_hash: hash(9), seeders: 4, total_size: 20e9, num_files: 26 }]))
  stub('nyaa.si', url => new Response(`<rss>${/batch/.test(url.search) ? item(10, '[Grp] Moon Station Nine (Batch) [1080p]', 6) : item(11, '[Grp] Moon Station Nine - 01 [720p]', 9)}</rss>`))
  const list = await sources({ type: 'anime', id: ANIME.id, season: 1, episode: 1 })
  const providers = new Set(list.map(s => s.provider))
  assert.ok(providers.has('AnimeTosho') && providers.has('Nyaa'), [...providers].join())
  assert.ok(list.some(s => s.pack) && list.some(s => !s.pack))
})

test('two similar versions of a film are raced and the film plays', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/movie/${TWIN.id}`)
  await page.waitForFunction(() => { const v = document.querySelector('.pl video'); return v && v.currentTime > 1 && !v.paused }, null, { timeout: 60000 })
  // a version that finished while racing stays in the library, so both may be there; the player has one of them
  const library = await (await fetch(`${base}/api/library`)).json()
  assert.ok(library.some(e => e.ctx.id === TWIN.id))
  await ctx.close()
})

test('asking for another version while the first is still being probed does not play the first', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  const played = []; const streamed = new Set(); let attached = 0
  page.on('response', async r => { if (r.url().endsWith('/api/play')) played.push((await r.json()).hash) })
  page.on('request', r => { const m = /\/(?:hls|raw)\/([0-9a-f]{40})\//.exec(r.url()); if (m) streamed.add(m[1]); if (/index\.m3u8/.test(r.url())) attached++ })
  // the probe of the first version answers late, after the viewer has already asked for another one
  let asked; const another = new Promise(r => { asked = r })
  await page.route('**/api/info/**', async route => { const res = await route.fetch(); await another; await route.fulfill({ response: res }).catch(() => {}) })
  await page.goto(`${base}/#/watch/movie/${TWIN.id}`)
  await page.waitForRequest('**/api/info/**')
  await page.evaluate(() => { document.querySelector('#l-act').innerHTML = '<button id="another">Try another version</button>'; document.querySelector('#another').click() })
  asked()
  await page.waitForFunction(() => { const v = document.querySelector('.pl video'); return v && v.currentTime > 1 && !v.paused }, null, { timeout: 60000 })
  assert.equal(played.length, 2, 'a second version was asked for')
  assert.deepEqual([...streamed], [played[1]], 'only the version asked for second was streamed')
  assert.equal(attached, 1, 'the stream was attached once, not again by the superseded run')
  await ctx.close()
})

test('the seeder count a source lists is replaced by what the trackers report live', async () => {
  const ask = async () => (await fetch(`${base}/api/sources?type=movie&id=${TWIN.id}`)).json()
  await ask()
  const row = (await ask()).find(s => s.reportedSeeders)
  assert.ok(row, 'a row carries the live count')
  assert.ok(row.seeders >= 1 && row.seeders < row.reportedSeeders, `${row.seeders} of ${row.reportedSeeders}`)
})
