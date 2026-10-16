// One adapter per torrent source. run(gold) resolves to { ok, status, ms, rows, skip? }; a row is
// { src, title, hash, seeders, size, fileIdx?, release? } so every source can be compared the same way.
import { req } from './net.js'
import { xml, unxml } from './xml.js'
import { aniZip, fribb } from './store.js'

const BYTES = { KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1048576, GB: 1e9, GIB: 1073741824, TB: 1e12, TIB: 1099511627776 }
const toBytes = (n, unit) => parseFloat(n) * BYTES[unit.toUpperCase()]
const row = (src, title, hash, seeders, size, extra = {}) => ({ src, title, hash: (hash || '').toLowerCase(), seeders: +seeders || 0, size: +size || 0, ...extra })
const p2 = n => String(n).padStart(2, '0')

let AZ; let FR
const az = () => (AZ ||= aniZip())
const fr = () => (FR ||= fribb())
const episodeOf = g => az()[g.al]?.episodes?.[g.ep]
const skip = { ok: false, ms: 0, rows: [], skip: true }
const finish = (src, r, parse) => ({ ok: r.ok, status: r.status, ms: r.ms, rows: r.ok ? parse(src, r.body ?? r.text) : [] })

const textQuery = g => g.kind === 'movie' ? `${g.title} ${g.year}` : g.kind === 'series' ? `${g.title} S${p2(g.season)}E${p2(g.episode)}` : g.movie ? g.title : `${g.title} ${p2(g.ep)}`

// Stremio-style stream addons -------------------------------------------------
const streamRows = (src, j) => (j?.streams || []).filter(s => s.infoHash).map(s => {
  const [t, meta = ''] = (s.title || s.description || '').split('\n👤'); const size = meta.match(/💾\s*([\d.]+)\s*(\w+)/)
  return row(src, s.behaviorHints?.filename || t.split('\n')[0], s.infoHash, parseInt(meta, 10), size ? toBytes(size[1], size[2]) : 0, { fileIdx: s.fileIdx, release: t.split('\n')[0] })
})
const stream = (base, src) => async g => {
  let path
  if (g.kind === 'movie') path = `movie/${g.imdb}`
  else if (g.kind === 'series') path = `series/${g.imdb}:${g.season}:${g.episode}`
  else {
    const m = az()[g.al]?.mappings; const e = episodeOf(g)
    if (!m?.imdb_id) return skip
    path = g.movie ? `movie/${m.imdb_id}` : `series/${m.imdb_id}:${e?.seasonNumber}:${e?.episodeNumber}`
  }
  return finish(src, await req(`${base}/stream/${path}.json`), streamRows)
}
const kitsuStream = (base, src) => async g => {
  const k = fr().get(g.al)?.kitsu_id
  if (!k) return skip
  return finish(src, await req(`${base}/stream/${g.movie ? `movie/kitsu:${k}` : `series/kitsu:${k}:${g.ep}`}.json`), streamRows)
}

// AnimeTosho ---------------------------------------------------------------------
const toshoRows = (src, j) => (Array.isArray(j) ? j : []).filter(x => x.info_hash).map(x => row(src, x.title, x.info_hash, x.seeders, x.total_size, { files: x.num_files, eid: x.anidb_eid, aid: x.anidb_aid }))
const toshoBy = (src, param) => async g => {
  const m = az()[g.al]
  const id = param === 'eid' ? (g.movie ? null : episodeOf(g)?.anidbEid) : m?.mappings?.anidb_id
  if (!id) return skip
  return finish(src, await req(`https://animetosho.org/feed/json?${param}=${id}&order=seeders`), toshoRows)
}

export const PROVIDERS = [
  { id: 'torrentio', kinds: ['movie', 'series', 'anime'], run: stream('https://torrentio.strem.fun', 'torrentio') },
  { id: 'torrentio-kitsu', kinds: ['anime'], run: kitsuStream('https://torrentio.strem.fun', 'torrentio-kitsu') },
  { id: 'torrentsdb', kinds: ['movie', 'series', 'anime'], run: stream('https://torrentsdb.com', 'torrentsdb') },
  { id: 'peerflix', kinds: ['movie', 'series', 'anime'], run: stream('https://peerflix.mov', 'peerflix') },
  { id: 'yts', kinds: ['movie'], async run (g) {
    return finish('yts', await req(`https://movies-api.accel.li/api/v2/list_movies.json?query_term=${g.imdb}`), (s, j) => (j.data?.movies || []).flatMap(m => (m.torrents || []).map(t => row(s, `${m.title_long} ${t.quality} ${t.type} ${t.video_codec}`, t.hash, t.seeds, t.size_bytes, { year: m.year }))))
  } },
  { id: 'eztv', kinds: ['series'], async run (g) {
    return finish('eztv', await req(`https://eztvx.to/api/get-torrents?imdb_id=${g.imdb.replace(/^tt/, '')}&limit=100&page=1`), (s, j) => (j.torrents || []).filter(x => x.season == g.season && x.episode == g.episode).map(x => row(s, x.filename || x.title, x.hash, x.seeds, x.size_bytes)))
  } },
  { id: 'tosho-eid', kinds: ['anime'], run: toshoBy('tosho-eid', 'eid') },
  { id: 'tosho-aid', kinds: ['anime'], run: toshoBy('tosho-aid', 'aid') },
  { id: 'tosho-q', kinds: ['anime'], async run (g) {
    return finish('tosho-q', await req(`https://animetosho.org/feed/json?q=${encodeURIComponent(textQuery(g))}&order=seeders`), toshoRows)
  } },
  { id: 'nyaa-text', kinds: ['anime'], async run (g) {
    const r = await req(`https://nyaa.si/?page=rss&c=1_2&s=seeders&o=desc&q=${encodeURIComponent(textQuery(g))}`, { as: 'text' })
    return finish('nyaa-text', r, (s, t) => [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => { const it = m[1]; const sz = xml(it, 'nyaa:size').match(/([\d.]+)\s*(\w+)/); return row(s, unxml(xml(it, 'title')), xml(it, 'nyaa:infoHash'), xml(it, 'nyaa:seeders'), sz ? toBytes(sz[1], sz[2]) : 0) }))
  } },
  { id: 'tpb-text', kinds: ['movie', 'series'], async run (g) {
    return finish('tpb-text', await req(`https://apibay.org/q.php?q=${encodeURIComponent(textQuery(g))}&cat=200`), (s, j) => j.filter(x => x.info_hash && !/^0+$/.test(x.info_hash)).map(x => row(s, x.name, x.info_hash, x.seeders, x.size)))
  } },
  { id: 'knaben-text', kinds: ['movie', 'series', 'anime'], async run (g) {
    return finish('knaben-text', await req('https://api.knaben.org/v1', { method: 'POST', json: { search_field: 'title', query: textQuery(g), order_by: 'seeders', order_direction: 'desc', size: 50, hide_unsafe: true, hide_xxx: true } }), (s, j) => (j.hits || []).filter(x => x.hash).map(x => row(s, x.title, x.hash, x.seeders, x.bytes)))
  } },
  { id: 'torrents-csv', kinds: ['movie', 'series', 'anime'], async run (g) {
    return finish('torrents-csv', await req(`https://torrents-csv.com/service/search?q=${encodeURIComponent(textQuery(g))}&size=50`), (s, j) => (j.torrents || []).map(x => row(s, x.name, x.infohash, x.seeders, x.size_bytes)))
  } },
  { id: 'subsplease', kinds: ['anime'], async run (g) {
    return finish('subsplease', await req(`https://subsplease.org/api/?f=search&tz=UTC&s=${encodeURIComponent(g.title.replace(/ 2nd Season| \dth Season/, ''))}`), (s, j) => typeof j === 'object' && j ? Object.entries(j).flatMap(([name, v]) => (v.downloads || []).map(d => row(s, `[SubsPlease] ${name} (${d.res}p)`, (d.magnet.match(/btih:([0-9a-zA-Z]+)/) || [])[1], 0, 0))) : [])
  } },
  { id: 'nekobt', kinds: ['anime'], async run (g) {
    return finish('nekobt', await req(`https://nekobt.to/api/v1/torrents/search?query=${encodeURIComponent(textQuery(g))}`), (s, j) => (j.data?.results || []).map(x => row(s, x.title, x.infohash || x.info_hash, x.seeders, x.filesize || x.size)))
  } },
  { id: 'tokyotosho', kinds: ['anime'], async run (g) {
    return finish('tokyotosho', await req(`https://tokyotosho.info/rss.php?terms=${encodeURIComponent(textQuery(g))}&type=1`, { as: 'text', timeout: 12000 }), (s, t) => [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => row(s, unxml(xml(m[1], 'title')), (unxml(xml(m[1], 'link')).match(/btih:([0-9a-zA-Z]+)/) || [])[1], 0, 0)).filter(x => x.hash))
  } }
]

// Providers whose answer is keyed by an id (IMDb, Kitsu, AniDB): their rows are trusted as the right title.
export const ID_KEYED = new Set(['torrentio', 'torrentio-kitsu', 'torrentsdb', 'tosho-eid', 'eztv', 'yts', 'peerflix'])
