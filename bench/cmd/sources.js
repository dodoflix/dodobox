// Queries every provider for every gold item and stores the raw rows for the report commands.
//   --set core|edge   --only a,b   --reps n (repeat each query, for latency stats)   --gap ms (default 200)
import { PROVIDERS } from '../lib/providers.js'
import { cacheFile, goldSet, readJSON, writeJSON } from '../lib/store.js'
import { sleep } from '../lib/net.js'

export default async function sources (args) {
  const set = args.set || 'core'
  const only = args.only?.split(',')
  const gap = +args.gap || 200
  const reps = +args.reps || 1
  const gold = await goldSet(set)
  const out = []
  for (const p of PROVIDERS.filter(p => !only || only.includes(p.id))) {
    const per = []; let failedInARow = 0
    for (const g of gold.filter(g => p.kinds.includes(g.kind))) {
      for (let i = 0; i < reps; i++) {
        let r = await p.run(g)
        // rate limits are common and say nothing about coverage: retry after a pause, and leave the error visible if it persists
        // (a source that failed twice in a row after retries is rate-limiting this run: stop waiting on it)
        for (let k = 1; !r.skip && !r.ok && (r.status === 429 || r.status === 0) && k <= 2 && failedInARow < 2; k++) { await sleep(2500 * k); r = await p.run(g) }
        failedInARow = r.ok || r.skip ? 0 : failedInARow + 1
        if (r.skip) break
        per.push({ g, ok: r.ok, status: r.status, ms: r.ms, rows: i === 0 ? r.rows : undefined })
        if (gap) await sleep(gap)
      }
    }
    out.push({ id: p.id, per })
    process.stderr.write(p.id + ' ')
  }
  process.stderr.write('\n')
  const file = cacheFile(`sources-${set}.json`)
  const prev = readJSON(file, [])
  writeJSON(file, [...prev.filter(p => !out.some(o => o.id === p.id)), ...out])
}
