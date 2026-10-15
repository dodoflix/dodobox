#!/usr/bin/env node
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import qr from 'qrcode-generator'
import { Bonjour } from 'bonjour-service'
import { fileURLToPath } from 'node:url'
import { catalog, meta, animeImdb } from './src/meta.js'
import { findSources, measured, score, refreshTrackers, showVerdict } from './src/sources.js'
import { listSubtitles, allowedSubUrl, fetchSubtitle, srtToVtt, decode, toVtt, legacyEncoding } from './src/subs.js'
import * as engine from './src/engine.js'
import * as local from './src/local.js'
import * as downloads from './src/downloads.js'
import { chartItems } from './src/charts.js'
import * as state from './src/state.js'
import { image } from './src/images.js'
import { lanAddresses, openBrowser } from './src/net.js'
import { encoder } from './src/bin.js'
import * as speed from './src/speed.js'
import { localizeItems, localizeMeta } from './src/locale.js'
import { syncInWorker, parseCues, shiftVtt } from './src/sync.js'
import * as better from './src/translate-hq.js'
import { translateSubtitle, translateBetter, stopBetter, targets as translateTargets, modelLang } from './src/translate.js'
import { once } from './src/http.js'
import { langOfName } from './src/sidecar.js'
import { DATA } from './src/paths.js'
import * as updates from './src/update.js'
import { probe, playlist, segment, warm, embeddedSub, anyToVtt, SEG } from './src/transcode.js'

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
const jsonCached = (req, res, data, maxAge = 180) => send(req, res, 200, 'application/json', JSON.stringify(data), { 'cache-control': `private, max-age=${maxAge}, stale-while-revalidate=${maxAge * 5}`, vary: 'x-lang, x-adult-filter, accept-encoding' })
const isLocal = req => /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(req.socket.remoteAddress || '')
const fail = (req, res, code, msg) => json(req, res, { error: msg }, code)
const body = req => new Promise((resolve, reject) => {
  const chunks = []; let n = 0
  req.on('data', c => { n += c.length; if (n > 5e6) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
  req.on('end', () => resolve(Buffer.concat(chunks)))
  req.on('error', reject)
})
const jbody = async req => { try { return JSON.parse(await body(req)) } catch { throw Object.assign(new Error('bad JSON'), { code: 400 }) } }

let port
const rawUrl = (hash, idx) => `http://127.0.0.1:${port}/raw/${hash}/${idx}`
const statusOf = (h, silent, file) => local.isLocal(h) ? local.status(h) : engine.status(h, silent, file)
const pid = req => req.headers['x-profile'] || ''
// Older versions saved translated titles; put the original back once, quietly, so every language shows the right one.
const repaired = new Set()
async function repairNames (id) {
  const p = state.profile(id)
  if (!p || repaired.has(id) || p.namesFixed) return
  repaired.add(id)
  const seen = new Map()
  for (const it of [...p.list, ...Object.values(p.recent)]) seen.set(`${it.type}:${it.id}`, it)
  for (const it of seen.values()) {
    try { const m = await meta(it.type, it.id); if (m.name && m.name !== it.name) state.renameTitle(id, it.type, it.id, m.name) } catch {}
  }
  state.markNamesFixed(id)
}
const needProfile = req => { const p = state.profile(pid(req)); if (!p) throw Object.assign(new Error('Choose a profile first'), { code: 401 }); return p }

const runtimeOf = m => parseInt(String(m.runtime || '').match(/\d+/)?.[0], 10) || 0
const MODES = ['balanced', 'compact', 'lossless']
const ctxOf = b => ({ sublang: b.sublang, audio: b.audio, mbps: speed.downMbps(), prefer: b.prefer || 'auto', display: +b.display || 0, mode: MODES.includes(b.mode) ? b.mode : 'balanced' })
const modeOf = req => state.profile(pid(req))?.settings.sourceMode
const audioOf = req => state.profile(pid(req))?.settings.lang
const sublangOf = req => state.profile(pid(req))?.settings.sublang

async function play (b) {
  const m = await meta(b.type, b.id)
  const flat = b.type === 'movie' || m.movie
  const item = { type: b.type, id: b.id, title: m.name, altTitles: m.altTitles, year: m.year, movie: m.movie, runtimeMin: runtimeOf(m), season: flat ? null : +b.season, episode: flat ? null : +b.episode }
  const exclude = b.exclude || []
  for (const h of exclude) if (engine.status(h, true)?.phase !== 'done') await engine.remove(h)
  if (!b.infoHash) {
    const loc = local.find(item)
    if (loc) return local.status(loc.id)
    const ctx0 = { type: item.type, id: item.id, season: item.season, episode: item.episode }
    let have = engine.findEntry(ctx0)
    // An earlier search could pick another show's release for an anime episode ("One Piece Log" for "One Piece"); such a download is dropped.
    if (have && item.type === 'anime' && showVerdict(engine.status(have.hash, true, have.file)?.name || '', [item.title, ...(item.altTitles || [])]) === 'other') { await engine.remove(have.hash, have.file); have = null }
    if (have && !exclude.includes(have.hash)) { if (b.pin) engine.pin(have.hash); return engine.status(have.hash, false, have.file) }
  }
  const list = (await findSources(item, ctxOf(b))).filter(s => !exclude.includes(s.infoHash))
  const first = b.infoHash ? list.find(s => s.infoHash === b.infoHash) : list[0]
  if (!first) throw Object.assign(new Error('Nothing playable found for this title right now'), { code: 404 })
  const start = pick => engine.add({ hash: pick.infoHash, magnet: pick.magnet, ctx: { type: item.type, id: item.id, title: m.name, poster: m.poster, season: item.season, episode: item.episode, release: pick.release }, fileIdx: pick.fileIdx, pinned: !!b.pin })
  // Seeder counts say little about real speed, so the best few versions race for a moment.
  const rivals = b.infoHash || b.pin ? [first] : list.filter(s => s.seeders > 0 && !s.wrongSeason && score(s, ctxOf(b)) >= score(first, ctxOf(b)) - 45).slice(0, 3)
  const pick = rivals.length > 1 ? await race(rivals, start) : first
  const e = start(pick)
  engine.evict(state.settings().maxStorageGB * 1e9).catch(() => {})
  return engine.status(e.hash, false)
}

async function race (rivals, start) {
  const t0 = Date.now()
  rivals.forEach(r => start(r))
  const speedOf = r => { const st = engine.status(r.infoHash, true); return st ? { bps: st.speed, got: st.downloaded, phase: st.phase } : { bps: 0, got: 0 } }
  let winner = null
  while (!winner && Date.now() - t0 < 6500) {
    await new Promise(r => setTimeout(r, 500))
    const t = Date.now() - t0
    const seen = rivals.map(r => ({ r, ...speedOf(r) }))
    const fast = seen.find(x => x.bps >= 1.2e6 || x.got >= 3e6)
    if (t >= 2500 && fast && (fast.r === rivals[0] || t >= 4500)) winner = seen.filter(x => x.bps >= 1.2e6 || x.got >= 3e6).sort((a, b) => (b.got + b.bps * 3) - (a.got + a.bps * 3))[0].r
  }
  const seen = rivals.map(r => ({ r, ...speedOf(r) }))
  for (const x of seen) measured.set(x.r.infoHash, { bps: x.bps, at: Date.now() })
  winner ||= seen.sort((a, b) => (b.got + b.bps * 3) - (a.got + a.bps * 3))[0].bps ? seen[0].r : rivals[0]
  for (const r of rivals) if (r !== winner && engine.status(r.infoHash, true)?.phase !== 'done') await engine.remove(r.infoHash).catch(() => {})
  return winner
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
  for (const r of liked) {
    const g = (r.genres || [])[0]; if (!g) continue
    const items = await catalog({ type: r.type, genre: g, page: 1, safe }).catch(() => [])
    const fresh = items.filter(i => !seen.has(`${i.type}:${i.id}`)).slice(0, 18)
    if (fresh.length < 6) continue
    fresh.forEach(i => seen.add(`${i.type}:${i.id}`))
    out.push({ because: r.name, genre: g, items: await localizeItems(fresh, lang) })
    if (out.length >= 2) break
  }
  if (out.length) picksCache.set(k, { at: Date.now(), v: out })
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
      for (const id of [`top:${type}`, `new:${type}`, `rated:${type}`]) await shelfItems(id, 'en', false).catch(() => {})
      for (const i of popular.slice(0, 8)) await meta(type, i.id).catch(() => {})
    } catch {}
  }
}
async function shelfItems (id, lang, safe) {
  const [kind, a, b] = id.split(':')
  if (!TYPES.includes(a) || (kind === 'country' && !/^[A-Z]{2}$/.test(b)) || (kind === 'genre' && !/^[\w -]{2,24}$/.test(b || ''))) throw Object.assign(new Error('unknown shelf'), { code: 404 })
  let items = []
  if (kind === 'top') {
    if (a !== 'anime') items = await chartItems(a).catch(() => [])
    if (items.length < 5) items = (await catalog({ type: a, safe })).slice(0, 10)
  } else if (kind === 'country') items = await chartItems(a, b).catch(() => [])
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
async function localText (srcPath) {
  if (!SUB_PATH.test(srcPath)) throw Object.assign(new Error('bad subtitle'), { code: 400 })
  const r = await fetch(`http://127.0.0.1:${port}${srcPath}`)
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
  const prefix = done ? s.length : engine.readablePrefix(h, i)
  return { file, done, duration: info.duration, available: done ? info.duration : info.duration * (s.length ? prefix / s.length : 0) * 0.85 }
}
const cuesCache = new Map()
async function cuesOf (src) {
  if (!cuesCache.has(src)) { cuesCache.set(src, parseCues(await localText(src))); if (cuesCache.size > 20) cuesCache.delete(cuesCache.keys().next().value) }
  return cuesCache.get(src)
}
async function subtitleSync (h, i, src) {
  const key = `${h}:${i}:${src}`
  const r = await readable(h, i)
  if (!r || r.available < 150) return { pending: true }
  const { file, done, available } = r
  const hit = syncCache.get(key)
  const fresh = hit && (done ? !hit.partial : !hit.partial || available < hit.available * 1.6)
  if (fresh) return hit.res ? { ...hit.res, partial: hit.partial } : { none: true }
  return once('sync:' + key, () => (syncChain = syncChain.catch(() => {}).then(async () => {
    const res = await syncInWorker({ url: file, duration: available, cues: await cuesOf(src) })
    syncCache.set(key, { res, partial: !done, available })
    if (syncCache.size > 100) syncCache.delete(syncCache.keys().next().value)
    return res ? { ...res, partial: !done } : { none: true }
  })))
}
async function subtitleProbe (h, i, src, { at, ratio, expected }) {
  const r = await readable(h, i)
  if (!r || r.available < 150) return { pending: true }
  if (at > r.available) return { probe: null, ahead: true } // the playhead is beyond the part that can be read
  return once(`probe:${h}:${i}:${src}:${Math.round(at / 30)}`, () => (syncChain = syncChain.catch(() => {}).then(async () => ({
    probe: await syncInWorker({ url: r.file, duration: r.available, cues: await cuesOf(src), at, ratio, expected }, 90000)
  }))))
}
const routes = [
  ['GET', /^\/api\/health$/, (req, res) => json(req, res, { app: 'dodobox', version: VERSION })],
  ['GET', /^\/api\/server$/, async (req, res) => json(req, res, {
    version: VERSION, port, urls: lanAddresses().map(a => `http://${a}:${port}`), mdns: `http://dodobox.local:${port}`,
    encoder: await encoder(), internetMbps: Math.round(speed.downMbps()), mediaDirs: local.dirs(), localCount: local.all().length, update: updates.info()
  })],
  // Updates: anyone can see that one exists, only a request from the computer Dodobox runs on can start it.
  ['GET', /^\/api\/update$/, (req, res) => json(req, res, updates.view(VERSION, isLocal(req)))],
  ['POST', /^\/api\/update\/(download|install|check)$/, async (req, res, [, what]) => {
    if (!isLocal(req)) return fail(req, res, 403, 'Update from the computer Dodobox runs on')
    if (what === 'download') updates.download().catch(() => {})
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
  ['PATCH', /^\/api\/profiles\/(\w+)$/, async (req, res, [, id]) => json(req, res, state.updateProfile(id, await jbody(req)) || {})],
  ['DELETE', /^\/api\/profiles\/(\w+)$/, (req, res, [, id]) => json(req, res, { ok: state.deleteProfile(id) })],
  ['GET', /^\/api\/me$/, async (req, res) => {
    needProfile(req)
    repairNames(pid(req))
    const me = state.me(pid(req)); const lang = req.headers['x-lang']
    json(req, res, { ...me, list: await localizeItems(me.list, lang), recent: await localizeItems(me.recent, lang), history: await localizeItems(me.history, lang), ratings: Object.fromEntries((await localizeItems(Object.values(me.ratings), lang)).map(r => [`${r.type}:${r.id}`, r])) })
  }],
  ['PATCH', /^\/api\/me$/, async (req, res) => { needProfile(req); state.updateProfile(pid(req), await jbody(req)); json(req, res, state.me(pid(req))) }],
  ['PUT', /^\/api\/progress$/, async (req, res) => { needProfile(req); json(req, res, { ok: state.saveProgress(pid(req), await jbody(req)) }) }],
  ['PUT', /^\/api\/rating$/, async (req, res) => { needProfile(req); const b = await jbody(req); for (const k of picksCache.keys()) if (k.startsWith(pid(req) + ':')) picksCache.delete(k); json(req, res, state.setRating(pid(req), b.item, b.value)) }],
  ['GET', /^\/api\/picks$/, async (req, res) => { needProfile(req); json(req, res, await picksFor(pid(req), req.headers['x-lang'], safeOf(req))) }],
  ['GET', /^\/api\/shelves$/, (req, res, _, q) => { const p = needProfile(req); const c = (q.get('country') || '').toUpperCase(); json(req, res, shelvesFor(p, /^[A-Z]{2}$/.test(c) ? c : '', TYPES.includes(q.get('type')) ? q.get('type') : '')) }],
  ['GET', /^\/api\/shelf$/, async (req, res, _, q) => jsonCached(req, res, await shelfItems(q.get('id') || '', req.headers['x-lang'], safeOf(req)), 600)],
  ['PUT', /^\/api\/list$/, async (req, res) => { needProfile(req); const b = await jbody(req); json(req, res, state.setList(pid(req), b.item, !!b.on)) }],

  ['GET', /^\/api\/settings$/, (req, res) => json(req, res, state.settings())],
  ['PUT', /^\/api\/settings$/, async (req, res) => {
    const s = state.setSettings(await jbody(req))
    local.rescan().catch(() => {})
    json(req, res, s)
  }],
  ['GET', /^\/api\/storage$/, (req, res) => json(req, res, { ...engine.storage(), cap: state.settings().maxStorageGB * 1e9 })],
  ['GET', /^\/api\/local$/, (req, res) => json(req, res, local.all().map(({ path: _p, ...e }) => e))],
  ['POST', /^\/api\/local\/rescan$/, async (req, res) => json(req, res, { count: await local.rescan() })],

  ['GET', /^\/api\/catalog$/, async (req, res, _, q) => jsonCached(req, res, await localizeItems((await catalog({ type: q.get('type'), q: q.get('q'), genre: q.get('genre'), page: +q.get('page') || 1, sort: q.get('sort') || 'popular', safe: safeOf(req) })).slice(0, Math.min(50, +q.get('limit') || 50)), req.headers['x-lang']))],
  ['GET', /^\/api\/meta\/(\w+)\/([^/]+)$/, async (req, res, [, type, id]) => jsonCached(req, res, await localizeMeta(await meta(type, decodeURIComponent(id)), req.headers['x-lang']), 300)],
  ['GET', /^\/api\/sources$/, async (req, res, _, q) => {
    const type = q.get('type'); const m = await meta(type, q.get('id'))
    const list = await findSources({ type, id: m.id, title: m.name, altTitles: m.altTitles, year: m.year, movie: m.movie, runtimeMin: runtimeOf(m), season: +q.get('season'), episode: +q.get('episode') }, ctxOf({ prefer: q.get('prefer'), display: q.get('display'), mode: q.get('mode'), audio: q.get('audio') }))
    json(req, res, list.map(({ magnet, ...s }) => ({ ...s, measuredBps: measured.get(s.infoHash)?.bps })))
  }],
  ['POST', /^\/api\/play$/, async (req, res) => { const b = await jbody(req); b.mode ||= modeOf(req); b.audio ||= audioOf(req); b.sublang ||= sublangOf(req); json(req, res, await play(b)) }],
  ['GET', /^\/api\/status\/(\w+)$/, (req, res, [, h], q) => { const s = statusOf(h, false, q.get('file')); if (s) speed.observe(s.speed); s ? json(req, res, s) : fail(req, res, 404, 'unknown source') }],
  ['GET', /^\/api\/info\/(\w+)$/, async (req, res, [, h]) => {
    const s = statusOf(h)
    if (!s || s.fileIdx == null) return fail(req, res, 409, 'not ready')
    json(req, res, { ...s, ...await probe(rawUrl(h, s.fileIdx), `${h}:${s.fileIdx}`, s.name || ''), sidecar: (local.isLocal(h) ? local.sidecars(h) : engine.sidecars(h, s.fileIdx)).map(({ path, ...x }) => x) })
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
      const r = await fetch(`http://127.0.0.1:${port}${explicit}`)
      if (!r.ok) return fail(req, res, r.status, 'subtitle not ready')
      text = await r.text()
    } else {
      const lang = q.get('sl'); const type = q.get('t'); const id = q.get('mid')
      if (!/^[a-z]{3}$/.test(lang || '') || !type || !id) return fail(req, res, 400, 'bad subtitle')
      const m = await meta(type, id).catch(() => null)
      const list = await listSubtitles({ type, id, season: q.get('s'), episode: q.get('e'), titles: m ? [m.name, ...(m.altTitles || [])] : [] }, [lang], statusOf(h, true)?.name || '')
      const pick = list.find(x => x.lang === lang && !x.forced)
      if (!pick) return fail(req, res, 404, 'no subtitle')
      text = await fetchSubtitle(pick.url, pick.enc)
    }
    const known = syncCache.get(`${h}:${i}:${explicit || ''}`)?.res
    if (known && known.confidence >= 0.35) text = shiftVtt(text, known)
    // Align cue times with the stream's own timestamps (segments start at 0).
    const body = text.replace(/^\uFEFF/, '').replace(/^WEBVTT[^\n]*\n/, '')
    res.writeHead(200, { 'content-type': 'text/vtt; charset=utf-8', 'cache-control': 'no-store' }).end(`WEBVTT\nX-TIMESTAMP-MAP=MPEGTS:0,LOCAL:00:00:00.000\n${body.startsWith('\n') ? body : '\n' + body}`)
  }],
  ['GET', /^\/hls\/(\w+)\/(\d+)\/seg(\d+)\.ts$/, async (req, res, [, h, i, n], q) => {
    const audio = +q.get('a') || 0; const maxH = Math.min(2160, Math.max(240, +q.get('h') || 1080))
    const data = await segment(rawUrl(h, i), `${h}:${i}`, +n, audio, maxH)
    probe(rawUrl(h, i), `${h}:${i}`).then(info => warm(rawUrl(h, i), `${h}:${i}`, +n, Math.ceil(info.duration / SEG) - 1, audio, maxH)).catch(() => {})
    res.writeHead(200, { 'content-type': 'video/mp2t', 'content-length': data.length, 'cache-control': 'max-age=3600' }).end(data)
  }],

  ['GET', /^\/api\/subs$/, async (req, res, _, q) => {
    const type = q.get('type'); const m = await meta(type, q.get('id')).catch(() => null)
    const titles = m ? [m.name, ...(m.altTitles || [])] : []
    const langs = (q.get('langs') || '').split(',').filter(l => /^[a-z]{3}$/.test(l))
    // Most subtitle files are filed under the series' catalog id; anime episodes map onto it when it is the first season.
    const imdb = type === 'anime' && m && !m.movie ? await animeImdb(m) : null
    json(req, res, await listSubtitles({ type, id: q.get('id'), season: q.get('season'), episode: q.get('episode'), titles, imdb: imdb && !imdb.later ? imdb.id : null }, langs, q.get('release') || '').catch(() => []))
  }],
  ['GET', /^\/api\/translate\/langs$/, async (req, res) => { const t = await translateTargets().catch(() => []); json(req, res, UI_LANGS.filter(c => t.includes(modelLang(c)))) }],
  ['GET', /^\/api\/sub\/translate$/, async (req, res, _, q) => {
    const to = q.get('to') || ''
    if (!UI_LANGS.includes(to)) return fail(req, res, 400, 'unsupported language')
    const key = `${q.get('src')}|${to}`
    if (!translating.has(key)) translating.set(key, { stage: 'starting', pct: 0 })
    const gone = new AbortController()
    res.on('close', () => { if (!res.writableEnded) gone.abort() })
    try {
      const vtt = await localText(q.get('src') || ''); const report = p => translating.set(key, p)
      if (q.get('hq') !== '1') return send(req, res, 200, 'text/vtt; charset=utf-8', await translateSubtitle(vtt, to, report, gone.signal), { 'cache-control': 'max-age=86400' })
      const r = await translateBetter(vtt, to, +q.get('at') || 0, report, gone.signal)
      send(req, res, 200, 'text/vtt; charset=utf-8', r.vtt, { 'cache-control': 'no-store', 'x-hq-done': r.done.toFixed(3), ...(r.prep != null && { 'x-hq-prep': r.prep.toFixed(3) }) })
    } catch (e) { if (!gone.signal.aborted) throw e } finally { setTimeout(() => translating.delete(key), 3000).unref() }
  }],
  ['POST', /^\/api\/sub\/translate\/stop$/, async (req, res) => { const b = await jbody(req); if (UI_LANGS.includes(b.to)) stopBetter(await localText(b.src || ''), b.to); json(req, res, { ok: true }) }],
  ['GET', /^\/api\/translate\/better$/, (req, res) => json(req, res, better.status())],
  ['POST', /^\/api\/translate\/better$/, (req, res) => { better.ensure(true); json(req, res, better.status()) }],
  ['GET', /^\/api\/sub\/translate\/status$/, (req, res, _, q) => json(req, res, translating.get(`${q.get('src')}|${q.get('to')}`) || { stage: 'idle', pct: 0 })],
  ['GET', /^\/api\/sub\/sync$/, async (req, res, _, q) => {
    const h = q.get('hash') || ''; const i = +q.get('file') || 0; const src = q.get('src') || ''
    json(req, res, q.get('at') != null
      ? await subtitleProbe(h, i, src, { at: +q.get('at') || 0, ratio: +q.get('ratio') || 1, expected: +q.get('expected') || 0 })
      : await subtitleSync(h, i, src))
  }],
  ['GET', /^\/api\/sub$/, async (req, res, _, q) => {
    const url = q.get('url')
    if (!allowedSubUrl(url)) return fail(req, res, 400, 'subtitle host not allowed')
    send(req, res, 200, 'text/vtt; charset=utf-8', await fetchSubtitle(url, q.get('enc')), { 'cache-control': 'max-age=86400' })
  }],
  ['GET', /^\/api\/sub\/embedded\/(\w+)\/(\d+)\/(\d+)$/, async (req, res, [, h, i, n]) => {
    const s = statusOf(h, true)
    if (!s) return fail(req, res, 404, 'unknown source')
    let to = 0
    // Read from disk: through the stream, ffmpeg's seek to the end of a half-downloaded file waits on pieces that may never come.
    const r = await readable(h, i)
    if (s.phase !== 'done') {
      // Only the verified start of the file counts: pieces downloaded further on leave holes that cut the track short.
      to = Math.floor(r?.available || 0)
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
    const vtt = /^\s*(WEBVTT|\d+\s*\n\s*\d{2}:\d{2}:\d{2}[,.])/.test(text) ? srtToVtt(text) : await anyToVtt(buf)
    send(req, res, 200, 'text/vtt; charset=utf-8', vtt)
  }],

  ['POST', /^\/api\/download$/, async (req, res) => { const b = await jbody(req); b.mode ||= modeOf(req); b.audio ||= audioOf(req); b.sublang ||= sublangOf(req); json(req, res, await downloads.enqueue(b)) }],
  ['GET', /^\/api\/downloads$/, (req, res) => json(req, res, downloads.state())],
  ['DELETE', /^\/api\/downloads\/(.+)$/, (req, res, [, k]) => { downloads.cancel(decodeURIComponent(k)); json(req, res, { ok: true }) }],
  ['GET', /^\/api\/library$/, (req, res) => json(req, res, engine.library())],
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  res.setHeader('x-content-type-options', 'nosniff')
  // Cast receivers and other origins fetch media directly.
  if (/^\/(hls|raw)\//.test(url.pathname)) {
    res.setHeader('access-control-allow-origin', '*')
    res.setHeader('access-control-allow-headers', 'range')
    res.setHeader('access-control-expose-headers', 'content-range, content-length')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()
  }
  try {
    for (const [method, re, fn] of routes) {
      const m = req.method === method && re.exec(url.pathname)
      if (m) return await fn(req, res, m, url.searchParams)
    }
    serveStatic(req, res, url.pathname)
  } catch (e) {
    if (!res.headersSent) fail(req, res, e.code >= 400 && e.code < 600 ? e.code : 500, e.message)
    else res.destroy()
    if (!(e.code >= 400 && e.code < 500)) console.error(`[${req.method} ${url.pathname}]`, e.message)
  }
})

let bonjour
export function start (listenPort = process.env.PORT === undefined ? 3000 : +process.env.PORT, host = process.env.HOST || '0.0.0.0') {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(listenPort, host, () => {
      port = server.address().port
      const lan = lanAddresses()
      console.log(`\n  Dodobox is running\n\n  This computer:  http://localhost:${port}`)
      for (const a of lan) console.log(`  Phones, TVs:    http://${a}:${port}`)
      console.log(`  Or:             http://dodobox.local:${port}\n`)
      if (!process.env.NO_MDNS) {
        try { bonjour = new Bonjour(); bonjour.publish({ name: 'dodobox', type: 'http', port, host: 'dodobox.local' }) } catch {}
      }
      local.watch()
      downloads.init(play)
      refreshTrackers(); setInterval(refreshTrackers, 12 * 3600e3).unref()
      speed.start()
      updates.watch(VERSION)
      setTimeout(warmCatalog, 3000).unref(); setInterval(warmCatalog, 2 * 3600e3).unref()
      encoder().then(e => console.log(`  Video encoder: ${e}`))
      resolve(server)
    })
  })
}

export async function stop () {
  try { bonjour?.unpublishAll(); bonjour?.destroy() } catch {}
  state.flush()
  server.closeAllConnections()
  await new Promise(r => server.close(r))
  await engine.shutdown()
}

// A bad torrent peer or a dead API must never take the server down.
process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e))
process.on('uncaughtException', e => console.error('[uncaught]', e?.message || e))

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start().catch(e => { console.error(e.code === 'EADDRINUSE' ? `Port ${process.env.PORT || 3000} is busy. Is Dodobox already running?` : e.message); process.exit(1) })
  openBrowser(`http://localhost:${s.address().port}`)
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => stop().then(() => process.exit(0)))
}
