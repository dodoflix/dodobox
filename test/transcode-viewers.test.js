// Who is waiting for an encode decides when it stops; a file that claims an absurd length is refused. A stand-in ffmpeg keeps this free of real encodes.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('transcode-viewers')
const fake = path.join(tmp, 'ffmpeg')
// A segment (-ss) never ends by itself; a trial or a probe answers at once, and the probe reports a length of ~4 years.
fs.writeFileSync(fake, '#!/bin/sh\ncase "$*" in\n *-ss*) exec sleep 600;;\n *lavfi*) exit 0;;\nesac\necho "Input #0, matroska,webm, from \'x.mkv\':" >&2\necho "  Duration: 99999:00:00.00, start: 0.000000, bitrate: 1 kb/s" >&2\nexit 1\n', { mode: 0o755 })
Object.assign(process.env, { FFMPEG: fake, DATA_DIR: path.join(tmp, 'data'), MAX_TRANSCODES: '1' })
const { segment, cancel, watching, probe, encodes } = await import('../src/transcode.js')

const tick = () => new Promise(resolve => setImmediate(resolve))
const until = async cond => { while (!cond()) await tick() }
const track = p => { const s = { done: false, err: null }; p.then(() => { s.done = true }, e => { s.done = true; s.err = e }); return s }
// One job holds the only encoder slot, so what is started after it waits in the queue.
async function hold (key) {
  const c = new AbortController()
  const t = track(segment('x', key, 0, 0, 1080, c.signal))
  await until(() => encodes().running === 1)
  return { t, c }
}
const queued = async (n = 1) => { await until(() => encodes().queued === n) }

test('one viewer leaving keeps the encode the other viewer still uses; the last one leaving stops it', async () => {
  const key = 'film:0'
  const first = await hold(key)
  watching(key, 'a'); watching(key, 'b')
  const next = track(segment('x', key, 1, 0, 1080, new AbortController().signal))
  await queued()
  cancel(key, 'a')
  await tick(); await tick()
  assert.equal(next.done, false, 'b still watches')
  cancel(key, 'b')
  await until(() => next.done)
  assert.equal(next.err.code, 499)
  await until(() => first.t.done)
  await until(() => encodes().running === 0)
})

test('a segment stops when every request waiting for it is gone, not before', async () => {
  const key = 'film:1'
  const first = await hold(key)
  const one = new AbortController(); const two = new AbortController()
  const wanted = segment('x', key, 3, 0, 1080, one.signal)
  segment('x', key, 3, 0, 1080, two.signal)
  const s = track(wanted)
  await queued()
  one.abort(); await tick(); await tick()
  assert.equal(s.done, false, 'the second request still waits')
  two.abort()
  await until(() => s.done)
  assert.equal(s.err.code, 499)
  first.c.abort()
  await until(() => encodes().running === 0)
})

test('seeking away drops the warm-ups queued for the old position and keeps the ones ahead of the new one', async () => {
  const key = 'film:2'
  const first = await hold(key)
  const stale = [1, 2].map(n => track(segment('x', key, n, 0, 1080)))
  const near = track(segment('x', key, 51, 0, 1080))
  await queued(3)
  const go = new AbortController()
  const want = track(segment('x', key, 50, 0, 1080, go.signal))
  await until(() => stale.every(s => s.done))
  assert.equal(stale[0].err.code, 499)
  assert.equal(near.done, false, 'the segment right after the new position stays warm')
  cancel(key)
  await until(() => want.done && near.done && first.t.done)
  await until(() => encodes().running === 0)
})

test('a full queue refuses more work instead of growing without limit', async () => {
  const key = 'film:3'
  const first = await hold(key)
  const jobs = Array.from({ length: 41 }, (_, n) => track(segment('x', key, n + 10, 0, 1080)))
  await until(() => jobs.some(j => j.done))
  assert.equal(jobs.find(j => j.done).err.code, 503)
  assert.equal(encodes().queued, 40)
  cancel(key, 'nobody')
  first.c.abort()
  await until(() => jobs.every(j => j.done))
})

test('a file that claims a length over 24 hours is refused instead of becoming a playlist of millions of lines', async () => {
  await assert.rejects(probe('x.mkv', 'absurd'), { code: 422, message: /impossible length/ })
})
