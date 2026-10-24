// Boots the real server in this process with every outbound request answered from fixtures, plus a local
// tracker and seeder so a title can be played end to end in a real browser without internet.
// Anything from src/ is imported dynamically, after boot(): this module is async, so a static import of src/ in a spec can load it before
// DATA_DIR points at the temp folder, and the run would use the developer's own data.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { Server as Tracker } from 'bittorrent-tracker'
import WebTorrent from 'webtorrent'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-ui-'))
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'), HOME: tmp, NO_SPEEDTEST: '1', MIN_LOCAL_BYTES: '1000', MEDIA_DIR: path.join(tmp, 'media'), NO_UPDATE_CHECK: '1', NO_DHT: '1', NO_MDNS: '1', NO_DISCORD: '1', ALLOWED_HOSTS: 'localhost'
})

export const MOVIE = { id: 'tt9000001', type: 'movie', name: 'Night Harbor', year: 2020, file: 'Night.Harbor.2020.1080p.WEB-DL.mkv', genres: ['Drama'], description: 'A ferry pilot takes one last crossing.' }
export const SERIES = { id: 'tt9000002', type: 'series', name: 'Paper Lanterns', year: 2021, file: 'Paper.Lanterns.S01E01.1080p.WEB-DL.mkv', genres: ['Comedy'], description: 'Neighbours share one very old festival.' }
export const ANIME = { id: 'al:9001', name: 'Moon Station Nine', year: 2022, genres: ['Sci-Fi'], description: 'A night shift on the far side.' }
// A longer film with speech-like audio and its own subtitle file, for the automatic subtitle sync. The subtitle runs SYNC_LAG seconds late.
export const LONG = { id: 'tt9000004', type: 'movie', name: 'Long Take', year: 2018, file: 'Long.Take.2018.1080p.WEB-DL.mkv', genres: ['Drama'], description: 'One scene, many minutes.' }
export const SYNC_LAG = 3.2
// Two torrents of the same film, so playing it starts a race between versions.
export const TWIN = { id: 'tt9000005', type: 'movie', name: 'Twin Streams', year: 2017, file: 'Twin.Streams.2017.1080p.WEB-DL.mkv', alt: 'Twin.Streams.2017.1080p.BluRay.mkv', genres: ['Drama'], description: 'Same story, two sources.' }
export const ORCHARD = { id: 'tt9000006', type: 'series', name: 'Glass Orchard', year: 2020, genres: ['Drama'], description: 'A greenhouse that remembers.' }
// A film and an episode on the viewer's own disk (MEDIA_DIR), played without any torrent.
export const HOME = { id: 'tt9000007', type: 'movie', name: 'Home Movie', year: 2015, genres: ['Drama'], description: 'Filmed on a holiday.' }
const rows = Array.from({ length: 4 }, (_, n) => ({ id: `tt91100${n}`, type: 'series', name: `Orchard Row ${n + 1}`, year: 2012 + n, genres: ['Drama'], description: 'Filler series.' }))
const dramas = Array.from({ length: 8 }, (_, n) => ({ id: `tt91000${n}`, type: 'movie', name: `Harbor Lights ${n + 1}`, year: 2010 + n, genres: ['Drama'], description: 'Filler drama.' }))
export const CATALOG = [MOVIE, SERIES, { id: 'tt9000003', type: 'movie', name: 'Quiet Orbit', year: 2019, genres: ['Sci-Fi'], description: 'Two engineers, one silent station.' }, LONG, TWIN, ORCHARD, HOME, ...dramas, ...rows]

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const metaOf = (t, extra = {}) => ({
  id: t.id, imdb_id: t.id, name: t.name, year: String(t.year), releaseInfo: String(t.year), genres: t.genres, description: t.description,
  poster: `https://images.metahub.space/poster/medium/${t.id}/img`, background: `https://images.metahub.space/background/medium/${t.id}/img`, imdbRating: '7.4', ...extra
})
const videos = [1, 2].map(episode => ({ season: 1, episode, name: `Lantern ${episode}`, released: '2021-01-01T00:00:00.000Z' }))

let stubs = new Map()
let hits = []
export const upstreamHits = () => hits
// Replace one fixture, e.g. stub('torrentio', () => json({ streams: [] })). Cleared by resetStubs().
export const stub = (name, fn) => stubs.set(name, fn)
export const resetStubs = () => { stubs = new Map(); hits = [] }
export { json }

function upstream (url, init) {
  const u = new URL(url)
  const key = u.hostname
  const custom = stubs.get(key)
  if (custom) return custom(u, init)
  if (key === 'v3-cinemeta.strem.io') {
    const [, kind, type, id, extra] = u.pathname.match(/^\/(catalog|meta)\/(\w+)\/([^/]+?)(?:\/(.+?))?\.json$/) || []
    if (kind === 'meta') {
      const t = CATALOG.find(c => c.id === id && c.type === type)
      return t ? json({ meta: metaOf(t, type === 'series' ? { videos } : {}) }) : json({}, 404)
    }
    if (kind === 'catalog') {
      const p = new URLSearchParams(extra || ''); const q = p.get('search'); const genre = p.get('genre')
      const hits = CATALOG.filter(c => c.type === type && (!q || c.name.toLowerCase().includes(q.toLowerCase())) && (!genre || c.genres.includes(genre)))
      return json({ metas: hits.slice(+p.get('skip') || 0).map(c => metaOf(c)) })
    }
  }
  if (key === 'torrentio.strem.fun') {
    const t = [MOVIE, SERIES, LONG, TWIN].find(c => u.pathname.includes(c.id))
    const wanted = t && (t.type === 'movie' || u.pathname.includes(`${t.id}:1:1`))
    const streams = !wanted || !seeded ? [] : [].concat(seeded[t.id]).map((h, n) => ({ name: 'Torrentio\n1080p', title: `${(n ? t.alt : t.file).replace(/\.mkv$/, '')}\n\u{1F464} ${25 - n} \u{1F4BE} 1.2 GB ⚙️ Fixture`, infoHash: h.infoHash, sources: [`tracker:${seeded.announce}`] }))
    return json({ streams })
  }
  if (key === 'graphql.anilist.co') {
    const id = JSON.parse(init.body).variables.id
    const media = [{ id: 9001, idMal: 1, title: { romaji: ANIME.name, english: ANIME.name }, coverImage: { extraLarge: 'https://s4.anilist.co/cover.png' }, seasonYear: ANIME.year, averageScore: 80, genres: ANIME.genres, description: ANIME.description, episodes: 2, duration: 24, format: 'TV', status: 'FINISHED', countryOfOrigin: 'JP' }]
    return json({ data: { Page: { media: id && id !== 9001 ? [] : media } } })
  }
  if (key === 'www.netflix.com' && u.pathname.endsWith('all-weeks-countries.tsv')) {
    const line = (category, rank, title) => `United States\tUS\t2026-01-04\t${category}\t${rank}\t${title}\t`
    const films = ['Quiet Orbit', ...dramas.slice(1, 5).map(d => d.name)].map((t, n) => line('Films', n + 1, t))
    const shows = [ORCHARD.name, ...rows.map(d => d.name)].map((t, n) => line('TV', n + 1, t))
    return new Response(`country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\n${[...films, ...shows].join('\n')}\n`)
  }
  if (key === 'www.netflix.com') return new Response(`week\tcategory\tweekly_rank\tshow_title\tseason_title\tweekly_hours_viewed\n2026-01-04\tFilms (English)\t1\t${MOVIE.name}\t\t900\n2026-01-04\tTV (English)\t1\t${SERIES.name}\t\t800\n`)
  if (key === 'raw.githubusercontent.com') return json([{ anilist_id: 9001, kitsu_id: 42, anidb_id: 7, imdb_id: 'tt9000009', season: { tvdb: 1 } }])
  if (key === 'api.ani.zip') return json({ titles: { en: ANIME.name }, episodes: { 1: { anidbEid: 111, seasonNumber: 1, episodeNumber: 1, absoluteEpisodeNumber: 1 }, 2: { anidbEid: 112, seasonNumber: 1, episodeNumber: 2, absoluteEpisodeNumber: 2 } } })
  if (key === 'images.metahub.space' || key === 's4.anilist.co') return new Response(PNG, { headers: { 'content-type': 'image/png' } })
  return json({}, 404)
}

const realFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input)
  const { hostname } = new URL(url)
  if (hostname === '127.0.0.1' || hostname === 'localhost') return realFetch(input, init)
  hits.push(url)
  return Promise.resolve(upstream(url, init))
}

let seeded = null
let seeder, tracker, srv, browser
const udp = []

// H.264 + AC3 in MKV with an embedded subtitle: not browser-direct, so playback goes through the HLS transcoder.
function makeVideo (file, subtitle) {
  const srt = path.join(tmp, 'sub.srt')
  fs.writeFileSync(srt, `1\n00:00:01,000 --> 00:00:04,000\n${subtitle}\n`)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-i', srt,
    '-c:v', 'libx264', '-g', '24', '-c:a', 'ac3', '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-t', '20', file])
}

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
// Four minutes of noise bursts (the "speech") with a subtitle whose cues start SYNC_LAG seconds after each burst does.
function makeSpeechVideo (file, srtFile) {
  const rate = 16000; const seconds = 240; const r = rng(11)
  const samples = new Int16Array(rate * seconds)
  const bursts = []; let t = 5 + r() * 5
  while (t < seconds - 8) { const len = 0.6 + r() * 3.4; bursts.push([t, t + len]); t += len + 0.4 + r() * 4.5 }
  for (let i = 0; i < samples.length; i++) samples[i] = (r() - 0.5) * 60
  for (const [a, b] of bursts) {
    let level = 1
    for (let i = Math.floor(a * rate); i < Math.min(samples.length, Math.floor(b * rate)); i++) {
      if (i % 1600 === 0) level = 0.4 + r() * 0.6
      samples[i] = (r() - 0.5) * 16000 * level
    }
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + samples.length * 2, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(samples.length * 2, 40)
  const wav = path.join(tmp, 'speech.wav'); fs.writeFileSync(wav, Buffer.concat([header, Buffer.from(samples.buffer)]))
  const stamp = x => { const ms = Math.round(x * 1000); const p = (n, w) => String(n).padStart(w, '0'); return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}` }
  fs.writeFileSync(srtFile, bursts.map(([a, b], n) => `${n + 1}\n${stamp(a + SYNC_LAG)} --> ${stamp(b + SYNC_LAG)}\nLine ${n + 1}\n`).join('\n'))
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc=size=160x90:rate=10:duration=${seconds}`, '-i', wav, '-c:v', 'libx264', '-g', '20', '-c:a', 'ac3', '-t', String(seconds), file])
}

// seed: start the torrent fixtures; data(dir): put files in the data folder before the server reads it (an install from an older release).
export async function boot ({ seed = true, data, media = false } = {}) {
  if (seed) {
    tracker = new Tracker({ udp: false, ws: false, http: true, stats: false })
    await new Promise(r => tracker.listen(0, '127.0.0.1', r))
    const announce = `http://127.0.0.1:${tracker.http.address().port}/announce`
    // Two UDP trackers hear the seeder too, so live seeder counts (BEP 15 scrape) can be read from them.
    for (let i = 0; i < 2; i++) {
      const t = new Tracker({ udp: true, ws: false, http: false, stats: false })
      t.udp6.close(); t.udp6 = null // IPv4 only: a loopback address cannot be bound by the IPv6 socket
      const up = new Promise(r => t.udp4.once('listening', r))
      t.listen(0, '127.0.0.1')
      await up
      udp.push(t)
    }
    const announces = [announce, ...udp.map(t => `udp://127.0.0.1:${t.udp.address().port}`)]
    seeder = new WebTorrent({ dht: false, lsd: false, utp: false })
    seeded = { announce }
    const long = path.join(tmp, 'seed', LONG.id); fs.mkdirSync(long, { recursive: true })
    makeSpeechVideo(path.join(long, LONG.file), path.join(long, LONG.file.replace(/mkv$/, 'en.srt')))
    seeded[LONG.id] = await new Promise(r => seeder.seed(long, { announce: announces }, r))
    const twin = path.join(tmp, 'seed', TWIN.id); fs.mkdirSync(twin, { recursive: true })
    makeVideo(path.join(twin, TWIN.file), 'Hello twins')
    fs.copyFileSync(path.join(twin, TWIN.file), path.join(twin, TWIN.alt))
    seeded[TWIN.id] = await Promise.all([TWIN.file, TWIN.alt].map(f => new Promise(r => seeder.seed(path.join(twin, f), { announce: announces }, r))))
    for (const t of [MOVIE, SERIES]) {
      const dir = path.join(tmp, 'seed', t.id); fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, t.file)
      makeVideo(file, `Hello from ${t.name}`)
      seeded[t.id] = await new Promise(r => seeder.seed(file, { announce: announces }, r))
    }
  }
  if (media) {
    const dir = process.env.MEDIA_DIR; fs.mkdirSync(path.join(dir, 'Paper Lanterns', 'Subs'), { recursive: true })
    makeVideo(path.join(dir, 'Home.Movie.2015.1080p.mkv'), 'Hello from the disk')
    fs.writeFileSync(path.join(dir, 'Home.Movie.2015.1080p.en.srt'), '1\n00:00:01,000 --> 00:00:03,000\nBeside the file\n')
    makeVideo(path.join(dir, 'Paper Lanterns', 'Paper.Lanterns.S01E02.mkv'), 'Hello from the disk')
  }
  if ((await import('../src/paths.js')).DATA !== process.env.DATA_DIR) throw new Error('a module read the data folder before the harness set DATA_DIR')
  if (data) { fs.mkdirSync(process.env.DATA_DIR, { recursive: true }); data(process.env.DATA_DIR) }
  // Live seeder counts are read from the two local UDP trackers, never from the real ones.
  const { hooks } = await import('../src/sources.js')
  const { scrape } = await import('../src/tracker.js')
  hooks.scrape = hashes => scrape(hashes, udp.map(t => `udp://127.0.0.1:${t.udp.address().port}`), 800)
  const { start } = await import('../server.js')
  srv = await start(0)
  const base = `http://localhost:${srv.address().port}`
  browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH, args: ['--no-sandbox'] } : { channel: 'chrome' })
  return { base, browser }
}

export async function shutdown () {
  await browser?.close()
  const { stop } = await import('../server.js')
  await stop()
  tracker && await new Promise(r => tracker.close(r))
  await Promise.all(udp.map(t => new Promise(r => t.close(r))))
  seeder && await new Promise(r => seeder.destroy(r))
  fs.rmSync(tmp, { recursive: true, force: true })
}

export async function newPage (base, opts = {}) {
  const ctx = await browser.newContext({ locale: 'en', viewport: { width: 1280, height: 800 }, ...opts })
  ctx.setDefaultTimeout(30000)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  return { ctx, page, errors }
}

// Creates the profile on a fresh install (walking through onboarding) or picks it when it already exists.
export async function signIn (page, base, name) {
  await page.goto(base)
  const pick = page.locator('.pf[data-id]', { hasText: name })
  const first = page.locator('input[name=name]')
  const home = page.locator('.hero-body')
  await home.or(pick).or(first).first().waitFor()
  if (await home.count()) return
  if (await first.count()) {
    await first.fill(name)
    await page.click('text=Start watching')
    for (let i = 0; i < 3; i++) await page.click('.ob [data-next]')
    await page.locator('.ob').waitFor({ state: 'detached' })
  } else await pick.click()
  await home.waitFor()
}
