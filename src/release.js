// Release names: one parser for torrent and file names, and the questions the rest of the backend asks of it
// (is this the title, is this the episode, which file of a pack). Names are parsed once and cached.
export const VIDEO_EXT = /\.(mkv|mp4|m4v|webm|avi|mov|ts|wmv)$/i

export const tok = s => (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/['’`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
export const lead = w => (w[0] === 'the' || w[0] === 'a') && w.length > 1 ? w.slice(1) : w
const base = n => n.split(/[\\/]/).pop()

function clean (name) {
  return name.replace(/\.(mkv|mp4|avi|m4v|webm|ts|wmv|mov)$/i, '')
    .replace(/^\s*(\[[^\]]*\]\s*)+/, ' ') // fansub group tags
    .replace(/^(www\.)?[\w-]+\.(com|org|net|to|io|se|cc|ws|tv)\s*-\s*/i, '') // "site.com - Name"
    .replace(/_/g, ' ').replace(/(?<=[A-Za-z])\.(?=[A-Za-z0-9])|(?<=\d)\.(?=[A-Za-z])|(?<=[A-Za-z])\.(?=\d)/g, ' ')
}

const parsed = new Map()
// { seasons: Set, eps: [numbers named by S01E02 / 1x02 / E02 / " - 02"], range: [from, to] | null, seasonRange,
//   pack, seasonWord, year, bare (trailing number before a bracket or quality tag), alt (bracketed numbers, often
//   absolute), titleSegs (candidate titles as token lists: the text before the numbering, plus "A | B" and "(B)" aliases) }
export function parse (name) {
  if (parsed.has(name)) return parsed.get(name)
  const s = clean(name)
  const p = { seasons: new Set(), eps: [], range: null, seasonRange: null, pack: false, seasonWord: false, year: null, bare: null, alt: [], titleSegs: [] }
  let m
  const sxe = /\bs(\d{1,2})[ ._-]?e(\d{1,4})(?:[ ._-]?(?:e|-\s?e?)(\d{1,4}))?(?:v\d)?\b/gi
  while ((m = sxe.exec(s))) { p.seasons.add(+m[1]); p.eps.push(+m[2]); if (m[3] && +m[3] > +m[2]) p.range = [+m[2], +m[3]] }
  const nxm = /\b(\d{1,2})x(\d{1,3})\b/gi
  while ((m = nxm.exec(s))) { p.seasons.add(+m[1]); p.eps.push(+m[2]) }
  const epw = /\b(?:ep?|episode|ep\.)[ ._-]?0*(\d{1,4})(?:v\d)?\b/gi
  while ((m = epw.exec(s))) p.eps.push(+m[1])
  // resolutions, years and CRC hashes are numbers that are not episodes
  const bare = s.replace(/\b\d{3,4}[pi]\b|\b\d{3,4}x\d{3,4}\b/gi, ' ').replace(/\b(19|20)\d\d\b/g, ' ').replace(/\[[0-9A-Fa-f]{8}\]|\([0-9A-Fa-f]{8}\)/g, ' ')
  const dash = /\s-\s*0*(\d{1,4})(?:v\d)?(?=[\s[(._-]|$)/g
  while ((m = dash.exec(bare))) p.eps.push(+m[1])
  const rg = /(?<![\w.])0*(\d{1,4})\s*(?:[-~]|to)\s*0*(\d{1,4})(?![\w.])/g
  while ((m = rg.exec(bare))) if (+m[2] > +m[1] && !p.range) p.range = [+m[1], +m[2]]
  const sw = /\b(\d{1,2})(?:st|nd|rd|th) season\b|\bseason[ ._-]?0*(\d{1,2})\b|\bs0*(\d{1,2})\b(?![ ._-]?e\d)|\b(?:part|cour)[ ._-]?0*(\d{1,2})\b/gi
  while ((m = sw.exec(s))) { if (!m[4]) p.seasons.add(+(m[1] || m[2] || m[3])); p.seasonWord = true }
  const sr = /\bs0*(\d{1,2})\s*[-~]\s*s?0*(\d{1,2})\b/i.exec(s); if (sr) p.seasonRange = [+sr[1], +sr[2]]
  if (/\b(batch|complete|collection|pack|boxset|box set|integral|anthology|trilogy|saga)\b/i.test(s)) p.pack = true
  const ym = s.match(/(?:^|[\s([.])((?:19|20)\d\d)(?=[\s)\].]|$)/g); if (ym) p.year = +ym[0].replace(/\D/g, '')
  const tail = /(?:^|\s)0*(\d{1,4})(?:v\d)?(?=\s*(?:\[|\(|-\s|\.\s|\d{3,4}[pi]\b|\b(?:web|bd|hevc|x26)|$))/i.exec(' ' + bare.replace(/\s+$/, ''))
  if (tail) p.bare = +tail[1]
  p.alt = [...s.matchAll(/[[(]0*(\d{1,4})(?:v\d)?[\])]/g)].map(x => +x[1])
  // Titles: text before the first numbering or quality marker, and the alias forms "A | B", "A / B", "A (B)".
  const cut = s.search(/\bs\d{1,2}[ ._-]?e\d|\b\d{1,2}x\d{2}\b|\s-\s*\d|\b(?:ep?|episode)[ ._-]?\d|\bs\d{1,2}\b|\bseason\b|\b\d+(?:st|nd|rd|th) season\b|\b(?:19|20)\d\d\b|\b\d{3,4}[pi]\b|\b(?:batch|complete)\b|\[|\(\s*(?:\d|batch|season|bd|web)/i)
  const segs = new Set([(cut > 0 ? s.slice(0, cut) : s).trim()])
  const pre = s.replace(/\[[^\]]*\]/g, ' ')
  for (const part of pre.split(/\s[|/]\s/)) { const c = part.search(/\bs\d{1,2}[ ._-]?e\d|\s-\s*\d|\b\d{3,4}[pi]\b|\b(?:19|20)\d\d\b/i); segs.add((c > 0 ? part.slice(0, c) : part).trim()) }
  for (const g of pre.matchAll(/\(([^()]{3,}?)\)/g)) { const c = g[1].search(/\s-\s*\d|\bs\d{1,2}[ ._-]?e\d|\b\d{3,4}[pi]\b/i); segs.add((c > 0 ? g[1].slice(0, c) : g[1]).trim()) }
  p.titleSegs = [...segs].filter(Boolean).map(x => lead(tok(x)))
  parsed.set(name, p)
  return p
}

// Openings, endings, specials and recaps share a show's name and often its numbers.
const EXTRA = /\b(nc ?op|nc ?ed|op ?\d|ed ?\d|opening|ending|trailer|menu|creditless|sp\d|s\d+sp\d|specials?|ova|oad|recap|henshu|mini anime|pv\d?|cm|extras?|featurette|behind the scenes|sample)\b/i
export const isExtra = name => EXTRA.test(name.replace(/[_.]/g, ' '))

// The season an entry or release claims (1 when it says nothing). Anime catalogs list each cour as its own entry.
export const seasonOf = name => Math.max(1, ...parse(name).seasons)
export const entrySeason = titles => Math.max(1, ...titles.map(seasonOf))

// True when the name is a pack of episodes rather than one episode.
export function isPack (name) {
  const p = parse(name)
  if (p.range || p.pack) return true
  return !p.eps.length && p.bare == null && p.seasonWord
}

// Do all words of `title` appear in `name`?
export const hasWords = (name, title) => { const n = new Set(tok(name)); return tok(title).every(w => n.has(w)) }

const SEASONY = /(\d+(st|nd|rd|th) season|season \d+|part \d+|cour \d+|final season|the final season|\bs\d+\b|\(\d{4}\))/gi
const aliasCache = new WeakMap()
function aliases (t) {
  if (aliasCache.has(t)) return aliasCache.get(t)
  const set = new Map()
  for (const a of t.titles || [t.title]) {
    const full = lead(tok(a)); if (full.length) set.set(full.join(' '), { tokens: full, seasonal: SEASONY.test(a) })
    SEASONY.lastIndex = 0
    const plain = lead(tok(a.replace(SEASONY, ' '))); if (plain.length) set.set(plain.join(' '), { tokens: plain, seasonal: false })
  }
  const out = [...set.values()]
  aliasCache.set(t, out)
  return out
}
// Words that may follow a title without making it another title: "Show US", "Show (2019)", "Show Complete".
const TAIL_OK = new Set(['us', 'uk', 'au', 'nz', 'ca', 'tv', 'the', 'complete', 'uncut', 'remastered', 'dub', 'dubbed', 'sub', 'subbed', 'dual', 'audio', 'multi', 'bd', 'hd', 'web', 'eng', 'english'])
function titleHit (p, t) {
  let best = null
  for (const seg of p.titleSegs) for (const a of aliases(t)) {
    if (seg.length < a.tokens.length || !a.tokens.every((w, i) => seg[i] === w)) continue
    if (seg.slice(a.tokens.length).every(w => TAIL_OK.has(w) || /^\d{4}$/.test(w)) && (!best || a.tokens.length > best.tokens.length)) best = a
  }
  return best
}

// A later season or part is another entry unless the title itself says so.
const SAME_SHOW_EXTRAS = /^(?:(?:season|part|cour|s) ?0*1\b|1st season|tv|(?:19|20)\d\d|uncut|remastered|hd|bd|bluray|dub|dual|multi|complete|batch)(?: |$)/
// 'other': the release is a different show that merely contains this title ("One Piece Log - Fish-Man Island Saga" for
// "One Piece", or a parody wrapped around it); 'same'; or 'unknown' (named differently, left to the search's relevance).
export function titleVerdict (name, titles) {
  const segs = parse(name).titleSegs
  if (!segs.length) return 'unknown'
  const first = segs[0].join(' ')
  let verdict = 'unknown'
  for (const t of titles) {
    const w = lead(tok(t)).join(' ')
    if (!w) continue
    if (segs.some(s => s.join(' ') === w)) return 'same'
    if (first.startsWith(w + ' ')) {
      let rest = first.slice(w.length + 1)
      while (rest && SAME_SHOW_EXTRAS.test(rest)) rest = rest.replace(SAME_SHOW_EXTRAS, '')
      if (!rest) return 'same'
      verdict = 'other'
    } else if (` ${first} `.includes(` ${w} `)) verdict = 'other'
  }
  return verdict
}

// Is this torrent or file the requested title and episode?
//   target: { kind: 'movie'|'series'|'anime', title|titles, year, season, episode, movie,
//             tvdbSeason, tvdbEpisode, abs }   (anime: every numbering the episode may be released under)
//   row:    { name, release }  name is the file or torrent; release is the torrent when name is a file inside it
//   opt:    noTitle (the source already vouches for the title), requireYear (movies: a name without a year fails)
export function matchRelease (row, t, opt = {}) {
  if (t.kind === 'anime' && !t.movie && isExtra(row.name) && !isExtra(t.title || t.titles?.[0] || '')) return false
  const p = parse(row.name); const q = row.release && row.release !== row.name ? parse(row.release) : null
  const hit = opt.noTitle ? { tokens: [], seasonal: false } : titleHit(p, t) || (q && titleHit(q, t))
  if (!hit) return false
  // The file's own name beats the torrent's: a season pack holds files that each name one episode.
  const P = p.eps.length || p.range ? [p, ...(q && !p.seasons.size ? [{ ...q, eps: [], range: null, pack: false }] : [])] : [p, q].filter(Boolean)
  if (t.kind === 'movie' || t.movie) {
    if (t.movie && t.kind === 'anime') return true
    const years = P.map(x => x.year).filter(Boolean)
    return !t.year || (years.length ? years.some(y => Math.abs(y - t.year) <= 1) : !opt.requireYear)
  }
  const eps = new Set(); const seasons = new Set(); let range = null; let pack = false; let seasonRange = null
  for (const x of P) { x.eps.forEach(e => eps.add(e)); x.seasons.forEach(s => seasons.add(s)); range ||= x.range; pack ||= x.pack; seasonRange ||= x.seasonRange }
  if (t.kind === 'series') {
    if (seasons.size && !seasons.has(t.season) && !(seasonRange && seasonRange[0] <= t.season && t.season <= seasonRange[1])) return false
    if (eps.has(t.episode)) return true
    if (range && range[0] <= t.episode && t.episode <= range[1]) return true
    return !eps.size && (seasons.has(t.season) || pack || !!seasonRange) // a season pack
  }
  // Anime. Season claims are only judged once the TVDB season is known (see src/ids.js).
  const gated = t.tvdbSeason != null
  if (gated && seasons.size && !seasons.has(t.tvdbSeason) && !seasons.has(t.entrySeason ?? 0) && ![...seasons].every(s => s === 1 && eps.has(t.abs)) && !(hit.seasonal && seasons.has(Math.max(...seasons)))) return false
  const numbers = new Set([...eps, ...P.flatMap(x => [x.bare, ...x.alt].filter(n => n != null))])
  const local = !gated || t.tvdbSeason === 1 || hit.seasonal || seasons.size > 0
  if (gated && seasons.has(t.tvdbSeason) && numbers.has(t.tvdbEpisode)) return true
  if (t.abs && numbers.has(t.abs) && (!seasons.size || !gated || seasons.has(t.tvdbSeason) || seasons.has(1))) return true
  if (numbers.has(t.episode) && local) return true
  if (range && ((range[0] <= t.episode && t.episode <= range[1] && local) || (t.abs && range[0] <= t.abs && t.abs <= range[1]))) return true
  return !numbers.size && (pack || seasons.size > 0 || P.some(x => x.seasonWord))
}

// Is the name exactly this episode (not a pack, not a neighbour)? Used for subtitle files named after the episode.
export function isEpisode (name, { type, season, episode }) {
  if (type === 'anime') return matchRelease({ name }, { kind: 'anime', episode }, { noTitle: true })
  const p = parse(name)
  return p.seasons.has(season) && p.eps.includes(episode) // S01E01-07 is a multi-episode release, not this episode
}

// The file of a torrent that holds the requested episode (movies: the biggest video). -1 when the torrent does not
// have it. `fileIdx` is the source's own suggestion, used only when the names give no answer.
export function pickFile (files, { type, season, episode, fileIdx, tvdbSeason, tvdbEpisode, abs } = {}) {
  const anime = type === 'anime'
  const vids = files.map((f, i) => ({ ...f, i })).filter(f => VIDEO_EXT.test(f.name) && !/sample/i.test(f.name) && !(anime && isExtra(base(f.name))))
  if (!vids.length) return -1
  const biggest = list => list.sort((a, b) => b.length - a.length)[0].i
  if (type === 'movie' || episode == null) return biggest(vids)
  // Numbers of a file, ignoring "Part 2" style suffixes; a trailing bare number only counts when nothing else names the episode.
  const nums = f => {
    const p = parse(base(f.name).replace(/\b(part|pt|cour|vol|volume)[ ._-]?\d+/gi, ' '))
    return { seasons: p.seasons, eps: p.eps, loose: [...new Set([...p.eps, ...(p.eps.length || p.bare == null ? [] : [p.bare]), ...p.alt])] }
  }
  const infos = vids.map(f => ({ ...f, ...nums(f) }))
  let hit
  if (!anime) hit = infos.filter(f => f.seasons.has(season) && f.eps.includes(episode))
  else {
    hit = infos.filter(f => tvdbSeason != null && f.seasons.has(tvdbSeason) && f.eps.includes(tvdbEpisode))
    if (!hit.length) {
      // A pack numbers its files by TVDB season, absolutely, or from 1; the pack's own range tells which.
      const all = new Set(infos.flatMap(f => f.loose)); const lo = Math.min(...all); const hi = Math.max(...all)
      const wantAbs = abs && abs !== episode && all.has(abs) && !(all.has(episode) && lo === 1 && hi < abs)
      const want = wantAbs ? abs : episode
      hit = infos.filter(f => f.loose.includes(want) && !(tvdbSeason != null && f.seasons.size && !f.seasons.has(tvdbSeason) && !f.seasons.has(1)))
    }
  }
  if (hit.length) return biggest(hit)
  if (fileIdx != null && vids.some(f => f.i === fileIdx)) return fileIdx
  return vids.length === 1 ? vids[0].i : -1
}
