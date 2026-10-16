import { parseQuality } from '../../src/sources.js'
const TIER = q => (q >= 2160 ? 2160 : q >= 1080 ? 1080 : q >= 720 ? 720 : 480)
const DUB = /\b(ita|italian|french|vff|vfq|truefrench|german|deutsch|spanish|castellano|latino|esp|russian|rus|hindi|tamil|telugu|polish|lektor|turkish|portuguese|dublado|brazilian)\b/i
const ENG = /\b(eng|english|multi|dual)\b/i
const BAD = /\b(cam|hdcam|ts|telesync|hdts|tc|telecine|screener|scr)\b/i
const REMUX = /\bremux\b|\bbd(25|50|66|100)\b|\bcomplete\.?(uhd\.)?bluray\b/i
const TARGET = { 2160: 14, 1080: 6, 720: 3, 480: 1.4 }
const feat = (r, ctx) => {
  if (r._f) return r._f
  const t = r.title; const q = r.quality ?? parseQuality(t)
  const mbps = r.size && ctx.runtimeMin ? r.size * 8 / (ctx.runtimeMin * 60) / 1e6 : 0
  return (r._f = { q, tier: TIER(q), mbps, bad: BAD.test(t), dub: DUB.test(t) && !ENG.test(t), remux: REMUX.test(t), hevc: /x265|hevc|h\.?265|av1/i.test(t), pack: !!r.pack && r.fileIdx == null })
}
export function rank (list, ctx) {
  const forced = ctx.prefer && ctx.prefer !== 'auto' ? +ctx.prefer : 0
  const mode = ctx.mode || 'balanced'
  const disp = ctx.display ? (ctx.display >= 1800 ? 2160 : ctx.display >= 1000 ? 1080 : 720) : 1080
  const cap = forced || (mode === 'compact' ? Math.min(disp, 1080) : disp)
  const line = ctx.mbps ? ctx.mbps * 0.7 : 0
  const F = list.map(r => [r, feat(r, ctx)])
  const stages = [ // each stage relaxes the previous gates
    ([r, f]) => r.seeders >= 5 && !f.bad && !f.dub && !f.pack && (!f.mbps || !line || f.mbps <= line) && (mode === 'lossless' || !f.remux || forced) && !r.wrongSeason,
    ([r, f]) => r.seeders >= 3 && !f.bad && !f.dub && !r.wrongSeason && (!f.mbps || !line || f.mbps <= line * 1.3),
    ([r, f]) => r.seeders >= 1 && !f.bad
  ]
  let pool = []
  for (const g of stages) { pool = F.filter(g); if (pool.length) break }
  if (!pool.length) pool = F
  const best = Math.max(...pool.map(([, f]) => f.tier <= cap ? f.tier : 0))
  const want = forced || (best || Math.min(...pool.map(([, f]) => f.tier)))
  const sc = ([r, f]) => {
    let s = -Math.abs(Math.log2(f.tier / want)) * 100 // resolution fit dominates
    if (f.tier > cap && !forced) s -= 150
    s += Math.min(Math.log2(r.seeders + 1) * 6, 40)
    if (f.mbps && mode !== 'lossless') { const tgt = (TARGET[f.tier] ?? 8) * (mode === 'compact' ? 0.6 : 1) / (f.hevc ? 0.6 : 1); const x = f.mbps / tgt; if (x > 1.3) s -= Math.min(60, (x - 1.3) * 25) }
    if (f.remux) s += mode === 'lossless' ? 25 : -40
    if (f.hevc) s += mode === 'compact' ? 8 : -4; else s += 4
    if (f.pack) s -= 25
    return s
  }
  return pool.map(x => [x, sc(x)]).sort((a, b) => b[1] - a[1]).map(([[r]]) => r).concat(F.filter(x => !pool.includes(x)).map(([r]) => r))
}
export default { id: 'gates', rank }
