import { getJSON as fetchJSON, getText, once } from './http.js'

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
export const VIDEO_EXT = /\.(mkv|mp4|m4v|webm|avi|mov|ts|wmv)$/i

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
  return s
}
export const rank = (list, ctx) => [...list].sort((a, b) => score(b, ctx) - score(a, ctx))

const words = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean)
export const nameHasTitle = (name, title) => {
  const n = new Set(words(name))
  return words(title).every(w => n.has(w))
}

export function matchAnimeEpisode (name, ep) {
  const e = String(ep).replace(/^0+/, '')
  const single = new RegExp(`(?:^|[\\s_\\-\\[(])0*${e}(?:v\\d)?(?=[\\s_\\[\\]().,-]|$)`)
  if (single.test(name.replace(/\b\d{3,4}p\b/gi, ''))) return true
  // Ranges are written "0001-1000", "01 ~ 12" or "S01E01-16".
  const range = name.match(/\bS\d+E0*(\d{1,4})\s*[-~]\s*E?0*(\d{1,4})\b/i) || name.match(/\b0*(\d{1,4})\s*[-~]\s*0*(\d{1,4})\b/)
  if (range && +range[1] <= ep && ep <= +range[2] && !/\b\d{3,4}p\b/.test(range[0])) return true
  return /batch|complete/i.test(name) && !range
}

export function animeShowName (release) {
  const n = release.replace(/^\s*(\[[^\]]*\]\s*)+/, '').replace(/_/g, ' ')
  const cut = n.search(/\s-\s*\d|\s-\s*S\d|\sS\d+E\d+|\s\d{2,4}\s*(\(|\[|v\d|$)|\s\(?\d{3,4}p|\s\[/i)
  return (cut > 0 ? n.slice(0, cut) : n).trim()
}
// Words that may follow the show's title without making it a different show. A later season or part ("Part 2") is a
// different entry unless the title itself says so.
const SAME_SHOW_EXTRAS = /^(?:(?:season|part|cour|s)\s*0*1\b|1st\s+season|tv|\(?(?:19|20)\d\d\)?|uncut|remastered|hd|bd|bluray|dub|dual|multi|complete|batch)(?:\s+|$)/i
// 'other': the release is a different show that merely starts with this title (a spin-off such as "One Piece Log - Fish-Man
// Island Saga" for "One Piece"); 'same' or 'unknown' (named differently, left to the search's relevance) otherwise.
export function showVerdict (release, titles) {
  const show = words(animeShowName(release)).join(' ')
  if (!show) return 'unknown'
  let verdict = 'unknown'
  for (const t of titles) {
    const w = words(t).join(' ')
    if (!w) continue
    if (show === w) return 'same'
    if (show.startsWith(w + ' ')) {
      let rest = show.slice(w.length + 1)
      while (rest && SAME_SHOW_EXTRAS.test(rest)) rest = rest.replace(SAME_SHOW_EXTRAS, '')
      if (!rest) return 'same'
      verdict = 'other'
    } else if (` ${show} `.includes(` ${w} `)) verdict = 'other' // a parody or spin-off wrapped around the title ("Koisuru One Piece")
  }
  return verdict
}

// Season number a release claims (1 when it doesn't say). The anime catalog lists each cour/season as its own entry,
// so "Show S2 - 03" must not satisfy a lookup for the first entry's episode 3.
export function animeSeason (name) {
  const m = name.match(/\bS(\d{1,2})\b(?!E)|\b(\d{1,2})(?:st|nd|rd|th) Season|\bSeason[ _]?0*(\d{1,2})\b/i)
  return m ? +(m[1] || m[2] || m[3]) : 1
}
const ANIME_PACK = /batch|complete|\bseason\b|\bS\d+\b(?!E)|\b\d{1,4}\s*[-~]\s*\d{1,4}\b/i
// "Show Season 2 - 03" is one episode; "Show (Season 1) [BD]" or "Show 01-12" is a pack.
export function isAnimePack (name) {
  const n = name.replace(/\b\d{3,4}p\b/gi, '')
  const season = /\bseason\s*\d+|\b\d+(st|nd|rd|th) season|\bS\d{1,2}\b(?!E)|\bseason\b/i
  const rest = n.replace(new RegExp(season.source, 'gi'), ' ') // "Season 2 - 01" must not read as the range 2-01
  if (/\b(batch|complete)\b|\b\d{1,4}\s*[-~]\s*\d{1,4}\b/i.test(rest)) return true
  if (/\s-\s*\d{1,3}(v\d)?(?=[\s_[\]().,-]|$)/.test(rest)) return false
  return season.test(n)
}

export const matchSeriesEpisode = (name, s, e) =>
  new RegExp(`(?:\\bs0*${s}[ ._-]?e0*${e}\\b|\\b0*${s}x0*${e}\\b)`, 'i').test(name)
const isSeasonPack = (name, s) => new RegExp(`\\bs0*${s}\\b|season[ ._-]?0*${s}\\b`, 'i').test(name) && !/\bs\d+[ ._-]?e\d+/i.test(name)

export function pickFile (files, { type, season, episode, fileIdx } = {}) {
  const vids = files.map((f, i) => ({ ...f, i })).filter(f => VIDEO_EXT.test(f.name) && !/sample/i.test(f.name))
  if (!vids.length) return -1
  if (type !== 'movie' && episode != null) {
    const hit = vids.filter(f => type === 'anime'
      ? matchAnimeEpisode(f.name.split(/[\\/]/).pop(), episode)
      : matchSeriesEpisode(f.name.split(/[\\/]/).pop(), season, episode))
    if (hit.length) return hit.sort((a, b) => b.length - a.length)[0].i
    if (fileIdx != null && vids.some(f => f.i === fileIdx)) return fileIdx
    if (vids.length > 1) return -1
  }
  return vids.sort((a, b) => b.length - a.length)[0].i
}

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

const cache = new Map()
export const findSources = (item, ctx = {}) => once('src:' + JSON.stringify([item.type, item.id, item.season, item.episode]), () => find(item, ctx))
async function find (item, ctx) {
  const key = JSON.stringify([item.type, item.id, item.season, item.episode])
  const hit = cache.get(key)
  const sctx = { ...ctx, runtimeMin: item.runtimeMin || RUNTIME[item.type] }
  if (hit && Date.now() - hit.at < 90 * 60e3) return rank(hit.list, sctx).slice(0, 25)

  const { type, season, episode } = item
  const jobs = []
  if (type === 'movie') {
    jobs.push(torrentio(`movie/${item.id}`))
    // The search is fuzzy: trust its catalog tag when present, else title + year in the name.
    jobs.push(apibay(`${item.title} ${item.year || ''}`.trim(), (n, r) => r.imdb ? r.imdb === item.id : nameHasTitle(n, item.title) && (!item.year || n.includes(String(item.year)))))
  } else if (type === 'series') {
    jobs.push(torrentio(`series/${item.id}:${season}:${episode}`))
    const tag = `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
    jobs.push(apibay(`${item.title} ${tag}`, n => nameHasTitle(n, item.title) && matchSeriesEpisode(n, season, episode)))
    jobs.push(apibay(`${item.title} S${String(season).padStart(2, '0')}`, n => nameHasTitle(n, item.title) && isSeasonPack(n, season)))
  } else {
    const ep = String(episode).padStart(2, '0')
    const titles = [...new Set([item.title, ...(item.altTitles || [])].filter(Boolean))].slice(0, 2)
    for (const t of titles) {
      const tw = t.replace(/[^\p{L}\p{N} ]+/gu, ' ')
      // The search is fuzzy: a title plus the episode number also finds other shows whose names start with it.
      const own = n => item.movie || showVerdict(n, titles) !== 'other'
      jobs.push(nyaa(item.movie ? tw : `${tw} ${ep}`, n => own(n) && (item.movie || matchAnimeEpisode(n, episode))))
      if (!item.movie) jobs.push(nyaa(`${tw} batch`, n => own(n) && matchAnimeEpisode(n, episode) && ANIME_PACK.test(n)))
    }
  }
  const settled = await Promise.allSettled(jobs)
  const byHash = new Map()
  for (const s of settled) {
    if (s.status === 'rejected') { console.warn('[sources]', s.reason.message); continue }
    for (const r of s.value) if (!byHash.has(r.infoHash) || byHash.get(r.infoHash).seeders < r.seeders) byHash.set(r.infoHash, r)
  }
  for (const r of byHash.values()) {
    if (type === 'series') r.pack = !matchSeriesEpisode(r.release, season, episode)
    else if (type === 'anime' && !item.movie) {
      r.pack = isAnimePack(r.release)
      r.wrongSeason = animeSeason(r.release) !== Math.max(...[item.title, ...(item.altTitles || [])].map(animeSeason))
    }
    else r.pack = /\b(pack|collection|trilogy|anthology|saga|complete)\b|\b\d-\d\b/i.test(r.release)
  }
  const all = [...byHash.values()]
  if (all.length) cache.set(key, { at: Date.now(), list: all })
  return rank(all, sctx).slice(0, 25)
}
