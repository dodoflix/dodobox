// Poster/backdrop proxy with a disk cache: same-origin (lets the UI sample colors), fast on repeat, survives offline.
import fs from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA } from './paths.js'
import { run } from './transcode.js'
import { fetchRetry, once } from './http.js'

const DIR = path.join(DATA, 'img')
fs.mkdirSync(DIR, { recursive: true })
const HOSTS = /(^|\.)(metahub\.space|media-amazon\.com|anilist\.co|crunchyroll\.com|kitsu\.(io|app)|myanimelist\.net|cdn\.myanimelist\.net|strem\.io|themoviedb\.org|tmdb\.org)$/

const WIDTHS = [240, 360, 480, 640, 800, 1080, 1280, 1920]
export const snap = w => WIDTHS.find(x => x >= w) || WIDTHS.at(-1)

export const proxied = u => u && HOSTS.test(safeHost(u)) ? `/img?u=${encodeURIComponent(u)}` : u
const safeHost = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : '' } catch { return '' } }

export async function image (u, w) {
  if (!HOSTS.test(safeHost(u))) throw Object.assign(new Error('image host not allowed'), { code: 400 })
  const f = path.join(DIR, crypto.createHash('sha1').update(u).digest('hex'))
  let orig
  try { orig = { buf: await readFile(f), type: await readFile(f + '.t', 'utf8') } } catch {}
  if (!orig) {
    const r = await once('img:' + u, () => fetchRetry(u, { timeout: 12000, tries: 3 })).catch(() => { throw Object.assign(new Error('image fetch failed'), { code: 502 }) })
    if (!/^image\//.test(r.headers.get('content-type') || '')) throw Object.assign(new Error('image fetch failed'), { code: 502 })
    const buf = Buffer.from(await r.clone().arrayBuffer())
    if (buf.length > 8e6) throw new Error('image too large')
    orig = { buf, type: r.headers.get('content-type') }
    await Promise.all([writeFile(f, buf), writeFile(f + '.t', orig.type)])
  }
  if (!w) return orig
  const sw = snap(w)
  const small = `${f}.${sw}.jpg`
  try { return { buf: await readFile(small), type: 'image/jpeg' } } catch {}
  // A page asks for dozens of posters at once; resizing them all in parallel would starve playback of CPU.
  return once('resize:' + small, async () => {
    await slot()
    try {
      const buf = await run(['-i', 'pipe:0', '-vf', `scale='min(${sw},iw)':-2:flags=lanczos`, '-frames:v', '1', '-q:v', sw >= 1080 ? '2' : '4', '-f', 'mjpeg', 'pipe:1'], orig.buf)
      if (buf.length) { await writeFile(small, buf); return { buf, type: 'image/jpeg' } }
    } catch {} finally { release() }
    return orig
  })
}

let running = 0
const waiting = []
const slot = () => new Promise(resolve => (running < 3 ? (running++, resolve()) : waiting.push(resolve)))
const release = () => { const next = waiting.shift(); if (next) next(); else running-- }
