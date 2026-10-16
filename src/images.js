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

const WIDTHS = [64, 160, 240, 360, 480, 640, 800, 1080, 1280, 1920]
export const snap = w => WIDTHS.find(x => x >= w) || WIDTHS.at(-1)

export const proxied = u => u && HOSTS.test(safeHost(u)) ? `/img?u=${encodeURIComponent(u)}` : u
// The https address behind a /img?u= link, sized for Discord, or '' when it is not a known picture host.
export const remote = p => {
  try {
    const u = new URL(p, 'http://x'); const o = u.pathname === '/img' ? u.searchParams.get('u') : p
    const r = HOSTS.test(safeHost(o)) ? upstream(o, 512) : ''
    return r.length <= 256 ? r : ''
  } catch { return '' }
}
const safeHost = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.hostname : '' } catch { return '' } }

const cancelled = () => Object.assign(new Error('cancelled'), { cancelled: true })

// Some picture hosts resize on request: ask for about the width that is needed instead of the full-size original
// (an IMDb poster is 12 KB at 200 px against 243 KB at 500). Anything else, or a failed variant, uses the original.
export function upstream (u, w) {
  try {
    const x = new URL(u); const sw = snap(w)
    if (/(^|\.)metahub\.space$/.test(x.hostname)) x.pathname = x.pathname.replace(/^\/poster\/(small|medium|large)\//, `/poster/${sw <= 300 ? 'small' : sw <= 500 ? 'medium' : 'large'}/`)
    else if (/(^|\.)media-amazon\.com$/.test(x.hostname)) x.pathname = x.pathname.replace(/\._V1_(?:UX|UY|SX|SY)\d+_\./, `._V1_UX${sw}_.`)
    else if (/(^|\.)anilist\.co$/.test(x.hostname) && sw <= 240) x.pathname = x.pathname.replace(/\/cover\/(?:medium|large|extraLarge)\//, '/cover/medium/')
    return x.href
  } catch { return u }
}

const hash = u => crypto.createHash('sha1').update(u).digest('hex')

async function original (u, signal) {
  const f = path.join(DIR, hash(u))
  try { return { f, buf: await readFile(f), type: await readFile(f + '.t', 'utf8') } } catch {}
  if (signal?.aborted) throw cancelled()
  const r = await once('img:' + u, () => fetchRetry(u, { timeout: 12000, tries: 3 })).catch(() => { throw Object.assign(new Error('image fetch failed'), { code: 502 }) })
  if (!/^image\//.test(r.headers.get('content-type') || '')) throw Object.assign(new Error('image fetch failed'), { code: 502 })
  const buf = Buffer.from(await r.clone().arrayBuffer())
  if (buf.length > 8e6) throw new Error('image too large')
  const type = r.headers.get('content-type')
  await Promise.all([writeFile(f, buf), writeFile(f + '.t', type)])
  return { f, buf, type }
}

// webp: the browser takes WebP, which is about a third smaller than JPEG. signal: the request went away, so skip work not yet started.
export async function image (u, w, { webp = false, signal } = {}) {
  if (!HOSTS.test(safeHost(u))) throw Object.assign(new Error('image host not allowed'), { code: 400 })
  if (!w) { const o = await original(u, signal); return { buf: o.buf, type: o.type } }
  const v = upstream(u, w)
  const orig = await original(v, signal).catch(e => { if (e.cancelled || v === u) throw e; return original(u, signal) })
  const sw = snap(w)
  const ext = webp ? 'webp' : 'jpg'
  const small = `${orig.f}.${sw}.${ext}`
  try { return { buf: await readFile(small), type: `image/${webp ? 'webp' : 'jpeg'}` } } catch {}
  return once('resize:' + small, async () => {
    await slot(signal)
    try {
      const scale = `scale='min(${sw},iw)':-2:flags=lanczos`
      const args = webp ? ['-quality', '78'] : ['-q:v', sw >= 1080 ? '2' : '4']
      const buf = await run(['-i', 'pipe:0', '-vf', scale, '-frames:v', '1', ...(webp ? ['-c:v', 'libwebp'] : []), ...args, '-f', webp ? 'webp' : 'mjpeg', 'pipe:1'], orig.buf)
      if (buf.length) { await writeFile(small, buf); return { buf, type: `image/${webp ? 'webp' : 'jpeg'}` } }
    } catch {} finally { release() }
    return webp ? image(u, w, { signal }) : { buf: orig.buf, type: orig.type }
  })
}

let running = 0
const waiting = []
const slot = signal => new Promise((resolve, reject) => {
  const go = () => { if (signal?.aborted) { release(); reject(cancelled()) } else resolve() }
  if (running < 3) { running++; go() } else waiting.push(go)
})
const release = () => { const next = waiting.shift(); if (next) next(); else running-- }
