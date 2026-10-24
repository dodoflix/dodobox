// Subtitle identity: are the files served for a title or episode for that title and episode?
//   --snapshot   ask OpenSubtitles (every lookup path either candidate uses) and the addon for the core gold set, store the rows
//   --show n     print the wrong top picks of the first n items per candidate
// Without flags: replay both lookups on the stored rows (offline) and judge what they would serve in English.
//
// Oracle: OpenSubtitles files every upload under a show, season and episode and records the last cue time. A served file is
// wrong when it is filed under another show, season or episode (any numbering the episode is known by counts: TVDB's,
// the absolute one, the entry's own when it is season 1), is a film, or ends at a time that is not the episode's length.
// An addon file is judged through the same row when the REST lookup also returned it, else it is `unknown`: the addon
// carries a release name only. Blind spot: a file uploaded under the right label with the wrong content (a mislabelled
// upload) passes; `end far from the item's median` counts served files ending 30% away from the median of all English files found
// for the item, a check that does not use the labels. The shared question with the shipped matcher is the numbering, so check what changes by reading `--show`.
import { goldSet, readSnapshot, writeSnapshot, aniZip, fribb } from '../lib/store.js'
import { targetOf, labelOf } from '../lib/targets.js'
import { req, sleep } from '../lib/net.js'
import { scoreSub } from '../../src/subs.js'

const REST = 'https://rest.opensubtitles.org/search'
const ADDON = 'https://opensubtitles-v3.strem.io/subtitles'
const SLIM = ['IDSubtitleFile', 'SubFormat', 'SubDownloadLink', 'SubLanguageID', 'MovieReleaseName', 'SubFileName', 'SubDownloadsCnt', 'SubForeignPartsOnly', 'SubHearingImpaired', 'SubRating', 'MovieFPS', 'SubFromTrusted', 'MovieKind', 'SeriesSeason', 'SeriesEpisode', 'SeriesIMDBParent', 'IDMovieImdb', 'MovieName', 'SubLastTS']
const slim = s => Object.fromEntries(SLIM.map(k => [k, s[k]]))
const sec = ts => { const m = /^(\d+):(\d+):(\d+)/.exec(ts || ''); return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : null }

// What the server knows about a gold item: the catalog id, whether it is a later season, the episode's numbers, its length.
function idsOf (g) {
  if (g.kind !== 'anime') return { titles: [g.title] }
  const t = targetOf(g); const f = fribb().get(g.al); const e = aniZip()[g.al]?.episodes?.[g.ep]
  const imdb = [].concat(f?.imdb_id || [])[0] || null
  const nums = g.movie || !e ? null : { tvdbSeason: e.seasonNumber, tvdbEpisode: e.episodeNumber, abs: e.absoluteEpisodeNumber }
  return { titles: t.titles, imdb, later: (f?.season?.tvdb || 1) > 1, nums, runtime: e ? (e.runtime || e.length) * 60 : null }
}
const queryKey = g => labelOf(g)

async function get (url, headers) {
  for (let i = 0; i < 3; i++) {
    const r = await req(url, { headers })
    if (Array.isArray(r.body) || Array.isArray(r.body?.subtitles)) return r.body.subtitles || r.body
    await sleep(900)
  }
  return null
}

async function snapshot () {
  const candidates = await Promise.all([import('../candidates/subid-legacy.js'), import('../candidates/subid-repo.js')]).then(m => m.map(x => x.default))
  let out = []
  try { out = readSnapshot('subid') } catch {}
  const done = new Set(out.map(i => i.key))
  for (const g of await goldSet('core')) {
    if (done.has(queryKey(g))) continue
    const ids = idsOf(g)
    const qs = candidates.map(c => c.query(g, ids))
    const paths = [...new Set(qs.flatMap((q, i) => candidates[i].paths(q, 'eng')))]
    const keys = [...new Set(qs.flatMap((q, i) => candidates[i].addonKeys(q)))]
    const rest = {}; const addon = {}
    for (const p of paths) { rest[p] = (await get(`${REST}/${p}`, { 'X-User-Agent': 'TemporaryUserAgent' }))?.map(slim) || []; await sleep(700) }
    for (const k of keys) addon[k] = (await get(`${ADDON}/${g.kind === 'movie' ? 'movie' : 'series'}/${k}.json`)) || []
    out.push({ key: queryKey(g), g, ids, rest, addon })
    process.stderr.write(`${queryKey(g)}: ${Object.values(rest).flat().length} rest rows, ${Object.values(addon).flat().length} addon rows\n`)
    writeSnapshot('subid', out)
  }
  console.log(`${out.length} items stored`)
}

// Replays the lookup: paths in order until enough files match (as the shipped loop does), plus the addon rows, then the shipped score.
function serve (c, item) {
  const q = c.query(item.g, item.ids)
  const found = new Map()
  for (const p of c.paths(q, 'eng')) {
    for (const s of item.rest[p] || []) { if (found.has(s.SubDownloadLink)) continue; const r = c.keep(s, p, q); if (r) found.set(r.url, r) }
    if (found.size >= (q.type === 'anime' ? 3 : 1)) break
  }
  const addon = c.addonKeys(q).flatMap(k => item.addon[k] || []).map(s => ({ lang: s.lang, url: s.url, rel: s.movieReleaseName || s.subtitleFileName || '', dl: +s.g || 0, fps: (+s.fpsMilli || 0) / 1000 }))
    .filter(s => q.type !== 'anime' || c.plausible(s.rel, q))
  const seen = new Set()
  return [...found.values(), ...addon].filter(s => s.lang === 'eng' && !s.forced && !seen.has(s.url) && seen.add(s.url))
    .map(s => ({ ...s, score: scoreSub(s, '', ['eng']) })).sort((a, b) => b.score - a.score).slice(0, 10)
}

// right | wrong:<why> | unknown
function judge (s, item, byId) {
  const { g, ids } = item
  const id = /(\d{6,})(\.gz)?$/.exec(s.url)?.[1]
  const m = byId.get(id)
  if (!m) return 'unknown'
  if (g.movie) return m.MovieKind === 'movie' ? 'right' : 'wrong:episode'
  if (m.MovieKind === 'movie' && g.kind !== 'movie') return 'wrong:film'
  if (g.kind === 'movie') return +m.IDMovieImdb === +g.imdb.slice(2) ? 'right' : 'wrong:title'
  const parent = g.kind === 'series' ? g.imdb : ids.imdb
  if (parent && +m.SeriesIMDBParent && +m.SeriesIMDBParent !== +parent.slice(2)) return 'wrong:show'
  const n = ids.nums
  const truth = g.kind === 'series' ? [[g.season, g.episode]] : n ? [[n.tvdbSeason, n.tvdbEpisode], [1, n.abs]] : [[1, g.ep]]
  const last = sec(m.SubLastTS)
  if (ids.runtime && last && (last > ids.runtime * 1.6 || last < ids.runtime * 0.5)) return 'wrong:length'
  if (!+m.SeriesEpisode) return 'unknown'
  return truth.some(([a, b]) => +m.SeriesSeason === a && +m.SeriesEpisode === b) ? 'right' : 'wrong:episode'
}

export default async function subid (args) {
  if (args.snapshot) return snapshot()
  const data = readSnapshot('subid')
  const cands = await Promise.all([import('../candidates/subid-legacy.js'), import('../candidates/subid-repo.js')]).then(m => m.map(x => x.default))
  const rows = []; const shown = {}
  for (const kind of ['anime', 'series', 'movie']) {
    const items = data.filter(i => i.g.kind === kind)
    for (const c of cands) {
      let odd = 0; const why = {}; let withSubs = 0; let t1 = { right: 0, wrong: 0, unknown: 0 }; let top3Wrong = 0; let served = 0; let wrongServed = 0; 
      for (const item of items) {
        const byId = new Map(Object.values(item.rest).flat().map(s => [s.IDSubtitleFile, s]))
        const list = serve(c, item)
        const lasts = [...byId.values()].filter(m => m.SubLanguageID === 'eng' && sec(m.SubLastTS)).map(m => sec(m.SubLastTS)).sort((a, b) => a - b)
        const med = lasts[Math.floor(lasts.length / 2)]
        for (const x of list) { const l = sec(byId.get(/(\d{6,})(\.gz)?$/.exec(x.url)?.[1])?.SubLastTS); if (med && l && Math.abs(l - med) > med * 0.3) odd++ }
        if (list.length) withSubs++
        const v = list.map(s => judge(s, item, byId))
        served += list.length
        for (const x of v) { if (x.startsWith('wrong')) { wrongServed++; why[x] = (why[x] || 0) + 1 } }
        if (v.length) t1[v[0].split(':')[0]]++
        if (v.slice(0, 3).some(x => x.startsWith('wrong'))) top3Wrong++
        if (args.show && v[0]?.startsWith('wrong') && (shown[c.id] = (shown[c.id] || 0) + 1) <= +args.show) console.log(`${c.id} ${item.key}: ${v[0]} ${list[0].rel.slice(0, 60)}`)
      }
      rows.push({ group: kind, lookup: c.id, items: items.length, 'with files': withSubs, 'top-1 right': t1.right, 'top-1 wrong': t1.wrong, 'top-1 unknown': t1.unknown, 'top-3 has a wrong file': top3Wrong, 'wrong of served': `${wrongServed}/${served}`, 'end far from the item\'s median': odd, 'wrong by': Object.entries(why).map(([k, n]) => `${k.slice(6)} ${n}`).join(', ') || '-' })
    }
  }
  console.table(rows)
}
