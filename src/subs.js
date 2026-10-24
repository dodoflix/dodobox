// Subtitles from several keyless providers, merged and ranked by release match; SRT to WebVTT lives here too.
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA } from './paths.js'
import { fetchRetry, once } from './http.js'
import { yifyList, unzipFirst, yifyHeaders } from './yify.js'
import { log } from './log.js'
import * as account from './osaccount.js'
import { stripAds } from './sync.js'

const LEGACY = { tur: 'windows-1254', ara: 'windows-1256', per: 'windows-1256', rus: 'windows-1251', ukr: 'windows-1251', bul: 'windows-1251', srp: 'windows-1251', ell: 'windows-1253', heb: 'windows-1255', pol: 'windows-1250', cze: 'windows-1250', hun: 'windows-1250', rum: 'windows-1250', hrv: 'windows-1250', slv: 'windows-1250', tha: 'windows-874', vie: 'windows-1258' }

const CACHE = path.join(DATA, 'subs')

const ADDON = 'https://opensubtitles-v3.strem.io'
const REST = 'https://rest.opensubtitles.org/search'
const PER_LANG = 10
const names = new Intl.DisplayNames(['en'], { type: 'language' })
const langName = code => code === 'pob' ? 'Portuguese (Brazil)' : (() => { try { return names.of(code) } catch { return code } })()

export function srtToVtt (text) {
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim()
  if (/^WEBVTT/.test(text)) return text + '\n'
  return 'WEBVTT\n\n' + text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
}

const tokens = s => new Set(String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1))
export function similarity (a, b) {
  const A = tokens(a); const B = tokens(b)
  if (!A.size || !B.size) return 0
  let hit = 0; for (const t of A) if (B.has(t)) hit++
  return hit / (A.size + B.size - hit)
}

async function addon ({ type, id, season, episode, imdb, tvdbSeason, tvdbEpisode, abs }) {
  if (type === 'anime' && !imdb) return [] // the addon only knows IMDb-style ids
  const keys = imdb ? animeKeys({ episode, tvdbSeason, tvdbEpisode, abs }).map(([s, e]) => `${imdb}:${s}:${e}`) : [type === 'series' ? `${id}:${season}:${episode}` : id]
  const lists = await Promise.all(keys.map(async key => {
    const r = await fetchRetry(`${ADDON}/subtitles/${imdb ? 'series' : type}/${key}.json`, { timeout: 9000, tries: 2 })
    return (await r.json()).subtitles || []
  }))
  return lists.flat().map(s => ({ lang: s.lang, url: s.url, rel: s.movieReleaseName || s.subtitleFileName || '', dl: +s.g || 0, fps: (+s.fpsMilli || 0) / 1000, via: 'addon' }))
}
// ani.zip's TVDB numbering is trusted for later seasons and where it agrees with the absolute number. A first-season episode filed
// at another number (Cowboy Bebop's episode 5 is S1E15, "My Funny Valentine") follows TVDB's air order, not the episode's content.
const numbering = ({ episode, tvdbSeason, tvdbEpisode, abs }) =>
  tvdbSeason == null || (tvdbSeason === 1 && tvdbEpisode !== abs) ? { episode: +episode, tvdbSeason: null, tvdbEpisode: null, abs } : { episode: +episode, tvdbSeason, tvdbEpisode, abs }
// [season, episode] a catalog-id lookup may file an anime episode under: TVDB's numbering, then the entry's own number and the
// absolute one as season 1 (long shows file "One Piece S01E1100").
export const animeKeys = q => {
  const { episode, tvdbSeason, tvdbEpisode, abs } = numbering(q)
  const all = tvdbSeason == null ? [[1, episode], [1, abs]] : [[tvdbSeason, tvdbEpisode], [1, abs]]
  return all.filter(([, e], i) => e && all.findIndex(x => x[0] === all[i][0] && x[1] === e) === i)
}

// One language per request: asking for several at once ("sublanguageid-tur,eng") makes the service answer some queries with
// an empty body, which hid every result.
// The list carries `incomplete` when a lookup failed, so what it holds is not taken for everything that exists.
async function rest (q, langs) {
  const per = await Promise.all(langs.map(l => restOne(q, l).catch(() => Object.assign([], { incomplete: true }))))
  return Object.assign(per.flat(), { incomplete: per.some(l => l.incomplete) })
}
// A title search also finds sequels and spin-offs ("Naruto" brings Shippuden, Boruto, other episode numbers): keep the one show and episode.
// Compared by the show's catalog id when known, else by its name with doubled letters folded (Shippuuden = Shippuden).
const mentions = (text, n) => new RegExp(`(?<!\\d)0*${+n}(?!\\d)`).test(text)
const fold = t => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').replace(/(.)\1+/gu, '$1')
export function sameShow (s, q) {
  const { titles, imdb } = q
  const { tvdbSeason, tvdbEpisode, abs } = numbering(q)
  const wanted = q.wanted || episodeNumbers(q)
  if (+s.SeriesEpisode && !wanted.has(+s.SeriesEpisode)) return false
  // A file filed under another season is another cour's episode with the same number (the absolute number is unique, and may sit under any).
  if (+s.SeriesSeason && tvdbSeason != null && +s.SeriesSeason !== tvdbSeason && !(+s.SeriesEpisode === abs && abs !== tvdbEpisode)) return false
  // Files for a whole show (named only by episode number, "600.ass") are filed as the show itself: parent "0", the show's own id.
  const parent = +s.SeriesIMDBParent || (s.MovieKind === 'tv series' ? +s.IDMovieImdb : 0)
  if (imdb && parent) return parent === +imdb.slice(2)
  const name = fold((String(s.MovieName || '').match(/"([^"]+)"/) || [])[1])
  return !name || !titles.some(fold) || titles.some(t => fold(t) === name)
}
// The lookup paths for one language, best first. Anime: by catalog id when known, then by title. The title is searched as plain
// words (punctuation breaks the search: "86 eighty-six" finds nothing, "86 eighty six" does) and as release files name it, "Title - 01".
export function restPaths ({ type, id, season, episode, titles, imdb, tvdbSeason, tvdbEpisode, abs }, code) {
  const lang = `sublanguageid-${code}`
  const words = t => encodeURIComponent(t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim())
  const ep2 = String(episode).padStart(2, '0')
  // "Title 600" is the form that finds a long show's late episodes (files named by absolute number, filed under no season or episode);
  // "Title - 600" ignores the number and returns the first 100 files of the show, none of them this episode.
  const names = [...new Set(titles.map(words))].slice(0, 3)
  return (type === 'movie' ? [`imdbid-${id.slice(2)}`]
    : type === 'series' ? [`episode-${episode}/imdbid-${id.slice(2)}/season-${season}`]
      : [...(imdb ? animeKeys({ episode, tvdbSeason, tvdbEpisode, abs }).map(([s, e]) => `episode-${e}/imdbid-${imdb.slice(2)}/season-${s}`) : []),
        ...names.map(n => `query-${n}%20${episode}`), ...names.map(n => `episode-${episode}/query-${n}`), ...names.map(n => `query-${n}%20-%20${ep2}`)]
  ).map(p => `${p}/${lang}`)
}
// A raw OpenSubtitles row as a subtitle, or null when it is not for what was asked. `p` is the path that found it.
export function restRow (s, p, q) {
  const { type, episode } = q
  const rel = s.MovieReleaseName || s.SubFileName || ''
  if (!/^(srt|sub|ass|ssa)$/i.test(s.SubFormat) || !s.SubDownloadLink) return null
  if (type === 'anime') {
    const wanted = episodeNumbers(q)
    // Uploaders also file films and specials under an episode number ("Cowboy Bebop The Movie" as episode 5).
    if (episode != null && s.MovieKind === 'movie') return null
    // A title search returns the show's files in no useful order: keep the ones that name this episode.
    if (!(sameShow(s, { ...q, wanted }) && plausible(rel, q) &&
      (p.startsWith('episode-') || wanted.has(+s.SeriesEpisode) || [...wanted].some(n => mentions(`${rel} ${s.SubFileName}`, n))))) return null
  }
  return { lang: s.SubLanguageID, url: s.SubDownloadLink, enc: s.SubEncoding, rel, dl: +s.SubDownloadsCnt || 0, forced: s.SubForeignPartsOnly === '1', hi: s.SubHearingImpaired === '1', rating: +s.SubRating || 0, fps: +s.MovieFPS || 0, trusted: s.SubFromTrusted === '1', via: 'rest' }
}
async function restOne (q, code) {
  // Anime paths go on until a few matching files are found: one path finding a single file must not hide what the others know.
  const found = new Map()
  let failed = 0
  for (const p of restPaths(q, code)) {
    const r = await fetchRetry(`${REST}/${p}`, { headers: { 'X-User-Agent': 'TemporaryUserAgent' }, timeout: 6000, tries: 2 }).catch(() => null)
    // Two failures in a row mean the service is down or throttling: more paths would only take longer to fail.
    if (!r) { log.debug('subs', 'opensubtitles path failed', { path: p }); if (++failed >= 2) { log.warn('subs', 'opensubtitles failing twice in a row, giving up', { lang: code }); break } continue }
    failed = 0
    const list = await r.json().catch(() => null)
    for (const s of Array.isArray(list) ? list : []) {
      const row = found.has(s.SubDownloadLink) ? null : restRow(s, p, q)
      if (row) found.set(row.url, row)
    }
    if (found.size >= (q.type === 'anime' ? 3 : 1)) break
  }
  return Object.assign([...found.values()], { incomplete: failed > 0 })
}

// dl.opensubtitles.org answers 404 ("IP ... exceeded") once the IP's anonymous download quota is used up, and further tries count
// toward a firewall ban. Stop asking for a while; its files stay listed but flagged `limited`.
let quotaUntil = 0
const quotaHit = () => Date.now() < quotaUntil
const fromOpensubtitles = u => new URL(u).hostname === 'dl.opensubtitles.org'
const quotaError = () => Object.assign(new Error('opensubtitles download limit reached for now'), { code: 429 })
const usable = (list, profile) => (quotaHit() && !account.ready(profile) ? list.map(s => (fromOpensubtitles(s.url) ? { ...s, limited: true } : s)) : list)

const listCache = new Map()
const jobs = new Map()
export const timing = { quickMs: 3500 }
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const mark = (list, partial) => (partial ? list.map(s => ({ ...s, partial: true })) : list)
// The addon answers in a fraction of a second, the other providers can take many seconds (or fail). When they are not done within
// QUICK_MS the addon's list is returned flagged `partial`, the rest keeps working, and the complete list is kept for the next ask.
export async function listSubtitles (q, langs = [], release = '', profile = '') {
  const key = JSON.stringify([q.type, q.id, q.season, q.episode, langs, release])
  const hit = listCache.get(key)
  if (hit && Date.now() - hit.at < hit.ttl) return usable(hit.list, profile)
  let job = jobs.get(key)
  if (!job) {
    job = lookup(q, langs, release)
    job.full = job.full.then(r => {
      // A list built while a provider failed is kept briefly: it is better than nothing, but not the answer for hours.
      if (r.list.length) { listCache.set(key, { at: Date.now(), list: r.list, ttl: r.complete ? 6 * 3600e3 : 90e3 }); if (listCache.size > 300) listCache.delete(listCache.keys().next().value) }
      return r
    }).finally(() => jobs.delete(key))
    jobs.set(key, job)
  }
  const done = await Promise.race([job.full, wait(timing.quickMs)])
  if (done) return usable(mark(done.list, !done.complete), profile)
  return usable(mark(await job.quick, true), profile)
}
// The addon's answers carry only a release name: drop ones naming a sequel the title is not, or another episode.
const SEQUEL = /shipp?uu?den|boruto|next generations/i
const EXTRA = /\b(movie|special|ova|oad|recap)\b/i
// Numbers an episode may carry in file names. Its number in the entry counts, except where the entry continues a TVDB season
// (86 Part 2 episode 3 is S1E14, and "S01E03" is Part 1's).
export const episodeNumbers = q => {
  const { episode, tvdbSeason, tvdbEpisode, abs } = numbering(q)
  return new Set([...(tvdbSeason == null || tvdbSeason > 1 || tvdbEpisode === episode || abs === episode ? [episode] : []), tvdbEpisode, abs].filter(Boolean))
}
export function plausible (rel, q) {
  const { episode, titles = [] } = q
  const { tvdbSeason, tvdbEpisode, abs } = numbering(q)
  const wanted = episodeNumbers(q)
  const m = rel.match(/s(\d{1,2})e(\d{1,4})|\bep?\.? ?(\d{1,4})\b|episode ?(\d{1,4})|\b(\d{1,2})x(\d{2,3})\b/i)
  const n = m && +(m[2] || m[3] || m[4] || m[6])
  const season = m && +(m[1] || m[5])
  if (n && !wanted.has(n)) return false
  // A season marker must be the entry's season; the absolute number is unique across seasons and may sit under any.
  if (n && season && tvdbSeason != null && season !== tvdbSeason && !(n === abs && abs !== tvdbEpisode)) return false
  // Anime files are numbered by episode ("Naruto 022"): a bare three-digit number that is not this episode (101 is episode 101, not S01E01) belongs to another one.
  // Long shows reach four digits (One Piece is past 1100); 1000-1499 cannot be a year, so a number there is an episode.
  const bareM = !m && rel.match(/(?<![\dA-Za-z])(\d{3}|0?\d{3}|1[0-4]\d\d)(?![\dA-Za-z])|_(\d{2})_/)
  const bare = bareM && +(bareM[1] || bareM[2])
  if (bare && !wanted.has(bare) && ![240, 360, 480, 576, 720].includes(bare)) return false
  if (episode != null && EXTRA.test(rel) && !titles.some(t => EXTRA.test(t))) return false
  return !SEQUEL.test(rel) || titles.some(t => SEQUEL.test(t))
}
// Starts every provider once; `quick` is what the fast ones (the addon and, for movies, the yify page) give, `full` waits for all.
function lookup (q, langs, release) {
  const [addonP, restP, yifyP] = [addon(q), langs.length ? rest(q, langs) : [], q.type === 'movie' && langs.length ? yifyList(q.id, langs) : []]
  const quick = Promise.allSettled([addonP, yifyP]).then(r => assemble(q, langs, release, r.flatMap(x => x.value || [])))
  const full = Promise.allSettled([addonP, restP, yifyP]).then(([a, b, c]) => ({
    list: assemble(q, langs, release, [...(a.value || []), ...(b.value || []), ...(c.value || [])]),
    complete: a.status === 'fulfilled' && b.status === 'fulfilled' && !b.value?.incomplete // the yify page is an extra: its being down is not a reason to keep asking
  }))
  return { quick, full }
}
// Higher is a better pick. Weights are tuned by `npm run bench -- subs`.
export const WEIGHTS = { sim: 5, dl: 0.2, lang: 2, forced: 6, rating: 0.2, hi: 6, trusted: 1, fpsOdd: 1 }
const FILM_FPS = [23.976, 23.98, 24]
export function scoreSub (s, release, langs, w = WEIGHTS) {
  return similarity(release, s.rel) * w.sim + Math.log10(s.dl + 1) * w.dl + (langs.includes(s.lang) ? w.lang : 0) - (s.forced ? w.forced : 0) +
    (s.rating || 0) * w.rating - (s.hi ? w.hi : 0) + (s.trusted ? w.trusted : 0) - (s.fps && !FILM_FPS.includes(s.fps) ? w.fpsOdd : 0)
}
export { addon, rest }
export const resetQuota = () => { quotaUntil = 0 }
function assemble (q, langs, release, found) {
  const all = found.filter(x => q.type !== 'anime' || plausible(x.rel, q)).map(x => ({ ...x, enc: x.enc || LEGACY[x.lang] }))
  const seen = new Set()
  const scored = all.filter(s => !seen.has(s.url) && seen.add(s.url))
    .map(s => ({ ...s, score: scoreSub(s, release, langs) }))
    .sort((x, y) => y.score - x.score)
  const count = {}
  const out = []
  for (const s of scored) {
    const n = (count[s.lang] = (count[s.lang] || 0) + 1)
    if (n > PER_LANG) continue
    out.push({ lang: s.lang, label: `${langName(s.lang)}${n > 1 ? ' #' + n : ''}`, hint: (s.forced ? 'Forced only: ' : '') + s.rel.replace(/\.(srt|sub|ass)$/i, '').slice(0, 42), enc: s.enc, url: s.url, forced: s.forced, best: n === 1 && !s.forced && similarity(release, s.rel) > 0.34 })
  }
  return out.sort((x, y) => (langs.indexOf(x.lang) + 1 || 99) - (langs.indexOf(y.lang) + 1 || 99) || langName(x.lang).localeCompare(langName(y.lang))) // stable: within a language the best-ranked file stays first ('Turkish #10' is not before '#2')
}

// Only the subtitle providers' own hosts may be fetched, so /api/sub can't be used as an open proxy.
export const allowedSubUrl = u => {
  try { const { protocol, hostname } = new URL(u); return protocol === 'https:' && /(^|\.)(strem\.io|opensubtitles\.org|yifysubtitles\.ch)$/.test(hostname) } catch { return false }
}

export async function fetchSubtitle (url, enc, profile = '') {
  const f = path.join(CACHE, crypto.createHash('sha1').update(url + (enc || '')).digest('hex') + '.vtt')
  try { return stripAds(fs.readFileSync(f, 'utf8')) } catch {}
  return once('sub:' + f, async () => {
    // Anonymous downloads first; the household's account only takes over once this IP's quota is used up.
    let viaAcct = false
    const viaAccount = () => { if (!account.ready(profile)) throw quotaError(); viaAcct = true; return account.download(profile, url).catch(e => { throw e.code === 401 ? quotaError() : e }) }
    let buf
    if (fromOpensubtitles(url) && quotaHit()) buf = await viaAccount()
    else {
      const r = await fetchRetry(url, { timeout: 15000, tries: 3, headers: /yifysubtitles/.test(url) ? yifyHeaders : undefined }).catch(e => {
        if (e.status !== 404 || !fromOpensubtitles(url)) throw e
        quotaUntil = Date.now() + 3600e3
        log.warn('subs', 'opensubtitles download quota exceeded, skipping its files for 1h')
        return null
      })
      buf = r ? Buffer.from(await r.arrayBuffer()) : await viaAccount()
    }
    if (buf[0] === 0x50 && buf[1] === 0x4b) buf = unzipFirst(buf)
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf)
    const raw = await toVtt(buf, enc)
    // Downloads OpenSubtitles refuses (VIP-only) come back as one four-hour cue selling VIP: not a subtitle, and not worth keeping.
    if (/osdb\.link\/vip/i.test(raw) && raw.length < 300) {
      if (viaAcct) account.refuse(profile); else quotaUntil = Date.now() + 3600e3
      throw quotaError()
    }
    const vtt = stripAds(raw)
    fs.mkdirSync(CACHE, { recursive: true })
    fs.writeFileSync(f, vtt)
    return vtt
  })
}

// Subtitle file bytes in any common format (SRT, WebVTT, ASS/SSA) to WebVTT.
export async function toVtt (buf, enc) {
  if (buf.length > 3e6) throw new Error('subtitle too large')
  let text = decode(buf, enc)
  // ASS/SSA and other formats go through ffmpeg (loaded lazily: transcode.js imports this module).
  if (/^\s*\[Script Info\]/i.test(text)) text = await (await import('./transcode.js')).anyToVtt(buf)
  return srtToVtt(text)
}
export const legacyEncoding = lang => LEGACY[lang]

// UTF-8 when valid; otherwise the encoding the provider reported (Turkish files are usually CP1254), else Windows-1252.
export function decode (buf, enc) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf) } catch {}
  const label = String(enc || '').toLowerCase().replace(/^cp/, 'windows-')
  for (const l of [label, 'windows-1252']) { try { return new TextDecoder(l).decode(buf) } catch {} }
  return buf.toString('latin1')
}
