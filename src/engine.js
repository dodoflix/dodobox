// Torrent engine: adds torrents, downloads only the chosen file, persists the library across restarts.
import WebTorrent from 'webtorrent'
import fs from 'node:fs'
import path from 'node:path'
import { pickFile } from './sources.js'
import { sidecarsFor, SUB_FILE } from './sidecar.js'
import { sendRange, MIME } from './range.js'

import { DATA } from './paths.js'
export { DATA }
const DL = path.join(DATA, 'downloads')
const STATE = path.join(DATA, 'library.json')
fs.mkdirSync(DL, { recursive: true })

const client = new WebTorrent({ dht: !process.env.NO_DHT, lsd: !process.env.NO_DHT, utp: !process.env.NO_DHT })
client.on('error', e => console.error('[torrent]', e.message))

let lib = {}
try { lib = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch {}
const save = () => fs.writeFileSync(STATE, JSON.stringify(lib, null, 1))

function attach (entry) {
  const t = client.add(entry.magnet, { path: DL })
  t.on('error', e => console.error('[torrent]', entry.hash, e.message))
  t.on('ready', () => {
    for (const f of t.files) f.deselect()
    const idx = entry.fileIdx ?? pickFile(t.files.map(f => ({ name: f.path, length: f.length })), entry.ctx)
    if (idx < 0) { entry.error = 'No playable file found in torrent'; return }
    entry.fileIdx = idx
    entry.name = t.files[idx].name
    t.files[idx].select()
    for (const x of entry.extra || []) {
      x.fileIdx ??= pickFile(t.files.map(f => ({ name: f.path, length: f.length })), x.ctx)
      if (x.fileIdx >= 0) { x.name = t.files[x.fileIdx].name; t.files[x.fileIdx].select() }
    }
    save()
  })
  return t
}

for (const e of Object.values(lib)) attach(e)

export function add ({ hash, magnet, ctx, fileIdx, pinned }) {
  hash = hash.toLowerCase()
  // The provider's fileIdx is only a hint for pickFile (it can be stale for multi-file packs).
  ctx.fileIdx = fileIdx
  if (!lib[hash]) {
    lib[hash] = { hash, magnet, ctx, added: Date.now() }
    save()
    attach(lib[hash])
  } else if (ctx.episode != null && lib[hash].ctx?.episode !== ctx.episode && (pinned || lib[hash].pinned)) {
    addExtra(hash, ctx)
  } else if (ctx.episode != null && lib[hash].ctx?.episode !== ctx.episode && !lib[hash].pinned) {
    const t = client.torrents.find(x => x.infoHash === hash)
    Object.assign(lib[hash], { ctx, fileIdx: undefined, error: undefined })
    if (t?.ready) {
      for (const f of t.files) f.deselect()
      const idx = pickFile(t.files.map(f => ({ name: f.path, length: f.length })), ctx)
      if (idx >= 0) { lib[hash].fileIdx = idx; lib[hash].name = t.files[idx].name; t.files[idx].select() }
      save()
    }
  }
  if (pinned && !lib[hash].pinned) { lib[hash].pinned = true; save() }
  return lib[hash]
}

function addExtra (hash, ctx) {
  const e = lib[hash]
  if ((e.extra || []).some(x => x.ctx.season === ctx.season && x.ctx.episode === ctx.episode)) return
  const x = { ctx }
  ;(e.extra ||= []).push(x)
  const t = torrentOf(hash)
  if (t?.ready) {
    x.fileIdx = pickFile(t.files.map(f => ({ name: f.path, length: f.length })), ctx)
    if (x.fileIdx >= 0) { x.name = t.files[x.fileIdx].name; t.files[x.fileIdx].select() }
  }
  save()
}

// Idle streams pause, and manual downloads give way while something is being watched.
const WATCH_MS = 25e3 // a title is "being watched" while the player has asked for it this recently
const IDLE_MS = 45e3 // an unpinned download nobody has asked for this long is paused
export const pauseReason = (e, now, watching) => {
  const used = e.lastUsed || 0
  if (now - used < WATCH_MS) return null
  if (e.pinned) return watching ? 'watching' : null
  return now - (used || e.added || 0) > IDLE_MS ? 'idle' : null
}
const paused = new Map() // hash -> 'watching' | 'idle'
const selectRows = (e, t) => { for (const r of rowsOf(e)) if (r.fileIdx != null) t.files[r.fileIdx]?.select() }
function setPaused (e, t, reason) {
  if (reason === (paused.get(e.hash) ?? null)) return
  if (reason) {
    if (!paused.has(e.hash)) { for (const f of t.files) f.deselect(); t.pause() }
    paused.set(e.hash, reason)
  } else { paused.delete(e.hash); t.resume(); selectRows(e, t) }
}
const downloading = (e, t) => rowsOf(e).some(r => r.fileIdx != null && t.files[r.fileIdx] && !t.files[r.fileIdx].done)
function rebalance () {
  const now = Date.now()
  const live = Object.values(lib).map(e => ({ e, t: torrentOf(e.hash) })).filter(x => x.t?.ready)
  const watching = live.some(({ e, t }) => now - (e.lastUsed || 0) < WATCH_MS && downloading(e, t))
  for (const { e, t } of live) setPaused(e, t, downloading(e, t) ? pauseReason(e, now, watching) : null)
}
setInterval(rebalance, 5000).unref()

export function pin (hash) { if (lib[hash]) { lib[hash].pinned = true; save() } }

const torrentOf = hash => client.torrents.find(t => t.infoHash === hash)

const rowsOf = e => [e, ...(e.extra || [])]
const rowFor = (e, file) => (file == null ? e : rowsOf(e).find(x => x.fileIdx === +file) || e)

export function status (hash, silent, file) {
  const e = lib[hash]
  if (!e) return null
  if (!silent) touch(hash)
  const row = rowFor(e, file)
  const t = torrentOf(hash)
  const f = row.fileIdx != null && t?.ready ? t.files[row.fileIdx] : null
  return {
    hash,
    key: row.fileIdx != null ? `${hash}:${row.fileIdx}` : hash,
    ctx: row.ctx,
    pinned: !!e.pinned,
    error: row.error || e.error,
    phase: row.error || e.error ? 'error' : !t?.ready ? 'metadata' : f?.done ? 'done' : paused.has(hash) ? 'paused' : 'downloading',
    pausedReason: paused.get(hash) || null,
    peers: t?.numPeers ?? 0,
    speed: paused.has(hash) ? 0 : t?.downloadSpeed ?? 0,
    fileIdx: row.fileIdx,
    name: f?.name || row.name || null,
    length: f?.length ?? 0,
    downloaded: f?.downloaded ?? 0,
    readable: f && !f.done ? readablePrefix(hash, row.fileIdx) : f?.length ?? 0,
    progress: f?.progress ?? 0
  }
}

export const library = () => Object.values(lib).sort((a, b) => b.added - a.added).flatMap(e => rowsOf(e).map(r => status(e.hash, true, r.fileIdx ?? undefined)).filter(Boolean))

function pruneEmpty (dir) {
  try { for (const d of fs.readdirSync(dir, { withFileTypes: true })) if (d.isDirectory()) pruneEmpty(path.join(dir, d.name)); fs.rmdirSync(dir) } catch { /* not empty, or already gone */ }
}

export async function remove (hash, file) {
  if (!lib[hash]) return false
  const e = lib[hash]
  const t = torrentOf(hash)
  if (file != null && e.extra?.length) {
    const k = +file
    if (e.fileIdx === k) { const x = e.extra.shift(); t?.files[k]?.deselect(); Object.assign(e, { ctx: x.ctx, fileIdx: x.fileIdx, name: x.name }); save(); return true }
    const at = e.extra.findIndex(x => x.fileIdx === k)
    if (at >= 0) { e.extra.splice(at, 1); t?.files[k]?.deselect(); save(); return true }
  }
  const tops = t ? new Set(t.files.map(f => f.path.split(/[\\/]/)[0])) : []
  if (t) await new Promise(resolve => client.remove(hash, { destroyStore: true }, resolve))
  // Removing the files leaves a pack's folders behind.
  for (const top of tops) pruneEmpty(path.join(DL, top))
  delete lib[hash]
  save()
  return true
}

export function readablePrefix (hash, idx) {
  const t = torrentOf(hash); const f = t?.ready ? t.files[idx] : null
  if (!f || !t.bitfield) return 0
  const pl = t.pieceLength; const first = Math.floor(f.offset / pl); const last = Math.floor((f.offset + f.length - 1) / pl)
  let p = first; while (p <= last && t.bitfield.get(p)) p++
  return p > last ? f.length : Math.max(0, p * pl - f.offset)
}

// Subtitle files inside the torrent that belong to the file being watched.
export function sidecars (hash, file) {
  const e = lib[hash]; const t = torrentOf(hash)
  const row = e && rowFor(e, file)
  if (!t?.ready || row?.fileIdx == null) return []
  return sidecarsFor(t.files.map(f => ({ name: f.path, length: f.length })), row.fileIdx, row.ctx)
}

// A subtitle file's path and bytes. Reading asks the swarm for its pieces ahead of the video's, which is a few kilobytes.
export function readSidecar (hash, idx, ms = 20000) {
  const f = torrentOf(hash)?.files[idx]
  if (!f || !SUB_FILE.test(f.name)) throw Object.assign(new Error('unknown subtitle file'), { code: 404 })
  touch(hash)
  return new Promise((resolve, reject) => {
    const chunks = []; const s = f.createReadStream()
    const timer = setTimeout(() => { s.destroy(); reject(Object.assign(new Error('subtitle file not downloaded yet'), { code: 409 })) }, ms)
    s.on('data', c => chunks.push(c))
    s.on('end', () => { clearTimeout(timer); resolve({ name: f.path, buf: Buffer.concat(chunks) }) })
    s.on('error', e => { clearTimeout(timer); reject(e) })
  })
}

export function filePath (hash, idx) {
  const t = torrentOf(hash); const f = t?.files[idx]
  return f ? path.join(t.path, f.path) : null
}

export function serve (hash, idx, req, res) {
  const f = torrentOf(hash)?.files[idx]
  if (!f) { res.writeHead(404).end(); return }
  touch(hash)
  sendRange(req, res, { length: f.length, type: MIME[path.extname(f.name).slice(1).toLowerCase()] || 'application/octet-stream', stream: (start, end) => f.createReadStream({ start, end }) })
}

export function touch (hash) {
  const e = lib[hash]; if (!e) return
  e.lastUsed = Date.now()
  if (paused.has(hash)) { const t = torrentOf(hash); if (t) setPaused(e, t, null) } // someone is watching again: continue at once
}

export function findEntry (ctx) {
  for (const e of Object.values(lib)) {
    if (e.error) continue
    for (const r of rowsOf(e)) if (r.ctx.type === ctx.type && r.ctx.id === ctx.id && r.ctx.season === ctx.season && r.ctx.episode === ctx.episode) return { hash: e.hash, file: r.fileIdx }
  }
  return null
}

export function storage () {
  const entries = Object.values(lib).map(e => { const t = torrentOf(e.hash); return { hash: e.hash, bytes: rowsOf(e).reduce((a, r) => a + (t?.files[r.fileIdx]?.downloaded ?? 0), 0), lastUsed: e.lastUsed || e.added, ctx: e.ctx } })
  return { used: entries.reduce((a, e) => a + e.bytes, 0), entries }
}

// Over the cap: drop the least recently used downloads, never anything touched in the last half hour.
export async function evict (maxBytes) {
  const { used, entries } = storage()
  let over = used - maxBytes
  for (const e of entries.filter(x => !lib[x.hash]?.pinned).sort((a, b) => a.lastUsed - b.lastUsed)) {
    if (over <= 0) break
    if (Date.now() - e.lastUsed < 30 * 60e3) continue
    await remove(e.hash)
    over -= e.bytes
  }
}

export const shutdown = () => new Promise(r => client.destroy(r))
