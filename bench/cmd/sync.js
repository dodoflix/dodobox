// Auto sync: how much audio, in how many windows, and from where in the file does it take to fix a subtitle?
//   --win a,b      window lengths in seconds (default 45,60,90,120,180)   --count a,b  windows per sync (default 1,2,3)
//   --place a,b    start (first 10 min downloaded), resume (5 min around the playhead only), full (default all three)
//   --files n      real subtitle timings used as the speech (default 6)   --noise a,b  clean,music,action (default all)
//   --verbose      print the trials that came out wrong
//   --media a,b    real films instead: the audio of each video file is read with ffmpeg and its first text subtitle track
//                  is the truth that gets shifted and warped; a track is rarely timed to the frame, so its own offset against the
//                  audio (a full-strength sync of the unshifted track) is the reference the trials are judged against
//
// No real film is bundled, so the audio is synthetic: speech bursts follow the cue times of real subtitle files from
// snapshots/subs.json.gz (a syllable-rate modulated voice with a random pitch and level per cue), over a music bed and
// sound-effect bursts whose loudness depends on the noise case. The stretch of audio goes through the shipped
// speechStrength() and syncSubtitle(), so the signal processing, the search and the window logic are the real ones;
// what is not real is the sound itself. Real mixes are harder than "clean" and easier than "action" in most films.
// A sync counts as right when the subtitle times it produces are within 0.5 s of the truth across the film, wrong when it
// answers with confidence >= 0.35 (the player's own threshold) and is off by more, and none when it gives up.
import { execFileSync } from 'node:child_process'
import { readSnapshot } from '../lib/store.js'
import { syncSubtitle, speechStrength, parseCues, pcm } from '../../src/sync.js'
import { FFMPEG } from '../../src/bin.js'
import { mapTime } from '../../public/js/syncmap.js'

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
const RATE = 16000
const NOISE = { clean: { music: 0, sfx: 1 / 40, floor: 250 }, music: { music: 3500, sfx: 1 / 40, floor: 400 }, action: { music: 2200, sfx: 1 / 6, floor: 600 } }

function truthOf (file, seed) {
  const r = rng(seed); const out = []
  for (let i = 0; i < file.starts.length; i++) {
    const s = file.starts.slice(0, i + 1).reduce((a, b) => a + b, 0) / 10
    out.push({ s, e: s + 0.8 + r() * 2.7 })
  }
  for (let i = 0; i < out.length - 1; i++) out[i].e = Math.min(out[i].e, out[i + 1].s - 0.05)
  return out.filter(c => c.e > c.s + 0.3)
}

// Audio of [ws, ws + len) of a film whose speech is `bursts`.
function audio (bursts, ws, len, kind, seed) {
  const r = rng(seed); const n = Math.round(len * RATE); const x = new Float64Array(n); const cfg = NOISE[kind]
  for (let i = 0; i < n; i++) x[i] = (r() - 0.5) * 2 * cfg.floor
  if (cfg.music) {
    const f = [220, 277, 330, 440].map(q => q * (0.97 + r() * 0.06))
    for (let i = 0; i < n; i++) { const t = (ws * RATE + i) / RATE; x[i] += cfg.music * (0.6 + 0.4 * Math.sin(t * 0.3)) * f.reduce((a, q) => a + Math.sin(2 * Math.PI * q * t), 0) / 4 }
  }
  for (const b of bursts) {
    if (b.e < ws || b.s > ws + len) continue
    const f0 = 100 + (b.s * 7919 % 120); const amp = 3000 + (b.s * 104729 % 6000)
    for (let i = Math.max(0, Math.floor((b.s - ws) * RATE)); i < Math.min(n, Math.ceil((b.e - ws) * RATE)); i++) {
      const t = (ws * RATE + i) / RATE
      x[i] += amp * (0.55 + 0.45 * Math.sin(2 * Math.PI * (3.5 + (b.s % 1.5)) * (t - b.s))) * (Math.sin(2 * Math.PI * f0 * 3 * t) + 0.6 * Math.sin(2 * Math.PI * f0 * 7 * t) + 0.4 * Math.sin(2 * Math.PI * f0 * 11 * t)) / 2
    }
  }
  for (let at = -Math.log(r()) / cfg.sfx; at < len; at += -Math.log(r()) / cfg.sfx) {
    for (let i = Math.floor(at * RATE), end = Math.min(n, i + Math.floor((0.2 + r() * 1.6) * RATE)); i < end; i++) x[i] += (r() - 0.5) * 24000
  }
  const pcm = new Int16Array(n); for (let i = 0; i < n; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(x[i])))
  return Buffer.from(pcm.buffer)
}

async function realFilm (file) {
  const film = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  for (let i = 0; i < 8; i++) {
    let vtt
    try { vtt = execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', `0:s:${i}`, '-f', 'webvtt', '-'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { continue }
    const cues = parseCues(vtt).filter(c => c.e > c.s)
    if (cues.length < 100) continue
    const ref = await syncSubtitle({ url: file, duration: film, cues, win: 180, count: 3 }).catch(() => null)
    const ds = ref?.points.map(p => p.d).sort((a, b) => a - b)
    if (!ref || ref.ratio !== 1 || ref.confidence < 0.5 || ds.at(-1) - ds[0] > 0.8) break
    const d = ds[Math.floor(ds.length / 2)]
    return { name: file.split('/').pop().slice(0, 40), film, cues: cues.map(c => ({ ...c, s: c.s + d, e: c.e + d })), url: file }
  }
  console.error(`skipped, no text subtitle track whose windows agree on one offset: ${file}`)
  return null
}

const places = (film, seed) => {
  const at = film * (0.3 + 0.4 * rng(seed)())
  return { start: { ranges: [[0, 600]], at: 0 }, resume: { ranges: [[at - 150, at + 150]], at }, full: { ranges: [[0, film]], at: undefined } }
}

export default async function (args) {
  const list = (v, d) => (v ? String(v).split(',') : d)
  const wins = list(args.win, [45, 60, 90, 120, 180]).map(Number); const counts = list(args.count, [1, 2, 3]).map(Number)
  const where = list(args.place, ['start', 'resume', 'full']); const kinds = list(args.noise, Object.keys(NOISE))
  const seen = new Set()
  const real = args.media ? (await Promise.all(String(args.media).split(',').map(realFilm))).filter(Boolean) : null
  const files = real ?? readSnapshot('subs').filter(f => f.lang === 'eng' && f.last > 3000 && f.n > 500 && !seen.has(f.imdb) && seen.add(f.imdb)).slice(0, +args.files || 6)
  const kindsUsed = real ? ['real'] : kinds
  console.log(real ? `${real.length} real films: ${real.map(f => f.name).join(' | ')}\n` : `${files.length} subtitle timings, ${kinds.join('/')} noise\n`)
  console.log('place   win count  right  wrong  none  p90 err   audio read  ms/sync')
  for (const place of where) for (const win of wins) for (const count of counts) {
    let right = 0; let wrong = 0; let none = 0; let read = 0; let ms = 0; let n = 0; const errs = []
    for (const [fi, f] of files.entries()) for (const [ki, kind] of kindsUsed.entries()) for (const [vi, drift] of [false, true, false, true, false, true].slice(0, real ? 6 : 2).entries()) {
      const seed = fi * 100 + ki * 10 + vi + 1; const r = rng(seed)
      const truth = f.cues ?? truthOf(f, seed); const film = f.film ?? f.last + 120
      const ratio = drift ? 25 / 23.976 : 1; const d = (r() < 0.5 ? -1 : 1) * (0.7 + r() * 24)
      // subtitle time t belongs at t * ratio + d
      const cues = truth.map(c => ({ s: (c.s - d) / ratio, e: (c.e - d) / ratio, t: c.t ?? 'x' }))
      const voiced = truth.map(c => ({ s: c.s + 0.05 + r() * 0.25, e: c.e - 0.05 }))
      const { ranges, at } = places(film, seed)[place]
      let secs = 0; const t0 = performance.now()
      const signalAt = real ? async (ws, len) => { secs += len; return speechStrength(await pcm(f.url, ws, len)) } : (ws, len) => { secs += len; return speechStrength(audio(voiced, ws, len, kind, seed + Math.round(ws))) }
      const res = await syncSubtitle({ url: 'unused', duration: film, ranges, at, cues, win, count, signalAt }).catch(() => null)
      ms += performance.now() - t0; read += secs; n++
      if (!res || res.confidence < 0.35) { none++; continue }
      let worst = 0
      for (let k = 1; k <= 30; k++) { const t = (film / 31) * k / ratio; worst = Math.max(worst, Math.abs(mapTime(res, t) - (t * ratio + d))) }
      errs.push(worst)
      worst <= 0.5 ? right++ : wrong++
      if (args.verbose && worst > 0.5) console.log(`  wrong: ${f.name ?? f.title} trial ${vi} ratio ${ratio.toFixed(3)} d ${d.toFixed(2)} -> ${res.model} ratio ${res.ratio.toFixed(3)} conf ${res.confidence.toFixed(2)} ${JSON.stringify((res.points ?? []).map(p => [Math.round(p.t), +p.d.toFixed(2), +p.z.toFixed(1)]))}`)
    }
    errs.sort((a, b) => a - b)
    const pct = x => `${(100 * x / n).toFixed(0)}%`.padStart(5)
    console.log(`${place.padEnd(7)} ${String(win).padStart(3)} ${String(count).padStart(5)}  ${pct(right)}  ${pct(wrong)} ${pct(none)}  ${errs.length ? (errs[Math.floor(errs.length * 0.9)]).toFixed(2).padStart(6) + 's' : '     -'}  ${(read / n).toFixed(0).padStart(7)} s  ${(ms / n).toFixed(0).padStart(7)}`)
  }
}
