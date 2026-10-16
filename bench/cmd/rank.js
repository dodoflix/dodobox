// Ranking: does the top result suit the viewer? Uses the rows `sources --set core` stored for movies and series.
// The oracle below is written from the product rules (seeded, not a cam, not another language, fits the line, right
// resolution for the screen), so it favours a ranker built on the same rules: read the speed column with more trust.
import { parseQuality } from '../../src/sources.js'
import { sourcesRaw } from '../lib/store.js'
import repo from '../candidates/rank-repo.js'
import gates from '../candidates/rank-gates.js'

const RUNTIME = { tt0133093: 136, tt15398776: 180, tt15239678: 166, tt6751668: 132, tt0034583: 102, tt1375666: 148, tt1160419: 155, tt9362722: 140 }
const SCENARIOS = {
  'unknown line, 1080 screen': { mbps: 0, display: 1080, mode: 'balanced' },
  'line 15 Mbps': { mbps: 15, display: 1080, mode: 'balanced' },
  'line 100 Mbps, 4K screen': { mbps: 100, display: 2160, mode: 'balanced' },
  'line 8 Mbps, compact': { mbps: 8, display: 1080, mode: 'compact' },
  'line 200 Mbps, lossless 4K': { mbps: 200, display: 2160, mode: 'lossless' },
  'forced 720, line 50 Mbps': { mbps: 50, display: 1080, mode: 'balanced', prefer: '720' },
  'line 4 Mbps': { mbps: 4, display: 1080, mode: 'balanced' }
}
const BAD = /\b(cam|hdcam|ts|telesync|hdts|tc)\b/i
const DUB = /\b(ita|italian|french|german|deutsch|spanish|latino|castellano|russian|rus|hindi|polish|turkish|portuguese|dublado)\b/i
const ENG = /\b(eng|english|multi|dual)\b/i
const tier = q => (q >= 2160 ? 2160 : q >= 1080 ? 1080 : q >= 720 ? 720 : 480)

function acceptable (r, ctx, runtime) {
  const q = tier(r.quality); const mbps = r.size && !r.pack ? r.size * 8 / (runtime * 60) / 1e6 : 0
  if (r.seeders < 5 || BAD.test(r.title) || (DUB.test(r.title) && !ENG.test(r.title))) return false
  if (r.pack && r.fileIdx == null) return false
  if (/\bremux\b/i.test(r.title) && ctx.mode !== 'lossless' && !ctx.prefer) return false
  if (ctx.mbps && mbps && mbps > ctx.mbps * 0.7) return false
  if (ctx.prefer) return q === +ctx.prefer
  return q <= (ctx.display >= 1800 ? 2160 : 1080) && (ctx.mode !== 'compact' || q <= 1080)
}

export default async function rank () {
  const tio = sourcesRaw('core').find(p => p.id === 'torrentio')
  const items = tio.per.filter(x => x.g.kind !== 'anime').map(x => ({
    g: x.g, runtime: x.g.kind === 'movie' ? RUNTIME[x.g.imdb] : 45,
    rows: x.rows.map(r => ({ ...r, quality: parseQuality(`${r.release} ${r.title}`), pack: x.g.kind === 'series' && r.release !== r.title }))
  }))
  const out = []
  for (const R of [repo, gates]) for (const [name, base] of Object.entries(SCENARIOS)) {
    let n = 0; let ok = 0; let tierOk = 0; let ms = 0
    for (const it of items) {
      const ctx = { ...base, runtimeMin: it.runtime, kind: it.g.kind, year: it.g.year }
      const acc = it.rows.filter(r => acceptable(r, ctx, it.runtime)); if (!acc.length) continue
      n++
      const t0 = performance.now(); const top = R.rank(it.rows.map(r => ({ ...r })), ctx)[0]; ms += performance.now() - t0
      if (!acceptable(top, ctx, it.runtime)) continue
      ok++
      if (ctx.prefer || tier(top.quality) === Math.max(...acc.map(r => tier(r.quality)))) tierOk++
    }
    out.push({ ranker: R.id, scenario: name, titles: n, 'top-1 acceptable': `${ok}/${n}`, 'best resolution': `${tierOk}/${n}`, 'ms per rank': (ms / n).toFixed(2) })
  }
  console.table(out)
}
