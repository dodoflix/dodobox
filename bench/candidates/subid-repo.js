import { animeKeys, plausible, restPaths, restRow } from '../../src/subs.js'

// The shipped lookup: the server's choice of catalog id and numbering, then the shipped paths and row filter.
export default {
  id: 'repo',
  plausible,
  query: (g, ids) => ({ type: g.kind, id: g.imdb || 'al:' + g.al, season: g.season, episode: g.episode ?? g.ep, titles: ids.titles, imdb: ids.imdb && (ids.nums || !ids.later) ? ids.imdb : null, ...ids.nums }),
  paths: restPaths,
  keep: restRow,
  addonKeys: q => (q.type === 'anime' ? (q.imdb ? animeKeys(q).map(([s, e]) => `${q.imdb}:${s}:${e}`) : []) : q.type === 'series' ? [`${q.id}:${q.season}:${q.episode}`] : [q.id])
}
