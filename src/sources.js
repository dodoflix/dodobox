import { getJSON as fetchJSON, getText, once } from './http.js'
import { matchRelease, titleVerdict, isPack, isEpisode, seasonOf, entrySeason } from './release.js'
import { animeIds, episodeNumbers } from './ids.js'
import { scrape } from './tracker.js'

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
  if (r.pack) s -= r.fileIdx != null ? 4 : 12
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

async function knaben (query, filter) {
  const body = JSON.stringify({ search_field: 'title', query, order_by: 'seeders', order_direction: 'desc', size: 50, hide_unsafe: true, hide_xxx: true })
  const j = await fetchJSON('https://api.knaben.org/v1', { method: 'POST', headers: { 'content-type': 'application/json' }, body, timeout: 9000 })
  return (j.hits || []).filter(r => r.hash && filter(r.title)).map(r => ({
    title: r.title, release: r.title, infoHash: r.hash.toLowerCase(), magnet: magnetFor(r.hash, r.title),
    seeders: r.seeders || 0, size: r.bytes || 0, quality: parseQuality(r.title), provider: 'Knaben'
  }))
}

// Every YTS release of a movie, by IMDb id.
async function yts (imdb) {
  const j = await getJSON(`https://movies-api.accel.li/api/v2/list_movies.json?query_term=${imdb}`)
  return (j.data?.movies || []).flatMap(m => (m.torrents || []).map(t => {
    const title = `${m.title_long} ${t.quality} ${t.type} ${t.video_codec}`
    return { title, release: title, infoHash: t.hash.toLowerCase(), magnet: magnetFor(t.hash, m.title_long), seeders: t.seeds || 0, size: t.size_bytes || 0, quality: parseQuality(t.quality), provider: 'YTS' }
  }))
}

const xml = (s, tag) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
const unescapeXml = s => s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

// Adult releases are listed on sukebei, a separate site with the same feed.
const NYAA = { host: 'nyaa.si', cat: '1_2' }
const SUKEBEI = { host: 'sukebei.nyaa.si', cat: '1_1' }
async function nyaa (query, filter, { host, cat } = NYAA) {
  const text = await getText(`https://${host}/?page=rss&c=${cat}&s=seeders&o=desc&q=${encodeURIComponent(query)}`, { timeout: 9000 })
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
      provider: host === NYAA.host ? 'Nyaa' : 'Sukebei'
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

const MIN_FIRST_TIER = 3
// A lookup runs in two tiers. The first asks sources keyed by id (Torrentio by IMDb or Kitsu id, AnimeTosho by AniDB episode
// id), whose answers are already the right title and episode; the second searches by name and runs only when the first came
// back with fewer than three seeded releases (`fallback` is a function so those requests are not sent unless needed).
//
// Rows an id vouches for still pass a numbering and year check, which drops the odd stray file ("Halloween costume haul" for
// Halloween; a movie that is a few megabytes is not a movie). When the check would leave almost nothing it is skipped, so a parser blind spot cannot empty the list.
const MIN_MOVIE_BYTES = 150e6
const vouched = (job, target) => job.then(rows => {
  const fits = r => matchRelease({ name: r.title, release: r.release }, target, { noTitle: true }) && !(target.kind === 'movie' && r.size && r.size < MIN_MOVIE_BYTES)
  const kept = target ? rows.filter(fits) : rows
  return (kept.length >= MIN_FIRST_TIER ? kept : rows).map(r => ({ ...r, idKeyed: true }))
})
const p2 = n => String(n).padStart(2, '0')

function movieTiers (item) {
  const target = { kind: 'movie', title: item.title, year: item.year }
  const query = `${item.title} ${item.year || ''}`.trim()
  // The text searches are fuzzy: trust a catalog tag when present, else the title and year in the name.
  const named = n => matchRelease({ name: n }, target, { requireYear: true })
  return {
    first: [vouched(torrentio(`movie/${item.id}`), target)],
    fallback: () => [vouched(yts(item.id), target), apibay(query, (n, r) => r.imdb ? r.imdb === item.id : named(n)), knaben(query, named)]
  }
}

// Older episodes are found in season packs, so the text searches also ask for the season and for the complete series.
function seriesTiers (item) {
  const { title, season, episode } = item
  const target = { kind: 'series', title, season, episode }
  const named = n => matchRelease({ name: n }, target)
  const queries = [`${title} S${p2(season)}E${p2(episode)}`, `${title} Season ${season}`, `${title} complete`]
  return {
    first: [vouched(torrentio(`series/${item.id}:${season}:${episode}`), target)],
    fallback: () => queries.flatMap(q => [apibay(q, named), knaben(q, named)])
  }
}

async function animeTiers (item) {
  const alId = +String(item.id).replace('al:', '')
  const [ids, nums] = await Promise.all([animeIds(alId), item.movie ? null : episodeNumbers(alId, item.episode)])
  const titles = [...new Set([item.title, ...(item.altTitles || [])].filter(Boolean))].slice(0, 2)
  const target = item.movie ? null : { kind: 'anime', titles, episode: item.episode, entrySeason: entrySeason(titles), ...nums }
  const first = []
  if (ids?.kitsu) first.push(vouched(torrentio(item.movie ? `movie/kitsu:${ids.kitsu}` : `series/kitsu:${ids.kitsu}:${item.episode}`), target))
  if (nums?.eid) first.push(vouched(tosho(`eid=${nums.eid}`), target))
  else if (item.movie && ids?.anidb) first.push(vouched(tosho(`aid=${ids.anidb}`), null))
  const fallback = () => {
    const jobs = []
    if (ids?.anidb && !item.movie) jobs.push(vouched(tosho(`aid=${ids.anidb}`), target))
    for (const t of titles) for (const site of item.adult ? [NYAA, SUKEBEI] : [NYAA]) {
      const tw = t.replace(/[^\p{L}\p{N} ]+/gu, ' ')
      // The search is fuzzy: a title plus the episode number also finds other shows whose names start with it.
      const own = n => item.movie || titleVerdict(n, titles) !== 'other'
      const numbering = { kind: 'anime', episode: item.episode, ...nums }
      jobs.push(nyaa(item.movie ? tw : `${tw} ${p2(item.episode)}`, n => own(n) && (item.movie || matchRelease({ name: n }, numbering, { noTitle: true })), site))
      if (!item.movie) jobs.push(nyaa(`${tw} batch`, n => own(n) && isPack(n) && matchRelease({ name: n }, numbering, { noTitle: true }), site))
    }
    return jobs
  }
  return { first, fallback }
}

const usable = rows => rows.filter(r => r.seeders > 0).length
const wait = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, ms)))
const DEADLINE_MS = 300
const HARD_CAP_MS = 4000

// Runs a lookup's tiers. tiers.first[0] is the primary source. When it answers with enough seeded releases the lookup returns
// at the deadline with whatever its tier-mates managed by then; when it fails or comes back thin, the name searches start
// at once instead of after the slow tier-mates. Everything still in flight lands in `done`, so the caller can top up its cache.
export async function runTiers (tiers, { deadline = DEADLINE_MS, cap = HARD_CAP_MS } = {}) {
  const t0 = Date.now()
  const got = []
  let failed = false
  const track = job => job.then(rows => { got.push(...rows) }, e => { failed = true; console.warn('[sources]', e.message) })
  const first = tiers.first.map(track)
  let all = Promise.all(first)
  await first[0]
  if (usable(got) >= MIN_FIRST_TIER) await Promise.race([all, wait(deadline - (Date.now() - t0))])
  else {
    all = Promise.all([...first, ...tiers.fallback().map(track)])
    await Promise.race([all, wait(cap - (Date.now() - t0))])
  }
  return { rows: [...got], failed, done: all.then(() => ({ rows: [...got], failed })) }
}

// Live seeder counts. A source's number can be days old, so the best candidates are asked of the trackers themselves; a count
// is used only when at least two trackers knew the torrent (one tracker not knowing it says little).
export const hooks = { scrape }
const seen = new Map()
const SEEN_FRESH_MS = 10 * 60e3
const SCRAPED = 15
const withLive = list => list.map(r => { const s = seen.get(r.infoHash); return s?.trackers >= 2 ? { ...r, seeders: s.seeders, reportedSeeders: r.seeders } : r })
async function refreshSeeders (hashes) {
  const trackers = [...new Set([...TRACKERS, ...live])].filter(t => t.startsWith('udp://'))
  const found = await hooks.scrape(hashes, trackers)
  for (const [hash, s] of found) seen.set(hash, { ...s, at: Date.now() })
  if (seen.size > 5000) for (const k of [...seen.keys()].slice(0, 1000)) seen.delete(k)
}
async function rankLive (list, sctx) {
  const stale = rank(withLive(list), sctx).slice(0, SCRAPED).filter(r => !(seen.get(r.infoHash)?.at > Date.now() - SEEN_FRESH_MS)).map(r => r.infoHash)
  if (stale.length) await Promise.race([refreshSeeders(stale).catch(() => {}), wait(700)])
  return rank(withLive(list), sctx).slice(0, 25)
}

const LIST_TTL = 90 * 60e3
const PARTIAL_TTL = 60e3 // what was found while a source failed is used, but asked for again soon
const NOTHING_TTL = 5 * 60e3
const cache = new Map()
export const findSources = (item, ctx = {}) => once('src:' + JSON.stringify([item.type, item.id, item.season, item.episode, !!item.adult]), () => find(item, ctx))
async function find (item, ctx) {
  const key = JSON.stringify([item.type, item.id, item.season, item.episode, !!item.adult])
  const hit = cache.get(key)
  const sctx = { ...ctx, runtimeMin: item.runtimeMin || RUNTIME[item.type], year: item.year, kind: item.type }
  if (hit && Date.now() - hit.at < hit.ttl) return rankLive(hit.list, sctx)

  const { type, season, episode } = item
  const tiers = type === 'movie' ? movieTiers(item) : type === 'series' ? seriesTiers(item) : await animeTiers(item)
  const build = rows => {
    const byHash = new Map()
    for (const r of rows) if (!byHash.has(r.infoHash) || byHash.get(r.infoHash).seeders < r.seeders) byHash.set(r.infoHash, { ...r })
    for (const r of byHash.values()) {
      if (type === 'series') r.pack = !isEpisode(r.release, { type, season, episode })
      else if (type === 'anime' && !item.movie) {
        r.pack = r.files != null ? r.files > 1 : isPack(r.release)
        r.wrongSeason = !r.idKeyed && seasonOf(r.release) !== entrySeason([item.title, ...(item.altTitles || [])])
      }
      else r.pack = /\b(pack|collection|trilogy|anthology|saga|complete)\b|\b\d-\d\b/i.test(r.release)
    }
    return [...byHash.values()]
  }
  const { rows, failed, done } = await runTiers(tiers)
  const list = build(rows)
  // Nothing found is remembered briefly, unless a source errored: that says nothing about the title.
  if (list.length) cache.set(key, { at: Date.now(), list, ttl: failed ? PARTIAL_TTL : LIST_TTL })
  else if (!failed) cache.set(key, { at: Date.now(), list, ttl: NOTHING_TTL })
  // Sources that answered after the deadline top up the cached list for the next request.
  done.then(late => { const full = build(late.rows); if (full.length > list.length || (!late.failed && failed)) cache.set(key, { at: Date.now(), list: full, ttl: late.failed ? PARTIAL_TTL : LIST_TTL }) }).catch(() => {})
  return rankLive(list, sctx)
}
