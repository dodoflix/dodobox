import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('subs') // not the real data folder: a connected account there would change the answers
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

test('subtitles: the fast providers list goes out shortly after they answer, without waiting out a slow one', async () => {
  const restore = stub({ restDelay: 2500 }); timing.quickMs = 5000; timing.graceMs = 100
  try {
    const t0 = Date.now()
    const first = await listSubtitles({ type: 'movie', id: 'tt9100005', titles: ['Stub Movie'] }, ['tur'], '')
    assert.ok(Date.now() - t0 < 1500, `took ${Date.now() - t0} ms`)
    assert.ok(first.length === 1 && first.every(s => s.partial))
  } finally { restore(); timing.quickMs = 3500; timing.graceMs = 500 }
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
  const restore = stub({}); timing.quickMs = 5000; timing.graceMs = 5000
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
  } finally { globalThis.fetch = inner; restore(); resetQuota(); timing.quickMs = 3500; timing.graceMs = 500 }
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

// The addon is the only source of languages the profile did not ask for; REST answers every language when it is not given one.
function stubAddon ({ addonFails }) {
  const real = globalThis.fetch
  const rest = []
  globalThis.fetch = async url => {
    const u = new URL(url)
    if (u.hostname === 'opensubtitles-v3.strem.io') return addonFails() ? new Response('down', { status: 503 }) : json({ subtitles: [addonFile, { ...addonFile, lang: 'ger', url: 'https://subs5.strem.io/ger' }] })
    if (u.hostname === 'rest.opensubtitles.org') {
      rest.push(u.pathname)
      const all = [restFile(1), { ...restFile(3), SubLanguageID: 'fre' }, { ...restFile(4), SubLanguageID: 'spa' }]
      return json(/sublanguageid-(\w+)/.test(u.pathname) ? all.filter(s => s.SubLanguageID === u.pathname.match(/sublanguageid-(\w+)/)[1]) : all)
    }
    return new Response('nothing', { status: 404 })
  }
  return { rest, restore: () => { globalThis.fetch = real } }
}

test('subtitles: while the addon is down, other languages still come from REST (one unfiltered lookup) and the list stays partial', async () => {
  const { rest, restore } = stubAddon({ addonFails: () => true }); timing.quickMs = 5000; timing.graceMs = 5000 // wait for the whole lookup
  try {
    const q = { type: 'movie', id: 'tt9100010', titles: ['Stub Movie'] }
    const list = await listSubtitles(q, ['tur'], '')
    assert.deepEqual([...new Set(list.map(s => s.lang))].sort(), ['fre', 'spa', 'tur'])
    assert.ok(list.every(s => s.partial), 'what the addon would have added may still follow')
    assert.equal(rest.filter(p => !p.includes('sublanguageid')).length, 1, 'one request without a language filter')
  } finally { restore(); timing.quickMs = 3500; timing.graceMs = 500 }
})

test('subtitles: a list cached while the addon failed is flagged partial on every ask; once the cache is stale the addon\'s files join', async () => {
  let down = true
  const { restore } = stubAddon({ addonFails: () => down }); timing.quickMs = 5000; timing.graceMs = 5000
  const now = Date.now
  try {
    const q = { type: 'movie', id: 'tt9100011', titles: ['Stub Movie'] }
    const first = await listSubtitles(q, ['tur'], '')
    assert.ok(first.length && first.every(s => s.partial))
    assert.ok((await listSubtitles(q, ['tur'], '')).every(s => s.partial), 'the second ask is served from the cache')
    down = false; Date.now = () => now() + 120e3 // past the 90 s an incomplete list is kept
    const list = await listSubtitles(q, ['tur'], '')
    assert.ok(list.some(s => s.lang === 'ger') && list.every(s => !s.partial), 'the complete list')
  } finally { Date.now = now; restore(); timing.quickMs = 3500; timing.graceMs = 500 }
})
