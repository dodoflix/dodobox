import * as engine from './engine.js'
import { measured, score } from './sources.js'
import { log } from './log.js'

const FLOOR = 250e3 // bytes/s: slower than this cannot carry even a small video
const CEIL = 1.2e6
const BASE_MS = 6500
const MAX_MS = 20000
const CLIMB_POLLS = 6 // polls are 500 ms apart

// Versions in a race are an implementation detail: the library and the download slots do not count them.
export const racing = new Set()

// Seeder counts say little about real speed, so the best few versions race for a moment.
// A slow line leaves little room for rivals to share, so only two race there.
export const rivalsOf = (list, first, ctx) => list.filter(s => s.seeders > 0 && !s.wrongSeason && score(s, ctx) >= score(first, ctx) - 45).slice(0, ctx.mbps && ctx.mbps < 15 ? 2 : 3)

// Speed a version has to show to count as fast: its own bitrate with some room, but never more than the line can give
// each rival at once (the line is shared while they race).
const needOf = (r, ctx, n) => {
  const bitrate = r.size ? r.size / ((ctx.runtimeMin || 100) * 60) : CEIL
  return Math.max(FLOOR, Math.min(bitrate * 1.3, CEIL, ctx.mbps ? ctx.mbps * 125e3 * 0.8 / n : CEIL))
}

// Waits for a rival to show it can sustain playback. Over a slow or distant link all rivals look alike for the first
// seconds (handshakes and slow start), so the race keeps going while any is still metadata-less or speeding up.
export async function race (rivals, start, ctx = {}, { status = engine.status, remove = engine.remove, wait = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const t0 = Date.now()
  rivals.forEach(r => { racing.add(r.infoHash); start(r) })
  const speedOf = r => { const st = status(r.infoHash, true); return st ? { bps: st.speed, got: st.downloaded, phase: st.phase } : { bps: 0, got: 0, phase: 'metadata' } }
  const rank = (a, b) => (b.got + b.bps * 3) - (a.got + a.bps * 3)
  let winner = null
  const hist = [] // speeds seen at each poll: over a distant link a rival is judged by how fast it is still climbing
  while (!winner) {
    await wait(500)
    const t = Date.now() - t0
    const seen = rivals.map(r => ({ r, ...speedOf(r) }))
    const fast = seen.filter(x => x.bps >= needOf(x.r, ctx, rivals.length) || x.got >= 3e6)
    if (t >= 2500 && fast.length && (fast.some(x => x.r === rivals[0]) || t >= 4500)) winner = fast.sort(rank)[0].r
    else if (t >= BASE_MS && (t >= MAX_MS || !seen.some((x, i) => x.phase === 'metadata' || x.bps > (hist[hist.length - CLIMB_POLLS]?.[i] ?? 0) * 1.25))) break
    hist.push(seen.map(x => x.bps))
  }
  const seen = rivals.map(r => ({ r, ...speedOf(r) }))
  // A version that has not even fetched its metadata says nothing about its speed: it is not remembered as slow.
  for (const x of seen) if (x.phase !== 'metadata') measured.set(x.r.infoHash, { bps: x.bps, at: Date.now() })
  log.debug('race', 'result', { ms: Date.now() - t0, rivals: seen.map(x => `${x.r.infoHash.slice(0, 8)}:${Math.round(x.bps / 1e3)}kB/s:${Math.round(x.got / 1e3)}kB`).join(' ') })
  winner ||= seen.filter(x => x.phase !== 'metadata').sort(rank)[0]?.r || rivals[0]
  for (const r of rivals) if (r !== winner && status(r.infoHash, true)?.phase !== 'done') await remove(r.infoHash).catch(e => log.debug('race', 'dropping a losing version failed', { err: e }))
  rivals.forEach(r => racing.delete(r.infoHash))
  return winner
}
