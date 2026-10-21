// Subtitle ranking: does the top pick suit the playing release? Uses movies and series from the core gold set.
//   --snapshot   ask the providers and download the files (network), store cue timings in snapshots/subs.json.gz
//   --langs a,b  languages to snapshot (default eng,tur,spa)   --keep n  files kept per title and language (default 14)
//   --weights j  score with these weights over the shipped ones, e.g. '{"dl":0.5}'
//   --grid       search ranking weights on the snapshot and print the best set
// Without flags: compare the shipped scorer with the previous one on the stored snapshot (offline).
//
// No file is labelled, so the oracle is leave-one-out. Take one file X as "the file for the release being played" (every file
// is uploaded for some release and synced to it). A candidate is acceptable for X when it is intrinsically sound (enough cues,
// reaches the end, clean text, not full of sound-effect lines) and its cue times agree with X's. The ranker sees X's release
// name only, never its timings. The caveat is the one `rank` has: the oracle and the ranker share the idea that a similar
// release name means a similar cut, so the numbers are indicative.
import { goldSet, readSnapshot, writeSnapshot, cacheFile } from '../lib/store.js'
import { sleep } from '../lib/net.js'

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const HI_LINE = /\[[^\]]{2,}\]|^\(.{2,}\)$|♪/

async function snapshot (args) {
  const { addon, rest, fetchSubtitle } = await import('../../src/subs.js')
  const { parseCues } = await import('../../src/sync.js')
  const langs = (args.langs || 'eng,tur,spa').split(',')
  const keep = +args.keep || 14
  let out = []
  try { out = readSnapshot('subs') } catch {} // resumes: a title and language already stored is skipped
  const done = new Set(out.map(c => `${c.imdb}|${c.lang}`))
  let failed = 0
  for (const g of (await goldSet('core')).filter(g => g.kind !== 'anime')) {
    const q = { type: g.kind, id: g.imdb, season: g.season, episode: g.episode, titles: [g.title] }
    const found = [...(await addon(q).catch(() => [])), ...(await rest(q, langs).catch(() => []))].filter(c => langs.includes(c.lang))
    for (const lang of langs) {
      if (done.has(`${g.imdb}|${lang}`)) continue
      const seen = new Set()
      const list = found.filter(c => c.lang === lang && !c.forced && !seen.has(c.url) && seen.add(c.url)).sort((a, b) => b.dl - a.dl).slice(0, keep)
      for (const c of list) {
        if (failed >= 15) { console.error('downloads failing 15 times in a row: quota or outage, stopping'); return finish(out) }
        try {
          const cues = parseCues(await fetchSubtitle(c.url, c.enc))
          failed = 0
          if (!cues.length) continue
          const text = cues.map(x => x.t).join('\n')
          out.push({ title: g.title, kind: g.kind, imdb: g.imdb, ...c, n: cues.length, last: cues.at(-1).e,
            fffd: (text.match(/�/g) || []).length / text.length, hi: c.hi || undefined, hiText: cues.filter(x => HI_LINE.test(x.t)).length / cues.length,
            starts: cues.map((x, i) => Math.round(x.s * 10) - (i ? Math.round(cues[i - 1].s * 10) : 0)) })
        } catch { failed++ }
        await sleep(300)
      }
      process.stderr.write(`${g.title} ${lang} ${list.length}\n`)
    }
  }
  finish(out)
}
const finish = out => { writeSnapshot('subs', out); console.log(`${out.length} files stored`) }

const abs = c => { let t = 0; return c.starts.map(d => (t += d) / 10) }
// Share of a's cue starts that sit within 0.5 s of one of b's: 1 for the same timing, near chance (about 0.2) for another cut.
function agree (a, b) {
  const A = abs(a); const B = abs(b); let hit = 0; let j = 0
  for (const t of A) { while (j < B.length - 1 && B[j] < t - 0.5) j++; if (Math.abs(B[j] - t) <= 0.5) hit++ }
  return hit / A.length
}
// What a sound file of this language looks like, from its siblings.
function sound (c, sibs) {
  const n = median(sibs.map(x => x.n)); const last = median(sibs.map(x => x.last))
  return c.n >= n * 0.6 && c.last >= last * 0.8 && c.fffd < 0.005 && c.hiText < 0.04
}

// Playing releases: the most downloaded files of each title and language. Candidates: the others of that group.
function cases (data, perGroup = 4) {
  const groups = Map.groupBy(data, c => `${c.imdb}|${c.lang}`)
  const out = []
  for (const g of groups.values()) {
    if (g.length < 6) continue
    const ok = g.filter(c => sound(c, g))
    for (const x of ok.sort((a, b) => b.dl - a.dl).slice(0, perGroup)) {
      const pool = g.filter(c => c !== x)
      const good = new Set(pool.filter(c => sound(c, g) && agree(c, x) >= 0.6))
      if (good.size) out.push({ x, pool, good, lang: x.lang, kind: x.kind })
    }
  }
  return out
}

function evaluate (cs, ranker, w) {
  let top = 0; let ms = 0; let rr = 0
  for (const k of cs) {
    const t0 = performance.now()
    const r = ranker.rank(k.pool, k.x.rel, [k.lang], w)
    ms += performance.now() - t0
    if (k.good.has(r[0])) top++
    rr += 1 / (1 + r.findIndex(c => k.good.has(c)))
  }
  return { top, mrr: rr / cs.length, ms: ms / cs.length }
}

// Leave-one-title-out: weights are fitted on the other titles and scored on the one left out, so the number is not the fit's own.
function grid (cs, repo) {
  const fit = set => {
    let best
    for (const sim of [0, 1, 2, 3, 5, 8]) for (const dl of [0, 0.5, 1, 2]) for (const rating of [0, 0.2, 0.5]) for (const hi of [0, 3, 6]) for (const trusted of [0, 1, 2]) for (const fpsOdd of [0, 1, 3]) {
      const w = { ...repo.W, sim, dl, rating, hi, trusted, fpsOdd }
      const e = evaluate(set, repo, w)
      if (!best || e.top > best.e.top || (e.top === best.e.top && e.mrr > best.e.mrr)) best = { w, e }
    }
    return best
  }
  let cv = 0
  for (const t of new Set(cs.map(k => k.x.title))) {
    const w = fit(cs.filter(k => k.x.title !== t)).w
    cv += evaluate(cs.filter(k => k.x.title === t), repo, w).top
  }
  const all = fit(cs)
  console.log(`held-out top-1 ${cv}/${cs.length}; fitted on everything ${all.e.top}/${cs.length}`)
  console.log(JSON.stringify(all.w))
}

export default async function subs (args) {
  process.env.DATA_DIR ??= cacheFile('subs-data')
  if (args.snapshot) return snapshot(args)
  const legacy = (await import('../candidates/subs-legacy.js')).default
  const repo = (await import('../candidates/subs-repo.js')).default
  const data = readSnapshot('subs')
  const cs = cases(data)
  if (args.grid) return grid(cs, repo)
  const rows = []
  for (const [name, set] of [['all', cs], ...[...new Set(cs.map(k => k.lang))].map(l => [l, cs.filter(k => k.lang === l)]), ['movie', cs.filter(k => k.kind === 'movie')], ['series', cs.filter(k => k.kind === 'series')]]) {
    for (const R of [legacy, repo]) {
      const e = evaluate(set, R, R === repo && args.weights ? { ...repo.W, ...JSON.parse(args.weights) } : undefined)
      rows.push({ ranker: R.id, group: name, cases: set.length, 'top-1 acceptable': `${e.top}/${set.length}`, 'share': (e.top / set.length).toFixed(2), mrr: e.mrr.toFixed(3), 'ms per rank': e.ms.toFixed(3) })
    }
  }
  const base = cs.reduce((n, k) => n + k.good.size / k.pool.length, 0) / cs.length
  console.log(`${data.length} files, ${cs.length} cases; a random pick is acceptable ${(base * 100).toFixed(0)}% of the time`)
  console.table(rows)
}
