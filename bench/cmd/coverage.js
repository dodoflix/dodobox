// Which sources answer which titles. Reads the rows stored by `sources`.
//   --set core|edge   --lists (print the zero-source, single-source and no-good-source titles)
// A row counts as a hit when it has >= 5 seeders and is the right release: for id-keyed sources the title is
// trusted and only the numbering/year is checked, for text-search sources the whole tokenizer match must pass.
import { ID_KEYED } from '../lib/providers.js'
import { sourcesRaw } from '../lib/store.js'
import { keyOf, labelOf, targetOf } from '../lib/targets.js'
import { matchRow } from '../candidates/tokenizer.js'
import { pct } from '../lib/net.js'

const years = s => [...s.matchAll(/\b(?:19|20)\d\d\b/g)].map(m => +m[0])
function isHit (provider, g, r, target) {
  if (r.seeders < 5) return false
  if (ID_KEYED.has(provider)) {
    if (g.kind !== 'movie') return matchRow({ name: r.title, release: r.release }, target, { noTitle: true })
    const y = years(`${r.title} ${r.release || ''}`)
    return !y.length || y.some(v => Math.abs(v - g.year) <= 1)
  }
  return matchRow({ name: r.title, release: r.release || r.title }, target)
}

export default async function coverage (args) {
  const set = args.set || 'core'
  const raw = sourcesRaw(set)
  const cases = new Map()
  const hits = new Map() // case -> provider -> { hits, good, n, ok, ms }
  for (const p of raw) for (const x of p.per) {
    const k = keyOf(x.g); cases.set(k, x.g)
    const t = targetOf(x.g); const rel = []
    for (const r of x.rows || []) if (isHit(p.id, x.g, r, t)) rel.push(r)
    const m = hits.get(k) || hits.set(k, {}).get(k)
    m[p.id] = { rel, hits: rel.length, good: rel.filter(r => r.seeders >= 20).length, n: (x.rows || []).length, ok: x.ok, ms: x.ms }
  }
  // the most seeded relevant hashes per case, from every source together: what a viewer would want first
  const top5 = new Map()
  for (const [k, m] of hits) {
    const best = new Map(); for (const v of Object.values(m)) for (const r of v.rel) best.set(r.hash, Math.max(best.get(r.hash) || 0, r.seeders))
    top5.set(k, new Set([...best].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h]) => h)))
  }
  const recallOf = (ids, kind) => {
    let sum = 0; let n = 0; let any = 0
    for (const [k, g] of cases) {
      if (g.kind !== kind || !top5.get(k).size) continue
      const have = new Set(ids.flatMap(id => hits.get(k)[id]?.rel.map(r => r.hash) || []))
      const got = [...top5.get(k)].filter(h => have.has(h)).length
      sum += got / top5.get(k).size; n++; if (got) any++
    }
    return { recall: n ? Math.round(100 * sum / n) + '%' : '-', 'has top5': `${any}/${n}` }
  }

  for (const kind of ['movie', 'series', 'anime']) {
    const ids = raw.filter(p => p.per.some(x => x.g.kind === kind)).map(p => p.id)
    const table = ids.map(id => {
      const per = raw.find(p => p.id === id).per.filter(x => x.g.kind === kind)
      const ks = per.map(x => hits.get(keyOf(x.g))[id])
      return { provider: id, items: per.length, 'hit>=1': ks.filter(v => v.hits).length, 'good>=1': ks.filter(v => v.good).length, errors: ks.filter(v => !v.ok).length, ...recallOf([id], kind), p50: pct(ks.map(v => v.ms), 0.5), p95: pct(ks.map(v => v.ms), 0.95) }
    })
    console.log(`\n${kind} (${set} set), top-5 recall = share of the five most seeded relevant releases a source returns`)
    console.table(table)
    // greedy cover: add the source that raises top-5 recall most, until nothing improves
    const chosen = []; let best = 0
    for (;;) {
      const next = ids.map(id => [id, parseInt(recallOf([...chosen, id], kind).recall, 10) || 0]).filter(([id]) => !chosen.includes(id)).sort((a, b) => b[1] - a[1])[0]
      if (!next || next[1] <= best) break
      chosen.push(next[0]); best = next[1]
      console.log(`  + ${next[0].padEnd(16)} -> ${next[1]}%`)
    }
  }

  const rows = [...cases].map(([k, g]) => ({ g, ps: Object.entries(hits.get(k)).filter(([, v]) => v.hits).map(([id]) => id), good: Object.entries(hits.get(k)).filter(([, v]) => v.good).map(([id]) => id) }))
  for (const kind of ['movie', 'series', 'anime']) {
    const d = {}; for (const r of rows.filter(r => r.g.kind === kind)) d[r.ps.length] = (d[r.ps.length] || 0) + 1
    console.log(`${kind}: number of sources with a hit -> titles`, JSON.stringify(d))
  }
  if (args.lists) {
    const list = (title, items, f) => { console.log(`\n${title}`); for (const r of items) console.log('  ', r.g.kind.padEnd(6), labelOf(r.g).padEnd(34), `[${r.g.cat || ''}]`, f(r)) }
    list('no source:', rows.filter(r => !r.ps.length), () => '')
    list('one source only:', rows.filter(r => r.ps.length === 1), r => r.ps[0])
    list('hits but none with >= 20 seeders:', rows.filter(r => r.ps.length && !r.good.length), r => r.ps.join(','))
  }
}
