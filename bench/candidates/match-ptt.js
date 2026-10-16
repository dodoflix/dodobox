import { sameTitle } from './title.js'

let parser
try { const m = await import('parse-torrent-title'); parser = (m.parse || m.default?.parse || m.default) } catch {}
const cache = new Map()
const parse = n => { if (!cache.has(n)) { try { cache.set(n, parser(n)) } catch { cache.set(n, null) } } return cache.get(n) }

export default !parser ? null : {
  id: 'parse-torrent-title',
  match (row, t) {
    const p = parse(row.name); const q = parse(row.release || row.name)
    if (!p) return false
    if (!(sameTitle(p.title || '', t) || (q && sameTitle(q.title || '', t)))) return false
    if (t.kind === 'movie' || t.movie) { const y = p.year || q?.year; return !t.year || !y || Math.abs(y - t.year) <= 1 }
    const e = [p.episode, q?.episode, ...(p.episodes || [])].filter(x => x != null)
    const s = [p.season, q?.season, ...(p.seasons || [])].filter(x => x != null)
    if (t.kind === 'series') return (e.includes(t.episode) && s.includes(t.season)) || (!e.length && s.includes(t.season))
    return (e.includes(t.episode) && (!s.length || s.includes(t.tvdbSeason) || s.includes(1))) || e.includes(t.abs) || (e.includes(t.tvdbEpisode) && s.includes(t.tvdbSeason))
  }
}
