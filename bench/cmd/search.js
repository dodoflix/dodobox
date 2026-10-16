// Title search relevance and latency. Each source gets every query twice; the second pass is the warm (CDN cached) latency.
import { req, pct } from '../lib/net.js'
import { QUERIES } from '../gold/search.js'

const norm = s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const KIND = { movie: /^(movie|tvMovie|short|video)$/, series: /^(tvSeries|tvMiniSeries)$/ }
const SOURCES = {
  'imdb-suggest': async (q, t) => {
    const slug = norm(q)
    const r = await req(`https://v3.sg.media-imdb.com/suggestion/${/[a-z]/.test(slug[0]) ? slug[0] : 'x'}/${encodeURIComponent(slug)}.json`)
    return { ms: r.ms, ids: (r.body?.d || []).filter(d => KIND[t].test(d.qid || '') && /^tt/.test(d.id)).map(d => d.id) }
  },
  cinemeta: async (q, t) => {
    const r = await req(`https://v3-cinemeta.strem.io/catalog/${t}/top/search=${encodeURIComponent(q)}.json`)
    return { ms: r.ms, ids: (r.body?.metas || []).map(m => m.imdb_id || m.id) }
  },
  tvmaze: async (q, t) => {
    if (t !== 'series') return null
    const r = await req(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`)
    return { ms: r.ms, ids: (r.body || []).map(x => x.show?.externals?.imdb).filter(Boolean) }
  }
}
const rrf = lists => { const s = new Map(); for (const l of lists) l.forEach((id, i) => s.set(id, (s.get(id) || 0) + 1 / (60 + i))); return [...s].sort((a, b) => b[1] - a[1]).map(x => x[0]) }

export default async function search () {
  const rows = []
  const answers = {}
  for (const [name, fn] of Object.entries(SOURCES)) {
    for (const pass of [1, 2]) {
      let n = 0; let top1 = 0; let top3 = 0; const ms = []; const miss = []
      for (const [q, t, want] of QUERIES) {
        const r = await fn(q, t); if (!r) continue
        n++; ms.push(r.ms)
        if (pass === 1) (answers[q] ||= {})[name] = r.ids
        const i = r.ids.indexOf(want); if (i === 0) top1++; else miss.push(q); if (i >= 0 && i < 3) top3++
      }
      if (pass === 2) rows.push({ source: name, queries: n, 'top-1': `${top1}/${n}`, 'top-3': `${top3}/${n}`, 'warm p50 ms': pct(ms, 0.5), 'warm p95 ms': pct(ms, 0.95), 'top-1 misses': miss.join(' | ') })
    }
  }
  let t1 = 0; let t3 = 0
  for (const [q, , want] of QUERIES) { const f = rrf([answers[q]['imdb-suggest'], answers[q].cinemeta]); if (f[0] === want) t1++; if (f.slice(0, 3).includes(want)) t3++ }
  rows.push({ source: 'rank fusion: imdb-suggest + cinemeta', queries: QUERIES.length, 'top-1': `${t1}/${QUERIES.length}`, 'top-3': `${t3}/${QUERIES.length}` })
  console.table(rows)
}
