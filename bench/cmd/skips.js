// Skip markers (intro, recap, outro): which services know them, for how many titles, and whether the release in hand matches.
//   --per n         titles per popularity bucket (default 40)
//   --server url    also probe the real releases of the gold titles through a running app: chapter marks, and whether the
//                   file's length matches the length a skip marker was recorded against (use a throwaway DATA_DIR: it starts
//                   downloads and deletes them again)
import { execFile } from 'node:child_process'
import { req, pct, pool, sleep } from '../lib/net.js'
import { fribb, goldSet } from '../lib/store.js'
import { FFMPEG } from '../../src/bin.js'

const ANILIST = 'https://graphql.anilist.co'
const PAGE = 'query($p:Int){Page(page:$p,perPage:25){media(type:ANIME,format:TV,sort:POPULARITY_DESC){id idMal episodes title{romaji}}}}'
const BUCKETS = { popular: [1, 2], mid: [12, 13], tail: [60, 61] } // AniList popularity pages of 25
const CINEMETA = 'https://v3-cinemeta.strem.io'
const SERIES_BUCKETS = { popular: 0, mid: 400, tail: 900 } // skip offsets in the Cinemeta "top" series catalog
const MARK = /\b(op|opening|intro|ed|ending|outro|credits?|recap|preview|prologue|epilogue|next)\b/i

const share = (n, of) => (of ? Math.round(100 * n / of) + '%' : '-')

async function aniskip (mal, ep, length = 0) {
  const r = await req(`https://api.aniskip.com/v2/skip-times/${mal}/${ep}?types=op&types=ed&types=recap&episodeLength=${length}`)
  const by = Object.fromEntries((r.body?.results || []).map(x => [x.skipType, x]))
  return { ms: r.ms, err: r.status !== 200 && r.status !== 404, by }
}

async function animeCoverage (per) {
  const titles = []
  for (const [bucket, pages] of Object.entries(BUCKETS)) {
    for (const p of pages) {
      for (const m of (await req(ANILIST, { method: 'POST', json: { query: PAGE, variables: { p } } })).body?.data?.Page?.media || []) {
        if (m.idMal && m.episodes && titles.filter(t => t.bucket === bucket).length < per) titles.push({ bucket, mal: m.idMal, n: m.episodes })
      }
      await sleep(800)
    }
  }
  const jobs = titles.flatMap(t => [1, Math.floor(t.n / 2), t.n - 1].filter((e, i, a) => e >= 1 && a.indexOf(e) === i).map(ep => ({ ...t, ep })))
  const rows = []
  await pool(jobs, 4, async j => { rows.push({ ...j, ...await aniskip(j.mal, j.ep) }) })
  const out = Object.keys(BUCKETS).map(bucket => {
    const r = rows.filter(x => x.bucket === bucket); const t = new Set(r.map(x => x.mal))
    return { bucket, titles: t.size, lookups: r.length, op: share(r.filter(x => x.by.op).length, r.length), ed: share(r.filter(x => x.by.ed).length, r.length), recap: share(r.filter(x => x.by.recap).length, r.length), 'op or ed': share(r.filter(x => x.by.op || x.by.ed).length, r.length), 'titles with any': share([...t].filter(m => r.some(x => x.mal === m && (x.by.op || x.by.ed))).length, t.size) }
  })
  console.log('AniSkip, by MAL id (episodes: first, middle, next to last)')
  console.table(out)
  const ms = rows.map(x => x.ms); const ops = rows.filter(x => x.by.op).map(x => x.by.op.interval.endTime - x.by.op.interval.startTime)
  const eds = rows.filter(x => x.by.ed).map(x => x.by.ed.interval.startTime / x.by.ed.episodeLength)
  console.log(`latency p50 ${pct(ms, 0.5)} ms, p95 ${pct(ms, 0.95)} ms, errors ${rows.filter(x => x.err).length}; opening length p10/p50/p90 ${pct(ops, 0.1)?.toFixed(0)}/${pct(ops, 0.5)?.toFixed(0)}/${pct(ops, 0.9)?.toFixed(0)} s; ending starts at ${pct(eds, 0.1)?.toFixed(2)}/${pct(eds, 0.5)?.toFixed(2)}/${pct(eds, 0.9)?.toFixed(2)} of the episode`)
}

async function seriesCoverage (per) {
  const rows = []
  for (const [bucket, skip] of Object.entries(SERIES_BUCKETS)) {
    const cat = (await req(`${CINEMETA}/catalog/series/top${skip ? `/skip=${skip}` : ''}.json`)).body?.metas?.filter(m => m.imdb_id?.startsWith('tt')).slice(0, per) || []
    await pool(cat, 4, async c => {
      const meta = (await req(`${CINEMETA}/meta/series/${c.imdb_id}.json`)).body?.meta
      const seasons = [...new Set((meta?.videos || []).filter(v => v.season > 0 && v.released && new Date(v.released) < new Date()).map(v => v.season))].sort((a, b) => a - b)
      if (!seasons.length) return
      for (const [season, episode] of [[seasons[0], 2], [seasons.at(-1), 3]]) {
        if (!(meta.videos || []).some(v => v.season === season && v.episode === episode)) continue
        const r = await req(`https://api.introdb.app/segments?imdb_id=${c.imdb_id}&season=${season}&episode=${episode}`)
        const b = r.body || {}
        rows.push({ bucket, id: c.imdb_id, ms: r.ms, err: r.status !== 200 && r.status !== 404, intro: !!b.intro, outro: !!b.outro, recap: !!b.recap, post: !!b.post_credits, conf: b.intro?.confidence ?? b.outro?.confidence, subs: Math.max(b.intro?.submission_count || 0, b.outro?.submission_count || 0) })
      }
    })
  }
  const out = Object.keys(SERIES_BUCKETS).map(bucket => {
    const r = rows.filter(x => x.bucket === bucket); const t = new Set(r.map(x => x.id))
    return { bucket, titles: t.size, lookups: r.length, intro: share(r.filter(x => x.intro).length, r.length), outro: share(r.filter(x => x.outro).length, r.length), recap: share(r.filter(x => x.recap).length, r.length), 'intro or outro': share(r.filter(x => x.intro || x.outro).length, r.length), 'titles with any': share([...t].filter(id => r.some(x => x.id === id && (x.intro || x.outro))).length, t.size) }
  })
  console.log('\nIntroDB, by IMDb id (episodes: 2 of the first season, 3 of the latest)')
  console.table(out)
  const hits = rows.filter(x => x.intro || x.outro)
  console.log(`latency p50 ${pct(rows.map(x => x.ms), 0.5)} ms, p95 ${pct(rows.map(x => x.ms), 0.95)} ms, errors ${rows.filter(x => x.err).length}; submissions per hit p50 ${pct(hits.map(x => x.subs), 0.5)}, hits with a single submission ${share(hits.filter(x => x.subs <= 1).length, hits.length)}`)
}

const run = (args, timeout) => new Promise(resolve => execFile(FFMPEG, args, { timeout, maxBuffer: 1e7 }, (err, out, text) => resolve(text || '')))

// What the release itself carries: chapter titles, and its length.
async function probeReleases (server) {
  const F = fribb()
  const gold = (await goldSet('core')).filter(g => g.kind !== 'movie' && !g.movie)
  const rows = []
  for (const g of gold) {
    const body = g.kind === 'anime' ? { type: 'anime', id: `al:${g.al}`, season: 1, episode: g.ep } : { type: 'series', id: g.imdb, season: g.season, episode: g.episode }
    const row = { title: g.title.slice(0, 28), ep: g.kind === 'anime' ? g.ep : `S${g.season}E${g.episode}` }
    let st
    try {
      st = (await req(`${server}/api/play`, { method: 'POST', json: body, timeout: 30000 })).body
      for (let i = 0; i < 40 && st && !(st.fileIdx != null && st.readable > 4e6); i++) { await sleep(1500); st = (await req(`${server}/api/status/${st.hash}`)).body || st }
      if (!(st?.fileIdx != null && st.readable > 4e6)) { rows.push({ ...row, got: false }); continue }
      const text = await run(['-hide_banner', '-nostdin', '-i', `${server}/raw/${st.hash}/${st.fileIdx}`], 60000)
      const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(text); const length = dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : 0
      const chapters = [...text.matchAll(/Chapter #\d+:\d+: start ([\d.]+), end ([\d.]+)\s+Metadata:\s+title\s+: (.*)/g)].map(m => ({ s: +m[1], e: +m[2], title: m[3].trim() }))
      const marked = chapters.filter(c => MARK.test(c.title))
      const mal = g.kind === 'anime' ? F.get(g.al)?.mal_id : null
      let sk = null
      if (mal) { const any = await aniskip(mal, g.ep); const l = any.by.op?.episodeLength || any.by.ed?.episodeLength; sk = { has: !!(any.by.op || any.by.ed), delta: l ? Math.abs(l - length) : null, exact: l ? await aniskip(mal, g.ep, Math.round(length)).then(o => !!(o.by.op || o.by.ed)) : null } }
      rows.push({ ...row, got: true, chapters: chapters.length, marked: marked.length, titles: marked.map(c => c.title).join(', ').slice(0, 40), length: Math.round(length), aniskip: sk?.has ?? '-', 'length delta s': sk?.delta?.toFixed(1) ?? '-', 'accepted at file length': sk?.exact ?? '-' })
    } catch (e) { rows.push({ ...row, got: false, err: e.message }) } finally { if (st?.hash) await req(`${server}/api/library/${st.hash}`, { method: 'DELETE' }) }
  }
  console.log('\nReleases through the app')
  console.table(rows)
  const got = rows.filter(r => r.got)
  console.log(`probed ${got.length} of ${rows.length}; with any chapters ${share(got.filter(r => r.chapters).length, got.length)}; with an intro/outro/credits-like chapter ${share(got.filter(r => r.marked).length, got.length)}`)
  const sk = got.filter(r => r.aniskip === true)
  if (sk.length) console.log(`anime with an AniSkip entry: ${sk.length}; recorded length within 2 s of the file: ${share(sk.filter(r => +r['length delta s'] <= 2).length, sk.length)}, within 10 s: ${share(sk.filter(r => +r['length delta s'] <= 10).length, sk.length)}; accepted when asked at the file's own length: ${share(sk.filter(r => r['accepted at file length'] === true).length, sk.length)}`)
}

export default async function skips (args) {
  const per = +args.per || 40
  await animeCoverage(per)
  await seriesCoverage(per)
  if (args.server) await probeReleases(String(args.server).replace(/\/$/, ''))
}
