import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('state')
process.env.DATA_DIR = tmp
process.env.NO_DHT = '1'
const state = await import('../src/state.js')
const local = await import('../src/local.js')

test('profiles keep separate progress and lists', () => {
  const a = state.createProfile('Ann'); const b = state.createProfile('Bo')
  assert.equal(state.profiles().length, 2)
  state.saveProgress(a.id, { type: 'series', id: 'tt1', name: 'Show', season: 1, episode: 2, pos: 300, dur: 2400 })
  assert.equal(state.me(a.id).recent.length, 1)
  assert.equal(state.me(b.id).recent.length, 0)
  assert.deepEqual(state.me(a.id).progress[state.progressKey('series', 'tt1', 1, 2)].slice(0, 2), [300, 2400])
  state.setList(b.id, { type: 'movie', id: 'tt2', name: 'Film' }, true)
  assert.equal(state.me(b.id).list.length, 1)
  assert.equal(state.me(a.id).list.length, 0)
  state.setList(b.id, { type: 'movie', id: 'tt2', name: 'Film' }, false)
  assert.equal(state.me(b.id).list.length, 0)
})

test('finishing a title removes it from continue watching', () => {
  const p = state.createProfile('Cy')
  state.saveProgress(p.id, { type: 'movie', id: 'tt3', name: 'Film', pos: 100, dur: 6000 })
  assert.equal(state.me(p.id).recent.length, 1)
  state.saveProgress(p.id, { type: 'movie', id: 'tt3', name: 'Film', pos: 5900, dur: 6000 })
  assert.equal(state.me(p.id).recent.length, 0)
})

test('moving on to the next episode keeps the show in continue watching at that episode', () => {
  const p = state.createProfile('Di')
  state.saveProgress(p.id, { type: 'series', id: 'tt5', name: 'Show', season: 1, episode: 2, pos: 2350, dur: 2400, next: { season: 1, episode: 3 } })
  const [r] = state.me(p.id).recent
  assert.deepEqual([r.season, r.episode, r.pos], [1, 3, 0])
  state.saveProgress(p.id, { type: 'series', id: 'tt5', name: 'Show', season: 1, episode: 3, pos: 2350, dur: 2400 })
  assert.equal(state.me(p.id).recent.length, 0)
})

test('settings are validated and persisted to disk', () => {
  const p = state.createProfile('Di')
  state.updateProfile(p.id, { settings: { sublang: 'eng', evil: 'x' } })
  assert.equal(state.profile(p.id).settings.sublang, 'eng')
  assert.equal('evil' in state.profile(p.id).settings, false)
  assert.equal(state.profile(p.id).settings.sourceMode, 'compact')
  assert.equal(state.setSettings({ maxStorageGB: 1 }).maxStorageGB, 2)
  assert.equal(state.settings().shareUploads, false)
  assert.equal(state.setSettings({ shareUploads: 'yes' }).shareUploads, false, 'only a boolean turns sharing on')
  assert.equal(state.setSettings({ shareUploads: true }).shareUploads, true)
  assert.equal(state.setSettings({ shareUploads: false }).shareUploads, false)
  state.flush()
  const saved = JSON.parse(fs.readFileSync(path.join(tmp, 'state.json'), 'utf8'))
  assert.ok(Object.keys(saved.profiles).length >= 3)
  assert.throws(() => state.createProfile('  '), /Name required/)
})

test('local filenames are parsed into titles', () => {
  const p = local.parseName
  assert.deepEqual(p('/m/Breaking.Bad.S01E02.720p.mkv'), { kind: 'episode', title: 'Breaking Bad', season: 1, episode: 2 })
  assert.deepEqual(p('/m/[GroupA] Sousou no Frieren - 03 (1080p) [7EF3F175].mkv'), { kind: 'anime', title: 'Sousou no Frieren', season: 1, episode: 3 })
  assert.deepEqual(p('/m/The.Matrix.1999.1080p.BluRay.x264/matrix.mkv'), { kind: 'movie', title: 'The Matrix', year: 1999 })
  assert.deepEqual(p('/m/Dune (2021)/Dune.mkv'), { kind: 'movie', title: 'Dune', year: 2021 })
  assert.deepEqual(p('/m/Show Name 2x05 title.mkv'), { kind: 'episode', title: 'Show Name', season: 2, episode: 5 })
})

test.after(() => setTimeout(() => process.exit(0), 50))

test('ratings are per profile, can be cleared, and finished titles reach the history', () => {
  const a = state.createProfile('Dee'); const b = state.createProfile('Eli')
  const item = { type: 'movie', id: 'tt9', name: 'Film', genres: ['Drama', 'Crime', 'Thriller', 'War', 'Western'] }
  state.setRating(a.id, item, 2)
  assert.equal(state.me(a.id).ratings['movie:tt9'].v, 2)
  assert.equal(state.me(a.id).ratings['movie:tt9'].genres.length, 4)
  assert.deepEqual(state.me(b.id).ratings, {})
  state.setRating(a.id, item, 7)
  assert.deepEqual(state.me(a.id).ratings, {})
  state.saveProgress(a.id, { type: 'movie', id: 'tt9', name: 'Film', pos: 5900, dur: 6000 })
  assert.equal(state.me(a.id).history.length, 1)
  assert.equal(state.me(a.id).recent.length, 0)
})

test('download priority: idle streams pause, manual downloads give way only while something is watched', async () => {
  const { pauseReason } = await import('../src/engine.js')
  const now = 1e6
  const stream = (used, extra = {}) => ({ pinned: false, added: now - 600e3, lastUsed: used, ...extra })
  assert.equal(pauseReason(stream(now - 5e3), now, true), null) // being watched right now
  assert.equal(pauseReason(stream(now - 30e3), now, false), null) // just left: grace period
  assert.equal(pauseReason(stream(now - 60e3), now, false), 'idle') // left a minute ago
  assert.equal(pauseReason(stream(undefined, { added: now - 5e3 }), now, false), null) // just added, not yet asked for
  const manual = (used, extra = {}) => ({ pinned: true, added: now - 600e3, lastUsed: used, ...extra })
  assert.equal(pauseReason(manual(undefined), now, false), null) // runs in the background
  assert.equal(pauseReason(manual(undefined), now, true), 'watching') // gives way to what is on screen
  assert.equal(pauseReason(manual(now - 2e3), now, true), null) // unless it is the one being watched
  assert.equal(pauseReason(manual(undefined, { held: true }), now, false), 'user') // paused by hand
  assert.equal(pauseReason(manual(undefined), now, false, true), 'priority') // waits for the prioritized one
  assert.equal(pauseReason(manual(undefined, { priority: true }), now, false, true), null) // which itself runs
  assert.equal(pauseReason(manual(now - 2e3, { held: true }), now, false), null) // a paused download plays when asked for
})

test('a title can be removed from the watch history', () => {
  const p = state.createProfile('Hist')
  state.saveProgress(p.id, { type: 'anime', id: 'al:5', name: 'A', pos: 10, dur: 100 })
  assert.equal(state.me(p.id).history.length, 1)
  assert.equal(state.me(p.id).recent.length, 1)
  assert.equal(state.removeHistory(p.id, 'anime', 'al:5'), true)
  assert.equal(state.me(p.id).history.length, 0)
  assert.equal(state.me(p.id).recent.length, 0) // gone from continue watching too
})

test('a profile id of "__proto__" finds nothing and cannot change Object.prototype', () => {
  assert.equal(state.profile('__proto__'), undefined)
  assert.equal(state.updateProfile('__proto__', { name: 'pwned', color: 'red' }), null)
  assert.equal(state.saveProgress('constructor', { type: 'movie', id: 'x', pos: 1, dur: 10 }), false)
  assert.equal({}.name, undefined)
  const p = state.createProfile('Cy')
  state.updateProfile(p.id, { settings: { constructor: 1, lang: 'tr' } })
  assert.equal(Object.hasOwn(state.profile(p.id).settings, 'constructor'), false)
})

test('what a client sends is checked: wrong shapes are cut, colours and pictures cannot carry CSS', () => {
  const p = state.createProfile('Dee', 'red;background:url(//evil.example)')
  assert.match(p.color, /^#[0-9a-f]{6}$/i, 'a free-form colour is replaced')
  state.updateProfile(p.id, { color: 'red;x:y', settings: { lang: '<b>', sublang: 'tur', adultFilter: 'yes', interests: ['movie', '<i>'], quality: 'auto' } })
  assert.match(state.profile(p.id).color, /^#/)
  assert.deepEqual([state.profile(p.id).settings.lang, state.profile(p.id).settings.sublang, state.profile(p.id).settings.adultFilter], ['en', 'tur', false])
  const item = { type: 'movie', id: 'tt1', name: 'N'.repeat(500), poster: "/img?u=x');background:red;--x:('", year: '<svg>', rating: '9' }
  const [it] = state.setList(p.id, item, true)
  assert.deepEqual([it.name.length, it.poster, it.year, it.rating], [200, '', undefined, undefined])
  assert.equal(state.setList(p.id, { ...item, poster: '/img?u=https%3A%2F%2Fx.test%2Fa.jpg', year: '2008-2013', rating: 8.5 }, true)[0].rating, 8.5)
  assert.throws(() => state.setList(p.id, { type: 'game', id: 'x' }, true), /Bad title/)
  assert.throws(() => state.setList(p.id, { type: 'movie', id: '"><img>' }, true), /Bad title/)
  assert.equal(state.saveProgress(p.id, { type: 'movie', id: 'tt1', pos: 'x', dur: 10 }), false)
  assert.equal(state.saveProgress(p.id, { type: 'series', id: 'tt2', season: '1', episode: 2, pos: 5, dur: 100, poster: 'javascript:alert(1)' }), true)
  assert.equal(state.profile(p.id).history['series:tt2'].poster, '')
  assert.equal(state.profile(p.id).history['series:tt2'].season, null)
})

test('data saved before values were checked is cleaned when the server starts', async () => {
  const { execFileSync } = await import('node:child_process')
  const dir = tmpdir('scrub')
  const bad = { type: 'movie', id: 'tt1', name: 'x', poster: "/img?u=x');background:red", rating: '9<b>', year: '<svg>' }
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: { a1: { id: 'a1', name: 'A', color: 'red;x:y', progress: {}, recent: { 'movie:tt1': bad }, history: {}, ratings: { x: { type: 'game', id: 'z' } }, list: [bad, { type: 'bogus' }, null], settings: { lang: '<b>', legacy: 'keep' } } }, settings: {} }))
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', "const s = await import('./src/state.js'); process.stdout.write('\\nRESULT' + JSON.stringify(s.profile('a1')))"], { env: { ...process.env, DATA_DIR: dir, NO_DHT: '1' }, encoding: 'utf8' })
  const p = JSON.parse(out.slice(out.indexOf('RESULT') + 6))
  assert.match(p.color, /^#/)
  assert.equal(p.list.length, 1)
  assert.deepEqual([p.list[0].poster, p.list[0].rating, p.list[0].year], ['', undefined, undefined])
  assert.deepEqual(Object.keys(p.ratings), [])
  assert.equal(p.settings.lang, 'en')
  assert.equal(p.settings.legacy, 'keep')
})

test('profiles are capped so the API cannot grow the data file without limit', () => {
  while (state.profiles().length < 32) state.createProfile('P' + state.profiles().length)
  assert.throws(() => state.createProfile('One too many'), /Too many profiles/)
})

// Each case loads state.js in its own process, since the file is read once at import.
function startWith (text) {
  const dir = tmpdir('state-start')
  fs.writeFileSync(path.join(dir, 'state.json'), text)
  const run = spawnSync(process.execPath, ['-e', "await import('./src/state.js')"], { env: { ...process.env, DATA_DIR: dir, NO_DHT: '1' }, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  return { dir, files: fs.readdirSync(dir), state: fs.readFileSync(path.join(dir, 'state.json'), 'utf8') }
}

test('a state.json that cannot be parsed is kept aside and survives a start that changes nothing', () => {
  const r = startWith('{"profiles":{"a":{"id":"a","name":"Ann"') // cut off mid-write
  assert.equal(r.state, '{"profiles":{"a":{"id":"a","name":"Ann"')
  assert.ok(r.files.some(f => f.startsWith('state.json.unreadable-')))
})

test('titles that fail the checks at start are copied aside before they are dropped', () => {
  const profile = { id: 'a', name: 'Ann', history: { 'tv:x y': { type: 'tv', id: 'x y' }, 'movie:tt1': { type: 'movie', id: 'tt1', name: 'Film' } } }
  const r = startWith(JSON.stringify({ profiles: { a: profile } }))
  assert.ok(r.files.some(f => f.startsWith('state.json.before-clean-')))
  assert.equal(r.state, JSON.stringify({ profiles: { a: profile } }), 'the file itself is untouched until something changes')
})
