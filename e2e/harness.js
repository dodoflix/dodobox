// Boots the real server in this process with every outbound request answered from fixtures, plus a local
// tracker and seeder so a title can be played end to end in a real browser without internet.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright-core'
import { Server as Tracker } from 'bittorrent-tracker'
import WebTorrent from 'webtorrent'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-ui-'))
Object.assign(process.env, {
  DATA_DIR: path.join(tmp, 'data'), HOME: tmp, NO_SPEEDTEST: '1', NO_UPDATE_CHECK: '1', NO_DHT: '1', NO_MDNS: '1', NO_DISCORD: '1', ALLOWED_HOSTS: 'localhost'
})

export const MOVIE = { id: 'tt9000001', type: 'movie', name: 'Night Harbor', year: 2020, file: 'Night.Harbor.2020.1080p.WEB-DL.mkv', genres: ['Drama'], description: 'A ferry pilot takes one last crossing.' }
export const SERIES = { id: 'tt9000002', type: 'series', name: 'Paper Lanterns', year: 2021, file: 'Paper.Lanterns.S01E01.1080p.WEB-DL.mkv', genres: ['Comedy'], description: 'Neighbours share one very old festival.' }
export const ANIME = { id: 'al:9001', name: 'Moon Station Nine', year: 2022, genres: ['Sci-Fi'], description: 'A night shift on the far side.' }
const dramas = Array.from({ length: 8 }, (_, n) => ({ id: `tt91000${n}`, type: 'movie', name: `Harbor Lights ${n + 1}`, year: 2010 + n, genres: ['Drama'], description: 'Filler drama.' }))
export const CATALOG = [MOVIE, SERIES, { id: 'tt9000003', type: 'movie', name: 'Quiet Orbit', year: 2019, genres: ['Sci-Fi'], description: 'Two engineers, one silent station.' }, ...dramas]

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
    const t = [MOVIE, SERIES].find(c => u.pathname.includes(c.id))
    const wanted = t && (t.type === 'movie' || u.pathname.includes(`${t.id}:1:1`))
    return json({ streams: wanted && seeded ? [{ name: 'Torrentio\n1080p', title: `${t.file.replace(/\.mkv$/, '')}\n\u{1F464} 25 \u{1F4BE} 1.2 GB ⚙️ Fixture`, infoHash: seeded[t.id].infoHash, sources: [`tracker:${seeded.announce}`] }] : [] })
  }
  if (key === 'graphql.anilist.co') {
    const id = JSON.parse(init.body).variables.id
    const media = [{ id: 9001, idMal: 1, title: { romaji: ANIME.name, english: ANIME.name }, coverImage: { extraLarge: 'https://s4.anilist.co/cover.png' }, seasonYear: ANIME.year, averageScore: 80, genres: ANIME.genres, description: ANIME.description, episodes: 2, duration: 24, format: 'TV', status: 'FINISHED', countryOfOrigin: 'JP' }]
    return json({ data: { Page: { media: id && id !== 9001 ? [] : media } } })
  }
  if (key === 'www.netflix.com' && u.pathname.endsWith('all-weeks-countries.tsv')) return new Response(`country_name\tcountry_iso2\tweek\tcategory\tweekly_rank\tshow_title\tseason_title\n${['United States\tUS\t2026-01-04\tFilms\t1\t' + MOVIE.name + '\t', 'United States\tUS\t2026-01-04\tTV\t1\t' + SERIES.name + '\t'].join('\n')}\n`)
  if (key === 'www.netflix.com') return new Response(`week\tcategory\tweekly_rank\tshow_title\tseason_title\tweekly_hours_viewed\n2026-01-04\tFilms (English)\t1\t${MOVIE.name}\t\t900\n2026-01-04\tTV (English)\t1\t${SERIES.name}\t\t800\n`)
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

// H.264 + AC3 in MKV with an embedded subtitle: not browser-direct, so playback goes through the HLS transcoder.
function makeVideo (file, subtitle) {
  const srt = path.join(tmp, 'sub.srt')
  fs.writeFileSync(srt, `1\n00:00:01,000 --> 00:00:04,000\n${subtitle}\n`)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-i', srt,
    '-c:v', 'libx264', '-g', '24', '-c:a', 'ac3', '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-t', '20', file])
}

export async function boot ({ seed = true } = {}) {
  if (seed) {
    tracker = new Tracker({ udp: false, ws: false, http: true, stats: false })
    await new Promise(r => tracker.listen(0, '127.0.0.1', r))
    const announce = `http://127.0.0.1:${tracker.http.address().port}/announce`
    seeder = new WebTorrent({ dht: false, lsd: false, utp: false })
    seeded = { announce }
    for (const t of [MOVIE, SERIES]) {
      const dir = path.join(tmp, 'seed', t.id); fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, t.file)
      makeVideo(file, `Hello from ${t.name}`)
      seeded[t.id] = await new Promise(r => seeder.seed(file, { announce: [announce] }, r))
    }
  }
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
  seeder && await new Promise(r => seeder.destroy(r))
  fs.rmSync(tmp, { recursive: true, force: true })
}

export async function newPage (base, opts = {}) {
  const ctx = await browser.newContext({ locale: 'en', viewport: { width: 1280, height: 800 }, ...opts })
  ctx.setDefaultTimeout(15000)
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
