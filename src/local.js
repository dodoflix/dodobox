// Local media: scans folders of the user's own files and matches them to titles. Plays instantly, no download.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { catalog } from './meta.js'
import { DATA } from './paths.js'
import { settings } from './state.js'
import { VIDEO_EXT, nameHasTitle } from './sources.js'
import { sendRange, MIME } from './range.js'

const FILE = path.join(DATA, 'local.json')
const MIN_BYTES = +process.env.MIN_LOCAL_BYTES || 30e6
let known = {}
try { known = JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {}
let index = []
let scanning = null

export const dirs = () => {
  const cfg = settings().mediaDirs
  const list = cfg || [process.env.MEDIA_DIR, path.join(os.homedir(), 'Videos'), path.join(os.homedir(), 'Movies')].filter(Boolean)
  return list.filter(d => { try { return fs.statSync(d).isDirectory() } catch { return false } })
}

const clean = s => s.replace(/[._]+/g, ' ').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
const JUNK = /\b(2160p|1080p|720p|480p|4k|bluray|brrip|bdrip|webrip|web-?dl|hdtv|dvdrip|x26[45]|h26[45]|hevc|aac|ac3|dts|remux|proper|repack|extended|uncut)\b.*$/i

// "Show.Name.S01E02...", "[Group] Show - 03", "Movie Name (2019)" and the folder name as a last resort.
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
    const hit = res.find(r => nameHasTitle(r.name, p.title) && nameHasTitle(p.title, r.name) && (!p.year || !r.year || Math.abs(r.year - p.year) <= 1)) ||
      res.find(r => nameHasTitle(r.name, p.title))
    if (hit) return { type: hit.type, mid: hit.id, name: hit.name, poster: hit.poster, year: hit.year }
  }
  return null
}

function walk (dir, out, depth = 0) {
  if (depth > 6) return
  let items
  try { items = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const it of items) {
    if (it.name.startsWith('.')) continue
    const p = path.join(dir, it.name)
    if (p === DATA) continue
    if (it.isDirectory()) walk(p, out, depth + 1)
    else if (VIDEO_EXT.test(it.name) && !/sample|trailer|featurette/i.test(it.name)) {
      try { const st = fs.statSync(p); if (st.size >= MIN_BYTES) out.push({ p, size: st.size, mtime: st.mtimeMs }) } catch {}
    }
  }
}

export function rescan () {
  if (scanning) return scanning
  scanning = (async () => {
    const files = []
    for (const d of dirs()) walk(d, files)
    const next = []
    for (const f of files) {
      let k = known[f.p]
      // Unmatched files are retried hourly (a lookup service may have been down).
      if (!k || k.mtime !== f.mtime || k.size !== f.size || (!k.match && Date.now() - (k.at || 0) > 3600e3)) {
        const parsed = parseName(f.p)
        k = { mtime: f.mtime, size: f.size, at: Date.now(), parsed, match: parsed ? await hooks.match(parsed) : null }
        known[f.p] = k
      }
      if (k.match) {
        const e = { id: 'l' + crypto.createHash('sha1').update(f.p).digest('hex').slice(0, 16), path: f.p, size: f.size, ...k.match, season: k.parsed.season ?? null, episode: k.parsed.episode ?? null }
        next.push(e)
      }
    }
    for (const p of Object.keys(known)) if (!files.some(f => f.p === p)) delete known[p]
    index = next
    fs.writeFile(FILE, JSON.stringify(known), () => {})
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

export function serve (id, req, res) {
  const e = byId(id)
  if (!e) { res.writeHead(404).end(); return }
  sendRange(req, res, { length: e.size, type: MIME[path.extname(e.path).slice(1).toLowerCase()] || 'application/octet-stream', stream: (start, end) => fs.createReadStream(e.path, { start, end }) })
}

export function watch () {
  rescan().catch(e => console.warn('[local]', e.message))
  setInterval(() => rescan().catch(() => {}), 10 * 60e3).unref()
}
