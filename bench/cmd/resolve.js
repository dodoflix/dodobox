// Turns gold/edge-spec.js into gold/edge.json (IMDb ids from IMDb suggest, AniList entries from AniList search).
import fs from 'node:fs'
import path from 'node:path'
import { req, sleep, ROOT } from '../lib/net.js'
import { MOVIES, SERIES, ANIME } from '../gold/edge-spec.js'

const norm = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
async function suggest (q, kinds) {
  const slug = norm(q)
  const r = await req(`https://v3.sg.media-imdb.com/suggestion/${/[a-z]/.test(slug[0]) ? slug[0] : 'x'}/${encodeURIComponent(slug)}.json`)
  return (r.body?.d || []).filter(d => kinds.test(d.qid || '') && /^tt/.test(d.id))
}
const ANILIST = 'query($id:Int,$s:String){Media(id:$id,search:$s,type:ANIME,sort:SEARCH_MATCH){id title{romaji english} format episodes startDate{year} synonyms}}'

export default async function resolve () {
  const gold = []
  const show = (tag, want, got) => console.log(tag, want.padEnd(46), '->', got || 'NOT FOUND')
  for (const [title, year, cat, extra = {}] of MOVIES) {
    const hits = await suggest(`${title} ${year}`, /^(movie|tvMovie|short|video)$/)
    const h = hits.find(h => h.y === year && norm(h.l).startsWith(norm(title).slice(0, 6))) || hits.find(h => h.y === year) || hits[0]
    const imdb = extra.imdb || h?.id
    show('movie ', `${title} (${year})`, h && `${imdb} ${h.l} (${h.y})`)
    gold.push({ kind: 'movie', imdb, title, alt: extra.alt || [], year, cat })
  }
  for (const [title, year, season, episode, cat] of SERIES) {
    const hits = await suggest(`${title} ${year}`, /^(tvSeries|tvMiniSeries)$/)
    const h = hits.find(h => h.y === year) || hits[0]
    show('series', `${title} (${year}) S${season}E${episode}`, h && `${h.id} ${h.l} (${h.y})`)
    gold.push({ kind: 'series', imdb: h?.id, title, year, season, episode, cat })
  }
  for (const [q, ep, cat] of ANIME) {
    const r = await req('https://graphql.anilist.co', { method: 'POST', json: { query: ANILIST, variables: typeof q === 'number' ? { id: q } : { s: q } } })
    const m = r.body?.data?.Media
    show('anime ', String(q), m && `${m.id} ${m.title.romaji} (${m.format}, ${m.startDate.year})`)
    if (m) gold.push({ kind: 'anime', al: m.id, title: m.title.romaji, alt: [m.title.english, ...(m.synonyms || []).slice(0, 4)].filter(Boolean), year: m.startDate.year, ep: m.format === 'MOVIE' ? undefined : ep, movie: m.format === 'MOVIE', cat })
    await sleep(750)
  }
  const file = path.join(ROOT, 'gold', 'edge.json')
  fs.writeFileSync(file, '[' + gold.map(g => JSON.stringify(g)).join(',\n') + ']\n')
  console.log(`\nwrote ${gold.length} cases to gold/edge.json`)
}
