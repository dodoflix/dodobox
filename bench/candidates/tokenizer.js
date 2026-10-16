// Candidate release matcher: parse a torrent or file name once, then compare against a target
// (titles, season/episode numbering, year). No dependencies. See docs/benchmarks.md.
//
// target: { kind: 'movie'|'series'|'anime', title|titles, year, season, episode, movie,
//           tvdbSeason, tvdbEpisode, abs (anime numbering schemes), entryTitle }
// row:    { name (file or torrent name), release (torrent name when name is a file inside it) }

export const tok = s => (s || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/['\u2019`]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
export const lead = w => (w[0] === 'the' || w[0] === 'a') && w.length > 1 ? w.slice(1) : w

function clean (name) {
  let s = name.replace(/\.(mkv|mp4|avi|m4v|webm|ts|wmv|mov)$/i, '')
  s = s.replace(/^\s*(\[[^\]]*\]\s*)+/, ' ')                                   // leading fansub group tags
  s = s.replace(/^(www\.)?[\w-]+\.(com|org|net|to|io|se|cc|ws|tv)\s*-\s*/i, '')
  s = s.replace(/[_]/g, ' ').replace(/(?<=[A-Za-z])\.(?=[A-Za-z0-9])|(?<=\d)\.(?=[A-Za-z])|(?<=[A-Za-z])\.(?=\d)/g, ' ')
  return s
}

const cache = new Map()
export function parse (name) {
  if (cache.has(name)) return cache.get(name)
  const s = clean(name)
  const p = { seasons: new Set(), eps: [], range: null, pack: false, year: null, titleSegs: [], hashTail: null }
  // numbering ------------------------------------------------------------
  let m
  const sxe = /\bs(\d{1,2})[ ._-]?e(\d{1,4})(?:[ ._-]?(?:e|-\s?e?)(\d{1,4}))?(?:v\d)?\b/gi
  while ((m = sxe.exec(s))) { p.seasons.add(+m[1]); p.eps.push(+m[2]); if (m[3] && +m[3] > +m[2]) p.range = [+m[2], +m[3]] }
  const nxm = /\b(\d{1,2})x(\d{1,3})\b/gi
  while ((m = nxm.exec(s))) { p.seasons.add(+m[1]); p.eps.push(+m[2]) }
  const epw = /\b(?:ep?|episode|ep\.)[ ._-]?0*(\d{1,4})(?:v\d)?\b/gi
  while ((m = epw.exec(s))) p.eps.push(+m[1])
  const noRes = s.replace(/\b\d{3,4}[pi]\b|\b\d{3,4}x\d{3,4}\b/gi, ' ').replace(/\b(19|20)\d\d\b/g, ' ').replace(/\[[0-9A-Fa-f]{8}\]|\([0-9A-Fa-f]{8}\)/g, ' ')
  const dash = /\s-\s*0*(\d{1,4})(?:v\d)?(?=[\s[(._-]|$)/g
  while ((m = dash.exec(noRes))) p.eps.push(+m[1])
  const rg = /(?<![\w.])0*(\d{1,4})\s*(?:[-~]|to)\s*0*(\d{1,4})(?![\w.])/g
  while ((m = rg.exec(noRes))) if (+m[2] > +m[1] && !p.range) p.range = [+m[1], +m[2]]
  const sw = /\b(\d{1,2})(?:st|nd|rd|th) season\b|\bseason[ ._-]?0*(\d{1,2})\b|\bs0*(\d{1,2})\b(?![ ._-]?e\d)|\b(?:part|cour)[ ._-]?0*(\d{1,2})\b/gi
  while ((m = sw.exec(s))) { const n = +(m[1] || m[2] || m[3] || m[4]); if (m[4]) p.part = n; else p.seasons.add(n); p.seasonWord = true }
  const sr = /\bs0*(\d{1,2})\s*[-~]\s*s?0*(\d{1,2})\b/i.exec(s); if (sr) p.seasonRange = [+sr[1], +sr[2]]
  if (/\b(batch|complete|collection|pack|boxset|box set|integral|anthology|trilogy|saga)\b/i.test(s)) p.pack = true
  const ym = s.match(/(?:^|[\s([.])((?:19|20)\d\d)(?=[\s)\].]|$)/g); if (ym) p.year = +ym[0].replace(/\D/g, '')
  // bare trailing number right before tech/res/bracket: "Show Name 02 1080p" / "Show Name 02 [x]"
  const bare = /(?:^|\s)0*(\d{1,4})(?:v\d)?(?=\s*(?:\[|\(|-\s|\.\s|\d{3,4}[pi]\b|\b(?:web|bd|hevc|x26)|$))/i.exec(' ' + noRes.replace(/\s+$/, ''))
  if (bare) p.bare = +bare[1]
  // bracket numbers e.g. "[27]" or "(67)" are alternative (absolute) numbers
  p.alt = [...s.matchAll(/[[(]0*(\d{1,4})(?:v\d)?[\])]/g)].map(x => +x[1])
  // loose numbers anywhere (last resort for fansub names)
  p.nums = [...noRes.matchAll(/(?<![\w.])0*(\d{1,4})(?:v\d)?(?![\w.])/g)].map(x => +x[1])
  // title region: text before first numbering/quality marker -------------------
  const cut = s.search(/\bs\d{1,2}[ ._-]?e\d|\b\d{1,2}x\d{2}\b|\s-\s*\d|\b(?:ep?|episode)[ ._-]?\d|\bs\d{1,2}\b|\bseason\b|\b\d+(?:st|nd|rd|th) season\b|\b(?:19|20)\d\d\b|\b\d{3,4}[pi]\b|\b(?:batch|complete)\b|\[|\(\s*(?:\d|batch|season|bd|web)/i)
  const head = (cut > 0 ? s.slice(0, cut) : s).trim()
  // alias segments: "A | B", "A / B", "A (B)" in the whole pre-quality text
  const pre = s.replace(/\[[^\]]*\]/g, ' ')
  const segs = new Set([head])
  for (const part of pre.split(/\s[|/]\s/)) { const c = part.search(/\bs\d{1,2}[ ._-]?e\d|\s-\s*\d|\b\d{3,4}[pi]\b|\b(?:19|20)\d\d\b/i); segs.add((c > 0 ? part.slice(0, c) : part).trim()) }
  for (const g of pre.matchAll(/\(([^()]{3,}?)\)/g)) { const c = g[1].search(/\s-\s*\d|\bs\d{1,2}[ ._-]?e\d|\b\d{3,4}[pi]\b/i); segs.add((c > 0 ? g[1].slice(0, c) : g[1]).trim()) }
  p.titleSegs = [...segs].filter(x => x).map(x => lead(tok(x)))
  cache.set(name, p)
  return p
}

const SEASONY = /(\d+(st|nd|rd|th) season|season \d+|part \d+|cour \d+|final season|the final season|\bs\d+\b|\(\d{4}\))/gi
const aliasCache = new WeakMap()
const aliases = t => {
  if (aliasCache.has(t)) return aliasCache.get(t)
  const all = t.titles || [t.title]
  const set = new Map()
  for (const a of all) { const full = lead(tok(a)); if (full.length) set.set(full.join(' '), { tokens: full, seasonal: SEASONY.test(a) }); SEASONY.lastIndex = 0; const base = lead(tok(a.replace(SEASONY, ' '))); if (base.length) set.set(base.join(' '), { tokens: base, seasonal: false }) }
  const out = [...set.values()]; aliasCache.set(t, out); return out
}
const TAIL_OK = new Set(['us', 'uk', 'au', 'nz', 'ca', 'tv', 'the', 'complete', 'uncut', 'remastered', 'dub', 'dubbed', 'sub', 'subbed', 'dual', 'audio', 'multi', 'bd', 'hd', 'web', 'eng', 'english'])
function titleHit (p, t) {
  let best = null
  for (const seg of p.titleSegs) for (const a of aliases(t)) {
    if (seg.length < a.tokens.length) continue
    if (!a.tokens.every((w, i) => seg[i] === w)) continue
    const tail = seg.slice(a.tokens.length)
    if (tail.every(w => TAIL_OK.has(w) || /^\d{4}$/.test(w))) { if (!best || a.tokens.length > best.tokens.length) best = a }
  }
  return best
}

const EXTRA = /\b(nc ?op|nc ?ed|op ?\d|ed ?\d|opening|ending|trailer|menu|creditless|sp\d|s\d+sp\d|specials?|ova|oad|recap|henshu|mini anime|pv\d?|cm|extras?|featurette|behind the scenes|sample)\b/i
export const isExtra = n => EXTRA.test(n.replace(/[_.]/g, ' '))
export function matchRow (row, t, opt = {}) {
  if (isExtra(row.name) && !isExtra(t.entryTitle || t.title || '')) return false
  const p = parse(row.name); const q = row.release && row.release !== row.name ? parse(row.release) : null
  const hit = opt.noTitle ? { tokens: [], seasonal: false } : titleHit(p, t) || (q && titleHit(q, t))
  if (!hit) return false
  // The file's own name beats the torrent's: a season-pack release holds files that each name one episode.
  const P = p.eps.length || p.range ? [p, ...(q && !p.seasons.size ? [{ ...q, eps: [], range: null, pack: false }] : [])] : [p, q].filter(Boolean)
  if (t.kind === 'movie' || t.movie) {
    if (t.movie && t.kind === 'anime') return true
    const years = P.map(x => x.year).filter(Boolean)
    return !t.year || !years.length || years.some(y => Math.abs(y - t.year) <= 1)
  }
  const eps = new Set(); const seasons = new Set(); let range = null; let pack = false; let rseason = null
  for (const x of P) { x.eps.forEach(e => eps.add(e)); x.seasons.forEach(s => seasons.add(s)); range = range || x.range; pack = pack || x.pack; rseason = rseason || x.seasonRange }
  if (t.kind === 'series') {
    if (seasons.size && !seasons.has(t.season) && !(rseason && rseason[0] <= t.season && t.season <= rseason[1])) return false
    if (eps.has(t.episode) && (seasons.has(t.season) || !seasons.size)) return true
    if (range && range[0] <= t.episode && t.episode <= range[1]) return true
    if (!eps.size && (seasons.has(t.season) || pack || rseason)) return true // a season pack
    return false
  }
  // anime ------------------------------------------------------------------
  const entrySeason = hit.seasonal ? (Math.max(...P.flatMap(x => [...x.seasons])) || 1) : 1
  const claims = seasons
  if (claims.size && !claims.has(t.tvdbSeason) && !claims.has(t.entrySeason ?? 0) && ![...claims].every(c => c === 1 && (eps.has(t.abs)))) {
    // a season claim that is neither TVDB's season nor the entry's own season
    if (!(hit.seasonal && claims.has(entrySeason))) return false
  }
  const loose = [...new Set(P.flatMap(x => [x.bare, ...x.alt].filter(n => n != null)))]
  const cand = new Set([...eps, ...loose])
  const seasonOne = t.tvdbSeason === 1 || t.tvdbSeason == null
  const localOk = seasonOne || hit.seasonal || claims.size
  if (claims.has(t.tvdbSeason) && cand.has(t.tvdbEpisode)) return true
  if (t.abs && cand.has(t.abs) && (!claims.size || claims.has(t.tvdbSeason) || claims.has(1))) return true
  if (cand.has(t.episode) && localOk) return true
  if (range && ((range[0] <= t.episode && t.episode <= range[1] && localOk) || (t.abs && range[0] <= t.abs && t.abs <= range[1]))) return true
  if (!cand.size && (pack || claims.size || P.some(x => x.seasonWord))) return true
  return false
}
export default { id: 'tokenizer', match: matchRow }
