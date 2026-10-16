// Live seeders from trackers against the seeder counts the sources report. Uses the largest result list in `sources --set core`.
import { sourcesRaw } from '../lib/store.js'
import { scrape, TRACKERS } from '../lib/tracker.js'

export default async function scrapeCmd () {
  const item = sourcesRaw('core').find(p => p.id === 'torrentio').per.sort((a, b) => b.rows.length - a.rows.length)[0]
  const rows = item.rows.slice(0, 40); const hashes = rows.map(r => r.hash)
  const res = await Promise.all(TRACKERS.map(t => scrape(t, hashes)))
  console.table(res.map(r => ({ tracker: r.tracker, result: r.err || 'ok', ms: r.ms, 'with seeders': r.out ? `${Object.values(r.out).filter(x => x.seeders > 0).length}/${hashes.length}` : '-' })))
  const live = {}; for (const r of res) for (const [h, v] of Object.entries(r.out || {})) live[h] = Math.max(live[h] || 0, v.seeders)
  const ratio = rows.filter(r => live[r.hash] != null).map(r => (live[r.hash] + 1) / (r.seeders + 1)).sort((a, b) => a - b)
  console.log(`${item.g.title}: live / reported seeders at p10, p50, p90 = ${[0.1, 0.5, 0.9].map(p => ratio[Math.floor(ratio.length * p)].toFixed(2)).join(', ')}`)
  console.log('largest drops (reported -> live):')
  for (const r of rows.filter(r => live[r.hash] != null).sort((a, b) => (live[a.hash] - a.seeders) - (live[b.hash] - b.seeders)).slice(0, 5)) console.log(`  ${String(r.seeders).padStart(5)} -> ${String(live[r.hash]).padStart(4)}  ${r.title.slice(0, 70)}`)
}
