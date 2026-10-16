// Outbound HTTP with retries, per-provider rate limits, request merging and a circuit breaker.
const UA = { 'user-agent': 'Mozilla/5.0 dodobox' }
const inflight = new Map()
const hosts = new Map()

const LIMITS = [
  [/anilist\.co$/, { perSec: 1.2, parallel: 2 }],
  [/wikidata\.org$/, { perSec: 1, parallel: 1 }],
  [/wikipedia\.org$/, { perSec: 4, parallel: 2 }],
  [/opensubtitles\.org$/, { perSec: 1.5, parallel: 2 }],
  [/torrentio\.strem\.fun$/, { perSec: 2, parallel: 2 }],
  [/apibay\.org$/, { perSec: 2, parallel: 2 }],
  [/nyaa\.si$/, { perSec: 1.5, parallel: 2 }],
  [/kitsu\.io$/, { perSec: 2, parallel: 2 }],
  [/ani\.zip$/, { perSec: 1, parallel: 1 }],
  [/knaben\.org$/, { perSec: 3, parallel: 2 }],
  [/animetosho\.org$/, { perSec: 1.5, parallel: 1 }]
]

function hostState (host) {
  if (!hosts.has(host)) {
    const cfg = LIMITS.find(([re]) => re.test(host))?.[1] || { perSec: 8, parallel: 6 }
    hosts.set(host, { ...cfg, active: 0, next: 0, waiting: [], fails: 0, openUntil: 0 })
  }
  return hosts.get(host)
}

async function slot (h) {
  while (h.active >= h.parallel) await new Promise(r => h.waiting.push(r))
  const now = Date.now()
  const at = Math.max(now, h.next)
  h.next = at + 1000 / h.perSec
  h.active++
  if (at > now) await new Promise(r => setTimeout(r, at - now))
}
const release = h => { h.active--; h.waiting.shift()?.() }

const retryAfter = r => { const v = r.headers.get('retry-after'); const n = Number(v); return Number.isFinite(n) ? n * 1000 : v ? Math.max(0, Date.parse(v) - Date.now()) : 0 }

// Returns the Response, or throws after `tries` attempts. 4xx other than 429/408 are final.
export async function fetchRetry (url, { tries = 3, timeout = 10000, headers, ...opts } = {}) {
  const host = new URL(url).hostname
  const h = hostState(host)
  if (Date.now() < h.openUntil) throw Object.assign(new Error(`${host} is cooling down`), { cooling: true })
  let last
  for (let i = 1; i <= tries; i++) {
    await slot(h)
    let wait = 400 * 2 ** (i - 1) * (0.75 + Math.random() / 2)
    try {
      const r = await fetch(url, { ...opts, headers: { ...UA, ...headers }, signal: AbortSignal.timeout(timeout) })
      if (r.ok) { h.fails = 0; return r }
      const retriable = r.status === 429 || r.status === 408 || r.status >= 500
      last = Object.assign(new Error(`${r.status} ${host}`), { status: r.status, final: !retriable })
      if (!retriable) { h.fails = 0; throw last }
      wait = Math.min(8000, retryAfter(r) || wait)
    } catch (e) {
      if (e.final) throw e
      last = e
    } finally { release(h) }
    if (i < tries) await new Promise(res => setTimeout(res, wait)) // the slot is free while waiting
  }
  if (++h.fails >= 4) { h.openUntil = Date.now() + 30000; h.fails = 0 }
  throw last
}

export function once (key, fn) {
  if (!inflight.has(key)) inflight.set(key, fn().finally(() => inflight.delete(key)))
  return inflight.get(key)
}

export const getJSON = (url, opts = {}) => once('json:' + url + JSON.stringify(opts.body || ''), async () => (await fetchRetry(url, opts)).json())
export const getText = (url, opts = {}) => once('text:' + url, async () => (await fetchRetry(url, opts)).text())
