import test from 'node:test'
import assert from 'node:assert/strict'
import { listSubtitles, timing } from '../src/subs.js'

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
