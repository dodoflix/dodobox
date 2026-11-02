// Helpers for the files the server keeps on disk: whole-file writes that a crash cannot cut short, a size-capped body read, and
// size limits for the folders that only hold things which can be fetched or worked out again.
import fs from 'node:fs'
import { writeFile, rename, readdir, stat, rm } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const tmpName = f => `${f}.${crypto.randomUUID()}.tmp`

// Written to a temp name first: a crash mid-write must not leave a half file under the real name, which would be served for good.
export async function putFile (f, data) { const t = tmpName(f); await writeFile(t, data); await rename(t, f) }
export function putFileSync (f, data) { const t = tmpName(f); fs.writeFileSync(t, data); fs.renameSync(t, f) }

// The body of a response, refused as soon as it is over `max` bytes (by its length header before reading, else while reading).
const tooBig = what => Object.assign(new Error(`${what} too large`), { code: 'TOO_LARGE' })
export function checkLength (r, max, what = 'download') {
  if (+r.headers.get('content-length') > max) { r.body?.cancel().catch(() => {}); throw tooBig(what) }
}
export async function readCapped (r, max, what = 'download') {
  checkLength(r, max, what)
  const chunks = []; let n = 0
  for await (const c of r.body ?? []) { n += c.length; if (n > max) throw tooBig(what); chunks.push(c) }
  return Buffer.concat(chunks)
}

// A file that was just used counts as recent, so trim() drops what has gone unused longest.
export const touch = f => { const now = new Date(); fs.utimes(f, now, now, () => {}) }

const ORPHAN_MS = 3600e3 // a temp file this old belongs to a write that died
const running = new Set()
const lastRun = new Map()

// Keeps a folder under `max` bytes by deleting the least recently used files first (down to 90%, so it is not repeated on the next
// write). Everything in these folders can be fetched or built again, so a deleted file only costs a refetch.
export async function trim (dir, max) {
  if (running.has(dir)) return
  running.add(dir)
  try {
    const files = []
    let total = 0
    for (const name of await readdir(dir).catch(() => [])) {
      const f = path.join(dir, name)
      const st = await stat(f).catch(() => null)
      if (!st?.isFile()) continue
      if (name.endsWith('.tmp') && Date.now() - st.mtimeMs > ORPHAN_MS) { await rm(f, { force: true }); continue }
      files.push({ f, size: st.size, at: st.mtimeMs }); total += st.size
    }
    if (total <= max) return
    files.sort((a, b) => a.at - b.at)
    for (const x of files) {
      if (total <= max * 0.9) break
      await rm(x.f, { force: true }); total -= x.size
    }
  } finally { running.delete(dir) }
}
// After a write: checked at most once a minute per folder.
export function trimSoon (dir, max) {
  if (Date.now() - (lastRun.get(dir) || 0) < 60e3) return
  lastRun.set(dir, Date.now())
  trim(dir, max).catch(() => {})
}
