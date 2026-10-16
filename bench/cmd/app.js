// End to end: the app's own findSources() on the gold titles, cold. How often it finds a seeded release and how long it takes.
//   --set core|edge   --gap ms (default 150)
import path from 'node:path'
import { CACHE, pct, sleep } from '../lib/net.js'
import { goldSet } from '../lib/store.js'
import { labelOf } from '../lib/targets.js'

export default async function app (args) {
  process.env.DATA_DIR ||= path.join(CACHE, 'app-data') // never the real library
  const { findSources } = await import('../../src/sources.js')
  const set = args.set || 'core'
  const gap = +args.gap || 150
  const rows = []
  for (const g of await goldSet(set)) {
    const item = g.kind === 'anime'
      ? { type: 'anime', id: 'al:' + g.al, title: g.title, altTitles: g.alt, year: g.year, movie: g.movie, season: 1, episode: g.ep }
      : { type: g.kind, id: g.imdb, title: g.title, year: g.year, season: g.season, episode: g.episode }
    const t0 = performance.now()
    const list = await findSources(item, {}).catch(() => [])
    rows.push({ g, ms: Math.round(performance.now() - t0), n: list.length, seeded: list.filter(r => r.seeders >= 5).length, good: list.filter(r => r.seeders >= 20).length })
    await sleep(gap)
  }
  console.table(['movie', 'series', 'anime'].map(kind => {
    const r = rows.filter(x => x.g.kind === kind)
    return { kind, titles: r.length, 'with a seeded release': r.filter(x => x.seeded).length, 'with >= 20 seeders': r.filter(x => x.good).length, 'p50 ms': pct(r.map(x => x.ms), 0.5), 'p95 ms': pct(r.map(x => x.ms), 0.95) }
  }))
  const none = rows.filter(x => !x.seeded).map(x => labelOf(x.g))
  if (none.length) console.log('no seeded release for:', none.join(', '))
  process.exit(0)
}
