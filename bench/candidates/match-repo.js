import * as S from '../../src/sources.js'

// Baseline: the filters the repo applies to text-search results today (find() in src/sources.js).
export default {
  id: 'repo',
  match (row, t) {
    const name = row.name; const rel = row.release || row.name
    if (t.kind === 'movie') return S.releaseIsTitle(rel, t.title) && (!t.year || rel.includes(String(t.year)) || name.includes(String(t.year)))
    if (t.kind === 'series') return S.releaseIsTitle(rel, t.title) && (S.matchSeriesEpisode(name, t.season, t.episode) || S.matchSeriesEpisode(rel, t.season, t.episode))
    if (t.movie) return S.showVerdict(rel, t.titles) !== 'other'
    const own = S.showVerdict(rel, t.titles) !== 'other'
    const season = S.animeSeason(rel) === Math.max(...t.titles.map(S.animeSeason))
    return own && season && S.matchAnimeEpisode(name, t.episode)
  }
}
