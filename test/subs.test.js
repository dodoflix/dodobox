import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-subs-')) // not the real data folder: a connected account there would change the answers
const { listSubtitles, fetchSubtitle, resetQuota, timing, scoreSub } = await import('../src/subs.js')

const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const addonFile = { lang: 'tur', url: 'https://subs5.strem.io/a', movieReleaseName: 'Stub.Movie.2001', g: '5' }
const restFile = n => ({ SubLanguageID: 'tur', SubFormat: 'srt', SubDownloadLink: `https://dl.opensubtitles.org/f${n}.gz`, MovieReleaseName: `Stub.Movie.2001.${n}`, SubDownloadsCnt: '9', SubEncoding: 'CP1254', SubForeignPartsOnly: '0' })

function stub ({ restDelay = 0, restFails = false }) {
  const real = globalThis.fetch
  globalThis.fetch = async url => {
    const host = new URL(url).hostname
    if (host === 'opensubtitles-v3.strem.io') return json({ subtitles: [addonFile] })
    if (host === 'rest.opensubtitles.org') { await sleep(restDelay); return restFails ? new Response('busy', { status: 500 }) : json([restFile(1), restFile(2)]) }
    return new Response('nothing', { status: 404 })
  }
  return () => { globalThis.fetch = real }
}

test('subtitles: the fast provider answers first, flagged partial, and the complete list is there on the next ask', async () => {
  const restore = stub({ restDelay: 400 }); timing.quickMs = 60
  try {
    const q = { type: 'movie', id: 'tt9100001', titles: ['Stub Movie'] }
    const first = await listSubtitles(q, ['tur'], '')
    assert.equal(first.length, 1)
    assert.ok(first.every(s => s.partial), 'the viewer is told more may follow')
    await sleep(900)
    const second = await listSubtitles(q, ['tur'], '')
    assert.equal(second.length, 3, 'the slower provider\'s files joined')
    assert.ok(second.every(s => !s.partial))
  } finally { restore(); timing.quickMs = 3500 }
})

test('subtitles: a list built while a provider failed is not taken for the whole truth', async () => {
  const restore = stub({ restFails: true }); timing.quickMs = 5000
  try {
    const list = await listSubtitles({ type: 'movie', id: 'tt9100002', titles: ['Stub Movie'] }, ['tur'], '')
    assert.ok(list.length >= 1 && list.every(s => s.partial), 'what the addon had, marked as possibly incomplete')
  } finally { restore(); timing.quickMs = 3500 }
})

test('subtitles: scoring prefers the matching release, plain dialogue and film timing over raw downloads', () => {
  const base = { lang: 'eng', rel: 'Stub.Movie.2001.1080p.BluRay.x264-GRP', dl: 100, fps: 23.976 }
  const rel = 'Stub.Movie.2001.1080p.BluRay.x264-GRP'
  const score = s => scoreSub({ ...base, ...s }, rel, ['eng'])
  assert.ok(score({}) > score({ rel: 'Stub.Movie.2001.DVDRip.XviD-OTHER', dl: 5000 }), 'same release beats a popular other one')
  assert.ok(score({}) > score({ hi: true }), 'hearing-impaired lines lose')
  assert.ok(score({}) > score({ fps: 25 }), 'PAL timing loses against a film release')
  assert.ok(score({ trusted: true }) > score({}))
  assert.ok(score({ rating: 9 }) > score({ rating: 0 }))
  assert.ok(score({}) > score({ forced: true }))
})

test('subtitles: a 404 from the download host (IP quota used up) stops further tries and flags its files', async () => {
  const restore = stub({}); timing.quickMs = 5000
  const calls = []
  const inner = globalThis.fetch
  globalThis.fetch = async url => { if (new URL(url).hostname === 'dl.opensubtitles.org') { calls.push(url); return new Response('quota', { status: 404 }) } return inner(url) }
  try {
    const q = { type: 'movie', id: 'tt9100003', titles: ['Stub Movie'] }
    assert.equal((await listSubtitles(q, ['tur'], '')).length, 3)
    await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/f1.gz'), { code: 429 })
    await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/f2.gz'), { code: 429 })
    assert.equal(calls.length, 1, 'the second file is not even requested')
    const after = await listSubtitles(q, ['tur'], '')
    assert.equal(after.length, 3, 'still listed')
    assert.deepEqual(after.filter(s => s.limited).length, 2, 'the quota-hit host\'s files are flagged')
  } finally { globalThis.fetch = inner; restore(); resetQuota(); timing.quickMs = 3500 }
})

test('subtitles: several files in one language stay in rank order, not label order', async () => {
  const real = globalThis.fetch
  globalThis.fetch = async url => {
    const host = new URL(url).hostname
    if (host === 'opensubtitles-v3.strem.io') return json({ subtitles: Array.from({ length: 12 }, (_, i) => ({ lang: 'tur', url: `https://subs5.strem.io/${i}`, movieReleaseName: `Stub.Movie.2001.${i}`, g: String(100 - i) })) })
    return new Response('nothing', { status: 404 })
  }
  try {
    const list = await listSubtitles({ type: 'movie', id: 'tt9100004', titles: ['Stub Movie'] }, ['tur'], '')
    assert.deepEqual(list.slice(0, 3).map(s => s.label), ['Turkish', 'Turkish #2', 'Turkish #3'])
  } finally { globalThis.fetch = real }
})

test('subtitles: ad cues are dropped from the served file, dialogue and timing stay as they were', async () => {
  const real = globalThis.fetch
  const srt = '1\n00:00:01,000 --> 00:00:03,000\nSupport us and become VIP member\nto remove all ads from OpenSubtitles.org\n\n2\n00:00:05,000 --> 00:00:07,000\n<i>Hello there</i>\n\n3\n00:00:09,000 --> 00:00:11,000\nSee you at example.com\n'
  globalThis.fetch = async () => new Response(srt)
  try {
    const vtt = await fetchSubtitle('https://subs5.strem.io/ads')
    assert.equal(vtt, 'WEBVTT\n\n2\n00:00:05.000 --> 00:00:07.000\n<i>Hello there</i>\n\n3\n00:00:09.000 --> 00:00:11.000\nSee you at example.com')
  } finally { globalThis.fetch = real }
})

test('yify: movie subtitles are read from the page, filtered to the asked languages and cached', async () => {
  const { yifyList } = await import('../src/yify.js')
  const row = (lang, name, rating) => `<tr data-id="1"><td class="rating-cell">${rating}</td><td class="flag-cell"><span class="sub-lang">${lang}</span></td><td><a href="/subtitles/${name}"><span class="text-muted">subtitle</span> Stub.Movie.2001.1080p</a></td></tr>`
  let asked = 0
  const real = globalThis.fetch
  globalThis.fetch = async () => { asked++; return new Response(`<table>${row('Turkish', 'stub-turkish', 7)}${row('English', 'stub-english', -3)}${row('Klingon', 'stub-klingon', 1)}</table>`) }
  try {
    const tur = await yifyList('tt9100002', ['tur'])
    assert.deepEqual(tur.map(r => [r.lang, r.url, r.dl, r.rel]), [['tur', 'https://yifysubtitles.ch/subtitle/stub-turkish.zip', 140, 'Stub.Movie.2001.1080p']])
    assert.equal((await yifyList('tt9100002', ['eng']))[0].dl, 0)
    assert.equal(asked, 1)
  } finally { globalThis.fetch = real }
})
