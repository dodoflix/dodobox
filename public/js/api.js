import { store } from './util.js'

let profile = store.get('profile', '')
export const setProfile = id => { profile = id; store.set('profile', id) }
export const getProfile = () => profile
let lang = 'en'
export const setLang = l => { lang = l || 'en' }
// Whether the viewer asked to hide adult-marked titles; sent with every request so cached answers never mix the two.
let safe = false
export const setSafe = v => { safe = !!v }

const sleep = ms => new Promise(r => setTimeout(r, ms))

export async function api (path, { method = 'GET', body, raw } = {}) {
  const tries = method === 'GET' ? 4 : 1
  let lastErr
  for (let i = 0; i < tries; i++) {
    let wait = 350 * 2 ** i * (0.75 + Math.random() / 2)
    try {
      const r = await fetch(path, { method, headers: { 'x-profile': profile, 'x-lang': lang, 'x-adult-filter': safe ? '1' : '0', ...(body && !raw && { 'content-type': 'application/json' }) }, body: body && !raw ? JSON.stringify(body) : body, keepalive: method !== 'GET' && !raw })
      const j = await r.json().catch(() => ({}))
      if (r.ok) return j
      lastErr = Object.assign(new Error(j.error || r.statusText), { status: r.status })
      if (r.status !== 429 && r.status < 500) break
      const ra = Number(r.headers.get('retry-after')); if (ra) wait = Math.min(8000, ra * 1000)
    } catch (e) { lastErr = e }
    if (i < tries - 1) await sleep(wait)
  }
  throw lastErr
}

const memo = new Map()
export function cget (path, ttl = 10 * 60e3) {
  const k = lang + (safe ? '*' : '') + path
  const hit = memo.get(k)
  if (hit && Date.now() - hit.at < ttl) return hit.p
  const p = api(path)
  memo.set(k, { at: Date.now(), p })
  if (memo.size > 80) memo.delete(memo.keys().next().value) // pages of catalogs add up while scrolling
  p.catch(() => memo.delete(k))
  return p
}
