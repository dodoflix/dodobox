// Text-search fallbacks: which query shapes find a seeded release when the id-keyed source has nothing.
//   --kind series|anime (default both)   uses the edge set
// Old single episodes live in season packs, so the shapes include pack queries.
import { req, sleep } from '../lib/net.js'
import { goldSet } from '../lib/store.js'
import { targetOf, labelOf } from '../lib/targets.js'
import { matchRelease } from '../../src/release.js'

const p2 = n => String(n).padStart(2, '0')
const clean = s => (s || '').replace(/[^\p{L}\p{N} ]+/gu, ' ').trim()
const xml = (s, tag) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
const unxml = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))

const SEARCH = {
  tpb: async q => (await req(`https://apibay.org/q.php?q=${encodeURIComponent(q)}&cat=200`)).body?.filter?.(x => x.info_hash && !/^0+$/.test(x.info_hash)).map(x => ({ title: x.name, seeders: +x.seeders })) || [],
  knaben: async q => ((await req('https://api.knaben.org/v1', { method: 'POST', json: { search_field: 'title', query: q, order_by: 'seeders', order_direction: 'desc', size: 50, hide_unsafe: true, hide_xxx: true } })).body?.hits || []).filter(x => x.hash).map(x => ({ title: x.title, seeders: x.seeders })),
  csv: async q => ((await req(`https://torrents-csv.com/service/search?q=${encodeURIComponent(q)}&size=50`)).body?.torrents || []).map(x => ({ title: x.name, seeders: x.seeders })),
  nyaa: async q => { const r = await req(`https://nyaa.si/?page=rss&c=1_2&s=seeders&o=desc&q=${encodeURIComponent(q)}`, { as: 'text' }); return r.ok ? [...r.text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({ title: unxml(xml(m[1], 'title')), seeders: +xml(m[1], 'nyaa:seeders') || 0 })) : [] }
}
const SERIES = {
  episode: g => `${g.title} S${p2(g.season)}E${p2(g.episode)}`,
  season: g => `${g.title} S${p2(g.season)}`,
  'season word': g => `${g.title} Season ${g.season}`,
  complete: g => `${g.title} complete`
}
const ANIME = {
  episode: g => `${clean(g.title)} ${p2(g.ep)}`,
  batch: g => `${clean(g.title)} batch`,
  plain: g => clean(g.title),
  'english batch': g => g.alt?.[0] && `${clean(g.alt[0])} batch`,
  'english episode': g => g.alt?.[0] && `${clean(g.alt[0])} ${p2(g.ep)}`
}

async function run (kind, gold, providers, shapes) {
  const cases = gold.filter(g => g.kind === kind && !g.movie)
  const hits = cases.map(() => ({}))
  for (const [i, g] of cases.entries()) {
    const t = targetOf(g)
    for (const [shape, make] of Object.entries(shapes)) for (const provider of providers) {
      const q = make(g); if (!q) continue
      const rows = await SEARCH[provider](q).catch(() => []); await sleep(provider === 'nyaa' ? 900 : 120)
      hits[i][`${provider} / ${shape}`] = rows.filter(r => r.seeders >= 5 && matchRelease({ name: r.title, release: r.title }, t)).length
    }
  }
  const cols = Object.keys(hits[0])
  console.log(`\n${kind}: titles with at least one seeded release, out of ${cases.length}`)
  console.table(Object.fromEntries(cols.map(c => [c, hits.filter(h => h[c] > 0).length])))
  const any = hits.filter(h => Object.values(h).some(n => n > 0)).length
  console.log(`any query shape: ${any}/${cases.length}`)
  const none = cases.filter((_, i) => !Object.values(hits[i]).some(n => n > 0)).map(labelOf)
  if (none.length) console.log('no hit for:', none.join(', '))
}

export default async function fallback (args) {
  const gold = await goldSet('edge')
  if (args.kind !== 'anime') await run('series', gold, ['tpb', 'knaben', 'csv'], SERIES)
  if (args.kind !== 'series') await run('anime', gold, ['nyaa'], ANIME)
}
