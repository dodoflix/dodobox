// Auto sync: how much audio, in how many windows, and from where in the file does it take to fix a subtitle?
//   --win a,b      window lengths in seconds (default 45,60,90,120,180)   --count a,b  windows per sync (default 1,2,3)
//   --place a,b    start (first 10 min downloaded), resume (5 min around the playhead only), full (default all three)
//   --files n      real subtitle timings used as the speech (default 6)   --noise a,b  clean,music,action (default all)
//   --verbose      print the trials that came out wrong
//   --grow         the download grows (readable 2 min, 3 min ... 15 min, viewer at 1:40): the previous all-or-nothing pass run again at
//                  each size against the incremental pass that keeps earlier windows; an answer counts as
//                  right when the next few minutes of subtitles, from 1:40, are within 0.5 s
//   --media a,b    real films instead (`video::subtitle.vtt::seconds` uses that subtitle file and only the first seconds of a partly downloaded video): the audio of each video file is read with ffmpeg and its first text subtitle track
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
import fs from 'node:fs'
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

async function realFilm (spec) {
  const [file, vttFile, avail] = spec.split('::')
  const film = avail ? +avail : +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' })
  for (let i = 0; i < 8; i++) {
    let vtt
    try { vtt = vttFile ? fs.readFileSync(vttFile, 'utf8') : execFileSync(FFMPEG, ['-v', 'error', '-i', file, '-map', `0:s:${i}`, '-f', 'webvtt', '-'], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }) } catch { continue }
    const cues = parseCues(vtt).filter(c => c.e > c.s)
    if (cues.length < 100) continue
    const ref = await syncSubtitle({ url: file, duration: film, cues, win: 180, count: 3 }).catch(() => null)
    const ds = ref?.points?.map(p => p.d).sort((a, b) => a - b)
    if (!ref || ref.none || ref.ratio !== 1 || ref.confidence < 0.5 || ds.at(-1) - ds[0] > 0.8) break
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

// One trial: the subtitle (shifted by d, optionally converted between frame rates), the audio it is judged against.
function makeTrial (f, fi, kind, vi, real, { realistic, other } = {}) {
  const seed = fi * 100 + Object.keys(NOISE).indexOf(kind) * 10 + vi + 1; const r = rng(seed)
  const truth = f.cues ?? truthOf(f, seed); const film = f.film ?? f.last + 120
  const drift = vi % 2 === 1; const ratio = drift ? 25 / 23.976 : 1
  // Downloaded subtitles are mostly in step or a few seconds out; a long offset is the exception.
  const sign = r() < 0.5 ? -1 : 1; const span = r(); const u = realistic ? r() : 0
  const d = realistic ? (u < 0.4 ? (span - 0.5) * 0.6 : u < 0.7 ? sign * (0.5 + span * 3.5) : sign * (4 + span * 21)) : sign * (0.7 + span * 24)
  // subtitle time t belongs at t * ratio + d
  // `other`: the subtitle of another episode, which no stretch of this audio should match.
  const cues = (other ?? truth).map(c => ({ s: (c.s - d) / ratio, e: (c.e - d) / ratio, t: c.t ?? 'x' }))
  const voiced = truth.map(c => ({ s: c.s + 0.05 + r() * 0.25, e: c.e - 0.05 }))
  const spent = { secs: 0 }
  const signalAt = real ? async (ws, len) => { spent.secs += len; return speechStrength(await pcm(f.url, ws, len)) } : (ws, len) => { spent.secs += len; return speechStrength(audio(voiced, ws, len, kind, seed + Math.round(ws))) }
  // The answer's worst error against the truth over the film.
  // Worst error over the film times from..to (the whole film unless told otherwise).
  const error = (res, from = 0, to = film) => {
    let worst = 0
    for (let k = 0; k < 30; k++) { const at = from + ((to - from) * (k + 0.5)) / 30; worst = Math.max(worst, Math.abs(mapTime(res, (at - d) / ratio) - at)) }
    return worst
  }
  return { seed, film, ratio, d, cues, signalAt, spent, error, name: f.name ?? f.title }
}
const answered = res => res && !res.none && res.confidence >= 0.35

async function grow (files, kinds, real, verbose) {
  const stages = [120, 180, 240, 300, 420, 600, 900]
  const policies = { previous: { step: 1, carry: false }, incremental: { step: 0.5, carry: true } }
  const names = Object.keys(policies)
  const zero = () => stages.map(() => ({ n: 0, right: 0, wrong: 0, secs: 0 }))
  // match: the subtitle belongs to the video. mismatch: it is another episode's, so any answer is wrong.
  const tally = { match: Object.fromEntries(names.map(k => [k, zero()])), mismatch: Object.fromEntries(names.map(k => [k, zero()])) }
  const first = Object.fromEntries(names.map(k => [k, []])); let trials = 0
  for (const [fi, f] of files.entries()) for (const kind of kinds) for (let vi = 0; vi < (real ? 6 : 2); vi++) for (const mode of ['match', 'mismatch']) {
    const f2 = files[(fi + 1) % files.length]
    if (mode === 'mismatch' && (files.length < 2 || vi > 1)) continue
    if (mode === 'match') trials++
    for (const name of names) {
      const pol = policies[name]
      const t = makeTrial(f, fi, kind, vi, real, { realistic: true, other: mode === 'mismatch' ? (f2.cues ?? truthOf(f2, fi + 7)) : undefined }); let prior; let firstRight = null
      for (const [si, R] of stages.entries()) {
        if (R > t.film) break
        t.spent.secs = 0
        const res = await syncSubtitle({ url: 'unused', duration: t.film, ranges: [[0, R]], near: 100, cues: t.cues, signalAt: t.signalAt, step: pol.step, prior: pol.carry ? prior : undefined }).catch(() => null)
        if (pol.carry && res) prior = res
        const c = tally[mode][name][si]; c.n++; c.secs += t.spent.secs
        // What the viewer sees: from the playhead to five minutes ahead (or as far as is downloaded).
        const ok = mode === 'mismatch' ? !answered(res) : answered(res) && t.error(res, 100, Math.min(R, 400)) <= 0.5
        if (answered(res)) { if (mode === 'mismatch' || !ok) c.wrong++; else c.right++ }
        if (mode === 'match' && ok && answered(res) && firstRight == null) firstRight = R
        if (verbose && answered(res) && !ok) console.log(`  ${name} wrong at ${R} s (${mode}): ${t.name} trial ${vi} d ${t.d.toFixed(2)} ratio ${t.ratio.toFixed(3)} -> ${res.model} ${JSON.stringify(res.points.map(p => [Math.round(p.t), +p.d.toFixed(2), +p.z.toFixed(1), +p.peak.toFixed(2)]))}`)
      }
      if (mode === 'match' && firstRight != null) first[name].push(firstRight)
    }
  }
  const pct = (x, n) => `${(100 * x / n).toFixed(0)}%`.padStart(4)
  for (const mode of ['match', 'mismatch']) {
    console.log(mode === 'match' ? '\nThe subtitle belongs to the video: share right / wrong (the rest gave no answer), audio read per pass' : '\nThe subtitle is another episode\'s: share that got an answer anyway (all wrong)')
    console.log('readable ' + names.map(k => k.padStart(mode === 'match' ? 22 : 13)).join(''))
    for (const [si, R] of stages.entries()) {
      if (!tally[mode][names[0]][si].n) continue
      console.log(`${String(R).padStart(6)} s ` + names.map(k => { const c = tally[mode][k][si]; return mode === 'match' ? `${pct(c.right, c.n)} /${pct(c.wrong, c.n)} ${(c.secs / c.n).toFixed(0).padStart(4)} s  `.padStart(22) : `${pct(c.wrong, c.n)}`.padStart(13) }).join(''))
    }
  }
  const med = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
  console.log()
  for (const k of names) console.log(`${k.padEnd(11)} first right answer at ${med(first[k])} s readable (median), reached in ${first[k].length}/${trials} trials`)
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
  if (args.grow) return grow(files, kindsUsed, !!real, !!args.verbose)
  console.log('place   win count  right  wrong  none  p90 err   audio read  ms/sync')
  for (const place of where) for (const win of wins) for (const count of counts) {
    let right = 0; let wrong = 0; let none = 0; let read = 0; let ms = 0; let n = 0; const errs = []
    for (const [fi, f] of files.entries()) for (const kind of kindsUsed) for (let vi = 0; vi < (real ? 6 : 2); vi++) {
      const t = makeTrial(f, fi, kind, vi, !!real)
      const { ranges, at } = places(t.film, t.seed)[place]
      const t0 = performance.now()
      const res = await syncSubtitle({ url: 'unused', duration: t.film, ranges, near: at, cues: t.cues, win, count, signalAt: t.signalAt }).catch(() => null)
      ms += performance.now() - t0; read += t.spent.secs; n++
      if (!answered(res)) { none++; continue }
      const worst = t.error(res)
      errs.push(worst)
      worst <= 0.5 ? right++ : wrong++
      if (args.verbose && worst > 0.5) console.log(`  wrong: ${t.name} trial ${vi} ratio ${t.ratio.toFixed(3)} d ${t.d.toFixed(2)} -> ${res.model} ratio ${res.ratio.toFixed(3)} conf ${res.confidence.toFixed(2)} ${JSON.stringify((res.points ?? []).map(p => [Math.round(p.t), +p.d.toFixed(2), +p.z.toFixed(1)]))}`)
    }
    errs.sort((a, b) => a - b)
    const pct = x => `${(100 * x / n).toFixed(0)}%`.padStart(5)
    console.log(`${place.padEnd(7)} ${String(win).padStart(3)} ${String(count).padStart(5)}  ${pct(right)}  ${pct(wrong)} ${pct(none)}  ${errs.length ? (errs[Math.floor(errs.length * 0.9)]).toFixed(2).padStart(6) + 's' : '     -'}  ${(read / n).toFixed(0).padStart(7)} s  ${(ms / n).toFixed(0).padStart(7)}`)
  }
}
