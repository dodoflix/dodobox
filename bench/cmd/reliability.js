// Burst test: 60 lookups per provider, 8 in flight. Shows rate limits, error rates and queueing.
import { PROVIDERS } from '../lib/providers.js'
import { goldSet } from '../lib/store.js'
import { pct, pool, sleep } from '../lib/net.js'

export default async function reliability (args) {
  const only = (args.only || 'torrentio,torrentio-kitsu,torrentsdb,tpb-text,knaben-text,eztv,yts,nyaa-text,tosho-eid,torrents-csv').split(',')
  const gold = await goldSet('core'); const out = []
  for (const p of PROVIDERS.filter(p => only.includes(p.id))) {
    const items = gold.filter(g => p.kinds.includes(g.kind))
    const jobs = Array.from({ length: 60 }, (_, i) => items[i % items.length])
    const lat = []; const status = {}; let empty = 0; const t0 = performance.now()
    await pool(jobs, 8, async g => {
      const r = await p.run(g); if (r.skip) return
      lat.push(r.ms); const k = r.ok ? 'ok' : String(r.status || 'network error'); status[k] = (status[k] || 0) + 1
      if (r.ok && !r.rows.length) empty++
    })
    const { ok = 0, ...errors } = status
    out.push({ provider: p.id, calls: lat.length, ok, errors: JSON.stringify(errors), empty, p50: pct(lat, 0.5), p95: pct(lat, 0.95), 'wall s': ((performance.now() - t0) / 1000).toFixed(1) })
    await sleep(2000)
  }
  console.table(out)
}
