import fs from 'node:fs'
import { sameTitle } from './title.js'

// anitomyscript fetches its wasm by path; Node's fetch only takes URLs.
const realFetch = globalThis.fetch
globalThis.fetch = (u, ...a) => typeof u === 'string' && u.startsWith('/') ? Promise.resolve(new Response(fs.readFileSync(u), { headers: { 'content-type': 'application/wasm' } })) : realFetch(u, ...a)
let anitomy
try { anitomy = (await import('anitomyscript')).default } catch {}
const cache = new Map()
const num = x => (x == null ? [] : [].concat(x).map(Number))

export default !anitomy ? null : {
  id: 'anitomyscript',
  kinds: ['anime'],
  // The wasm parser is async and runs out of memory on big batches, so names are parsed up front in chunks.
  async prepare (rows) {
    const names = [...new Set(rows.filter(r => r.target.kind === 'anime').flatMap(r => [r.name, r.release || r.name]))]
    for (let i = 0; i < names.length; i += 100) { const chunk = names.slice(i, i + 100); const res = await anitomy(chunk); chunk.forEach((n, j) => cache.set(n, res[j])) }
  },
  match (row, t) {
    const p = cache.get(row.name); const q = cache.get(row.release || row.name)
    if (!p || !(sameTitle(p.anime_title || '', t) || (q && sameTitle(q.anime_title || '', t)))) return false
    if (t.movie) { const y = +(p.anime_year || q?.anime_year); return !t.year || !y || Math.abs(y - t.year) <= 1 }
    const e = [...num(p.episode_number), ...num(q?.episode_number)]; const s = [...num(p.anime_season), ...num(q?.anime_season)]
    return (e.includes(t.episode) && (!s.length || s.includes(t.tvdbSeason) || s.includes(1))) || e.includes(t.abs) || (e.includes(t.tvdbEpisode) && s.includes(t.tvdbSeason))
  }
}
