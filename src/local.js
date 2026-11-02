// Local media: scans folders of the user's own files and matches them to titles. Plays instantly, no download.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { readdir, stat } from 'node:fs/promises'
import { catalog } from './meta.js'
import './data.js'
import { DATA } from './paths.js'
import { settings } from './state.js'
import { VIDEO_EXT, hasWords } from './release.js'
import { sidecarsFor, SUB_FILE } from './sidecar.js'
import { sendRange, MIME } from './range.js'
import { log } from './log.js'
import { readAnyVersion, stamp } from './stamped.js'
import { putFile } from './store.js'

const FILE = path.join(DATA, 'local.json')
const MIN_BYTES = +process.env.MIN_LOCAL_BYTES || 30e6
// Which title a file is does not change with the release, so this cache is read whatever version saved it.
const known = readAnyVersion(FILE) || {}
let index = []
let scanning = null

const configured = () => settings().mediaDirs || [process.env.MEDIA_DIR, path.join(os.homedir(), 'Videos'), path.join(os.homedir(), 'Movies')].filter(Boolean)
export const dirs = () => configured().filter(d => { try { return fs.statSync(d).isDirectory() } catch { return false } })

const clean = s => s.replace(/[._]+/g, ' ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
const JUNK = /\b(2160p|1080p|720p|480p|4k|bluray|brrip|bdrip|webrip|web-?dl|hdtv|dvdrip|x26[45]|h26[45]|hevc|aac|ac3|dts|remux|proper|repack|extended|uncut)\b.*$/i

export function parseName (file) {
  const base = path.basename(file).replace(/\.[^.]+$/, '')
  const dir = path.basename(path.dirname(file))
  let m = base.match(/^(.*?)[ ._-]+S(\d{1,2})[ ._-]?E(\d{1,3})/i) || base.match(/^(.*?)[ ._-]+(\d{1,2})x(\d{2,3})\b/)
  if (m) return { kind: 'episode', title: clean(m[1]) || clean(dir.replace(/\bseason.*$/i, '')), season: +m[2], episode: +m[3] }
  m = base.match(/^\[[^\]]+\]\s*(.+?)\s*-\s*(\d{1,3})(?:v\d)?\b/)
  if (m) return { kind: 'anime', title: clean(m[1]), season: 1, episode: +m[2] }
  m = base.match(/^(.*?)[ ._([-]+((?:19|20)\d{2})(?!\d)/)
  if (m && clean(m[1])) return { kind: 'movie', title: clean(m[1]).replace(JUNK, '').trim(), year: +m[2] }
  m = dir.match(/^(.*?)[ ._([-]+((?:19|20)\d{2})(?!\d)/)
  if (m && clean(m[1])) return { kind: 'movie', title: clean(m[1]).replace(JUNK, '').trim(), year: +m[2] }
  const t = clean(base.replace(JUNK, ''))
  return t ? { kind: 'movie', title: t } : null
}

// Overridable so tests can scan without the network.
export const hooks = { match: matchOnline }
async function matchOnline (p) {
  const types = p.kind === 'movie' ? ['movie'] : p.kind === 'anime' ? ['anime', 'series'] : ['series', 'anime']
  for (const type of types) {
    const res = await catalog({ type, q: p.title }).catch(() => [])
    const hit = res.find(r => hasWords(r.name, p.title) && hasWords(p.title, r.name) && (!p.year || !r.year || Math.abs(r.year - p.year) <= 1)) ||
      res.find(r => hasWords(r.name, p.title))
    if (hit) return { type: hit.type, mid: hit.id, name: hit.name, poster: hit.poster, year: hit.year }
  }
  return null
}

// Folders and files that could not be read are collected in `bad`: what the scan knew about them must survive a mount that is briefly gone.
async function walk (dir, out, bad, depth = 0) {
  if (depth > 6) return
  let items
  try { items = await readdir(dir, { withFileTypes: true }) } catch (e) { bad.push(dir); log.warn('local', 'cannot read folder', { dir, err: e.code || e }); return }
  for (const it of items) {
    if (it.name.startsWith('.')) continue
    const p = path.join(dir, it.name)
    if (p === DATA) continue
    if (it.isDirectory()) await walk(p, out, bad, depth + 1)
    else if (VIDEO_EXT.test(it.name) && !/sample|trailer|featurette/i.test(it.name)) {
      try { const st = await stat(p); if (st.size >= MIN_BYTES) out.push({ p, size: st.size, mtime: st.mtimeMs }) } catch { bad.push(p) }
    }
  }
}

const under = (p, dir) => { const r = path.relative(dir, p); return r !== '..' && !r.startsWith('..' + path.sep) && !path.isAbsolute(r) } // right also for a folder typed with a trailing slash
// Saves are queued so an older copy never lands after a newer one.
let saving = Promise.resolve()
const save = () => (saving = saving.then(() => putFile(FILE, stamp(known))).catch(e => log.warn('local', 'could not save local.json', { err: e })))
const entryOf = (f, k) => ({ id: 'l' + crypto.createHash('sha1').update(f.p).digest('hex').slice(0, 16), path: f.p, size: f.size, ...k.match, season: k.parsed.season ?? null, episode: k.parsed.episode ?? null })
// Unmatched files are retried hourly (a lookup service may have been down).
const stale = (k, f) => !k || k.mtime !== f.mtime || k.size !== f.size || (!k.match && Date.now() - (k.at || 0) > 3600e3)

export function rescan () {
  if (scanning) return scanning
  scanning = (async () => {
    const t0 = Date.now()
    const files = []
    const cfg = configured(); const live = []
    for (const d of cfg) if (await stat(d).then(s => s.isDirectory(), () => false)) live.push(d) // async: a dead network mount must not stall the server
    // A configured folder that is not there (an unmounted drive) keeps its entries.
    const bad = cfg.filter(d => !live.includes(d))
    log.debug('local', 'scan start', { dirs: live.join(',') })
    for (const d of live) {
      const n = files.length
      await walk(d, files, bad)
      if (files.length === n) bad.push(d) // an unmounted share often leaves an empty mount point: no files at all is not proof they are gone
    }
    // What is already known is served at once; each new match joins the list as it is found.
    const entries = new Map()
    const todo = []
    for (const f of files) {
      const k = known[f.p]
      if (k?.match) entries.set(f.p, entryOf(f, k))
      if (stale(k, f)) todo.push(f)
    }
    index = [...entries.values()]
    let fresh = 0
    for (const f of todo) {
      const parsed = parseName(f.p)
      const k = { mtime: f.mtime, size: f.size, at: Date.now(), parsed, match: parsed ? await hooks.match(parsed) : null }
      known[f.p] = k
      if (k.match) entries.set(f.p, entryOf(f, k)); else entries.delete(f.p)
      index = [...entries.values()]
      if (++fresh % 25 === 0) save()
      log.debug('local', k.match ? 'matched' : 'no match', { file: f.p, parsed: parsed && `${parsed.title}${parsed.season != null ? ` S${parsed.season}E${parsed.episode}` : ''}`, as: k.match && `${k.match.type}:${k.match.mid}` })
    }
    const seen = new Set(files.map(f => f.p))
    for (const p of Object.keys(known)) if (!seen.has(p) && !bad.some(d => under(p, d))) delete known[p]
    await save()
    log.info('local', 'scan done', { files: files.length, matched: index.length, ms: Date.now() - t0 })
    return index.length
  })().finally(() => { scanning = null })
  return scanning
}

export const all = () => index
export const byId = id => index.find(e => e.id === id)
export const find = ({ type, id, season, episode }) => index.find(e => e.type === type && e.mid === id && (e.season ?? null) === (season ?? null) && (e.episode ?? null) === (episode ?? null))
export const isLocal = h => /^l[0-9a-f]{16}$/.test(h)

export function status (id) {
  const e = byId(id)
  return e && { hash: id, local: true, phase: 'done', peers: 0, speed: 0, fileIdx: 0, name: path.basename(e.path), length: e.size, downloaded: e.size, progress: 1, ctx: { type: e.type, id: e.mid, title: e.name, poster: e.poster, season: e.season, episode: e.episode } }
}

// Subtitle files beside a local video: in its folder, or in a Subs/Subtitles folder (one level of episode folders inside it).
const SUBS_DIR = /^(subs?|subtitles?)$/i
function sideFiles (e) {
  const dir = path.dirname(e.path); const files = []
  const take = (d, depth) => {
    let items
    try { items = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const it of items) {
      const p = path.join(d, it.name)
      if (it.isDirectory()) { if (depth < 2 && (depth > 0 || SUBS_DIR.test(it.name))) take(p, depth + 1); continue }
      if (!it.isFile() || (!SUB_FILE.test(it.name) && !(depth === 0 && VIDEO_EXT.test(it.name)))) continue
      try { files.push({ name: path.relative(dir, p), length: fs.statSync(p).size, path: p }) } catch {}
    }
  }
  take(dir, 0)
  return files
}
export function sidecars (id) {
  const e = byId(id); if (!e) return []
  const files = sideFiles(e)
  const at = files.findIndex(f => f.path === e.path)
  if (at < 0) return []
  return sidecarsFor(files, at, { type: e.type, season: e.season, episode: e.episode }).map(s => ({ ...s, path: files[s.i].path }))
}
// A subtitle file's name and bytes; only files sidecars() lists can be read.
export function readSidecar (id, i) {
  const s = sidecars(id).find(x => x.i === i)
  if (!s) throw Object.assign(new Error('unknown subtitle file'), { code: 404 })
  return { name: s.name, buf: fs.readFileSync(s.path) }
}

// The size comes from the file now, not from the last scan: a file replaced or cut short since would get a wrong content-length.
export async function serve (id, req, res) {
  const e = byId(id)
  const st = e && await stat(e.path).catch(() => null)
  if (!st?.isFile()) { res.writeHead(404).end(); return }
  sendRange(req, res, { length: st.size, type: MIME[path.extname(e.path).slice(1).toLowerCase()] || 'application/octet-stream', stream: (start, end) => fs.createReadStream(e.path, { start, end }) })
}

export function watch () {
  rescan().catch(e => log.warn('local', 'scan failed', { err: e }))
  setInterval(() => rescan().catch(e => log.warn('local', 'scan failed', { err: e })), 10 * 60e3).unref()
}
