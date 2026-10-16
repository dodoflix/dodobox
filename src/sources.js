import { getJSON as fetchJSON, getText, once } from './http.js'
import { matchRelease, titleVerdict, isPack, isEpisode, seasonOf, entrySeason } from './release.js'
import { animeIds, episodeNumbers } from './ids.js'

// Torrent discovery: stream and search providers for movies and series, an anime tracker for anime.
const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'http://nyaa.tracker.wf:7777/announce'
]
// Public trackers come and go, so the healthy ones from a community list are added to every magnet.
let live = []
export async function refreshTrackers () {
  try {
    const text = await getText('https://cdn.jsdelivr.net/gh/ngosang/trackerslist@master/trackers_best.txt', { timeout: 8000 })
    const found = text.split(/\s+/).filter(u => /^(udp|https?):\/\//.test(u)).slice(0, 12)
    if (found.length) live = found
  } catch {}
}
export const magnetFor = (hash, name = '', extraTrackers = []) =>
  `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}` +
  [...new Set([...extraTrackers, ...TRACKERS, ...live])].map(t => '&tr=' + encodeURIComponent(t)).join('')

export function parseQuality (name) {
  // An explicit pixel height wins; "UHD" alone is only a hint (a "UHD BDRip 1080p" is 1080p).
  if (/2160p|\b4k\b/i.test(name)) return 2160
  if (/1080p/i.test(name)) return 1080
  if (/720p/i.test(name)) return 720
  if (/480p|\bdvdrip\b/i.test(name)) return 480
  if (/\buhd\b/i.test(name)) return 2160
  return 0
}

const TARGET = { 2160: 14, 1080: 6, 720: 3, 480: 1.4 }
const tierOf = q => (q >= 2160 ? 2160 : q >= 1080 ? 1080 : q >= 720 ? 720 : 480)
// Dubbed releases carry their language in the name; a full dub with no English track is wrong unless it is the viewer's own language.
const DUBS = { it: /\b(ita|italian)\b/i, fr: /\b(french|vff|vfq|truefrench|vostfr)\b/i, de: /\b(german|deutsch)\b/i, es: /\b(spanish|castellano|latino|esp)\b/i, ru: /\b(rus|russian)\b/i, tr: /\b(turkish|turkce)\b/i, pt: /\b(portuguese|dublado|brazilian)\b/i, hi: /\b(hindi|tamil|telugu)\b/i, pl: /\b(polish|lektor)\b/i, ko: /\bkorean\b/i, ja: /\bjap(anese)?\b/i, zh: /\bchinese\b/i }
// Fansub groups list the subtitle languages built into a release: "[Multiple Subtitle] [ENG][POR-BR][SPA-LA][ARA][FRE]".
const SUB_TAGS = { ENG: 'eng', JPN: 'jpn', JAP: 'jpn', 'POR-BR': 'pob', POR: 'por', 'SPA-LA': 'spa', SPA: 'spa', ESP: 'spa', ARA: 'ara', FRE: 'fre', FRA: 'fre', GER: 'ger', DEU: 'ger', ITA: 'ita', RUS: 'rus', TUR: 'tur', KOR: 'kor', CHI: 'chi', ZHO: 'chi', 'CHI-S': 'chi', 'CHI-T': 'chi', IND: 'ind', VIE: 'vie', THA: 'tha', POL: 'pol', DUT: 'dut', NLD: 'dut', SWE: 'swe', HIN: 'hin', HEB: 'heb', GRE: 'ell', ELL: 'ell' }
const MULTI_SUB = /multi(?:ple)?[ ._-]?sub(?:title)?s?\b/i
export const releaseSubLangs = name => new Set([...name.matchAll(/\[([A-Za-z]{3}(?:-[A-Za-z]{1,2})?)\]/g)].map(m => SUB_TAGS[m[1].toUpperCase()]).filter(Boolean))
export const measured = new Map()
const QUALITY_SCORE = { 2160: 130, 1440: 112, 1080: 100, 720: 80, 480: 30, 0: 20 }
const RUNTIME = { movie: 110, series: 45, anime: 24 }

// ctx: { mbps: internet speed of the server (0 unknown), prefer: forced resolution or 'auto',
//        mode: 'balanced' | 'compact' | 'lossless' (how much size to accept for quality),
//        sublang: the viewer's subtitle language (ISO 639-2), to favour releases that have it built in,
//        display: short side of the viewer's screen in px, runtimeMin }
export function score (r, ctx = {}) {
  if (!r.seeders) return -1000
  const forced = ctx.prefer && ctx.prefer !== 'auto' ? +ctx.prefer : 0
  let base = QUALITY_SCORE[r.quality] ?? 20
  if (r.quality >= 2160 && !forced && (!ctx.mbps || (ctx.display && ctx.display < 1800) || ctx.mode === 'compact')) base = 70
  let s = base + Math.min(Math.log2(r.seeders + 1) * 8, 60)
  if (forced) s += r.quality === forced ? 200 : -(r.quality ? Math.abs(Math.log2(r.quality / forced)) * 45 : 45)

  // Can the line carry it? Bitrate = size / runtime. A season pack's size says nothing about one episode.
  const mode = ctx.mode || 'balanced'
  const hevc = /x265|hevc|h\.?265|\bav1\b/i.test(r.title)
  // The stream provider reports the size of the episode's own file even inside a season pack (it knows the file index).
  const ownSize = !r.pack || r.fileIdx != null
  if (ownSize && r.size) {
    const mbps = r.size * 8 / ((ctx.runtimeMin || 100) * 60) / 1e6
    if (ctx.mbps) {
      const ratio = mbps / (ctx.mbps * 0.7)
      if (ratio > 1) s -= Math.min(160, (ratio - 1) * 70) * (forced ? 0.3 : mode === 'lossless' ? 0.5 : 1)
    } else if (r.size > 12e9 && mode !== 'lossless') s -= 40
    if (mode === 'lossless') s += Math.min(20, Math.log2(mbps + 1) * 3)
    else {
      const target = (TARGET[tierOf(r.quality)] ?? 8) * (mode === 'compact' ? 0.6 : 1)
      const ratio = mbps / (hevc ? 1.6 : 1) / target
      if (ratio > 1.25) s -= Math.min(150, (ratio - 1.25) * 45)
    }
  }
  const dub = Object.entries(DUBS).filter(([, re]) => re.test(r.title))
  if (dub.length) {
    if (dub.some(([l]) => l === ctx.audio)) s += 25
    else if (!/\b(eng|english|multi)\b/i.test(r.title)) s -= 80
  }
  if (/\bremux\b|\bbd(25|50|66|100)\b|\bcomplete\.?(uhd\.)?bluray\b/i.test(r.title)) s += mode === 'lossless' ? 25 : mode === 'compact' ? -90 : -60
  if (ctx.sublang && ctx.sublang !== 'off' && ctx.sublang !== 'eng' && releaseSubLangs(r.title).has(ctx.sublang)) s += 35
  else if (ctx.sublang && ctx.sublang !== 'off' && ctx.sublang !== 'eng' && MULTI_SUB.test(r.title)) s += 12 // several languages built in, this one not listed
  const m = measured.get(r.infoHash)
  if (m && Date.now() - m.at < 6 * 3600e3) s += m.bps ? Math.min(40, Math.log2(m.bps / 1e5 + 1) * 6) : -60
  if (/\b(cam|hdcam|ts|telesync|hdts|tc)\b/i.test(r.title)) s -= 300
  if (/x265|hevc|h\.?265|10.?bit/i.test(r.title)) s += mode === 'compact' ? 12 : mode === 'lossless' ? -6 : -10
  else if (/x264|h\.?264|avc/i.test(r.title)) s += 8
  if (/\b(yts|yify)\b/i.test(r.title + ' ' + (r.provider || ''))) s += 10
  if (r.pack) s -= r.fileIdx != null ? 8 : 25
  if (r.pack && r.fileIdx == null && r.size > 100e9) s -= 40 // a whole-series batch: thousands of files to index before the first byte
  if (r.wrongSeason) s -= 80
  // Different shows share a title ("The Prince" is a 2023 Turkish drama and a cartoon): a year in the name settles which.
  const years = ctx.kind !== 'anime' && ctx.year ? [...r.title.matchAll(/\b(?:19|20)\d\d\b(?![px])/g)].map(m => +m[0]) : []
  if (years.length) s += years.some(y => Math.abs(y - ctx.year) <= 1) ? 40 : -60
  return s
}
// A video far shorter or longer than the title's runtime is another title with the same name.
export const lengthFits = (seconds, runtimeMin) => !seconds || !runtimeMin || (seconds / 60 >= runtimeMin * 0.35 && seconds / 60 <= runtimeMin * 3)
export const rank = (list, ctx) => [...list].sort((a, b) => score(b, ctx) - score(a, ctx))

const toBytes = (n, unit) => parseFloat(n) * ({ KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1048576, GB: 1e9, GIB: 1073741824, TB: 1e12, TIB: 1099511627776 })[unit.toUpperCase()]

const getJSON = url => fetchJSON(url, { timeout: 9000 })

async function torrentio (path) {
  const j = await getJSON(`https://torrentio.strem.fun/stream/${path}.json`)
  return (j.streams || []).filter(s => s.infoHash).map(s => {
    const [title, meta = ''] = s.title.split('\n👤')
    const size = meta.match(/💾\s*([\d.]+)\s*(\w+)/)
    return {
      title: s.behaviorHints?.filename || title.split('\n')[0],
      release: title.split('\n')[0],
      infoHash: s.infoHash.toLowerCase(),
      magnet: magnetFor(s.infoHash, title.split('\n')[0], (s.sources || []).filter(x => x.startsWith('tracker:')).map(x => x.slice(8))),
      seeders: parseInt(meta, 10) || 0,
      size: size ? toBytes(size[1], size[2]) : 0,
      quality: parseQuality(s.name + ' ' + s.title),
      provider: (meta.match(/⚙️\s*(.+)/) || [])[1]?.split('\n')[0].trim() || 'torrentio',
      fileIdx: s.fileIdx
    }
  })
}

async function apibay (query, filter) {
  const j = await getJSON(`https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=200`)
  return j.filter(r => r.info_hash && !/^0+$/.test(r.info_hash) && filter(r.name, r)).map(r => ({
    title: r.name,
    release: r.name,
    infoHash: r.info_hash.toLowerCase(),
    magnet: magnetFor(r.info_hash, r.name),
    seeders: +r.seeders,
    size: +r.size,
    quality: parseQuality(r.name),
    provider: 'TPB'
  }))
}

const xml = (s, tag) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
const unescapeXml = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')

async function nyaa (query, filter) {
  const text = await getText(`https://nyaa.si/?page=rss&c=1_2&s=seeders&o=desc&q=${encodeURIComponent(query)}`, { timeout: 9000 })
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1]
    const title = unescapeXml(xml(it, 'title'))
    const size = xml(it, 'nyaa:size').match(/([\d.]+)\s*(\w+)/)
    return {
      title,
      release: title,
      infoHash: xml(it, 'nyaa:infoHash').toLowerCase(),
      magnet: magnetFor(xml(it, 'nyaa:infoHash'), title),
      seeders: +xml(it, 'nyaa:seeders') || 0,
      size: size ? toBytes(size[1], size[2]) : 0,
      quality: parseQuality(title),
      provider: 'Nyaa'
    }
  }).filter(r => r.infoHash && filter(r.title))
}

// AnimeTosho lists releases by AniDB id: `eid` is one episode, `aid` the whole show.
async function tosho (query) {
  const j = await getJSON(`https://animetosho.org/feed/json?${query}&order=seeders`)
  return (Array.isArray(j) ? j : []).filter(x => x.info_hash).map(x => ({
    title: x.title, release: x.torrent_name || x.title, infoHash: x.info_hash.toLowerCase(), magnet: magnetFor(x.info_hash, x.torrent_name || x.title),
    seeders: x.seeders || 0, size: x.total_size || 0, quality: parseQuality(x.title), provider: 'AnimeTosho', files: x.num_files
  }))
}

// Anime lookups, in two tiers. The first asks sources keyed by id (Torrentio by Kitsu id, AnimeTosho by AniDB episode id),
// whose answers are already the right episode; the second searches by name and runs only when the first came back thin.
async function animeTiers (item) {
  const alId = +String(item.id).replace('al:', '')
  const [ids, nums] = await Promise.all([animeIds(alId), item.movie ? null : episodeNumbers(alId, item.episode)])
  const titles = [...new Set([item.title, ...(item.altTitles || [])].filter(Boolean))].slice(0, 2)
  const target = { kind: 'anime', titles, episode: item.episode, entrySeason: entrySeason(titles), ...nums }
  // Releases the ids vouch for still pass a numbering check; when it would leave almost nothing, it is skipped.
  const vouched = job => job.then(rows => {
    const kept = item.movie ? rows : rows.filter(r => matchRelease({ name: r.title, release: r.release }, target, { noTitle: true }))
    return (kept.length >= 3 ? kept : rows).map(r => ({ ...r, idKeyed: true }))
  })
  const first = []
  if (ids?.kitsu) first.push(vouched(torrentio(item.movie ? `movie/kitsu:${ids.kitsu}` : `series/kitsu:${ids.kitsu}:${item.episode}`)))
  if (nums?.eid) first.push(vouched(tosho(`eid=${nums.eid}`)))
  else if (item.movie && ids?.anidb) first.push(vouched(tosho(`aid=${ids.anidb}`)))
  const fallback = []
  if (ids?.anidb && !item.movie) fallback.push(vouched(tosho(`aid=${ids.anidb}`)))
  const ep = String(item.episode).padStart(2, '0')
  for (const t of titles) {
    const tw = t.replace(/[^\p{L}\p{N} ]+/gu, ' ')
    // The search is fuzzy: a title plus the episode number also finds other shows whose names start with it.
    const own = n => item.movie || titleVerdict(n, titles) !== 'other'
    const numbering = { kind: 'anime', episode: item.episode, ...nums }
    fallback.push(nyaa(item.movie ? tw : `${tw} ${ep}`, n => own(n) && (item.movie || matchRelease({ name: n }, numbering, { noTitle: true }))))
    if (!item.movie) fallback.push(nyaa(`${tw} batch`, n => own(n) && isPack(n) && matchRelease({ name: n }, numbering, { noTitle: true })))
  }
  return { first, fallback }
}

const gather = async jobs => (await Promise.allSettled(jobs)).flatMap(s => {
  if (s.status === 'rejected') { console.warn('[sources]', s.reason.message); return [] }
  return s.value
})
const MIN_FIRST_TIER = 3

const cache = new Map()
export const findSources = (item, ctx = {}) => once('src:' + JSON.stringify([item.type, item.id, item.season, item.episode]), () => find(item, ctx))
async function find (item, ctx) {
  const key = JSON.stringify([item.type, item.id, item.season, item.episode])
  const hit = cache.get(key)
  const sctx = { ...ctx, runtimeMin: item.runtimeMin || RUNTIME[item.type], year: item.year, kind: item.type }
  if (hit && Date.now() - hit.at < 90 * 60e3) return rank(hit.list, sctx).slice(0, 25)

  const { type, season, episode } = item
  const jobs = []
  let tiers
  if (type === 'movie') {
    jobs.push(torrentio(`movie/${item.id}`))
    // The search is fuzzy: trust its catalog tag when present, else title + year in the name.
    jobs.push(apibay(`${item.title} ${item.year || ''}`.trim(), (n, r) => r.imdb ? r.imdb === item.id : matchRelease({ name: n }, { kind: 'movie', title: item.title, year: item.year }, { requireYear: true })))
  } else if (type === 'series') {
    jobs.push(torrentio(`series/${item.id}:${season}:${episode}`))
    const tag = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    const target = { kind: 'series', title: item.title, season, episode }
    jobs.push(apibay(`${item.title} ${tag}`, n => matchRelease({ name: n }, target)))
    jobs.push(apibay(`${item.title} S${String(season).padStart(2, '0')}`, n => matchRelease({ name: n }, target)))
  } else {
    tiers = await animeTiers(item)
    jobs.push(...tiers.first)
  }
  let rows = await gather(jobs)
  if (tiers && rows.filter(r => r.seeders > 0).length < MIN_FIRST_TIER) rows = rows.concat(await gather(tiers.fallback))
  const byHash = new Map()
  for (const r of rows) if (!byHash.has(r.infoHash) || byHash.get(r.infoHash).seeders < r.seeders) byHash.set(r.infoHash, r)
  for (const r of byHash.values()) {
    if (type === 'series') r.pack = !isEpisode(r.release, { type, season, episode })
    else if (type === 'anime' && !item.movie) {
      r.pack = r.files != null ? r.files > 1 : isPack(r.release)
      r.wrongSeason = !r.idKeyed && seasonOf(r.release) !== entrySeason([item.title, ...(item.altTitles || [])])
    }
    else r.pack = /\b(pack|collection|trilogy|anthology|saga|complete)\b|\b\d-\d\b/i.test(r.release)
  }
  const all = [...byHash.values()]
  if (all.length) cache.set(key, { at: Date.now(), list: all })
  return rank(all, sctx).slice(0, 25)
}
