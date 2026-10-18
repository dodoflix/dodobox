import test from 'node:test'
import assert from 'node:assert/strict'
import { fromChapters, sane, skipsFor } from '../src/skips.js'
import { parseProbe } from '../src/transcode.js'

const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
function stub (answers) {
  const real = globalThis.fetch; const calls = []
  globalThis.fetch = async url => { const u = new URL(url); calls.push(u.hostname); return answers[u.hostname] ? json(answers[u.hostname]) : new Response('no', { status: 404 }) }
  return { calls, restore: () => { globalThis.fetch = real } }
}

test('chapter titles releases use are read as intro, recap and ending', () => {
  const m = fromChapters([
    { start: 0, end: 30, title: 'Prologue' }, { start: 30, end: 120, title: 'Opening Song' }, { start: 120, end: 1300, title: 'Part A' },
    { start: 1300, end: 1400, title: 'To Be Continued & Ending Song' }, { start: 1400, end: 1430, title: 'Preview' }
  ], 1430)
  assert.deepEqual(m, { intro: { start: 30, end: 120 }, outro: { start: 1300, end: 1400 } })
  assert.deepEqual(fromChapters([{ start: 0, end: 60, title: 'OP' }, { start: 1380, end: 1440, title: 'ED' }], 1440), { intro: { start: 0, end: 60 }, outro: { start: 1380, end: 1440 } })
  assert.deepEqual(fromChapters([{ start: 0, end: 600, title: 'Chapter 1' }], 600), {})
})

test('a marker that cannot be right is dropped', () => {
  assert.equal(sane('intro', { start: 28, end: 118 }, 1440), true)
  assert.equal(sane('intro', { start: 900, end: 990 }, 1440), false, 'an intro in the second half')
  assert.equal(sane('outro', { start: 100, end: 190 }, 1440), false, 'an ending in the first half')
  assert.equal(sane('outro', { start: 1500, end: 1560 }, 1440), false, 'starts after the file')
  assert.equal(sane('intro', { start: 10, end: 12 }, 1440), false, 'too short')
})

test('chapters win over the databases, and the file length decides whether AniSkip applies', async () => {
  const net = stub({ 'api.aniskip.com': { found: true, results: [
    { skipType: 'op', interval: { startTime: 28, endTime: 118 }, episodeLength: 1440 },
    { skipType: 'ed', interval: { startTime: 1330, endTime: 1440 }, episodeLength: 1440 }
  ] } })
  try {
    const item = { type: 'anime', id: 'al:1', season: 1, episode: 4, mal: 111 }
    const own = await skipsFor(item, { chapters: [{ start: 40, end: 130, title: 'Opening' }], duration: 1440 })
    assert.deepEqual(own.intro, { start: 40, end: 130, from: 'chapters' })
    assert.deepEqual(own.outro, { start: 1330, end: 1440, from: 'aniskip' })
    const other = await skipsFor({ ...item, episode: 5 }, { duration: 1500 }) // a 60 s longer cut than the one recorded
    assert.deepEqual(other, {})
    const same = await skipsFor({ ...item, episode: 6 }, { duration: 1445 })
    assert.equal(same.intro.from, 'aniskip')
  } finally { net.restore() }
})

test('series use IntroDB, and a lookup that finds nothing is not repeated at once', async () => {
  const net = stub({ 'api.introdb.app': { intro: { start_sec: 314.5, end_sec: 331 }, outro: { start_sec: 2843, end_sec: 2901 }, recap: null } })
  try {
    const r = await skipsFor({ type: 'series', id: 'tt0903747', season: 1, episode: 2 }, { duration: 2893 })
    assert.deepEqual(r.intro, { start: 314.5, end: 331, from: 'introdb' })
    assert.deepEqual(r.outro, { start: 2843, end: 2893, from: 'introdb' }, 'the end is cut to the length of this file')
  } catch (e) { net.restore(); throw e }
  net.restore()
  const none = stub({})
  try {
    await skipsFor({ type: 'series', id: 'tt1', season: 1, episode: 1 }, { duration: 2400 })
    await skipsFor({ type: 'series', id: 'tt1', season: 1, episode: 1 }, { duration: 2400 })
    assert.equal(none.calls.length, 1)
  } finally { none.restore() }
})

test('ffmpeg chapter lines are read from the probe text', () => {
  const r = parseProbe(`Input #0, matroska,webm, from 'x.mkv':
  Duration: 00:24:00.00, start: 0.000000, bitrate: 5000 kb/s
  Chapters:
    Chapter #0:0: start 0.000000, end 30.030000
      Metadata:
        title           : Prologue
    Chapter #0:1: start 30.030000, end 120.120000
      Metadata:
        title           : Opening
  Stream #0:0: Video: h264 (High), yuv420p, 1920x1080, 24 fps
`)
  assert.deepEqual(r.chapters, [{ start: 0, end: 30.03, title: 'Prologue' }, { start: 30.03, end: 120.12, title: 'Opening' }])
})
