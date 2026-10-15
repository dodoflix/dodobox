import fs from 'node:fs'
import path from 'node:path'
import { DATA } from './paths.js'
import { proxied } from './images.js'
import { getJSON, fetchRetry } from './http.js'

// Metadata: a catalog service for movies and series, a separate one for anime.
const CINEMETA = 'https://v3-cinemeta.strem.io'
const PAGE = 36

// Stale-while-revalidate cache on disk: served at once, refreshed in the background, kept up to a week if the provider fails.
const FILE = path.join(DATA, 'meta-cache.json')
const MAX_STALE = 7 * 24 * 3600e3
const ttl = new Map()
// Deep catalog pages are re-fetched when needed; keeping them made the file (and every save) many MB.
const persist = k => { const m = k.match(/^cat\d+:.*:(\d+):[a-z]+$/); return !m || +m[1] <= 3 }
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) if (!/^(cat[3-6]|meta2):/.test(k) && persist(k)) ttl.set(k, v) } catch {}
let saveT = null
// Saved at most every 20 s (stringifying a big cache blocks the server for a moment).
const saveCache = () => { if (saveT) return; saveT = setTimeout(() => { saveT = null; fs.writeFile(FILE, JSON.stringify(Object.fromEntries([...ttl].filter(([k]) => persist(k)))), () => {}) }, 20000).unref() }
const refreshing = new Set()
export async function cached (key, maxAge, fn) {
  const hit = ttl.get(key)
  const fresh = hit && Date.now() - hit.at < maxAge
  const load = async () => {
    const v = await fn()
    ttl.set(key, { at: Date.now(), v })
    if (ttl.size > 1500) ttl.delete(ttl.keys().next().value)
    saveCache()
    return v
  }
  if (fresh) return hit.v
  if (hit && Date.now() - hit.at < MAX_STALE) {
    if (!refreshing.has(key)) { refreshing.add(key); load().catch(() => {}).finally(() => refreshing.delete(key)) }
    return hit.v
  }
  try { return await load() } catch (e) { if (hit) return hit.v; throw e }
}

// Original spoken language (ISO 639-2) from the first production country; unknown countries give none.
const COUNTRY_LANG = { 'United States': 'eng', 'United Kingdom': 'eng', Canada: 'eng', Australia: 'eng', Ireland: 'eng', 'New Zealand': 'eng', Japan: 'jpn', 'South Korea': 'kor', China: 'chi', 'Hong Kong': 'chi', Taiwan: 'chi', France: 'fre', Germany: 'ger', Spain: 'spa', Italy: 'ita', Turkey: 'tur', Russia: 'rus', India: 'hin', Brazil: 'por', Portugal: 'por', Netherlands: 'dut', Poland: 'pol', Sweden: 'swe', Indonesia: 'ind', Vietnam: 'vie', Greece: 'ell', Israel: 'heb' }
const ANI_LANG = { JP: 'jpn', KR: 'kor', CN: 'chi', TW: 'chi' }

const cineItem = (m, type) => ({
  id: m.imdb_id || m.id,
  type,
  name: m.name,
  poster: proxied(m.poster?.replace(/\/poster\/(small|medium)\//, '/poster/large/')),
  background: proxied(m.background?.replace('/background/medium/', '/background/large/')),
  trailer: m.trailerStreams?.[0]?.ytId || m.trailers?.find(t => t.source)?.source || null,
  year: parseInt(m.year || m.releaseInfo, 10) || null,
  rating: m.imdbRating ? +m.imdbRating : null,
  genres: m.genres || m.genre || [],
  description: m.description,
  runtime: m.runtime,
  cast: m.cast,
  originalLanguage: COUNTRY_LANG[String(m.country || '').split(',')[0].trim()] || null,
  imdb: m.imdb_id || m.id
})

const ANILIST = `
fragment F on Media { id idMal title { romaji english } coverImage { extraLarge } bannerImage
  description(asHtml: false) seasonYear startDate { year } averageScore genres episodes duration format status countryOfOrigin
  nextAiringEpisode { episode } streamingEpisodes { title thumbnail } trailer { id site } }
query ($page: Int, $perPage: Int, $search: String, $sort: [MediaSort], $genre: String, $tag: String, $id: Int, $minPop: Int, $notStatus: MediaStatus, $status: MediaStatus, $adult: Boolean, $notGenres: [String]) {
  Page(page: $page, perPage: $perPage) {
    media(type: ANIME, id: $id, search: $search, sort: $sort, genre: $genre, tag: $tag, isAdult: $adult, genre_not_in: $notGenres, popularity_greater: $minPop, status_not: $notStatus, status: $status) { ...F }
  }
}`

async function anilist (variables) {
  const j = await getJSON('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The anime API rejects an explicit null for filter arguments ("Illegal operator and value combination"), so unset ones are left out.
    body: JSON.stringify({ query: ANILIST, variables: Object.fromEntries(Object.entries(variables).filter(([, v]) => v != null)) })
  })
  if (j.errors) throw new Error(j.errors[0].message)
  return j.data.Page.media
}

const aniItem = m => {
  const aired = m.episodes ?? (m.nextAiringEpisode ? m.nextAiringEpisode.episode - 1 : 0)
  const eps = {}
  for (const s of m.streamingEpisodes || []) {
    const n = s.title.match(/^Episode (\d+)\s*-?\s*(.*)$/)
    if (n) eps[+n[1]] = { title: n[2], thumbnail: s.thumbnail }
  }
  const movie = m.format === 'MOVIE'
  return {
    id: 'al:' + m.id,
    type: 'anime',
    name: m.title.english || m.title.romaji,
    altTitles: [m.title.romaji, m.title.english].filter(Boolean),
    poster: proxied(m.coverImage.extraLarge),
    background: proxied(m.bannerImage || m.coverImage.extraLarge),
    year: m.seasonYear || m.startDate?.year || null,
    rating: m.averageScore ? m.averageScore / 10 : null,
    genres: m.genres,
    description: m.description?.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim(),
    runtime: m.duration ? m.duration + ' min' : null,
    movie,
    trailer: m.trailer?.site === 'youtube' ? m.trailer.id : null,
    status: m.status,
    originalLanguage: ANI_LANG[m.countryOfOrigin] || null,
    mal: m.idMal,
    videos: Array.from({ length: movie ? 1 : aired }, (_, i) => ({
      season: 1, episode: i + 1, title: eps[i + 1]?.title || (movie ? m.title.english || m.title.romaji : `Episode ${i + 1}`), thumbnail: proxied(eps[i + 1]?.thumbnail)
    }))
  }
}


// Anime artwork is soft as a full-screen hero; the movie catalog's is sharper, so it is used when the match is sure.
const norm = s => (s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
// The catalog title an anime entry corresponds to when the match is sure; lets subtitle search use catalog ids.
export const animeImdb = item => cached(`imdb3:${item.id}`, 30 * 24 * 3600e3, async () => {
  // A later season ("Show Season 2") shares the series' artwork, so the match ignores the season suffix (and the year then).
  const base = n => norm(n).replace(/ (season|part|cour) \d+.*$| \d+(st|nd|rd|th) season.*$/, '')
  const all = [item.name, ...(item.altTitles || [])].filter(Boolean)
  const names = [...new Set(all.map(norm))]; const bases = new Set(all.map(base))
  for (const t of item.movie ? ['movie'] : ['series', 'movie']) {
    for (const q of [...new Set([base(item.altTitles?.[0] || item.name), base(item.name)])]) {
      let hits
      try { hits = await imdbSuggest(q, t) } catch { continue }
      const exact = hits.find(h => names.includes(norm(h.name)) && (!h.year || !item.year || Math.abs(h.year - item.year) <= 1))
      // The catalog often files a show under a shorter name ("86" for "86 EIGHTY-SIX"): accept that when the year agrees and
      // its name is a whole-word part of the anime's own title.
      const within = hits.find(h => h.year && item.year && Math.abs(h.year - item.year) <= 1 && names.some(n => ` ${n} `.includes(` ${norm(h.name)} `)))
      const hit = exact || hits.find(h => bases.has(norm(h.name))) || within
      if (hit) return { id: hit.id, exact: !!exact, later: base(item.name) !== norm(item.name) }
    }
  }
  return null
}).catch(() => null)

const animeArt = async item => {
  const m = await animeImdb(item); if (!m) return null
  const bg = `https://images.metahub.space/background/large/${m.id}/img`
  const r = await fetchRetry(bg, { method: 'HEAD', tries: 1, timeout: 6000 }).catch(() => null)
  return r && /^image\//.test(r.headers.get('content-type') || '') && +r.headers.get('content-length') > 60000
    ? { background: proxied(bg), poster: proxied(`https://images.metahub.space/poster/large/${m.id}/img`) } : null
}
const withArt = async item => { const a = await animeArt(item); return a ? { ...item, ...a } : item }

const IMDB_KIND = { movie: /^(movie|short|tvMovie|video)$/, series: /^(tvSeries|tvMiniSeries)$/ }
async function imdbSuggest (q, type) {
  const slug = q.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!slug) return []
  const j = await getJSON(`https://v3.sg.media-imdb.com/suggestion/${slug[0].match(/[a-z]/) ? slug[0] : 'x'}/${encodeURIComponent(slug)}.json`, { tries: 2 })
  return (j.d || []).filter(d => IMDB_KIND[type].test(d.qid || '') && /^tt\d+$/.test(d.id)).map(d => ({
    id: d.id, type, name: d.l, year: d.y || null, poster: proxied(d.i?.imageUrl?.replace('._V1_.jpg', '._V1_UX500_.jpg')), rating: null, genres: [], imdb: d.id
  }))
}

export const ANIME_TAGS = ['Isekai', 'School', 'Shounen', 'Seinen', 'Shoujo', 'Military', 'Historical', 'Super Power', 'Martial Arts', 'Time Manipulation']
const ANIME_SORT = { popular: ['TRENDING_DESC', 'POPULARITY_DESC'], rating: ['SCORE_DESC'], new: ['START_DATE_DESC'], airing: ['POPULARITY_DESC'] }
const CINE_SORT = { popular: 'top', rating: 'imdbRating', new: 'year', airing: 'top' }

export const catalog = ({ type, q, genre, page = 1, sort = 'popular', safe = false }) => {
  if (!ANIME_SORT[sort]) sort = 'popular'
  return cached(`cat7:${type}:${q}:${genre}:${page}:${sort}:${safe ? 1 : 0}`, 3 * 3600e3, async () => {
    if (type === 'anime') {
      const tag = ANIME_TAGS.includes(genre)
      const media = await anilist({
        adult: safe ? false : null, notGenres: safe ? ['Hentai'] : null,
        page, perPage: PAGE, search: q || null, genre: tag ? null : genre || null, tag: tag ? genre : null,
        sort: q ? ['SEARCH_MATCH', 'POPULARITY_DESC'] : ANIME_SORT[sort],
        // Top rated and newest would otherwise be led by obscure or unreleased entries.
        minPop: !q && (sort === 'rating' ? 15000 : sort === 'new' ? 4000 : null), notStatus: !q && sort === 'new' ? 'NOT_YET_RELEASED' : null, status: !q && sort === 'airing' ? 'RELEASING' : null
      })
      const items = media.map(aniItem).map(({ videos, ...x }) => x)
      return q ? items : [...await Promise.all(items.slice(0, 10).map(withArt)), ...items.slice(10)]
    }
    // The catalog's own search is fuzzy; a suggestion endpoint finds exact titles, so it goes first.
    if (q && !genre && page === 1) {
      const hits = await imdbSuggest(q, type).catch(() => [])
      if (hits.length) return hits
    }
    // Its "year" catalog is keyed by year instead of genre, so "newest" is this year's titles, filtered by genre afterwards.
    const byYear = sort === 'new' && !q
    const cat = q ? 'top' : CINE_SORT[sort]
    const year = new Date().getFullYear()
    const extra = [q && `search=${encodeURIComponent(q)}`, byYear ? `genre=${year - Math.floor((page - 1) / 2)}` : genre && `genre=${encodeURIComponent(genre)}`, page > 1 && `skip=${(byYear ? (page - 1) % 2 : page - 1) * 50}`].filter(Boolean).join('&')
    const j = await getJSON(`${CINEMETA}/catalog/${type}/${cat}${extra ? '/' + extra : ''}.json`)
    let items = j.metas.map(m => cineItem(m, type))
    if (byYear && genre) items = items.filter(i => i.genres.includes(genre))
    return items
  })
}

async function kitsuEpisodes (anilistId, count) {
  try {
    const H = { accept: 'application/vnd.api+json' }
    const map = await getJSON(`https://kitsu.io/api/edge/mappings?filter%5BexternalSite%5D=anilist/anime&filter%5BexternalId%5D=${anilistId}&include=item`, { headers: H, tries: 1 })
    const kid = map.included?.[0]?.id
    if (!kid) return {}
    const out = {}
    for (let off = 0; off < Math.min(count, 60); off += 20) {
      const j = await getJSON(`https://kitsu.io/api/edge/anime/${kid}/episodes?page%5Blimit%5D=20&page%5Boffset%5D=${off}&sort=number`, { headers: H, tries: 1 })
      for (const e of j.data || []) out[e.attributes.number] = { title: e.attributes.canonicalTitle, thumbnail: e.attributes.thumbnail?.original, released: e.attributes.airdate }
      if ((j.data || []).length < 20) break
    }
    return out
  } catch { return {} }
}

export const meta = (type, id) =>
  cached(`meta4:${type}:${id}`, 12 * 3600e3, async () => {
    if (type === 'anime') {
      const [m] = await anilist({ page: 1, perPage: 1, id: +id.replace('al:', '') })
      if (!m) throw new Error('not found')
      const item = await withArt(aniItem(m))
      if (!item.movie && item.videos.some(v => !v.thumbnail)) {
        const k = await kitsuEpisodes(m.id, item.videos.length)
        for (const v of item.videos) {
          const e = k[v.episode]; if (!e) continue
          if (!v.thumbnail && e.thumbnail) v.thumbnail = proxied(e.thumbnail)
          if (/^Episode \d+$/.test(v.title) && e.title && !/^Episode \d+$/.test(e.title)) v.title = e.title
          if (e.released) v.released = e.released
        }
      }
      return item
    }
    const { meta: m } = await getJSON(`${CINEMETA}/meta/${type}/${id}.json`)
    const item = cineItem(m, type)
    if (type === 'series') {
      item.videos = (m.videos || []).filter(v => v.season > 0).map(v => ({
        season: v.season, episode: v.episode, title: v.name || v.title || `Episode ${v.episode}`,
        thumbnail: proxied(v.thumbnail), released: v.released
      })).sort((a, b) => a.season - b.season || a.episode - b.episode)
    }
    return item
  })
