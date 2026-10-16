// Live seeders from trackers against the seeder counts the sources report. Uses the largest result list in `sources --set core`.
import { sourcesRaw } from '../lib/store.js'
import { scrapeTracker } from '../../src/tracker.js'

const TRACKERS = ['udp://tracker.opentrackr.org:1337', 'udp://open.stealth.si:80', 'udp://tracker.torrent.eu.org:451', 'udp://explodie.org:6969', 'udp://tracker.bittor.pw:1337', 'udp://open.demonii.com:1337', 'udp://exodus.desync.com:6969']

export default async function scrapeCmd () {
  const item = sourcesRaw('core').find(p => p.id === 'torrentio').per.sort((a, b) => b.rows.length - a.rows.length)[0]
  const rows = item.rows.slice(0, 40); const hashes = rows.map(r => r.hash)
  const res = await Promise.all(TRACKERS.map(async t => { const t0 = performance.now(); const out = await scrapeTracker(t, hashes, 1500); return { tracker: t, out, ms: Math.round(performance.now() - t0) } }))
  console.table(res.map(r => ({ tracker: r.tracker, result: r.out ? 'ok' : 'no answer', ms: r.ms, 'with seeders': r.out ? `${[...r.out.values()].filter(n => n > 0).length}/${hashes.length}` : '-' })))
  const live = {}; for (const r of res) for (const [h, n] of r.out || []) live[h] = Math.max(live[h] || 0, n)
  const ratio = rows.filter(r => live[r.hash] != null).map(r => (live[r.hash] + 1) / (r.seeders + 1)).sort((a, b) => a - b)
  console.log(`${item.g.title}: live / reported seeders at p10, p50, p90 = ${[0.1, 0.5, 0.9].map(p => ratio[Math.floor(ratio.length * p)].toFixed(2)).join(', ')}`)
  console.log('largest drops (reported -> live):')
  for (const r of rows.filter(r => live[r.hash] != null).sort((a, b) => (live[a.hash] - a.seeders) - (live[b.hash] - b.seeders)).slice(0, 5)) console.log(`  ${String(r.seeders).padStart(5)} -> ${String(live[r.hash]).padStart(4)}  ${r.title.slice(0, 70)}`)
}
