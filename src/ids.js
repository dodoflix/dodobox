// Anime ids across services. The Fribb list maps an AniList entry to its Kitsu, AniDB, IMDb and TVDB ids offline;
// ani.zip adds per-episode AniDB episode ids and TVDB / absolute numbering. Both are community data: every lookup
// answers null when it has nothing, and callers fall back to searching by name.
import fs from 'node:fs'
import path from 'node:path'
import './data.js'
import { DATA } from './paths.js'
import { fetchRetry, getJSON } from './http.js'
import { cached } from './meta.js'

const FILE = path.join(DATA, 'anime-ids.json')
const MAX_AGE = 24 * 3600e3
const SOURCES = [
  'https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json',
  'https://cdn.jsdelivr.net/gh/Fribb/anime-lists@master/anime-list-full.json'
]

// The full list is 7 MB; what is kept per entry is a few numbers. imdb is the series id: later seasons share it.
export function reduceFribb (list) {
  const out = {}
  for (const x of list) {
    if (!x.anilist_id) continue
    out[x.anilist_id] = { kitsu: x.kitsu_id || null, anidb: x.anidb_id || null, imdb: [].concat(x.imdb_id || [])[0] || null, tvdb: x.tvdb_id || null, tvdbSeason: x.season?.tvdb ?? null }
  }
  return out
}

let map = {}
let loaded = 0
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); map = j.map; loaded = j.at } catch {}

async function refresh () {
  for (const url of SOURCES) {
    try {
      const list = await (await fetchRetry(url, { timeout: 60000, tries: 2 })).json()
      map = reduceFribb(list); loaded = Date.now()
      fs.writeFileSync(FILE + '.tmp', JSON.stringify({ at: loaded, map })); fs.renameSync(FILE + '.tmp', FILE)
      return
    } catch (e) { console.warn('[ids]', e.message) }
  }
}
// Resolves once there is a list to read: the saved one at once, or the download on a fresh install. Started by the first
// lookup or by the server, not on import, so loading this module (tests) never touches the network. A stale list is
// refreshed in the background; a failed download is retried after ten minutes.
let ready
let tried = 0
export function warm () {
  const stale = Date.now() - loaded >= MAX_AGE
  if (!ready || (stale && Date.now() - tried > 600e3)) {
    tried = Date.now()
    ready = stale ? refresh() : Promise.resolve()
  }
  return ready
}

export async function animeIds (anilistId) {
  // a fresh install waits for the first download, but not so long that playing stalls
  if (loaded) warm().catch(() => {})
  else await Promise.race([warm(), new Promise(resolve => setTimeout(resolve, 8000).unref())])
  return map[anilistId] || null
}

// { titles, eps: { n: [anidbEpisodeId, tvdbSeason, tvdbEpisode, absolute] } } of an AniList entry, kept a few hours.
export async function episodeTable (anilistId) {
  try {
    return await cached(`anizip1:${anilistId}`, 6 * 3600e3, async () => {
      const j = await getJSON(`https://api.ani.zip/mappings?anilist_id=${anilistId}`, { tries: 2 })
      const eps = {}
      for (const [n, e] of Object.entries(j.episodes || {})) if (/^\d+$/.test(n)) eps[n] = [e.anidbEid || null, e.seasonNumber ?? null, e.episodeNumber ?? null, e.absoluteEpisodeNumber ?? null]
      return { titles: Object.entries(j.titles || {}).filter(([k]) => /^(en|x-jat)/.test(k)).map(([, v]) => v), eps }
    })
  } catch { return null }
}

// How releases may number an episode of an AniList entry: TVDB season and episode, absolute, and AniDB's episode id.
export async function episodeNumbers (anilistId, episode) {
  const e = (await episodeTable(anilistId))?.eps[episode]
  return e ? { eid: e[0], tvdbSeason: e[1], tvdbEpisode: e[2], abs: e[3] } : null
}
