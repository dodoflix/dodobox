import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const CACHE = path.join(ROOT, '.cache')
export const SNAP = path.join(ROOT, 'snapshots')
export const REPO = path.dirname(ROOT)

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// Timed request that never throws: { ok, status, ms, body (parsed JSON), text, err }.
export async function req (url, { method = 'GET', json, headers = {}, timeout = 9000, as = 'json' } = {}) {
  const t0 = performance.now()
  try {
    const r = await fetch(url, { method, headers: { 'user-agent': UA, ...(json ? { 'content-type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(timeout), redirect: 'follow' })
    const text = await r.text()
    let body = null
    if (as === 'json') { try { body = JSON.parse(text) } catch {} }
    return { ok: r.ok && (as !== 'json' || body !== null), status: r.status, ms: Math.round(performance.now() - t0), body, text }
  } catch (e) { return { ok: false, status: 0, ms: Math.round(performance.now() - t0), err: e.name, text: '' } }
}

export const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null }

// Runs fn over items with at most `n` in flight.
export async function pool (items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }))
}
