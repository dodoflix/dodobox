// Torrent engine: adds torrents, downloads only the chosen file, persists the library across restarts.
import WebTorrent from 'webtorrent'
import fs from 'node:fs'
import path from 'node:path'
import { pickFile } from './release.js'
import { sidecarsFor, SUB_FILE } from './sidecar.js'
import { sendRange, MIME } from './range.js'

import './data.js'
import { DATA } from './paths.js'
export { DATA }
const DL = path.join(DATA, 'downloads')
const STATE = path.join(DATA, 'library.json')
fs.mkdirSync(DL, { recursive: true })

const client = new WebTorrent({ dht: !process.env.NO_DHT, lsd: !process.env.NO_DHT, utp: !process.env.NO_DHT })
client.setMaxListeners(0) // every torrent listens for the client's 'listening' event
client.on('error', e => console.error('[torrent]', e.message))

let lib = {}
try { lib = JSON.parse(fs.readFileSync(STATE, 'utf8')) } catch {}
const save = () => { fs.writeFileSync(STATE + '.tmp', JSON.stringify(lib, null, 1)); fs.renameSync(STATE + '.tmp', STATE) }

function attach (entry) {
  const t = client.add(entry.magnet, { path: DL })
  t.setMaxListeners(50) // every open read of the file listens for verified pieces
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

// Idle streams pause, and manual downloads give way while something is being watched or a prioritized download is running.
const WATCH_MS = 25e3 // a title is "being watched" while the player has asked for it this recently
const IDLE_MS = 45e3 // an unpinned download nobody has asked for this long is paused
export const pauseReason = (e, now, watching, urgent) => {
  const used = e.lastUsed || 0
  if (now - used < WATCH_MS) return null
  if (e.pinned) return e.held ? 'user' : watching ? 'watching' : urgent && !e.priority ? 'priority' : null
  return now - (used || e.added || 0) > IDLE_MS ? 'idle' : null
}
// Pausing is per file: a pack can hold several of the episodes asked for, and pausing or prioritizing one must leave the others alone.
const paused = new Map() // `${hash}:${fileIdx}` -> 'watching' | 'idle' | 'user' | 'priority'
const rowKey = (e, r) => `${e.hash}:${r.fileIdx}`
const fileOf = (r, t) => (r.fileIdx != null ? t.files[r.fileIdx] : null)
const pending = (r, t) => { const f = fileOf(r, t); return !!f && !f.done }
// Pausing is deselecting. torrent.pause() would also refuse every peer the swarm offers meanwhile, so a resumed torrent finds none until its next announce (many minutes) and playback sits on "buffering".
function setPaused (e, t, r, reason) {
  const k = rowKey(e, r)
  if (reason === (paused.get(k) ?? null)) return
  if (reason) { fileOf(r, t)?.deselect(); paused.set(k, reason) } else { paused.delete(k); fileOf(r, t)?.select() }
}
function rebalance () {
  const now = Date.now()
  const live = Object.values(lib).map(e => ({ e, t: torrentOf(e.hash) })).filter(x => x.t?.ready)
  const watching = live.some(({ e, t }) => now - (e.lastUsed || 0) < WATCH_MS && rowsOf(e).some(r => pending(r, t)))
  const urgent = live.some(({ e, t }) => rowsOf(e).some(r => r.priority && !r.held && pending(r, t)))
  for (const { e, t } of live) {
    for (const r of rowsOf(e)) {
      // A paused download that is the one being watched plays, then is paused again.
      const viewed = e.lastFile === r.fileIdx && now - (e.lastUsed || 0) < WATCH_MS
      const view = { ...e, held: r.held && !viewed, priority: r.priority }
      setPaused(e, t, r, pending(r, t) ? pauseReason(view, now, watching, urgent) : null)
    }
  }
}
// A torrent someone is waiting on that gets nothing asks the trackers and the DHT for peers again, and a torrent that never found its metadata is dropped.
const stalled = new Map() // hash -> { since, askedAt }
const NO_METADATA_MS = 10 * 60e3
function heal () {
  const now = Date.now()
  for (const e of Object.values(lib)) {
    const t = torrentOf(e.hash)
    if (!t) continue
    if (!t.ready) {
      if (!e.pinned && now - Math.max(e.lastUsed || 0, e.added || 0) > NO_METADATA_MS) remove(e.hash).catch(() => {})
      continue
    }
    const wanted = now - (e.lastUsed || 0) < WATCH_MS && rowsOf(e).some(r => pending(r, t) && !paused.has(rowKey(e, r)))
    if (!wanted || t.downloadSpeed > 0) { stalled.delete(e.hash); continue }
    const s = stalled.get(e.hash) || stalled.set(e.hash, { since: now, askedAt: 0 }).get(e.hash)
    if (now - s.since < 8000 || now - s.askedAt < 30000) continue
    s.askedAt = now
    try { t.discovery?.tracker?.update(); t.discovery?._dhtAnnounce?.() } catch { /* a missing tracker or DHT only means nothing to ask */ }
  }
}
setInterval(() => { rebalance(); heal() }, 5000).unref()

export function pin (hash) { if (lib[hash]) { lib[hash].pinned = true; save() } }

// Pause, resume and prioritize act on one episode (one file of its torrent).
export function hold (hash, file, on) {
  const e = lib[hash]; if (!e) return false
  const r = rowFor(e, file)
  r.held = on || undefined
  if (on) delete r.priority
  save(); rebalance()
  return true
}
export function prioritize (hash, file, on) {
  const e = lib[hash]; if (!e) return false
  const r = rowFor(e, file)
  r.priority = on || undefined
  if (on) delete r.held
  save(); rebalance()
  return true
}
// For a download that was just started from the queue: its row is found by the episode it holds.
export function prioritizeCtx (ctx, on) {
  const f = findEntry(ctx); if (!f) return false
  return prioritize(f.hash, f.file, on)
}

const torrentOf = hash => client.torrents.find(t => t.infoHash === hash)

const rowsOf = e => [e, ...(e.extra || [])]
const rowFor = (e, file) => (file == null ? e : rowsOf(e).find(x => x.fileIdx === +file) || e)

export function status (hash, silent, file) {
  const e = lib[hash]
  if (!e) return null
  if (!silent) touch(hash, file == null ? e.fileIdx : +file)
  const row = rowFor(e, file)
  const t = torrentOf(hash)
  const f = row.fileIdx != null && t?.ready ? t.files[row.fileIdx] : null
  return {
    hash,
    key: row.fileIdx != null ? `${hash}:${row.fileIdx}` : hash,
    ctx: row.ctx,
    pinned: !!e.pinned,
    held: !!row.held,
    priority: !!row.priority,
    error: row.error || e.error,
    phase: row.error || e.error ? 'error' : !t?.ready ? 'metadata' : f?.done ? 'done' : paused.has(rowKey(e, row)) ? 'paused' : 'downloading',
    pausedReason: paused.get(rowKey(e, row)) || null,
    peers: t?.numPeers ?? 0,
    torrent: t && { name: t.name, size: t.length, files: t.files.length, pieceLength: t.pieceLength, uploaded: t.uploaded, uploadSpeed: t.uploadSpeed, ratio: t.ratio },
    speed: paused.has(rowKey(e, row)) ? 0 : t?.downloadSpeed ?? 0,
    fileIdx: row.fileIdx,
    name: f?.name || row.name || null,
    length: f?.length ?? 0,
    downloaded: f?.downloaded ?? 0,
    readable: f && !f.done ? readablePrefix(hash, row.fileIdx) : f?.length ?? 0,
    progress: f?.progress ?? 0
  }
}

// The file turned out to be another title: the entry is marked failed so it is never offered for this one again.
export function reject (hash, file, why) {
  const e = lib[hash]; if (!e) return
  rowFor(e, file).error = why
  save()
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
    if (e.fileIdx === k) { const x = e.extra.shift(); t?.files[k]?.deselect(); Object.assign(e, { ctx: x.ctx, fileIdx: x.fileIdx, name: x.name, held: x.held, priority: x.priority }); save(); return true }
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

export async function serve (hash, idx, req, res) {
  const t = torrentOf(hash)
  // After a restart the page is already asking for its video while the torrent is still finding its file list.
  if (t && !t.ready) await new Promise(resolve => { const timer = setTimeout(resolve, 15000); t.once('ready', () => { clearTimeout(timer); resolve() }) })
  const f = t?.files[idx]
  if (!f || res.destroyed) { if (!res.destroyed) res.writeHead(t ? 503 : 404, { 'retry-after': '3' }).end(); return }
  touch(hash, idx)
  sendRange(req, res, { length: f.length, type: MIME[path.extname(f.name).slice(1).toLowerCase()] || 'application/octet-stream', stream: (start, end) => f.createReadStream({ start, end }) })
}

export function touch (hash, file) {
  const e = lib[hash]; if (!e) return
  e.lastUsed = Date.now()
  if (file != null) e.lastFile = file
  const t = torrentOf(hash)
  if (t?.ready) for (const r of rowsOf(e)) if (paused.has(rowKey(e, r)) && (r.fileIdx === file || !r.held)) setPaused(e, t, r, null) // someone is watching again: continue at once
}

export function findEntry (ctx) {
  for (const e of Object.values(lib)) {
    if (e.error) continue
    for (const r of rowsOf(e)) if (!r.error && r.ctx.type === ctx.type && r.ctx.id === ctx.id && r.ctx.season === ctx.season && r.ctx.episode === ctx.episode) return { hash: e.hash, file: r.fileIdx }
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
