import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-state-'))
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

test('settings are validated and persisted to disk', () => {
  const p = state.createProfile('Di')
  state.updateProfile(p.id, { settings: { sublang: 'eng', evil: 'x' } })
  assert.equal(state.profile(p.id).settings.sublang, 'eng')
  assert.equal('evil' in state.profile(p.id).settings, false)
  assert.equal(state.setSettings({ maxStorageGB: 1 }).maxStorageGB, 2)
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
