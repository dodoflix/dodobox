import { aniZip } from './store.js'

let AZ
// The matcher's view of a gold item: aliases and every numbering scheme an anime episode may be released under.
export function targetOf (g) {
  if (g.kind === 'anime') {
    const az = (AZ ||= aniZip())[g.al]; const e = az?.episodes?.[g.ep]
    const titles = [...new Set([g.title, ...(g.alt || []), ...Object.entries(az?.titles || {}).filter(([k]) => /^(en|x-jat)/.test(k)).map(([, v]) => v)])]
    return { kind: 'anime', movie: g.movie, titles, year: g.year, episode: g.ep, tvdbSeason: e?.seasonNumber, tvdbEpisode: e?.episodeNumber, abs: e?.absoluteEpisodeNumber, entryTitle: g.title }
  }
  return { kind: g.kind, title: g.title, titles: [g.title, ...(g.alt || [])], year: g.year, season: g.season, episode: g.episode }
}

// Stable id of a gold item across commands.
export const keyOf = g => `${g.kind}:${g.imdb || g.al}:${g.season ?? ''}:${g.episode ?? g.ep ?? ''}`
export const labelOf = g => `${g.title.slice(0, 26)}${g.kind === 'movie' ? ' ' + g.year : g.kind === 'series' ? ` S${g.season}E${g.episode}` : g.movie ? '' : ` #${g.ep}`}`
