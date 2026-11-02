import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('meta-cache')
process.env.NO_DHT = '1'
const { persist, catalogKey } = await import('../src/meta.js')

test('only the first catalog pages are written to meta-cache.json, deeper ones are dropped', () => {
  const key = page => catalogKey({ type: 'movie', q: '', genre: 'Drama', page, sort: 'popular', safe: false })
  assert.equal(persist(key(1)), true)
  assert.equal(persist(key(3)), true)
  assert.equal(persist(key(4)), false)
  assert.equal(persist(key(40)), false)
  assert.equal(persist(catalogKey({ type: 'anime', q: 'a:7:b', genre: undefined, page: 9, sort: 'rating', safe: true })), false, 'a colon in the search text does not hide the page')
  assert.equal(persist(catalogKey({ type: 'anime', q: 'a:99:b', page: 1, safe: true })), true)
})

test('entries that are not catalog pages are always kept', () => {
  assert.equal(persist('meta8:series:tt1'), true)
})
