// Automatic subtitle sync: speech in the audio is cross-correlated with subtitle times in a few short windows; how the per-window offsets change reveals a constant shift, frame-rate drift or a splice.
import { spawn } from 'node:child_process'
import { Worker } from 'node:worker_threads'
import { FFMPEG } from './bin.js'
import { mapTime, classify, isLine } from '../public/js/syncmap.js'
export { mapTime, offsetAt } from '../public/js/syncmap.js'

const DT = 0.01 // seconds per frame

const toSec = t => { const p = t.replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1] }
export function parseCues (text) {
  const out = []
  for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n'); const k = lines.findIndex(l => l.includes('-->'))
    if (k < 0 || /^(NOTE|STYLE|REGION)/.test(lines[0])) continue
    const m = lines[k].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/); if (!m) continue
    const t = lines.slice(k + 1).join(' ').replace(/<[^>]*>/g, '').trim()
    if (t) out.push({ s: toSec(m[1]), e: toSec(m[2]), t })
  }
  return out.sort((a, b) => a.s - b.s)
}

// Subtitle files carry credits and ads ("Support us and become VIP member to remove all ads").
// Nobody speaks them, so they must not take part in the alignment. Site names count anywhere; the looser tell-tales (a web
// address, "subtitles by", "synced by") only count at the very start or end, where such lines live.
const AD_ANYWHERE = /opensubtitles|osdb\b|subscene|addic7ed|yifysubtitles|yts\.|podnapisi|subtitlecat|tvsubtitles|become (a )?vip|remove all ads|advertise (your|here)|rate this subtitle/i
const AD_EDGE = /\bwww\.|https?:|\.(com|org|net|io|tv|to)\b|subtitles? (by|from)|(re)?-?synced?\b.*\b(by|and corrected)|corrected by|translated (and \w+ )?by|downloaded from|encoded by|ripped by|captions? by|caption(ing)? (sponsored|provided)|fix(ed)? by/i
export function isAd (cue, end) {
  if (!cue.t) return false
  if (AD_ANYWHERE.test(cue.t)) return true
  return AD_EDGE.test(cue.t) && (cue.s < 180 || cue.e > end - 240)
}
export const withoutAds = cues => { const end = cues.length ? cues.at(-1).e : 0; return cues.filter(c => !isAd(c, end)) }

function fft (re, im, inverse) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = 2 * Math.PI / len * (inverse ? -1 : 1)
    const wr = Math.cos(ang); const wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k; const b = a + len / 2
        const xr = re[b] * cr - im[b] * ci; const xi = re[b] * ci + im[b] * cr
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

export function correlate (a, b) {
  let n = 1; while (n < a.length + b.length) n <<= 1
  const ar = new Float64Array(n); const ai = new Float64Array(n); const br = new Float64Array(n); const bi = new Float64Array(n)
  ar.set(a); br.set(b)
  fft(ar, ai); fft(br, bi)
  for (let i = 0; i < n; i++) { const r = ar[i] * br[i] + ai[i] * bi[i]; const q = ar[i] * bi[i] - ai[i] * br[i]; ar[i] = r; ai[i] = q }
  fft(ar, ai, true)
  return ar.subarray(0, b.length - a.length + 1)
}

const zeroMean = v => { let m = 0; for (const x of v) m += x; m /= v.length || 1; const o = new Float64Array(v.length); for (let i = 0; i < v.length; i++) o[i] = v[i] - m; return o }

// Offset d (seconds) such that a subtitle at t belongs at t + d, from `sig` (speech strength frames, media time ws + i*DT) against `cues`; `range` is how far either way to look. Returns { d, z } or null.
export function align (sig, ws, cues, range) {
  const R = Math.round(range / DT)
  const ind = new Float64Array(sig.length + 2 * R)
  const t0 = ws - R * DT
  for (const c of cues) {
    if (c.e < t0 || c.s > t0 + ind.length * DT) continue
    const a = Math.max(0, Math.floor((c.s - t0) / DT)); const b = Math.min(ind.length, Math.ceil((c.e - t0) / DT))
    for (let i = a; i < b; i++) ind[i] = 1
  }
  let on = 0; for (let i = 0; i < ind.length; i++) on += ind[i]
  if (on < 60) return null // fewer than a second of subtitles in this stretch
  const a = zeroMean(sig); const b = zeroMean(ind)
  const c = correlate(a, b)
  const pre = new Float64Array(b.length + 1); for (let i = 0; i < b.length; i++) pre[i + 1] = pre[i] + b[i] * b[i]
  let na = 0; for (const x of a) na += x * x
  const score = new Float64Array(c.length)
  for (let k = 0; k < c.length; k++) { const nb = pre[k + a.length] - pre[k]; score[k] = nb > 1e-9 && na > 1e-9 ? c[k] / Math.sqrt(na * nb) : 0 }
  let best = 0; for (let k = 1; k < score.length; k++) if (score[k] > score[best]) best = k
  let m = 0; let s2 = 0; let cnt = 0; const ex = Math.round(1.5 / DT)
  for (let k = 0; k < score.length; k++) if (Math.abs(k - best) > ex) { m += score[k]; cnt++ }
  m /= cnt || 1
  for (let k = 0; k < score.length; k++) if (Math.abs(k - best) > ex) s2 += (score[k] - m) ** 2
  const sd = Math.sqrt(s2 / (cnt || 1)) || 1e-9
  let frac = 0
  if (best > 0 && best < score.length - 1) { const l = score[best - 1]; const r = score[best + 1]; const den = l - 2 * score[best] + r; if (den < 0) frac = 0.5 * (l - r) / den }
  return { d: (R - (best + frac)) * DT, z: (score[best] - m) / sd, peak: score[best] }
}

export function pcm (url, start, len, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    // Lowest priority: playback and transcoding always come first.
    const args = ['-v', 'error', '-nostdin', '-threads', '1', '-ss', String(Math.max(0, start)), '-t', String(len), '-i', url, '-vn', '-sn', '-dn', '-map', '0:a:0',
      '-ac', '1', '-ar', '16000', '-af', 'highpass=f=250,lowpass=f=3500', '-f', 's16le', 'pipe:1']
    const p = process.platform === 'win32' ? spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] }) : spawn('nice', ['-n', '19', FFMPEG, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const out = []; let err = ''
    const timer = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('audio read timed out')) }, timeoutMs)
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => { err += d })
    p.on('close', code => {
      clearTimeout(timer)
      const buf = Buffer.concat(out)
      // A stretch that is not downloaded yet reads as a short or empty stream rather than an error.
      if (code === 0 && buf.length >= len * 32000 * 0.9) resolve(buf); else reject(new Error(err.trim() || `audio read too short (${buf.length} bytes, ffmpeg exit ${code})`))
    })
  })
}

// Loudness per frame in the speech band, weighted by how much the level changes from moment to moment: syllables make it jump, music and engine noise hold steady. Loudness alone is fooled by theme songs and action scenes.
const spread = (v, lo, hi, minSpan) => {
  const sorted = Float64Array.from(v).sort()
  const a = sorted[Math.floor(v.length * lo)] ?? 0; const b = sorted[Math.floor(v.length * hi)] ?? 1
  const span = Math.max(minSpan, b - a)
  return v.map(x => Math.min(1, Math.max(0, (x - a) / span)))
}
const blur = (v, w) => {
  const out = new Float64Array(v.length)
  for (let f = 0; f < v.length; f++) { let s = 0; let c = 0; for (let j = Math.max(0, f - w); j <= Math.min(v.length - 1, f + w); j++) { s += v[j]; c++ } out[f] = s / c }
  return out
}
export function speechStrength (buf) {
  const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2))
  const per = 160; const n = Math.floor(samples.length / per)
  const db = new Float64Array(n)
  for (let f = 0; f < n; f++) { let s = 0; for (let i = f * per; i < (f + 1) * per; i++) s += samples[i] * samples[i]; db[f] = 10 * Math.log10(s / per + 1) }
  const level = spread(db, 0.2, 0.92, 8)
  const change = new Float64Array(n)
  for (let f = 1; f < n; f++) change[f] = Math.abs(db[f] - db[f - 1])
  const lively = spread(blur(change, 40), 0.2, 0.92, 1e-6)
  return blur(level.map((x, i) => x * (0.35 + 0.65 * lively[i])), 5)
}

const WIN = 120 // seconds of audio per window
const COUNT = 3 // windows measured before the answer is given
const MIN_SPAN = 90 // shortest readable stretch worth a window
// Windows are accepted on a clear peak; the answer is trusted when windows agree with each other (real films give
// modest z-scores even for a correct lock, because speech is itself repetitive).
const MIN_PEAK = 0.18
const MIN_Z = 2.5
// Frame-rate conversions subtitles commonly suffer from (subtitle time * ratio = film time).
const RATIOS = [1, 25 / 23.976, 23.976 / 25, 24 / 23.976, 23.976 / 24, 30 / 29.97, 29.97 / 30, 25 / 24, 24 / 25, 30 / 25, 25 / 30]
const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
const warp = (cues, r) => (r === 1 ? cues : cues.map(c => ({ s: c.s * r, e: c.e * r })))
export const usable = (ranges, min = MIN_SPAN) => ranges.filter(([a, b]) => b - a >= min)
const spanAt = (spans, t) => spans.find(([a, b]) => t >= a && t <= b) ?? spans.reduce((x, y) => (Math.min(Math.abs(t - y[0]), Math.abs(t - y[1])) < Math.min(Math.abs(t - x[0]), Math.abs(t - x[1])) ? y : x))

// opts: { url (a file on disk), duration (length of the film, or of what can be read when `ranges` is not given), ranges
//         ([from, to] seconds that can be read; the film may be downloaded from anywhere), at (where the viewer is: that
//         stretch is measured first), cues (the subtitle to fix), signalAt(ws, len) (speech strength frames for a stretch;
//         reads the audio of `url` by default), isAborted, win, count }
// Returns { ratio, anchors: [{ t, d, z }], model, confidence, windows } or null when nothing lined up.
// A subtitle time t belongs at  t * ratio + offsetAt(anchors, model, t * ratio).
export async function syncSubtitle ({ url, duration, ranges, at, cues, signalAt, isAborted = () => false, win = WIN, count = COUNT }) {
  cues = withoutAds(cues)
  const spans = usable(ranges ?? [[0, duration]])
  if (!cues.length || !duration || !spans.length) return null
  const total = spans.reduce((n, [a, b]) => n + b - a, 0)
  // A few minutes are enough: shorter windows and fewer of them when little can be read.
  const len = Math.min(win, Math.max(MIN_SPAN, total / 2.2))
  const window = center => {
    const [a, b] = spanAt(spans, center); const l = Math.min(len, b - a)
    const lo = a === 0 && b - a <= 3 * len ? Math.min(30, b - a - l) : a // skip the opening logos when there is room to
    return { ws: Math.max(lo, Math.min(b - l, center - l / 2)), l }
  }
  const read = signalAt || (async (ws, n) => speechStrength(await pcm(url, ws, n)))
  const heard = new Map() // a stretch is read once however many ranges it is tried at
  const signal = async (ws, n) => { const k = `${ws}:${n}`; if (!heard.has(k)) heard.set(k, read(ws, n)); return heard.get(k) }
  const measure = async (center, range, ratio) => {
    const { ws, l } = window(center)
    const r = align(await signal(ws, l), ws, warp(cues, ratio), range)
    return r && r.z >= MIN_Z && r.peak >= MIN_PEAK ? { t: ws + l / 2, d: r.d, z: r.z, peak: r.peak } : null
  }
  // Window centres: the stretch the viewer is at first, then the ones farthest from those already taken (a drift or a splice shows between far-apart windows).
  const cands = spans.flatMap(([a, b]) => { const l = Math.min(len, b - a); const o = []; for (let c = a + l / 2; c <= b - l / 2 + 1e-6; c += l) o.push(c); return o.length ? o : [(a + b) / 2] })
  const inner = cands.filter(c => c >= 90 && c <= duration - 240)
  const pool = inner.length ? inner : cands
  const near = (c, t) => Math.abs(c - t)
  const spots = [pool.reduce((x, y) => (near(y, at ?? duration / 2) < near(x, at ?? duration / 2) ? y : x))]
  while (spots.length < Math.min(count, pool.length)) spots.push(pool.reduce((x, y) => (Math.min(...spots.map(s => near(y, s))) > Math.min(...spots.map(s => near(x, s))) ? y : x)))

  let ratio = 1; let first = null
  try {
    const { ws, l } = window(spots[0]); const sig = await signal(ws, l)
    let best = null
    for (const r of RATIOS) {
      const m = align(sig, ws, warp(cues, r), 200)
      if (m && m.peak >= MIN_PEAK && (!best || m.peak > best.peak * (r === 1 ? 1 : 1.12))) best = { peak: m.peak, ratio: r }
    }
    if (best) ratio = best.ratio
    first = await measure(ws + l / 2, 200, ratio)
  } catch { /* fall through to the per-window pass */ }

  const anchors = first ? [first] : []
  let wide = first ? Math.abs(first.d) + 25 : 150
  for (const c of spots) {
    if (isAborted()) return null
    if (first && Math.abs(window(c).ws + window(c).l / 2 - first.t) < 1) continue
    try {
      // A weak lock in a narrow range may be noise hiding the real offset further out: look wider and keep the stronger.
      const a = await measure(c, wide, ratio)
      const b = !a || a.peak < 0.35 ? (wide < 300 ? await measure(c, 300, ratio) : null) : null
      const m = a && b ? (b.peak > a.peak ? b : a) : a || b
      if (m) { anchors.push(m); if (anchors.length === 1) wide = Math.abs(m.d) + 25 }
    } catch { /* one unreadable stretch should not stop the rest */ }
  }
  if (!anchors.length) return null
  for (let round = 0; round < 3; round++) {
    anchors.sort((a, b) => a.t - b.t)
    const gap = anchors.map((a, i) => i && Math.abs(a.d - anchors[i - 1].d) > 0.6 && a.t - anchors[i - 1].t > 2 * len ? i : 0).filter(Boolean)[0]
    if (!gap || isAborted()) break
    try {
      const m = await measure((anchors[gap].t + anchors[gap - 1].t) / 2, Math.abs(anchors[gap].d - anchors[gap - 1].d) + 20, ratio)
      if (m && !anchors.some(a => Math.abs(a.t - m.t) < 1)) anchors.push(m); else break
    } catch { break }
  }
  anchors.sort((a, b) => a.t - b.t)
  const groups = anchors.map(a => anchors.filter(o => Math.abs(o.d - a.d) < 0.4))
  let kept = anchors.filter((a, i) => groups[i].length >= 2)
  if (!kept.length) {
    if (anchors.length >= 3 && isLine(anchors)) kept = anchors
    else { const top = anchors.reduce((x, y) => (y.peak > x.peak ? y : x)); kept = top.peak >= 0.3 && top.z >= 4 ? [top] : [] }
  }
  if (!kept.length) return null
  const cls = classify(kept, ratio)
  const confidence = Math.min(1, 0.25 + 0.2 * kept.length + 0.8 * median(kept.map(a => a.peak)) * (kept.length >= 2 ? 1 : 0.5))
  return { ratio, anchors: cls.anchors, model: cls.model, points: kept.map(({ t, d, z }) => ({ t, d, z })), windows: kept.length, confidence }
}

export function shiftVtt (text, res) {
  const fmt = t => { t = Math.max(0, t); const h = Math.floor(t / 3600); const m = Math.floor(t / 60) % 60; const sec = (t % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}` }
  return text.replace(/([\d:.,]+)(\s*-->\s*)([\d:.,]+)/g, (_, a, mid, b) => fmt(mapTime(res, toSec(a))) + mid + fmt(mapTime(res, toSec(b))))
}

// One window around `at` (seconds of film), looked at again and again while the film plays: has the offset changed since
// the last answer? `expected` is what the current model says there, so only a small neighbourhood is searched.
export async function syncProbe ({ url, duration, ranges, cues, at, ratio = 1, expected = 0, range = 30 }) {
  cues = withoutAds(cues)
  const spans = usable(ranges ?? [[0, duration]], 60)
  if (!cues.length || !duration || !spans.length) return null
  const [a, b] = spans.find(([x, y]) => at >= x && at <= y) ?? []
  if (a == null) return null // the playhead is outside what can be read
  const len = Math.min(120, b - a)
  const ws = Math.max(a, Math.min(b - len, at - len / 2))
  const sig = speechStrength(await pcm(url, ws, len))
  const r = align(sig, ws, warp(cues, ratio).map(c => ({ ...c, s: c.s + expected, e: c.e + expected })), range)
  return r && r.z >= MIN_Z && r.peak >= MIN_PEAK ? { t: ws + len / 2, d: expected + r.d, z: r.z, peak: r.peak } : null
}

export const syncInWorker = (args, timeoutMs = 180000) => new Promise(resolve => {
  const w = new Worker(new URL('./sync-worker.js', import.meta.url), { workerData: args })
  const done = r => { clearTimeout(timer); w.terminate(); resolve(r) }
  const timer = setTimeout(() => done(null), timeoutMs)
  w.once('message', done); w.once('error', () => done(null))
})
