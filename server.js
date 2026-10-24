#!/usr/bin/env node
import http from 'node:http'
import { log } from './src/log.js'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import qr from 'qrcode-generator'
import { Bonjour } from 'bonjour-service'
import { fileURLToPath } from 'node:url'
import { catalog, meta, animeImdb, isAdultItem } from './src/meta.js'
import { findSources, measured, refreshTrackers, lengthFits } from './src/sources.js'
import { titleVerdict } from './src/release.js'
import { episodeNumbers, warm as warmIds } from './src/ids.js'
import { party, newCode, cleanItem, LIMITS } from './src/party.js'
import * as osaccount from './src/osaccount.js'
import { listSubtitles, allowedSubUrl, fetchSubtitle, srtToVtt, decode, toVtt, legacyEncoding } from './src/subs.js'
import * as engine from './src/engine.js'
import * as local from './src/local.js'
import * as downloads from './src/downloads.js'
import * as lock from './src/lock.js'
import { skipsFor } from './src/skips.js'
import { chartItems } from './src/charts.js'
import * as state from './src/state.js'
import { report as presence } from './src/presence.js'
import { image, remote } from './src/images.js'
import { lanAddresses, openBrowser } from './src/net.js'
import { encoder, FFMPEG } from './src/bin.js'
import * as speed from './src/speed.js'
import { race, rivalsOf, racing } from './src/race.js'
import { localizeItems, localizeMeta } from './src/locale.js'
import { syncInWorker, parseCues, shiftVtt, usable } from './src/sync.js'
import * as better from './src/translate-hq.js'
import { translateSubtitle, translateBetter, stopBetter, stopPool, targets as translateTargets, modelLang } from './src/translate.js'
import { once } from './src/http.js'
import { langOfName } from './src/sidecar.js'
import { DATA } from './src/paths.js'
import * as updates from './src/update.js'
import { probe, playlist, segment, warm, cancel, embeddedSub, anyToVtt, encodes, SEG } from './src/transcode.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(ROOT, 'public')
const FONTS = { '/vendor/hls.js': 'node_modules/hls.js/dist/hls.min.js' }
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' }
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version

const compress = (req, body, type) => {
  if (!/gzip/.test(req.headers['accept-encoding'] || '') || !/json|text|javascript|svg|manifest/.test(type) || body.length < 1024) return [body, {}]
  return [zlib.gzipSync(body), { 'content-encoding': 'gzip', vary: 'accept-encoding' }]
}
const send = (req, res, code, type, body, extra = {}) => {
  const [b, h] = compress(req, Buffer.isBuffer(body) ? body : Buffer.from(body), type)
  res.writeHead(code, { 'content-type': type, ...h, ...extra }).end(b)
}
const json = (req, res, data, code = 200) => send(req, res, code, 'application/json', JSON.stringify(data), { 'cache-control': 'no-store' })
const safeOf = req => req.headers['x-adult-filter'] === '1'
// An empty list may be a failure in disguise: the browser is not told to keep it.
const jsonCached = (req, res, data, maxAge = 180) => send(req, res, 200, 'application/json', JSON.stringify(data), { 'cache-control': Array.isArray(data) && !data.length ? 'no-store' : `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 5}`, vary: 'x-lang, x-adult-filter, accept-encoding' })
const isLocal = req => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')
const fail = (req, res, code, msg) => json(req, res, { error: msg }, code)
const body = req => new Promise((resolve, reject) => {
  const chunks = []; let n = 0
  req.on('data', c => { n += c.length; if (n > 5e6) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})
// For a failure that is handled by carrying on: it still goes to the log.
const swallow = (what, fallback) => e => { log.debug('server', `${what} failed`, { err: e }); return fallback }
const SECRET_FIELD = /^(pin|current|password|code|token|text)$/i
const clip = (v, n = 200) => (typeof v === 'string' && v.length > n ? v.slice(0, n) + '...' : v)
const jbody = async req => {
  try {
    const b = JSON.parse(await body(req))
    if (b && typeof b === 'object' && !Array.isArray(b) && req.url !== '/api/log') log.debug('body', `${req.method} ${req.url.split('?')[0]}`, Object.fromEntries(Object.entries(b).slice(0, 25).map(([k, v]) => [k, SECRET_FIELD.test(k) ? '***' : clip(typeof v === 'object' ? JSON.stringify(v) : v)])))
    return b
  } catch (e) { log.debug('body', 'bad JSON', { url: req.url.split('?')[0], err: e }); throw Object.assign(new Error('bad JSON'), { code: 400 }) }
}

let port
const rawUrl = (hash, idx) => `http://127.0.0.1:${port}/raw/${hash}/${idx}`
const statusOf = (h, silent, file) => local.isLocal(h) ? local.status(h) : engine.status(h, silent, file)
// A profile with a PIN is only itself for a request that carries a session token issued after the PIN was entered; otherwise it is nobody.
const unlocked = (id, req) => !state.hasPin(id) || lock.valid(id, req.headers['x-token'])
const pid = req => { const id = req.headers['x-profile'] || ''; return unlocked(id, req) ? id : '' }
const partyWho = req => { const p = state.profile(pid(req)); return { name: p?.name || 'Guest', color: p?.color || '#888' } }
// Older versions saved translated titles; put the original back once, quietly, so every language shows the right one.
const repaired = new Set()
async function repairNames (id) {
  const p = state.profile(id)
  if (!p || repaired.has(id) || p.namesFixed) return
  repaired.add(id)
  const seen = new Map()
  for (const it of [...p.list, ...Object.values(p.recent)]) seen.set(`${it.type}:${it.id}`, it)
  for (const it of seen.values()) {
    try { const m = await meta(it.type, it.id); if (m.name && m.name !== it.name) state.renameTitle(id, it.type, it.id, m.name) } catch (e) { log.debug('server', 'title name repair failed', { type: it.type, id: it.id, err: e }) }
  }
  state.markNamesFixed(id)
}
const needProfile = req => {
  const p = state.profile(pid(req))
  if (!p) throw Object.assign(new Error(state.hasPin(req.headers['x-profile'] || '') ? 'Locked' : 'Choose a profile first'), { code: 401 })
  return p
}
// A wrong PIN counts against the profile; too many in a row and every attempt is refused for a while, the right one included.
async function checkPin (id, pin) {
  const wait = lock.throttled(id)
  if (wait) throw Object.assign(new Error(`Too many tries. Wait ${wait < 90 ? wait + ' seconds' : Math.ceil(wait / 60) + ' minutes'}.`), { code: 429 })
  if (!(await lock.matches(state.pinOf(id), String(pin ?? '')))) { lock.failed(id); throw Object.assign(new Error('Wrong PIN'), { code: 403 }) }
  lock.succeeded(id)
}
const needUnlocked = (id, req) => { if (!unlocked(id, req)) throw Object.assign(new Error('Locked'), { code: 401 }) }

// Adult releases are searched only for adult-marked titles, and only when the viewer has not turned the adult filter on.
const isAdult = (m, safe) => !safe && isAdultItem(m)
// With the adult filter on, drops entries whose title is adult-marked. `of` reads the { type, id } of an entry; an unknown title stays.
const hideAdult = async (items, safe, of = x => x) => {
  if (!safe) return items
  const adult = await Promise.all(items.map(x => { const { type, id } = of(x); return id ? meta(type, id).then(isAdultItem, () => false) : false }))
  return items.filter((_, i) => !adult[i])
}
const runtimeOf = m => parseInt(String(m.runtime || '').match(/\d+/)?.[0], 10) || 0
const MODES = ['balanced', 'compact', 'lossless']
const ctxOf = b => ({ sublang: b.sublang, audio: b.audio, mbps: speed.downMbps(), prefer: b.prefer || 'auto', display: +b.display || 0, mode: MODES.includes(b.mode) ? b.mode : 'compact' })
const modeOf = req => state.profile(pid(req))?.settings.sourceMode
const audioOf = req => state.profile(pid(req))?.settings.lang
const sublangOf = req => state.profile(pid(req))?.settings.sublang

const wrong = new Set() // ponytail: forgotten on restart, which costs one more wrong download; persist if that bites
const notAired = date => !!date && new Date(date) > new Date()
async function play (b) {
  log.info('play', 'request', { type: b.type, id: b.id, season: b.season, episode: b.episode, hash: b.infoHash, pin: b.pin, mode: b.mode, exclude: (b.exclude || []).length })
  const m = await meta(b.type, b.id)
  const flat = b.type === 'movie' || m.movie
  const item = { type: b.type, id: b.id, title: m.name, altTitles: m.altTitles, year: m.year, movie: m.movie, runtimeMin: runtimeOf(m), adult: isAdult(m, b.safe), season: flat ? null : +b.season, episode: flat ? null : +b.episode }
  const exclude = b.exclude || []
  for (const h of exclude) { const x = engine.status(h, true); if (x && x.phase !== 'done' && !x.pinned) await engine.remove(h) }
  if (!b.infoHash) {
    const loc = local.find(item)
    if (loc) { log.info('play', 'local file', { id: loc.id, name: loc.name }); return local.status(loc.id) }
    const ctx0 = { type: item.type, id: item.id, season: item.season, episode: item.episode }
    let have = engine.findEntry(ctx0)
    // An earlier search could pick another show's release for an anime episode ("One Piece Log" for "One Piece"); such a download is dropped.
    if (have && item.type === 'anime' && titleVerdict(engine.status(have.hash, true, have.file)?.name || '', [item.title, ...(item.altTitles || [])]) === 'other') { await engine.remove(have.hash, have.file); have = null }
    if (have && !exclude.includes(have.hash)) {
      log.info('play', 'reusing download', { hash: have.hash, file: have.file })
      if (b.pin) engine.pin(have.hash); return engine.status(have.hash, false, have.file) }
  }
  // Cancelled, unreleased, or an episode that has not aired: say so instead of searching for something that does not exist.
  const aired = flat ? null : m.videos?.find(v => v.season === item.season && v.episode === item.episode)
  if (m.unplayable || notAired(aired?.released)) throw Object.assign(new Error(m.unplayable || 'This episode has not aired yet'), { code: 409 })
  const list = (await findSources(item, ctxOf(b))).filter(s => !exclude.includes(s.infoHash) && !wrong.has(`${b.type}:${b.id}:${s.infoHash}`))
  // A version this server did not find itself (a watch party member can name any) is never fetched; the best listed one plays instead.
  const first = (b.infoHash && list.find(s => s.infoHash === b.infoHash)) || list[0]
  log.info('play', 'sources', { title: m.name, found: list.length, first: first && { hash: first.infoHash, name: first.title, seeders: first.seeders, size: first.size }, asked: b.infoHash })
  if (!first) throw Object.assign(new Error('Nothing playable found for this title right now'), { code: 404 })
  // A download that failed earlier (no playable file, bad torrent) is dropped so the version gets a fresh try instead of failing again at once.
  for (const r of [first, ...list.slice(0, 3)]) if (engine.status(r.infoHash, true)?.phase === 'error') await engine.remove(r.infoHash).catch(swallow('dropping a failed download'))
  // A pack may number its files by TVDB season or absolutely; the engine needs those numbers to open the right file.
  const numbers = item.type === 'anime' && !item.movie ? await episodeNumbers(+String(item.id).replace('al:', ''), item.episode) : null
  const start = pick => engine.add({ hash: pick.infoHash, magnet: pick.magnet, ctx: { type: item.type, id: item.id, title: m.name, poster: m.poster, season: item.season, episode: item.episode, release: pick.release, provider: pick.provider, seeders: pick.seeders, ...numbers && { tvdbSeason: numbers.tvdbSeason, tvdbEpisode: numbers.tvdbEpisode, abs: numbers.abs } }, fileIdx: pick.fileIdx, pinned: !!b.pin })
  const rivals = b.infoHash ? [first] : rivalsOf(list, first, { ...ctxOf(b), runtimeMin: item.runtimeMin, year: item.year, kind: item.type })
  const pick = rivals.length > 1 ? await race(rivals, start, { ...ctxOf(b), runtimeMin: item.runtimeMin }) : first
  const e = start(pick)
  log.info('play', 'chosen', { hash: pick.infoHash, name: pick.title, seeders: pick.seeders, raced: rivals.length > 1 ? rivals.length : undefined })
  // The next episode is usually what is watched next: its list is ready by then.
  if (!flat && !b.infoHash) findSources({ ...item, episode: item.episode + 1 }, ctxOf(b)).catch(swallow('looking ahead to the next episode'))
  engine.evict(state.settings().maxStorageGB * 1e9).catch(swallow('evicting old downloads'))
  return engine.status(e.hash, false)
}

const embeddedCache = new Map()
const picksCache = new Map()
async function picksFor (id, lang, safe) {
  const k = `${id}:${lang}:${safe ? 1 : 0}`; const hit = picksCache.get(k)
  if (hit && Date.now() - hit.at < 20 * 60e3) return hit.v
  const p = state.profile(id)
  const liked = Object.values(p.ratings).filter(r => r.v > 0).sort((a, b) => b.at - a.at).slice(0, 4)
  const seen = new Set([...Object.keys(p.history), ...Object.keys(p.ratings), ...p.list.map(x => `${x.type}:${x.id}`), ...Object.values(p.ratings).filter(r => r.v < 0).map(r => `${r.type}:${r.id}`)])
  const out = []
  let failed = false
  for (const r of liked) {
    const g = (r.genres || [])[0]; if (!g) continue
    const items = await catalog({ type: r.type, genre: g, page: 1, safe }).catch(e => { log.debug('server', 'picks catalog failed', { genre: g, err: e }); failed = true; return [] })
    const fresh = items.filter(i => !seen.has(`${i.type}:${i.id}`)).slice(0, 18)
    if (fresh.length < 6) continue
    fresh.forEach(i => seen.add(`${i.type}:${i.id}`))
    out.push({ because: r.name, genre: g, items: await localizeItems(fresh, lang) })
    if (out.length >= 2) break
  }
  if (out.length && !failed) picksCache.set(k, { at: Date.now(), v: out })
  return out
}

const TYPES = ['movie', 'series', 'anime']
const FALLBACK_GENRES = { movie: ['Action', 'Comedy', 'Sci-Fi', 'Thriller', 'Drama', 'Horror'], series: ['Drama', 'Crime', 'Comedy', 'Sci-Fi', 'Mystery', 'Fantasy'], anime: ['Action', 'Fantasy', 'Romance', 'Slice of Life', 'Isekai', 'Comedy'] }
function shelvesFor (p, country, only) {
  const want = (p.settings.interests || []).filter(t => TYPES.includes(t))
  const order = only ? [only] : [...want, ...TYPES.filter(t => !want.includes(t))]
  const liked = {}
  for (const r of Object.values(p.ratings)) if (r.v > 0) for (const g of r.genres || []) liked[`${r.type}:${g}`] = (liked[`${r.type}:${g}`] || 0) + 1
  const day = Math.floor(Date.now() / 864e5)
  const genre = t => Object.entries(liked).filter(([k]) => k.startsWith(t + ':')).sort((a, b) => b[1] - a[1]).map(([k]) => k.slice(t.length + 1)).concat(FALLBACK_GENRES[t].map((g, i, a) => a[(i + day) % a.length]))
  if (only) {
    const gs = [...new Set(genre(only))].slice(0, 7)
    const ids = [`top:${only}`, only !== 'anime' && country && `country:${only}:${country}`, `new:${only}`, `genre:${only}:${gs[0]}`, `rated:${only}`, only === 'anime' && 'airing:anime', ...gs.slice(1).map(g => `genre:${only}:${g}`)].filter(Boolean)
    return ids.map(id => ({ id, ranked: /^(top|country):/.test(id) }))
  }
  const rows = [
    order.map(t => `top:${t}`),
    country ? order.filter(t => t !== 'anime').map(t => `country:${t}:${country}`) : [],
    order.slice(0, 2).map(t => `new:${t}`),
    order.map(t => `genre:${t}:${genre(t)[0]}`),
    order.slice(0, 2).map(t => `rated:${t}`),
    ['airing:anime'],
    order.map(t => `genre:${t}:${genre(t)[1]}`)
  ]
  const out = []
  for (let i = 0; rows.some(r => i < r.length); i++) for (const r of rows) if (r[i]) out.push(r[i])
  return [...new Set(out)].map(id => ({ id, ranked: /^(top|country):/.test(id) }))
}
// The lists every home and type page opens with, and the first titles of each, are fetched in the background after start and
// again every couple of hours, so the first visitor does not wait on the catalog services (a chart shelf alone takes seconds cold).
async function warmCatalog () {
  for (const type of TYPES) {
    try {
      const popular = await catalog({ type, q: null, genre: null })
      for (const id of [`top:${type}`, `new:${type}`, `rated:${type}`]) await shelfItems(id, 'en', false).catch(swallow(`warming ${id}`))
      for (const i of popular.slice(0, 8)) await meta(type, i.id).catch(swallow('warming a title'))
    } catch (e) { log.warn('server', 'warming the catalog failed', { type, err: e }) }
  }
}
async function shelfItems (id, lang, safe) {
  const [kind, a, b] = id.split(':')
  if (!TYPES.includes(a) || (kind === 'country' && !/^[A-Z]{2}$/.test(b)) || (kind === 'genre' && !/^[\w -]{2,24}$/.test(b || ''))) throw Object.assign(new Error('unknown shelf'), { code: 404 })
  let items = []
  if (kind === 'top') {
    if (a !== 'anime') items = await chartItems(a).catch(swallow('chart', []))
    if (items.length < 5) items = (await catalog({ type: a, safe })).slice(0, 10)
  } else if (kind === 'country') items = await chartItems(a, b) // a failure is an error, not an empty shelf
  else if (kind === 'new') items = await catalog({ type: a, sort: 'new', safe })
  else if (kind === 'rated') items = await catalog({ type: a, sort: 'rating', safe })
  else if (kind === 'airing') items = await catalog({ type: a, sort: 'airing', safe })
  else if (kind === 'genre') items = await catalog({ type: a, genre: b, safe })
  else throw Object.assign(new Error('unknown shelf'), { code: 404 })
  return localizeItems(items.slice(0, kind === 'top' || kind === 'country' ? 10 : 15), lang)
}

// One sync job at a time, in a worker thread, at low priority.
const syncCache = new Map()
let syncChain = Promise.resolve()
const SUB_PATH = /^\/api\/sub(\?|\/embedded\/|\/file\/|\/translate\?)/
const translating = new Map() // translations being made: where each one is, for the progress display
const UI_LANGS = ['tr', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'nl', 'pl', 'ja', 'ko', 'zh', 'ar', 'id', 'sv', 'hi', 'vi', 'el', 'he']
// `req` hands the caller's profile on to the inner request: a download through a profile's own OpenSubtitles account needs it.
async function localText (srcPath, req) {
  if (!SUB_PATH.test(srcPath)) throw Object.assign(new Error('bad subtitle'), { code: 400 })
  const r = await fetch(`http://127.0.0.1:${port}${srcPath}`, req && { headers: { 'x-profile': req.headers['x-profile'] || '', 'x-token': req.headers['x-token'] || '' } })
  if (!r.ok) throw Object.assign(new Error('subtitle not ready'), { code: 409 })
  return r.text()
}
async function readable (h, i) {
  const s = statusOf(h, true, i)
  if (!s) throw Object.assign(new Error('unknown source'), { code: 404 })
  const file = local.isLocal(h) ? local.byId(h)?.path : engine.filePath(h, i)
  if (!file) return null
  const info = await probe(rawUrl(h, i), `${h}:${i}`, s.name || '')
  // Read from disk: asking the torrent for pieces ahead would take bandwidth from playback.
  const done = s.phase === 'done'
  const D = info.duration
  // Seconds of the film that are on disk. Playback resumed in the middle downloads from there, so the start may be missing; byte position maps to time only roughly, so the ends of each stretch are trimmed.
  const ranges = done ? [[0, D]] : engine.readableRuns(h, i).map(([a, b]) => {
    const [ta, tb] = [a, b].map(x => (s.length ? x / s.length : 0) * D)
    const cut = 15 + 0.05 * (tb - ta)
    return [a === 0 ? 0 : ta + cut, b >= s.length ? D : tb - cut]
  })
  const lead = done ? D : D * (s.length ? engine.readablePrefix(h, i) / s.length : 0) * 0.85 // the start of the file only: what built-in tracks can be read from
  return { file, done, duration: D, info, ranges, lead, available: ranges.reduce((n, [a, b]) => n + Math.max(0, b - a), 0) }
}
const cuesCache = new Map()
async function cuesOf (src) {
  if (!cuesCache.has(src)) { cuesCache.set(src, parseCues(await localText(src))); if (cuesCache.size > 20) cuesCache.delete(cuesCache.keys().next().value) }
  return cuesCache.get(src)
}
// A text track built into the video is timed to its audio: its cue times, for as much of the start as can be read, show what a downloaded subtitle should line up with.
const IMAGE_SUB = /pgs|dvd_sub|dvb_sub|xsub|vobsub/i
const refCache = new Map()
async function trackReference (h, i, r) {
  const to = Math.floor(Math.min(r.lead, 480))
  if (to < 120) return null
  const tracks = (r.info.subs || []).filter(t => !IMAGE_SUB.test(t.codec || '') && !/forced|sdh|commentary|signs/i.test(t.title || ''))
  const t = tracks.find(x => x.lang === 'eng') ?? tracks[0]
  if (!t) return null
  const key = `${h}:${i}:${t.i}:${Math.floor(to / 60)}`
  if (!refCache.has(key)) {
    refCache.set(key, once('ref:' + key, async () => { const cues = parseCues(await embeddedSub(r.file, t.i, to)); return cues.length >= 40 ? { cues, to } : null }).catch(() => null))
    if (refCache.size > 20) refCache.delete(refCache.keys().next().value)
  }
  return refCache.get(key)
}
async function subtitleSync (h, i, src, near, redo) {
  const key = `${h}:${i}:${src}`
  if (redo) syncCache.delete(key)
  const r = await readable(h, i)
  if (!r || !usable(r.ranges).length) return { pending: true }
  const { file, done, available, ranges, duration } = r
  const hit = syncCache.get(key)
  // While the file is still arriving, another pass is worth it once 40 s more can be read.
  const fresh = hit && (done ? !hit.partial : !hit.partial || available < hit.available + 40)
  const answer = (res, partial) => { if (!res || res.none) return { none: true, partial }; const { evidence: _, ...out } = res; return { ...out, partial } }
  if (fresh) return answer(hit.res, hit.partial)
  return once('sync:' + key, () => (syncChain = syncChain.catch(() => {}).then(async () => {
    const t0 = Date.now()
    // Each pass adds to what the last one measured instead of starting over.
    const res = await syncInWorker({ url: file, duration, ranges, near, cues: await cuesOf(src), prior: hit?.res, reference: await trackReference(h, i, r) })
    log.info('sync', res && !res.none ? 'subtitle aligned' : 'no alignment found', { key: `${h}:${i}`, ms: Date.now() - t0, partial: !done, readableSec: Math.round(available), at: near && Math.round(near), ratio: res?.ratio, anchors: res?.anchors?.length, windows: res?.windows, rough: res?.rough, seen: res?.evidence?.length, confidence: res?.confidence })
    syncCache.set(key, { res: res ?? hit?.res, partial: !done, available })
    if (syncCache.size > 100) syncCache.delete(syncCache.keys().next().value)
    return answer(res, !done)
  })))
}
async function subtitleProbe (h, i, src, { at, ratio, expected }) {
  const r = await readable(h, i)
  if (!r || !usable(r.ranges, 60).some(([a, b]) => at >= a && at <= b)) return r ? { probe: null, ahead: true } : { pending: true } // the playhead is beyond what can be read
  return once(`probe:${h}:${i}:${src}:${Math.round(at / 30)}`, () => (syncChain = syncChain.catch(() => {}).then(async () => ({
    probe: await syncInWorker({ url: r.file, duration: r.duration, ranges: r.ranges, cues: await cuesOf(src), at, ratio, expected }, 90000)
  }))))
}
let converting = 0
let clientLogs = 0
setInterval(() => { clientLogs = 0 }, 60e3).unref()
const routes = [
  // Errors from the page (player, scripts) so a report holds both sides. Capped per minute: a loop in the page must not fill the disk.
  ['POST', /^\/api\/log$/, async (req, res) => {
    const b = await jbody(req)
    if (clientLogs++ < 300) log[['error', 'warn', 'info', 'debug'].includes(b.level) ? b.level : 'info']('client', String(b.msg ?? '').slice(0, 500), { ...Object.fromEntries(Object.entries(b.f || {}).slice(0, 12).map(([k, v]) => [k, String(v).slice(0, 400)])), ip: req.socket.remoteAddress?.replace(/^::ffff:/, ''), profile: req.headers['x-profile'] })
    json(req, res, { ok: true })
  }],
  ['GET', /^\/api\/health$/, (req, res) => json(req, res, { app: 'dodobox', version: VERSION })],
  ['GET', /^\/api\/server$/, async (req, res) => json(req, res, {
    version: VERSION, port, urls: lanAddresses().map(a => `http://${a}:${port}`), mdns: `http://dodobox.local:${port}`,
    encoder: await encoder(), internetMbps: Math.round(speed.downMbps()), mediaDirs: local.dirs(), localCount: local.all().length, update: updates.info()
  })],
  // Updates: anyone can see that one exists, only a request from the computer Dodobox runs on can start it.
  ['GET', /^\/api\/update$/, (req, res) => json(req, res, updates.view(VERSION, isLocal(req)))],
  ['POST', /^\/api\/update\/(download|install|check)$/, async (req, res, [, what]) => {
    if (!isLocal(req)) return fail(req, res, 403, 'Update from the computer Dodobox runs on')
    if (what === 'download') updates.download().catch(e => log.warn('update', 'download failed', { err: e }))
    else if (what === 'install') updates.install()
    else updates.check()
    json(req, res, updates.view(VERSION, true))
  }],
  ['GET', /^\/api\/speedtest$/, (req, res, _, q) => speed.sendTestBytes(res, +q.get('bytes'))],
  ['GET', /^\/api\/qr\.svg$/, (req, res, _, q) => {
    const c = qr(0, 'M'); c.addData(String(q.get('text') || '').slice(0, 300)); c.make()
    send(req, res, 200, 'image/svg+xml', c.createSvgTag({ cellSize: 8, margin: 2, scalable: true }), { 'cache-control': 'max-age=86400' })
  }],
  ['GET', /^\/img$/, async (req, res, _, q) => {
    // Pages that were left stop asking: work that has not started yet is skipped.
    const gone = new AbortController()
    res.on('close', () => { if (!res.writableEnded) gone.abort() })
    const opts = { webp: /image\/webp/.test(req.headers.accept || ''), signal: gone.signal }
    let r
    try { r = await image(q.get('u'), +q.get('w') || 0, opts) } catch (e) {
      if (gone.signal.aborted) return
      // Another request's cancellation took the shared resize job with it: ask again once.
      if (!e.cancelled) throw e
      r = await image(q.get('u'), +q.get('w') || 0, { ...opts, signal: undefined })
    }
    res.writeHead(200, { 'content-type': r.type, 'cache-control': 'public, max-age=2592000, immutable', vary: 'accept' }).end(r.buf)
  }],

  ['GET', /^\/api\/profiles$/, (req, res) => json(req, res, state.profiles())],
  ['POST', /^\/api\/profiles$/, async (req, res) => { const b = await jbody(req); json(req, res, state.createProfile(b.name, b.color), 201) }],
  ['PATCH', /^\/api\/profiles\/(\w+)$/, async (req, res, [, id]) => { needUnlocked(id, req); const p = state.updateProfile(id, await jbody(req)); json(req, res, p ? { id: p.id, name: p.name, color: p.color } : {}) }],
  ['DELETE', /^\/api\/profiles\/(\w+)$/, (req, res, [, id]) => { needUnlocked(id, req); lock.revokeAll(id); osaccount.disconnect(id); json(req, res, { ok: state.deleteProfile(id) }) }],
  // The PIN is checked here and a session token comes back; the page sends it with every request.
  ['POST', /^\/api\/profiles\/(\w+)\/unlock$/, async (req, res, [, id]) => {
    const rec = state.pinOf(id)
    if (!state.profile(id)) return fail(req, res, 404, 'No such profile')
    if (!rec) return json(req, res, { token: '' })
    await checkPin(id, (await jbody(req)).pin)
    json(req, res, { token: lock.issue(id) })
  }],
  ['POST', /^\/api\/profiles\/(\w+)\/lock$/, (req, res) => { lock.revoke(req.headers['x-token']); json(req, res, { ok: true }) }],
  // Sets, changes (with the current PIN) or removes (pin empty) the PIN of the profile in use. The old sessions end and a new token comes back.
  ['PUT', /^\/api\/me\/pin$/, async (req, res) => {
    const me = needProfile(req); const b = await jbody(req)
    if (me.pin) await checkPin(me.id, b.current)
    const pin = b.pin ? String(b.pin) : ''
    if (pin && !lock.PIN_FORMAT.test(pin)) return fail(req, res, 400, 'A PIN is 4 to 8 digits')
    state.setPin(me.id, pin ? await lock.hashPin(pin) : null)
    lock.revokeAll(me.id)
    json(req, res, { token: pin ? lock.issue(me.id) : '' })
  }],
  ['GET', /^\/api\/me$/, async (req, res) => {
    needProfile(req)
    repairNames(pid(req))
    const me = state.me(pid(req)); const lang = req.headers['x-lang']; const safe = !!me.settings.adultFilter // the page asks before it has read its own setting, so the header is not trusted here
    const shown = async items => localizeItems(await hideAdult(items, safe), lang)
    json(req, res, { ...me, list: await shown(me.list), recent: await shown(me.recent), history: await shown(me.history), ratings: Object.fromEntries((await shown(Object.values(me.ratings))).map(r => [`${r.type}:${r.id}`, r])) })
  }],
  ['PATCH', /^\/api\/me$/, async (req, res) => { needProfile(req); state.updateProfile(pid(req), await jbody(req)); json(req, res, state.me(pid(req))) }],
  ['PUT', /^\/api\/progress$/, async (req, res) => { needProfile(req); json(req, res, { ok: state.saveProgress(pid(req), await jbody(req)) }) }],
  ['PUT', /^\/api\/presence$/, async (req, res) => { needProfile(req); const b = await jbody(req); presence({ ...b, art: remote(b.poster), party: party.phase === 'idle' ? null : { id: crypto.createHash('sha1').update(party.code).digest('hex').slice(0, 16), size: party.members.size, max: LIMITS.members } }); json(req, res, { ok: true }) }],
  ['DELETE', /^\/api\/history\/(movie|series|anime)\/([^/]{1,80})$/, (req, res, [, type, id]) => { needProfile(req); json(req, res, { ok: state.removeHistory(pid(req), type, decodeURIComponent(id)) }) }],
  ['PUT', /^\/api\/rating$/, async (req, res) => { needProfile(req); const b = await jbody(req); for (const k of picksCache.keys()) if (k.startsWith(pid(req) + ':')) picksCache.delete(k); json(req, res, state.setRating(pid(req), b.item, b.value)) }],
  ['GET', /^\/api\/picks$/, async (req, res) => { needProfile(req); json(req, res, await picksFor(pid(req), req.headers['x-lang'], safeOf(req))) }],
  ['GET', /^\/api\/shelves$/, (req, res, _, q) => { const p = needProfile(req); const c = (q.get('country') || '').toUpperCase(); json(req, res, shelvesFor(p, /^[A-Z]{2}$/.test(c) ? c : '', TYPES.includes(q.get('type')) ? q.get('type') : '')) }],
  ['GET', /^\/api\/shelf$/, async (req, res, _, q) => jsonCached(req, res, await shelfItems(q.get('id') || '', req.headers['x-lang'], safeOf(req)), 600)],
  ['PUT', /^\/api\/list$/, async (req, res) => { needProfile(req); const b = await jbody(req); json(req, res, state.setList(pid(req), b.item, !!b.on)) }],

  ['GET', /^\/api\/settings$/, (req, res) => json(req, res, state.settings())],
  ['PUT', /^\/api\/settings$/, async (req, res) => {
    const s = state.setSettings(await jbody(req))
    local.rescan().catch(swallow('rescan'))
    json(req, res, s)
  }],
  ['GET', /^\/api\/opensubtitles$/, (req, res) => json(req, res, osaccount.status(needProfile(req).id))],
  ['PUT', /^\/api\/opensubtitles$/, async (req, res) => { const id = needProfile(req).id; const b = await jbody(req); await osaccount.connect(id, b.user, b.pass); json(req, res, osaccount.status(id)) }],
  ['DELETE', /^\/api\/opensubtitles$/, (req, res) => { const id = needProfile(req).id; osaccount.disconnect(id); json(req, res, osaccount.status(id)) }],
  ['GET', /^\/api\/storage$/, (req, res) => json(req, res, { ...engine.storage(), cap: state.settings().maxStorageGB * 1e9 })],
  ['GET', /^\/api\/local$/, async (req, res) => json(req, res, (await hideAdult(local.all(), safeOf(req), e => ({ type: e.type, id: e.mid }))).map(({ path: _p, ...e }) => e))],
  ['POST', /^\/api\/local\/rescan$/, async (req, res) => json(req, res, { count: await local.rescan() })],

  ['GET', /^\/api\/catalog$/, async (req, res, _, q) => jsonCached(req, res, await localizeItems((await catalog({ type: q.get('type'), q: q.get('q'), genre: q.get('genre'), page: +q.get('page') || 1, sort: q.get('sort') || 'popular', safe: safeOf(req) })).slice(0, Math.min(50, +q.get('limit') || 50)), req.headers['x-lang']))],
  ['GET', /^\/api\/meta\/(\w+)\/([^/]+)$/, async (req, res, [, type, id]) => jsonCached(req, res, await localizeMeta(await meta(type, decodeURIComponent(id)), req.headers['x-lang']), 300)],
  ['GET', /^\/api\/sources$/, async (req, res, _, q) => {
    const type = q.get('type'); const m = await meta(type, q.get('id'))
    const list = await findSources({ type, id: m.id, title: m.name, altTitles: m.altTitles, year: m.year, movie: m.movie, runtimeMin: runtimeOf(m), adult: isAdult(m, safeOf(req)), season: +q.get('season'), episode: +q.get('episode') }, ctxOf({ prefer: q.get('prefer'), display: q.get('display'), mode: q.get('mode'), audio: q.get('audio') }))
    json(req, res, list.map(({ magnet, ...s }) => ({ ...s, measuredBps: measured.get(s.infoHash)?.bps })))
  }],
  // Watch party: the page asks, this server talks to the other members (src/party.js) and tells the page what they do.
  ['GET', /^\/api\/party$/, (req, res) => json(req, res, { ...party.status(), chat: party.chat })],
  ['GET', /^\/api\/party\/events$/, (req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
    const out = e => res.write(`data: ${JSON.stringify(e)}\n\n`)
    out({ type: 'status', ...party.status(), chat: party.chat })
    party.on('event', out)
    const beat = setInterval(() => res.write(': keep\n\n'), 20000)
    req.on('close', () => { party.off('event', out); clearInterval(beat) })
  }],
  ['POST', /^\/api\/party\/start$/, async (req, res) => {
    // With a title it starts there; without one it is a lobby that whoever presses play first fills.
    const b = await jbody(req); const item = b.item ? cleanItem(b.item) : null
    if (b.item && !item) return fail(req, res, 400, 'Bad title')
    const hash = /^[0-9a-f]{40}$/.test(b.hash || '') && engine.status(b.hash, true) ? b.hash : null
    json(req, res, await party.join(newCode(), partyWho(req), item && { item, source: hash ? { infoHash: hash } : null, pos: Math.max(0, +b.pos || 0), paused: !!b.paused, at: Date.now() }, b.password))
  }],
  ['POST', /^\/api\/party\/join$/, async (req, res) => { const b = await jbody(req); json(req, res, await party.join(b.code, partyWho(req), null, b.password)) }],
  ['POST', /^\/api\/party\/leave$/, (req, res) => { party.leave(); json(req, res, { ok: true }) }],
  ['POST', /^\/api\/party\/send$/, async (req, res) => { const b = await jbody(req); party.send(b.k, b); json(req, res, { ok: true }) }],
  ['POST', /^\/api\/play$/, async (req, res) => {
    const b = await jbody(req); b.mode ||= modeOf(req); b.audio ||= audioOf(req); b.sublang ||= sublangOf(req); b.safe = safeOf(req)
    const st = await play(b)
    // Where this viewer left off: the player starts there, so the download does too (same cutoffs as the player's).
    const [pos, dur] = state.profile(pid(req))?.progress[state.progressKey(b.type, b.id, b.season, b.episode)] || []
    if (st.hash && !st.local) engine.resumeAt(st.hash, st.fileIdx, pos > 10 && pos / dur < 0.95 ? pos / dur : 0)
    json(req, res, st)
  }],
  ['GET', /^\/api\/status\/(\w+)$/, (req, res, [, h], q) => { const s = statusOf(h, false, q.get('file')); if (s) speed.observe(s.speed); s ? json(req, res, s) : fail(req, res, 404, 'unknown source') }],
  // The player was left: stop converting for it.
  ['POST', /^\/api\/release\/(\w+)\/(\d+)$/, (req, res, [, h, i]) => { cancel(`${h}:${i}`); json(req, res, { ok: true }) }],
  ['GET', /^\/api\/info\/(\w+)$/, async (req, res, [, h]) => {
    const s = statusOf(h)
    if (!s || s.fileIdx == null) return fail(req, res, 409, 'not ready')
    const info = await probe(rawUrl(h, s.fileIdx), `${h}:${s.fileIdx}`, s.name || '')
    const c = s.ctx
    if (c && c.type !== 'anime' && !local.isLocal(h)) {
      const m = await meta(c.type, c.id).catch(swallow('meta lookup', null))
      if (m && !lengthFits(info.duration, runtimeOf(m))) {
        wrong.add(`${c.type}:${c.id}:${h}`); engine.reject(h, s.fileIdx, 'This video is a different title')
        return fail(req, res, 409, 'This video is a different title')
      }
    }
    json(req, res, { ...s, ...info, sidecar: (local.isLocal(h) ? local.sidecars(h) : engine.sidecars(h, s.fileIdx)).map(({ path, ...x }) => x) })
  }],
  // Intro, recap and ending of the episode being played; the player asks once the file is probed, so starting playback never waits for it.
  ['GET', /^\/api\/skips\/(\w+)$/, async (req, res, [, h], q) => {
    const s = statusOf(h, true, q.get('file'))
    const c = s?.ctx
    if (!s || s.fileIdx == null || !c || c.season == null || (c.type !== 'series' && c.type !== 'anime')) return json(req, res, {})
    const info = await probe(rawUrl(h, s.fileIdx), `${h}:${s.fileIdx}`, s.name || '')
    const m = c.type === 'anime' ? await meta(c.type, c.id).catch(swallow('meta lookup', null)) : null
    if (m?.movie) return json(req, res, {})
    json(req, res, await skipsFor({ type: c.type, id: c.id, season: c.season, episode: c.episode, mal: m?.mal }, { chapters: info.chapters, duration: info.duration }))
  }],
  ['GET', /^\/raw\/(\w+)\/(\d+)$/, (req, res, [, h, i]) => local.isLocal(h) ? local.serve(h, req, res) : engine.serve(h, +i, req, res)],
  // Safari hands HLS to AirPlay by URL, so only subtitles inside the stream reach a TV; with `sl` or `sub` the playlist becomes a master playlist with a WebVTT rendition.
  ['GET', /^\/hls\/(\w+)\/(\d+)\/index\.m3u8$/, async (req, res, [, h, i], q) => {
    const info = await probe(rawUrl(h, i), `${h}:${i}`)
    const qs = new URLSearchParams([...q].filter(([k]) => k === 'a' || k === 'h')).toString()
    let body = playlist(info.duration, qs ? '?' + qs : '')
    if (q.get('sub') || q.get('sl')) {
      const sq = new URLSearchParams([...q].filter(([k]) => ['sub', 'sl', 'sn', 't', 'mid', 's', 'e'].includes(k))).toString()
      const lang = (q.get('sl') || 'und').replace(/[^a-z]/g, '').slice(0, 3)
      const name = (q.get('sn') || lang).replace(/["\r\n]/g, '').slice(0, 40)
      body = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${name}",LANGUAGE="${lang}",DEFAULT=NO,AUTOSELECT=NO,FORCED=NO,URI="subs.m3u8?${sq}"\n` +
        `#EXT-X-STREAM-INF:BANDWIDTH=8000000,CODECS="avc1.640029,mp4a.40.2",SUBTITLES="subs"\nmedia.m3u8${qs ? '?' + qs : ''}\n`
    }
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }).end(body)
  }],
  ['GET', /^\/hls\/(\w+)\/(\d+)\/media\.m3u8$/, async (req, res, [, h, i], q) => {
    const info = await probe(rawUrl(h, i), `${h}:${i}`)
    const qs = new URLSearchParams([...q].filter(([k]) => k === 'a' || k === 'h')).toString()
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' }).end(playlist(info.duration, qs ? '?' + qs : ''))
  }],
  ['GET', /^\/hls\/(\w+)\/(\d+)\/subs\.m3u8$/, async (req, res, [, h, i], q) => {
    const info = await probe(rawUrl(h, i), `${h}:${i}`)
    const d = info.duration || 1
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' })
      .end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${Math.ceil(d)}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:${d.toFixed(3)},\nsub.vtt?${q}\n#EXT-X-ENDLIST\n`)
  }],
  ['GET', /^\/hls\/(\w+)\/(\d+)\/sub\.vtt$/, async (req, res, [, h, i], q) => {
    let text
    const explicit = q.get('sub')
    if (explicit) {
      if (!SUB_PATH.test(explicit)) return fail(req, res, 400, 'bad subtitle')
      const r = await fetch(`http://127.0.0.1:${port}${explicit}`, { headers: { 'x-profile': req.headers['x-profile'] || '', 'x-token': req.headers['x-token'] || '' } })
      if (!r.ok) return fail(req, res, r.status, 'subtitle not ready')
      text = await r.text()
    } else {
      const lang = q.get('sl'); const type = q.get('t'); const id = q.get('mid')
      if (!/^[a-z]{3}$/.test(lang || '') || !type || !id) return fail(req, res, 400, 'bad subtitle')
      const m = await meta(type, id).catch(swallow('meta lookup', null))
      const list = await listSubtitles({ type, id, season: q.get('s'), episode: q.get('e'), titles: m ? [m.name, ...(m.altTitles || [])] : [] }, [lang], statusOf(h, true)?.name || '', pid(req))
      const pick = list.find(x => x.lang === lang && !x.forced)
      if (!pick) return fail(req, res, 404, 'no subtitle')
      text = await fetchSubtitle(pick.url, pick.enc, pid(req))
    }
    const known = syncCache.get(`${h}:${i}:${explicit || ''}`)?.res
    if (known && known.confidence >= 0.35) text = shiftVtt(text, known)
    // Align cue times with the stream's own timestamps (segments start at 0).
    const body = text.replace(/^\uFEFF/, '').replace(/^WEBVTT[^\n]*\n/, '')
    res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' }).end(`WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n${body.startsWith('\n') ? body : '\n' + body}`)
  }],
  ['GET', /^\/hls\/(\w+)\/(\d+)\/seg(\d+)\.ts$/, async (req, res, [, h, i, n], q) => {
    const audio = +q.get('a') || 0; const maxH = Math.min(2160, Math.max(240, +q.get('h') || 1080))
    await probe(rawUrl(h, i), `${h}:${i}`) // refuses a file that is not a video before ffmpeg reads it
    const data = await segment(rawUrl(h, i), `${h}:${i}`, +n, audio, maxH)
    probe(rawUrl(h, i), `${h}:${i}`).then(info => warm(rawUrl(h, i), `${h}:${i}`, +n, Math.ceil(info.duration / SEG) - 1, audio, maxH)).catch(swallow('warming segments'))
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': data.length, 'cache-control': 'max-age=3600' }).end(data)
  }],

  ['GET', /^\/api\/subs$/, async (req, res, _, q) => {
    const type = q.get('type'); const m = await meta(type, q.get('id')).catch(swallow('meta lookup', null))
    const titles = m ? [m.name, ...(m.altTitles || [])] : []
    const langs = (q.get('langs') || '').split(',').filter(l => /^[a-z]{3}$/.test(l))
    // Most subtitle files are filed under the series' catalog id; anime episodes map onto it when it is the first season.
    const alId = +String(q.get('id')).replace('al:', '')
    const [imdb, nums] = type === 'anime' && m && !m.movie ? await Promise.all([animeImdb(m), episodeNumbers(alId, q.get('episode'))]) : []
    // Without the episode table a later season cannot be told apart in the catalog's numbering: search it by name only.
    const subs = await listSubtitles({ type, id: q.get('id'), season: q.get('season'), episode: q.get('episode'), titles, imdb: imdb && (nums || !imdb.later) ? imdb.id : null, ...nums }, langs, q.get('release') || '', pid(req)).catch(e => { log.warn('subs', 'listing failed', { id: q.get('id'), err: e }); return [] })
    log.info('subs', 'listed', { id: q.get('id'), season: q.get('season'), episode: q.get('episode'), langs: langs.join(','), found: subs.length, incomplete: subs.incomplete })
    json(req, res, subs)
  }],
  ['GET', /^\/api\/translate\/langs$/, async (req, res) => { const t = await translateTargets().catch(swallow('translate targets', [])); json(req, res, UI_LANGS.filter(c => t.includes(modelLang(c)))) }],
  ['GET', /^\/api\/sub\/translate$/, async (req, res, _, q) => {
    const to = q.get('to') || ''
    if (!UI_LANGS.includes(to)) return fail(req, res, 400, 'unsupported language')
    const key = `${q.get('src')}|${to}`
    if (!translating.has(key)) translating.set(key, { stage: 'starting', pct: 0 })
    const gone = new AbortController()
    res.on('close', () => { if (!res.writableEnded) gone.abort() })
    try {
      const vtt = await localText(q.get('src') || '', req); const report = p => translating.set(key, p)
      if (q.get('hq') !== '1') return send(req, res, 200, 'text/vtt; charset=utf-8', await translateSubtitle(vtt, to, report, gone.signal), { 'cache-control': 'max-age=86400' })
      const r = await translateBetter(vtt, to, +q.get('at') || 0, report, gone.signal)
      send(req, res, 200, 'text/vtt; charset=utf-8', r.vtt, { 'cache-control': 'no-store', 'x-hq-done': r.done.toFixed(3), ...(r.prep != null && { 'x-hq-prep': r.prep.toFixed(3) }) })
    } catch (e) { if (!gone.signal.aborted) throw e } finally { setTimeout(() => translating.delete(key), 3000).unref() }
  }],
  ['POST', /^\/api\/sub\/translate\/stop$/, async (req, res) => { const b = await jbody(req); if (UI_LANGS.includes(b.to)) stopBetter(await localText(b.src || '', req), b.to); json(req, res, { ok: true }) }],
  ['GET', /^\/api\/translate\/better$/, (req, res) => json(req, res, better.status())],
  ['POST', /^\/api\/translate\/better$/, (req, res) => { better.ensure(true); json(req, res, better.status()) }],
  ['GET', /^\/api\/sub\/translate\/status$/, (req, res, _, q) => json(req, res, translating.get(`${q.get('src')}|${q.get('to')}`) || { stage: 'idle', pct: 0 })],
  ['GET', /^\/api\/sub\/sync$/, async (req, res, _, q) => {
    const h = q.get('hash') || ''; const i = +q.get('file') || 0; const src = q.get('src') || ''
    json(req, res, q.get('at') != null
      ? await subtitleProbe(h, i, src, { at: +q.get('at') || 0, ratio: +q.get('ratio') || 1, expected: +q.get('expected') || 0 })
      : await subtitleSync(h, i, src, q.get('near') != null ? +q.get('near') || 0 : undefined, q.get('fresh') === '1'))
  }],
  ['GET', /^\/api\/sub$/, async (req, res, _, q) => {
    const url = q.get('url')
    if (!allowedSubUrl(url)) return fail(req, res, 400, 'subtitle host not allowed')
    send(req, res, 200, 'text/vtt; charset=utf-8', await fetchSubtitle(url, q.get('enc'), pid(req)), { 'cache-control': 'max-age=86400' })
  }],
  ['GET', /^\/api\/sub\/embedded\/(\w+)\/(\d+)\/(\d+)$/, async (req, res, [, h, i, n]) => {
    const s = statusOf(h, true)
    if (!s) return fail(req, res, 404, 'unknown source')
    let to = 0
    // Read from disk: through the stream, ffmpeg's seek to the end of a half-downloaded file waits on pieces that may never come.
    const r = await readable(h, i)
    if (s.phase !== 'done') {
      // Only the verified start of the file counts: pieces downloaded further on leave holes that cut the track short.
      to = Math.floor(r?.lead || 0)
      if (to < 60) return fail(req, res, 409, 'built-in subtitles need a little more of the download')
    }
    const key = `${h}:${i}:${n}:${Math.floor(to / 120)}`
    let vtt = embeddedCache.get(key)
    if (!vtt) {
      // A finished track is kept on disk (reading a whole film is slow); repeat requests share one read.
      const file = path.join(DATA, 'subs', `emb-${h}-${i}-${n}.vtt`)
      vtt = (!to && fs.existsSync(file) && fs.readFileSync(file, 'utf8')) || await once('emb:' + key, async () => {
        const t = await embeddedSub(r?.file || rawUrl(h, i), +n, to)
        if (!to && t.includes('-->')) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, t) }
        return t
      })
      embeddedCache.set(key, vtt); if (embeddedCache.size > 24) embeddedCache.delete(embeddedCache.keys().next().value)
    }
    send(req, res, 200, 'text/vtt; charset=utf-8', vtt, { 'cache-control': 'no-store', 'x-covered': to ? String(to) : 'full', 'access-control-expose-headers': 'x-covered' })
  }],
  // A subtitle file that came inside the torrent.
  ['GET', /^\/api\/sub\/file\/(\w+)\/(\d+)$/, async (req, res, [, h, n]) => {
    if (!statusOf(h)) return fail(req, res, 404, 'unknown source')
    // Files from a torrent are kept as WebVTT on disk; a local file is read again each time (it may be edited).
    const isLocal = local.isLocal(h)
    const file = path.join(DATA, 'subs', `side-${h}-${n}.vtt`)
    const vtt = (!isLocal && fs.existsSync(file) && fs.readFileSync(file, 'utf8')) || await once(`side:${h}:${n}`, async () => {
      const { name, buf } = isLocal ? local.readSidecar(h, +n) : await engine.readSidecar(h, +n)
      const text = await toVtt(buf, legacyEncoding(langOfName(name)))
      if (!isLocal) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text) }
      return text
    })
    send(req, res, 200, 'text/vtt; charset=utf-8', vtt, { 'cache-control': 'no-store', 'x-covered': 'full', 'access-control-expose-headers': 'x-covered' })
  }],
  ['POST', /^\/api\/sub\/convert$/, async (req, res) => {
    const buf = await body(req)
    const text = decode(buf)
    if (/^\s*(WEBVTT|\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.])/.test(text)) return send(req, res, 200, 'text/vtt; charset=utf-8', srtToVtt(text))
    // Anything else goes through ffmpeg: a couple at a time, so a flood of uploads cannot start hundreds of processes.
    if (converting >= 2) return fail(req, res, 429, 'Busy converting, try again in a moment')
    converting++
    try { send(req, res, 200, 'text/vtt; charset=utf-8', await anyToVtt(buf)) } finally { converting-- }
  }],

  ['POST', /^\/api\/download$/, async (req, res) => { const b = await jbody(req); b.mode ||= modeOf(req); b.audio ||= audioOf(req); b.sublang ||= sublangOf(req); b.safe = safeOf(req); json(req, res, await downloads.enqueue(b)) }],
  ['GET', /^\/api\/downloads$/, async (req, res) => { const d = downloads.state(); json(req, res, { queue: await hideAdult(d.queue, safeOf(req)), failed: await hideAdult(d.failed, safeOf(req)) }) }],
  ['POST', /^\/api\/downloads\/(.+)\/(prioritize|unprioritize)$/, (req, res, [, k, what]) => json(req, res, { ok: downloads.prioritize(decodeURIComponent(k), what === 'prioritize') })],
  ['DELETE', /^\/api\/downloads\/(.+)$/, (req, res, [, k]) => { downloads.cancel(decodeURIComponent(k)); json(req, res, { ok: true }) }],
  ['GET', /^\/api\/library$/, async (req, res) => json(req, res, await hideAdult(engine.library().filter(r => !racing.has(r.hash)), safeOf(req), e => e.ctx || {}))],
  ['POST', /^\/api\/library\/(\w+)(?::(\d+))?\/(pause|resume|prioritize|unprioritize)$/, (req, res, [, h, f, what]) => json(req, res, { ok: what === 'pause' || what === 'resume' ? engine.hold(h.toLowerCase(), f, what === 'pause') : engine.prioritize(h.toLowerCase(), f, what === 'prioritize') })],
  ['DELETE', /^\/api\/library\/(\w+)(?::(\d+))?$/, async (req, res, [, h, f]) => json(req, res, { ok: await engine.remove(h, f) })]
]

const staticCache = new Map()
function serveStatic (req, res, pathname) {
  const file = FONTS[pathname] ? path.join(ROOT, FONTS[pathname]) : path.join(PUBLIC, pathname === '/' ? 'index.html' : path.normalize(pathname))
  if (!FONTS[pathname] && !file.startsWith(PUBLIC + path.sep)) return fail(req, res, 404, 'not found')
  let st
  try { st = fs.statSync(file) } catch { return fail(req, res, 404, 'not found') }
  if (!st.isFile()) return fail(req, res, 404, 'not found')
  const key = file + st.mtimeMs
  let hit = staticCache.get(key)
  if (!hit) {
    const raw = fs.readFileSync(file)
    const type = MIME[path.extname(file)] || 'application/octet-stream'
    hit = { type, raw, gz: /text|javascript|svg|json/.test(type) ? zlib.gzipSync(raw) : null }
    staticCache.set(key, hit)
  }
  // Shell files revalidate so updates land immediately; fonts and the player lib never change.
  const headers = { 'content-type': hit.type, 'cache-control': FONTS[pathname] || pathname.startsWith('/fonts/') ? 'public, max-age=31536000, immutable' : 'no-cache', vary: 'accept-encoding' }
  if (hit.gz && /gzip/.test(req.headers['accept-encoding'] || '')) res.writeHead(200, { ...headers, 'content-encoding': 'gzip' }).end(hit.gz)
  else res.writeHead(200, headers).end(hit.raw)
}

// A web page open in the user's browser must not be able to drive this server: writes from another site are refused, and so is a
// made-up hostname that points at this server (DNS rebinding). Addresses, localhost, single-word and .local/.lan names are the ways
// people reach it; any other name (a reverse proxy, a tunnel) goes in ALLOWED_HOSTS. A forwarded-for header proves nothing, a page can set it.
const LOCAL_HOST = /^(localhost|\[[\da-f:]+\]|\d+\.\d+\.\d+\.\d+|[\w-]+(\.(local|lan|home|internal|localdomain|home\.arpa))?)\.?$/i
const ALLOWED_HOSTS = (process.env.ALLOWED_HOSTS || '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean)
const crossSite = req => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return false
  const site = req.headers['sec-fetch-site']
  if (site) return site !== 'same-origin' && site !== 'none'
  const origin = req.headers.origin
  if (!origin) return false
  try { return new URL(origin).host !== req.headers.host } catch { return true }
}
const rebound = req => { const host = (req.headers.host || '').replace(/:\d+$/, ''); return !!host && !LOCAL_HOST.test(host) && !ALLOWED_HOSTS.includes(host.toLowerCase()) }

const SECRET_PARAM = /^(pin|code|password|token|key)$/i
const seenClients = new Set()
// One line per request, written when it ends. Static files that went fine are left out; bodies are never logged (PINs, party codes).
function accessLog (req, res, url, t0, routed) {
  res.once('close', () => {
    const code = res.statusCode
    if (!routed() && code < 400) return
    const ip = (req.socket.remoteAddress || '').replace(/^::ffff:/, '')
    const q = [...url.searchParams].map(([k, v]) => `${k}=${SECRET_PARAM.test(k) ? '***' : v}`).join('&')
    const f = { ip, status: code, ms: Date.now() - t0, bytes: res.getHeader('content-length'), range: req.headers.range, profile: req.headers['x-profile'], q: q || undefined, err: res.logErr, aborted: res.writableFinished ? undefined : true }
    log[code >= 500 ? 'error' : 'debug']('http', `${req.method} ${url.pathname}`, f)
    if (!seenClients.has(ip)) { seenClients.add(ip); log.info('client', 'first request from this address', { ip, ua: req.headers['user-agent'] }) }
  })
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const t0 = Date.now(); let routed = false
  accessLog(req, res, url, t0, () => routed)
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('x-frame-options', 'SAMEORIGIN')
  if (rebound(req)) return fail(req, res, 421, 'unknown host (add it to ALLOWED_HOSTS)')
  if (crossSite(req)) return fail(req, res, 403, 'cross-site request refused')
  // Cast receivers and other origins fetch media directly.
  if (/^\/(hls|raw)\//.test(url.pathname)) {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'range')
    res.setHeader('access-control-expose-headers', 'content-range, content-length')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  }
  try {
    const h = /^\/hls\/(\w+)\//.exec(url.pathname)
    if (h && !statusOf(h[1], true)) return fail(req, res, 404, 'unknown source')
    for (const [method, re, fn] of routes) {
      const m = req.method === method && re.exec(url.pathname)
      if (m) { routed = true; return await fn(req, res, m, url.searchParams) }
    }
    serveStatic(req, res, url.pathname)
  } catch (e) {
    // A title the catalog does not know is the viewer's 404, not a server fault.
    const code = e.code >= 400 && e.code < 600 ? e.code : e.status >= 400 && e.status < 500 ? 404 : 500
    res.logErr = String(e.message).trim().split('\n').pop()
    if (!res.headersSent) fail(req, res, code, code === 404 && !(e.code >= 400) ? 'not found' : e.message)
    else res.destroy()
    if (code >= 500) log.error('http', `${req.method} ${url.pathname} failed`, { err: e })
  }
})

const loop = monitorEventLoopDelay()
loop.enable()
const heartbeat = () => {
  const m = process.memoryUsage()
  log.debug('heartbeat', 'status', { rssMB: Math.round(m.rss / 1e6), heapMB: Math.round(m.heapUsed / 1e6), up: Math.round(process.uptime()), loopMeanMs: Math.round(loop.mean / 1e6), loopMaxMs: Math.round(loop.max / 1e6), ...engine.stats(), encodes: encodes(), party: party.phase, members: party.phase === 'idle' ? undefined : party.members.size })
  loop.reset()
  for (const t of engine.details()) log.debug('heartbeat', 'torrent', t)
}
let bonjour
export function start (listenPort = process.env.PORT === undefined ? 3000 : +process.env.PORT, host = process.env.HOST || '0.0.0.0') {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(listenPort, host, () => {
      port = server.address().port
      const lan = lanAddresses()
      console.log(`[start] Dodobox ${VERSION}, ${process.platform} ${process.arch}, ${process.versions.electron ? `electron ${process.versions.electron}` : `node ${process.version}`}`)
      console.log(`\n  Dodobox is running\n\n  This computer:  http://localhost:${port}`)
      for (const a of lan) console.log(`  Phones, TVs:    http://${a}:${port}`)
      console.log(`  Or:             http://dodobox.local:${port}\n`)
      if (!process.env.NO_MDNS) {
        try { bonjour = new Bonjour(); bonjour.publish({ name: 'dodobox', type: 'http', port, host: 'dodobox.local' }); log.info('start', 'mDNS published', { name: 'dodobox.local', port }) } catch (e) { log.warn('start', 'mDNS could not be published, dodobox.local will not resolve', { err: e }) }
      }
      log.info('start', 'listening', { port, host, lan: lan.join(','), data: DATA, node: process.version, ffmpeg: FFMPEG })
      log.info('start', 'environment', { ...Object.fromEntries(['PORT', 'HOST', 'NO_MDNS', 'NO_DHT', 'MAX_TRANSCODES', 'ALLOWED_HOSTS', 'LOG_LEVEL', 'DODOBOX_DESKTOP'].map(k => [k, process.env[k]])), docker: fs.existsSync('/.dockerenv') || undefined })
      log.info('start', 'settings', state.settings())
      try { const d = fs.statfsSync(DATA); log.info('start', 'disk', { freeGB: Math.round(d.bavail * d.bsize / 1e8) / 10 }) } catch (e) { log.debug('start', 'disk space unknown', { err: e }) }
      setInterval(heartbeat, 60e3).unref()
      local.watch()
      downloads.init(play)
      refreshTrackers(); setInterval(refreshTrackers, 12 * 3600e3).unref()
      warmIds(); setInterval(warmIds, 24 * 3600e3).unref()
      speed.start()
      updates.watch(VERSION)
      setTimeout(warmCatalog, 3000).unref(); setInterval(warmCatalog, 2 * 3600e3).unref()
      encoder().then(e => console.log(`  Video encoder: ${e}`))
      resolve(server)
    })
  })
}

export async function stop () {
  log.info('start', 'stopping')
  try { bonjour?.unpublishAll(); bonjour?.destroy() } catch {}
  party.leave()
  state.flush()
  server.closeAllConnections()
  await new Promise(r => server.close(r))
  await engine.shutdown()
  await stopPool()
}

// A bad torrent peer or a dead API must never take the server down.
process.on('unhandledRejection', e => console.error('[unhandled]', e?.stack || e))
process.on('uncaughtException', e => console.error('[uncaught]', e?.stack || e))

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start().catch(e => { console.error(e.code === 'EADDRINUSE' ? `Port ${process.env.PORT || 3000} is busy. Is Dodobox already running?` : e.message); process.exit(1) })
  openBrowser(`http://localhost:${s.address().port}`)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log.info('start', `received ${sig}`); stop().then(() => process.exit(0)) })
}
