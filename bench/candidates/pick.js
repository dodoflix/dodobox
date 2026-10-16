import { parse, isExtra } from './tokenizer.js'
const VIDEO = /\.(mkv|mp4|m4v|webm|avi|mov|ts|wmv)$/i
const base = n => n.split(/[\\/]/).pop()
// numbers in a file name, ignoring "Part 2" style suffixes and extras
const fileNums = name => { const n = base(name).replace(/\b(part|pt|cour|vol|volume)[ ._-]?\d+/gi, ' '); const p = parse(n); return { seasons: p.seasons, se: p.eps, loose: [...new Set([...p.eps, ...(p.eps.length || p.bare == null ? [] : [p.bare]), ...p.alt])] } }
// Picks the file of a multi-file torrent for an anime episode; -1 when the torrent lacks it.
export function pickAnime (files, t) {
  const vids = files.map((f, i) => ({ ...f, i, ...fileNums(f.name) })).filter(f => VIDEO.test(f.name) && !/sample/i.test(f.name) && !isExtra(base(f.name)))
  if (!vids.length) return -1
  const exact = vids.filter(f => f.seasons.has(t.tvdbSeason) && f.se.includes(t.tvdbEpisode))
  if (exact.length) return exact.sort((a, b) => b.length - a.length)[0].i
  const all = new Set(vids.flatMap(f => f.loose)); const lo = Math.min(...all); const hi = Math.max(...all)
  const wantAbs = t.abs && t.abs !== t.episode && all.has(t.abs) && !(all.has(t.episode) && lo === 1 && hi < t.abs)
  const want = wantAbs ? t.abs : t.episode
  const hit = vids.filter(f => f.loose.includes(want) && !(f.seasons.size && !f.seasons.has(t.tvdbSeason) && !f.seasons.has(1)))
  if (hit.length) return hit.sort((a, b) => b.length - a.length)[0].i
  return vids.length === 1 ? vids[0].i : -1
}
