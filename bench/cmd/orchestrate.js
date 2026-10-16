// Simulates a lookup plan over measured per-provider latencies (from `sources --set core`) with injected failures.
//   --trials n   (default 1500)
// all-wait returns when every provider answered. first answer returns at the first provider with >= 3 usable rows.
// deadline returns at the first such provider but no sooner than 300 ms, so quick followers are included.
// Results arriving after the return are not counted in recall: in the app they refresh the cached list.
import { sourcesRaw } from '../lib/store.js'
import { keyOf, targetOf } from '../lib/targets.js'
import { ID_KEYED } from '../lib/providers.js'
import { matchRow } from '../candidates/tokenizer.js'
import { pct } from '../lib/net.js'

const PLANS = {
  'repo today': { movie: ['torrentio', 'tpb-text'], series: ['torrentio', 'tpb-text'], anime: ['nyaa-text'] },
  'id-first': { movie: ['torrentio', 'tpb-text'], series: ['torrentio', 'tpb-text'], anime: ['torrentio-kitsu', 'tosho-eid'] }
}
const rnd = (a, b) => a + Math.random() * (b - a)

export default async function orchestrate (args) {
  const trials = +args.trials || 1500
  const raw = sourcesRaw('core')
  const D = Object.fromEntries(raw.map(p => [p.id, Object.fromEntries(p.per.map(x => [keyOf(x.g), x]))]))
  // the five most seeded relevant releases per title, from all sources: what recall is measured against
  const top = new Map()
  for (const p of raw) for (const x of p.per) {
    const t = targetOf(x.g)
    for (const r of x.rows || []) {
      if (r.seeders < 5) continue
      const ok = ID_KEYED.has(p.id) ? (x.g.kind === 'movie' || matchRow({ name: r.title, release: r.release }, t, { noTitle: true })) : matchRow({ name: r.title, release: r.release || r.title }, t)
      if (ok) { const m = top.get(keyOf(x.g)) || top.set(keyOf(x.g), new Map()).get(keyOf(x.g)); m.set(r.hash, Math.max(m.get(r.hash) || 0, r.seeders)) }
    }
  }
  const top5 = new Map([...top].map(([k, m]) => [k, new Set([...m].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h]) => h))]))
  const call = (id, k, pFail) => {
    const x = D[id]?.[k]; if (!x) return null
    return Math.random() < pFail ? { t: Math.random() < 0.5 ? 60 : 9000, rows: [], fail: true } : { t: x.ms * rnd(0.7, 1.6) + rnd(0, 30), rows: x.rows || [] }
  }
  const STRATEGY = {
    'all-wait': calls => Math.max(...calls.filter(Boolean).map(c => c.t), 0),
    'first answer': calls => {
      const fin = calls.filter(Boolean); const all = Math.max(...fin.map(c => c.t), 0)
      const ok = fin.filter(c => !c.fail && c.rows.filter(r => r.seeders >= 5).length >= 3).map(c => c.t)
      return ok.length ? Math.min(...ok) : all
    },
    'deadline 300ms': calls => {
      const fin = calls.filter(Boolean); const all = Math.max(...fin.map(c => c.t), 0)
      const ok = fin.filter(c => !c.fail && c.rows.filter(r => r.seeders >= 5).length >= 3).map(c => c.t)
      return ok.length ? Math.min(all, Math.max(Math.min(...ok), 300)) : all
    }
  }
  const out = []
  for (const [plan, sets] of Object.entries(PLANS)) for (const [sname, strategy] of Object.entries(STRATEGY)) for (const pFail of [0, 0.1]) for (const kind of ['movie', 'series', 'anime']) {
    const keys = [...new Set(sets[kind].flatMap(id => Object.keys(D[id] || {})))].filter(k => k.startsWith(kind))
    if (!keys.length) continue
    const ts = []; const rc = []
    for (let n = 0; n < trials; n++) {
      const k = keys[n % keys.length]
      const calls = sets[kind].map((id, i) => call(id, k, i === 0 ? pFail : pFail / 2))
      const at = Math.min(strategy(calls), 9000); ts.push(at)
      const T = top5.get(k); if (!T?.size) continue
      const have = new Set(calls.filter(c => c && c.t <= at).flatMap(c => c.rows.map(r => r.hash)))
      rc.push([...T].filter(h => have.has(h)).length / T.size)
    }
    out.push({ plan, strategy: sname, 'p(primary fails)': pFail, kind, p50: Math.round(pct(ts, 0.5)), p95: Math.round(pct(ts, 0.95)), 'top-5 recall at return': Math.round(100 * rc.reduce((a, b) => a + b, 0) / rc.length) + '%' })
  }
  console.table(out)
}
