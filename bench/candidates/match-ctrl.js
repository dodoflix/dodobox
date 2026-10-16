import { sameTitle } from './title.js'

let parser
try { parser = (await import('@ctrl/video-filename-parser')).filenameParse } catch {}
const cache = new Map()
const parse = (n, tv) => { const k = tv + n; if (!cache.has(k)) { try { cache.set(k, parser(n, tv)) } catch { cache.set(k, null) } } return cache.get(k) }

export default !parser ? null : {
  id: '@ctrl/video-filename-parser',
  match (row, t) {
    const tv = t.kind !== 'movie' && !t.movie
    const p = parse(row.name, tv); const q = parse(row.release || row.name, tv)
    if (!p) return false
    const title = sameTitle(p.title, t) || (q && sameTitle(q.title, t))
    if (!tv) return title && (!t.year || !p.year || Math.abs(p.year - t.year) <= 1)
    if (!title) return false
    const eps = [...(p.episodeNumbers || []), ...(q?.episodeNumbers || [])]
    const abs = [...(p.absoluteEpisodeNumbers || []), ...(q?.absoluteEpisodeNumbers || [])]
    const seasons = [...(p.seasons || []), ...(q?.seasons || [])]
    if (t.kind === 'series') return (eps.includes(t.episode) && seasons.includes(t.season)) || ((p.fullSeason || q?.fullSeason) && seasons.includes(t.season))
    return (eps.includes(t.episode) && (!seasons.length || seasons.includes(t.tvdbSeason) || seasons.includes(1))) || abs.includes(t.abs) || (eps.includes(t.tvdbEpisode) && seasons.includes(t.tvdbSeason)) || !!p.fullSeason
  }
}
