import * as engine from '../../src/engine.js'
import * as S from '../../src/sources.js'

// Before the slow-link work: a 25 MB / 15 s speed probe (a line under ~13 Mbps reads as unknown), three rivals,
// a fixed 6.5 s race with absolute thresholds, and zero speeds remembered as dead.
async function race (rivals, start) {
  const t0 = Date.now()
  rivals.forEach(r => start(r))
  const speedOf = r => { const st = engine.status(r.infoHash, true); return st ? { bps: st.speed, got: st.downloaded, phase: st.phase } : { bps: 0, got: 0 } }
  let winner = null
  while (!winner && Date.now() - t0 < 6500) {
    await new Promise(r => setTimeout(r, 500))
    const t = Date.now() - t0
    const seen = rivals.map(r => ({ r, ...speedOf(r) }))
    const fast = seen.find(x => x.bps >= 1.2e6 || x.got >= 3e6)
    if (t >= 2500 && fast && (fast.r === rivals[0] || t >= 4500)) winner = seen.filter(x => x.bps >= 1.2e6 || x.got >= 3e6).sort((a, b) => (b.got + b.bps * 3) - (a.got + a.bps * 3))[0].r
  }
  const seen = rivals.map(r => ({ r, ...speedOf(r) }))
  for (const x of seen) S.measured.set(x.r.infoHash, { bps: x.bps, at: Date.now() })
  winner ||= seen.sort((a, b) => (b.got + b.bps * 3) - (a.got + a.bps * 3))[0].bps ? seen[0].r : rivals[0]
  for (const r of rivals) if (r !== winner && engine.status(r.infoHash, true)?.phase !== 'done') await engine.remove(r.infoHash).catch(() => {})
  return winner
}

export default {
  id: 'base',
  lineMbps: line => (line >= 13.3 ? line : 0),
  rank: (list, ctx) => S.rank(list, ctx),
  rivalsOf: (list, first, ctx) => list.filter(s => s.seeders > 0 && !s.wrongSeason && S.score(s, ctx) >= S.score(first, ctx) - 45).slice(0, 3),
  race
}
