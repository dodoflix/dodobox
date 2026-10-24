import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { align, syncSubtitle, syncInWorker, usable, offsetAt, mapTime, shiftVtt, parseCues, isAd, withoutAds } from '../src/sync.js'
import { tmpdir } from './support/tmp.js'

const rng = seed => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
function dialogue (seconds, seed = 7) {
  const r = rng(seed); const out = []; let t = 5 + r() * 5
  while (t < seconds - 5) { const len = 0.6 + r() * 3.4; out.push({ s: t, e: t + len }); t += len + 0.4 + r() * 4.5 }
  return out
}
const frames = (bursts, seconds, noise = 0.15, seed = 3) => {
  const r = rng(seed); const n = Math.round(seconds / 0.01); const sig = new Float64Array(n)
  for (const b of bursts) for (let i = Math.floor(b.s / 0.01); i < Math.min(n, Math.ceil(b.e / 0.01)); i++) sig[i] = 0.8 + r() * 0.2
  for (let i = 0; i < n; i++) sig[i] = Math.min(1, sig[i] + r() * noise)
  return sig
}

test('align finds a constant offset to within a few hundredths of a second', () => {
  const media = dialogue(500)
  for (const d of [-37.4, -2.15, 0.33, 6.8, 58.21]) {
    const cues = media.map(b => ({ s: b.s - d, e: b.e - d }))
    const r = align(frames(media.filter(b => b.s > 40 && b.e < 460), 500).subarray(0), 0, cues, 90)
    assert.ok(r && r.z > 6, `no lock for ${d}`)
    assert.ok(Math.abs(r.d - d) < 0.04, `${d}: got ${r?.d}`)
  }
})

test('align refuses to lock onto unrelated timing', () => {
  const cues = dialogue(500, 99)
  const r = align(frames(dialogue(500, 5), 500), 0, cues, 60)
  assert.ok(!r || r.z < 6, `false lock z=${r?.z}`)
})

const audioOf = media => (ws, len) => frames(media.map(b => ({ s: b.s - ws, e: b.e - ws })).filter(b => b.e > 0 && b.s < len), len, 0.2, Math.round(ws) + 1)

test('syncSubtitle recovers offset, frame-rate drift and splices', async () => {
  const media = dialogue(3600, 11)
  const run = cues => syncSubtitle({ url: 'unused', duration: 3600, cues, signalAt: audioOf(media) })
  let r = await run(media.map(b => ({ s: b.s - 4.7, e: b.e - 4.7 })))
  assert.equal(r.model, 'constant'); assert.ok(Math.abs(r.anchors[0].d - 4.7) < 0.05)
  // 25 fps subtitles on 23.976 fps film: times are compressed by 23.976/25 relative to the picture
  const k = 23.976 / 25
  r = await run(media.map(b => ({ s: b.s * k + 1.2, e: b.e * k + 1.2 })))
  for (const t of [300, 1500, 3200]) {
    const want = media.find(b => b.s > t).s
    const sub = want * k + 1.2
    assert.ok(Math.abs(mapTime(r, sub) - want) < 0.12, `drift at ${t}: ${mapTime(r, sub)} vs ${want}`)
  }
  // a 90 s scene cut from the subtitle's version halfway: first half off by 2 s, second half by 2 s + 90 s
  r = await run(media.map(b => b.s < 1800 ? { s: b.s - 2, e: b.e - 2 } : { s: b.s - 92, e: b.e - 92 }))
  assert.equal(r.model, 'piecewise')
  const early = media.find(b => b.s > 600); const late = media.find(b => b.s > 3000)
  assert.ok(Math.abs(mapTime(r, early.s - 2) - early.s) < 0.15)
  assert.ok(Math.abs(mapTime(r, late.s - 92) - late.s) < 0.15)
})

test('syncSubtitle syncs from a stretch around the playhead when the start of the file is not downloaded', async () => {
  const media = dialogue(7000, 51)
  const read = []
  const signalAt = (ws, len) => { read.push([ws, ws + len]); return audioOf(media)(ws, len) }
  // resumed at 40 min: only 3 min before and 5 min after it are on disk
  const ranges = [[2220, 2700]]
  const r = await syncSubtitle({ url: 'unused', duration: 7000, ranges, near: 2400, cues: media.map(b => ({ s: b.s - 3.4, e: b.e - 3.4 })), signalAt })
  assert.ok(r && Math.abs(r.anchors[0].d - 3.4) < 0.05, `offset ${r?.anchors?.[0]?.d}`)
  assert.ok(read.length && read.every(([a, b]) => a >= 2220 && b <= 2700), `read outside the downloaded stretch: ${JSON.stringify(read)}`)
  assert.equal(await syncSubtitle({ url: 'unused', duration: 7000, ranges: [[2400, 2440]], near: 2420, cues: media, signalAt }), null, 'a stretch too short to measure is not measured')
  assert.deepEqual(usable([[0, 30], [100, 400]]), [[100, 400]])
})

test('a later pass keeps what the earlier one measured and reads only stretches not yet seen', async () => {
  const media = dialogue(7000, 61)
  const cues = media.map(b => ({ s: b.s - 5.2, e: b.e - 5.2, t: 'x' }))
  const read = []
  const signalAt = (ws, len) => { read.push(ws + len / 2); return audioOf(media)(ws, len) }
  const first = await syncSubtitle({ url: 'unused', duration: 7000, ranges: [[0, 260]], near: 100, cues, signalAt })
  assert.ok(first && !first.none && first.evidence.length, 'no first answer')
  const seen = first.evidence.map(e => e.t); read.length = 0
  const second = await syncSubtitle({ url: 'unused', duration: 7000, ranges: [[0, 900]], near: 100, cues, signalAt, prior: first })
  assert.ok(Math.abs(second.anchors[0].d - 5.2) < 0.05, `offset ${second.anchors[0].d}`)
  assert.ok(second.evidence.length > first.evidence.length, 'the earlier windows were not kept')
  assert.ok(read.every(t => seen.every(s => Math.abs(s - t) >= 60)), `measured again: ${read} vs ${seen}`)
  // Nothing new to read: the answer stands without touching the audio.
  read.length = 0
  const third = await syncSubtitle({ url: 'unused', duration: 7000, ranges: [[0, 900]], near: 100, cues, signalAt: (ws, len) => { read.push(ws); return audioOf(media)(ws, len) }, prior: { ...second, evidence: [...second.evidence, ...Array.from({ length: 12 }, (_, i) => ({ t: 60 + i * 60, d: 5.2, z: 5, peak: 0.5 }))] } })
  assert.equal(read.length, 0, 'read audio although every stretch was measured')
  assert.ok(Math.abs(third.anchors[0].d - 5.2) < 0.05)
})

test('a track built into the video settles offset and frame rate from cue times alone', async () => {
  const media = dialogue(3000, 71)
  const rng2 = rng(5)
  // the release's own track: same speech, cut a little differently from the downloaded subtitle
  const track = media.filter(() => rng2() > 0.04).map(b => ({ s: b.s + (rng2() - 0.5) * 0.4, e: b.e + (rng2() - 0.5) * 0.4, t: 'x' }))
  const reference = { cues: track, to: 420 }
  let reads = 0
  const signalAt = () => { reads++; throw new Error('no audio needed') }
  let r = await syncSubtitle({ url: 'unused', duration: 3000, ranges: [[0, 420]], near: 100, cues: media.map(b => ({ s: b.s - 7.3, e: b.e - 7.3, t: 'x' })), signalAt, reference })
  assert.ok(r && !r.none && Math.abs(r.anchors[0].d - 7.3) < 0.3, `offset ${r?.anchors?.[0]?.d}`)
  assert.ok(r.evidence.some(e => e.ref), 'the track was not used')
  const k = 25 / 23.976
  r = await syncSubtitle({ url: 'unused', duration: 3000, ranges: [[0, 420]], near: 100, cues: media.map(b => ({ s: (b.s - 2) / k, e: (b.e - 2) / k, t: 'x' })), signalAt, reference })
  assert.ok(Math.abs(r.ratio - k) < 0.002, `ratio ${r.ratio}`)
  assert.ok(Math.abs(mapTime(r, (media[40].s - 2) / k) - media[40].s) < 0.4)
  assert.ok(reads <= 4, `read audio ${reads} times`)
  // another episode's subtitle: nothing lines up with the track, and audio alone is not trusted to say otherwise
  const other = dialogue(3000, 999).map(b => ({ s: b.s, e: b.e, t: 'x' }))
  const none = await syncSubtitle({ url: 'unused', duration: 3000, ranges: [[0, 420]], near: 100, cues: other, signalAt: audioOf(media), reference })
  assert.ok(!none || none.none || none.windows >= 2, 'a lone weak window was trusted against the track')
})

test('syncSubtitle works from real audio read through ffmpeg', async () => {
  const seconds = 600; const media = dialogue(seconds, 21)
  const rate = 16000; const data = new Int16Array(seconds * rate); const r = rng(1)
  for (let i = 0; i < data.length; i++) data[i] = Math.round((r() - 0.5) * 600)
  for (const b of media) for (let i = Math.floor(b.s * rate); i < Math.min(data.length, Math.floor(b.e * rate)); i++) { const t = i / rate; data[i] += Math.round(9000 * Math.sin(2 * Math.PI * (300 + 60 * Math.sin(t * 5)) * t) * (0.6 + 0.4 * Math.sin(t * 11))) }
  const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length * 2, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length * 2, 40)
  const file = path.join(tmpdir('sync'), 'a.wav')
  fs.writeFileSync(file, Buffer.concat([hdr, Buffer.from(data.buffer)]))
  const res = await syncSubtitle({ url: file, duration: seconds, cues: media.map(b => ({ s: b.s - 8.25, e: b.e - 8.25 })) })
  // The server runs it in a worker, which treats a request with `at` as a single-window probe: `near` must not be taken for it.
  const viaWorker = await syncInWorker({ url: file, duration: seconds, ranges: [[0, seconds]], near: 300, cues: media.map(b => ({ s: b.s - 8.25, e: b.e - 8.25 })) })
  assert.ok(res, 'no result')
  assert.ok(Math.abs(res.anchors[0].d - 8.25) < 0.06, `offset ${res.anchors[0].d}`)
  assert.ok(viaWorker?.anchors && Math.abs(viaWorker.anchors[0].d - 8.25) < 0.06, `worker answered ${JSON.stringify(viaWorker)}`)
  const again = await syncInWorker({ url: file, duration: seconds, ranges: [[0, seconds]], near: 300, cues: media.map(b => ({ s: b.s - 8.25, e: b.e - 8.25 })), prior: viaWorker })
  assert.ok(again?.anchors, 'the previous answer must survive the trip into the worker')
  fs.rmSync(path.dirname(file), { recursive: true })
})

test('shiftVtt rewrites cue times and parseCues reads them back', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:10.000 --> 00:00:12.500\nHello\n\n2\n00:01:00.000 --> 00:01:02.000\nWorld\n'
  const out = shiftVtt(vtt, { ratio: 1, anchors: [{ t: 0, d: 2.5 }], model: 'constant' })
  assert.deepEqual(parseCues(out).map(c => [c.s, c.e]), [[12.5, 15], [62.5, 64.5]])
  assert.equal(offsetAt([{ t: 0, d: 1 }, { t: 100, d: 3 }], 'piecewise', 50), 2)
})

test('shifting a subtitle keeps where each cue sits on the picture', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:10.000 --> 00:00:12.500 line:0 align:start\n<i>Hello</i>\n\n2\n00:01:00.000 --> 00:01:02.000 line:50%\nWorld\n'
  const out = shiftVtt(vtt, { ratio: 1, anchors: [{ t: 0, d: 2.5 }], model: 'constant' })
  assert.match(out, /00:00:12\.500 --> 00:00:15\.000 line:0 align:start\n<i>Hello<\/i>/)
  assert.match(out, /00:01:02\.500 --> 00:01:04\.500 line:50%\nWorld/)
})

test('advertisements and credits in a subtitle file are recognised and left out of the sync', async () => {
  const cue = (s, e, text) => ({ s, e, t: text })
  const lines = [cue(0, 6, 'Support us and become VIP member to remove all ads from www.OpenSubtitles.org'), cue(7, 9, 'Advertise your product or brand here'),
    cue(10, 12, 'Subtitles by SomeGroup'), cue(60, 63, 'Hello there. Visit us on the .com site? no.'), cue(2000, 2003, 'Synced and corrected by Someone'),
    cue(2100, 2104, 'I told you, www is not a word in this film'), cue(2500, 2503, 'Come on, we are leaving.'), cue(2800, 2801, 'Subtitles by OpenSubtitles')]
  const kept = withoutAds(lines).map(c => c.t)
  assert.ok(!kept.some(x => /OpenSubtitles|Advertise|Subtitles by/.test(x)), 'ads kept')
  assert.ok(kept.includes('Come on, we are leaving.') && kept.includes('I told you, www is not a word in this film'), 'dialogue dropped')
  assert.ok(isAd(cue(1, 4, 'Downloaded from example.com'), 3000))
  assert.ok(!isAd(cue(1500, 1503, 'See you at example.com'), 3000), 'a web address in the middle of the film is dialogue')
  // A file whose ads sit where there is no speech still locks on the real dialogue.
  const media = dialogue(3600, 31)
  const cues = [cue(0, 7, 'Support us and become VIP member to remove all ads from www.OpenSubtitles.org'), ...media.map(b => ({ s: b.s - 5.5, e: b.e - 5.5, t: 'line' })), cue(3590, 3600, 'Subtitles by Someone')]
  const r = await syncSubtitle({ url: 'unused', duration: 3600, cues, signalAt: audioOf(media) })
  assert.ok(r && Math.abs(r.anchors[0].d - 5.5) < 0.06, `offset ${r?.anchors?.[0]?.d}`)
  assert.equal(parseCues('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n<i>Hi</i> there\n')[0].t, 'Hi there')
})

test('classify turns measured points into a model, and a later point can change it', async () => {
  const { classify, mapTime } = await import('../public/js/syncmap.js')
  assert.deepEqual(classify([{ t: 100, d: 3.1 }, { t: 900, d: 3.2 }, { t: 1500, d: 3.15 }]), { model: 'constant', anchors: [{ t: 0, d: 3.15 }] })
  assert.equal(classify([{ t: 100, d: 0.2 }, { t: 900, d: 0.15 }]).anchors[0].d, 0) // measurement noise is not an offset
  assert.deepEqual(classify([{ t: 180, d: -11.02 }, { t: 660, d: -11.41 }]).anchors, [{ t: 0, d: -11.215 }]) // two noisy windows are a constant, not a slope
  const drift = classify([{ t: 100, d: 1 }, { t: 600, d: 3 }, { t: 1100, d: 5 }, { t: 1600, d: 7 }])
  assert.equal(drift.model, 'linear')
  const spliced = classify([{ t: 100, d: 1 }, { t: 600, d: 1 }, { t: 1100, d: 91 }, { t: 1600, d: 91 }])
  assert.equal(spliced.model, 'piecewise')
  assert.ok(Math.abs(mapTime({ ratio: 1, ...spliced }, 300) - 301) < 0.01)
  assert.ok(Math.abs(mapTime({ ratio: 1, ...spliced }, 1500) - 1591) < 0.01)
})

test('syncProbe finds how far a stretch has moved from what the model expects', async () => {
  const { syncProbe } = await import('../src/sync.js')
  const fs = await import('node:fs'); const path = await import('node:path')
  const seconds = 400; const media = dialogue(seconds, 41); const rate = 16000; const data = new Int16Array(seconds * rate); const r = rng(2)
  for (let i = 0; i < data.length; i++) data[i] = Math.round((r() - 0.5) * 600)
  for (const b of media) for (let i = Math.floor(b.s * rate); i < Math.min(data.length, Math.floor(b.e * rate)); i++) { const t = i / rate; data[i] += Math.round(9000 * Math.sin(2 * Math.PI * (300 + 60 * Math.sin(t * 5)) * t) * (0.6 + 0.4 * Math.sin(t * 11))) }
  const hdr = Buffer.alloc(44); hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length * 2, 4); hdr.write('WAVEfmt ', 8); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(rate, 24); hdr.writeUInt32LE(rate * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write('data', 36); hdr.writeUInt32LE(data.length * 2, 40)
  const file = path.join(tmpdir('probe'), 'a.wav')
  fs.writeFileSync(file, Buffer.concat([hdr, Buffer.from(data.buffer)]))
  // The subtitle was off by 4.0 s but the model believes 3.0 s: the probe should report 4.0.
  const cues = media.map(b => ({ s: b.s - 4, e: b.e - 4, t: 'x' }))
  const p = await syncProbe({ url: file, duration: seconds, cues, at: 200, ratio: 1, expected: 3 })
  fs.rmSync(path.dirname(file), { recursive: true })
  assert.ok(p && Math.abs(p.d - 4) < 0.08, `probe ${p?.d}`)
})
