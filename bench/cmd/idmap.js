// Anime id mapping: AniList id to IMDb / TVDB / AniDB / MAL ids, for the most popular AniList entries.
//   --limit n   how many entries ask the rate-limited online services (default 60; Fribb answers all 300)
import { req, pct, sleep } from '../lib/net.js'
import { cacheFile, fribb, readJSON, writeJSON } from '../lib/store.js'

const QUERY = 'query($p:Int){Page(page:$p,perPage:50){media(type:ANIME,sort:POPULARITY_DESC,format_in:[TV,MOVIE,ONA]){id title{romaji}}}}'

export default async function idmap (args) {
  let list = readJSON(cacheFile('top300.json'))
  if (!list) {
    list = []
    for (let p = 1; p <= 6; p++) { list.push(...(await req('https://graphql.anilist.co', { method: 'POST', json: { query: QUERY, variables: { p } } })).body?.data?.Page?.media || []); await sleep(800) }
    writeJSON(cacheFile('top300.json'), list)
  }
  const F = fribb(); const limit = +args.limit || 60
  const res = { fribb: [], anizip: [], animeapi: [] }; const lat = { anizip: [], animeapi: [] }
  list.forEach((m, i) => { const f = F.get(m.id); res.fribb[i] = f ? { imdb: f.imdb_id?.[0] || null, tvdb: f.tvdb_id || null, anidb: f.anidb_id || null, kitsu: f.kitsu_id || null, mal: f.mal_id || null } : null })
  for (let i = 0; i < Math.min(limit, list.length); i++) {
    const m = list[i]
    const a = await req(`https://api.ani.zip/mappings?anilist_id=${m.id}`); lat.anizip.push(a.ms)
    const x = a.body?.mappings; res.anizip[i] = x ? { imdb: x.imdb_id || null, tvdb: x.thetvdb_id || null, anidb: x.anidb_id || null, kitsu: x.kitsu_id || null, mal: x.mal_id || null } : null
    const b = await req(`https://animeapi.my.id/anilist/${m.id}`); lat.animeapi.push(b.ms)
    const y = b.body; res.animeapi[i] = y?.anilist ? { imdb: y.imdb || null, tvdb: y.thetvdb || null, anidb: y.anidb || null, kitsu: y.kitsu || null, mal: y.myanimelist || null } : null
    await sleep(500)
  }
  const cov = (n, k) => res[n].filter(x => x?.[k]).length
  console.table(['fribb', 'anizip', 'animeapi'].map(n => ({ source: n, asked: n === 'fribb' ? list.length : Math.min(limit, list.length), found: res[n].filter(Boolean).length, imdb: cov(n, 'imdb'), tvdb: cov(n, 'tvdb'), anidb: cov(n, 'anidb'), kitsu: cov(n, 'kitsu'), mal: cov(n, 'mal'), 'p50 ms': lat[n] ? pct(lat[n], 0.5) : 0, 'p95 ms': lat[n] ? pct(lat[n], 0.95) : 0 })))
  for (const [a, b] of [['fribb', 'anizip'], ['fribb', 'animeapi']]) {
    let both = 0; let eq = 0
    list.forEach((_, i) => { const x = res[a][i]?.imdb; const y = res[b][i]?.imdb; if (x && y) { both++; if (x === y) eq++ } })
    console.log(`${a} vs ${b}: IMDb id present in both for ${both}, equal for ${eq}`)
  }
}
