import { store, slowLink } from './util.js'

let profile = store.get('profile', '')
export const setProfile = id => { profile = id; store.set('profile', id) }
export const getProfile = () => profile
let lang = 'en'
export const setLang = l => { lang = l || 'en' }
// Whether the viewer asked to hide adult-marked titles; sent with every request so cached answers never mix the two.
let safe = false
export const setSafe = v => { safe = !!v }

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Data requests go through a small priority lane: what the visible page needs first, then what is about to be seen, then background work.
// A few run at a time (fewer on a slow link) and background work always leaves a free slot, so nothing important waits behind it.
export const NOW = 0; export const SOON = 1; export const LATER = 2
const lane = { active: 0, q: [] }
const cap = () => (slowLink() ? 3 : 5)
function pump () {
  while (lane.q.length && lane.active < cap()) {
    let i = 0
    for (let k = 1; k < lane.q.length; k++) if (lane.q[k].ref.prio < lane.q[i].ref.prio) i = k
    if (lane.q[i].ref.prio >= LATER && lane.active >= cap() - 1) break
    const [t] = lane.q.splice(i, 1)
    lane.active++
    t.resolve(() => { lane.active--; pump() })
  }
}
const slot = ref => new Promise(resolve => { lane.q.push({ ref, resolve }); pump() })

// ref: opts a GET into the priority lane (cget always does); long-running and player calls go straight out.
export async function api (path, { method = 'GET', body, raw, ref } = {}) {
  const tries = method === 'GET' ? 4 : 1
  let lastErr
  for (let i = 0; i < tries; i++) {
    let wait = 350 * 2 ** i * (0.75 + Math.random() / 2)
    const release = method === 'GET' && ref ? await slot(ref) : () => {}
    try {
      const r = await fetch(path, { method, headers: { 'x-profile': profile, 'x-lang': lang, 'x-adult-filter': safe ? '1' : '0', ...(body && !raw && { 'content-type': 'application/json' }) }, body: body && !raw ? JSON.stringify(body) : body, keepalive: method !== 'GET' && !raw })
      const j = await r.json().catch(() => ({}))
      if (r.ok) return j
      lastErr = Object.assign(new Error(j.error || r.statusText), { status: r.status })
      if (r.status !== 429 && r.status < 500) break
      const ra = Number(r.headers.get('retry-after')); if (ra) wait = Math.min(8000, ra * 1000)
    } catch (e) { lastErr = e } finally { release() }
    if (i < tries - 1) await sleep(wait)
  }
  throw lastErr
}

const memo = new Map()
export function cget (path, ttl = 10 * 60e3, prio = SOON) {
  const k = lang + (safe ? '*' : '') + path
  const hit = memo.get(k)
  if (hit && Date.now() - hit.at < ttl) { hit.ref.prio = Math.min(hit.ref.prio, prio); return hit.p }
  const ref = { prio }
  const p = api(path, { ref })
  memo.set(k, { at: Date.now(), p, ref })
  if (memo.size > 80) memo.delete(memo.keys().next().value) // pages of catalogs add up while scrolling
  p.catch(() => memo.delete(k))
  return p
}
