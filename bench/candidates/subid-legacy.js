
// Subtitle lookup before episode numbering was mapped, frozen: the entry's own episode number as season 1, no catalog id for
// later seasons, films and specials kept. Same interface as subid-repo.
const mentions = (text, n) => new RegExp(`(?<!\\d)0*${+n}(?!\\d)`).test(text)
const fold = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').replace(/(.)\1+/gu, '$1')
const SEQUEL = /shipp?uu?den|boruto|next generations/i
function plausible (rel, { episode, titles = [] }) {
  const m = rel.match(/s\d{1,2}e(\d{1,4})|\bep?\.? ?(\d{1,4})\b|episode ?(\d{1,4})|\b\d{1,2}x(\d{2,3})\b/i)
  const n = m && +(m[1] || m[2] || m[3] || m[4])
  if (n && n !== +episode) return false
  const bareM = !m && rel.match(/(?<![\dA-Za-z])(\d{3}|0?\d{3}|1[0-4]\d\d)(?![\dA-Za-z])|_(\d{2})_/)
  const bare = bareM && +(bareM[1] || bareM[2])
  if (bare && bare !== +episode && ![240, 360, 480, 576, 720].includes(bare)) return false
  return !SEQUEL.test(rel) || titles.some(t => SEQUEL.test(t))
}
function sameShow (s, { episode, titles, imdb }) {
  if (+s.SeriesEpisode && +s.SeriesEpisode !== +episode) return false
  const parent = +s.SeriesIMDBParent || (s.MovieKind === 'tv series' ? +s.IDMovieImdb : 0)
  if (imdb && parent) return parent === +imdb.slice(2)
  const name = fold((String(s.MovieName || '').match(/"([^"]+)"/) || [])[1])
  return !name || !titles.some(fold) || titles.some(t => fold(t) === name)
}

export default {
  id: 'legacy',
  plausible,
  query: (g, ids) => ({ type: g.kind, id: g.imdb || 'al:' + g.al, season: g.season, episode: g.episode ?? g.ep, titles: ids.titles, imdb: ids.imdb && !ids.later ? ids.imdb : null }),
  paths ({ type, id, season, episode, titles, imdb }, code) {
    const lang = `sublanguageid-${code}`
    const words = t => encodeURIComponent(t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
    const ep2 = String(episode).padStart(2, '0')
    const names = [...new Set(titles.map(words))].slice(0, 3)
    return (type === 'movie' ? [`imdbid-${id.slice(2)}`]
      : type === 'series' ? [`episode-${episode}/imdbid-${id.slice(2)}/season-${season}`]
        : [...(imdb ? [`episode-${episode}/imdbid-${imdb.slice(2)}/season-1`] : []),
          ...names.map(n => `query-${n}%20${episode}`), ...names.map(n => `episode-${episode}/query-${n}`), ...names.map(n => `query-${n}%20-%20${ep2}`)]).map(p => `${p}/${lang}`)
  },
  keep (s, p, q) {
    const rel = s.MovieReleaseName || s.SubFileName || ''
    if (!/^(srt|sub|ass|ssa)$/i.test(s.SubFormat) || !s.SubDownloadLink) return null
    if (q.type === 'anime' && !(sameShow(s, q) && plausible(rel, q) && (p.startsWith('episode-') || +s.SeriesEpisode === +q.episode || mentions(`${rel} ${s.SubFileName}`, q.episode)))) return null
    return { lang: s.SubLanguageID, url: s.SubDownloadLink, rel, dl: +s.SubDownloadsCnt || 0, forced: s.SubForeignPartsOnly === '1', hi: s.SubHearingImpaired === '1', rating: +s.SubRating || 0, fps: +s.MovieFPS || 0, trusted: s.SubFromTrusted === '1' }
  },
  addonKeys: ({ type, id, season, episode, imdb }) => (type === 'anime' ? (imdb ? [`${imdb}:1:${episode}`] : []) : type === 'series' ? [`${id}:${season}:${episode}`] : [id])
}
