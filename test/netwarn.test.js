import test from 'node:test'
import assert from 'node:assert/strict'
import { netWarnings } from '../public/js/netwarn.js'

test('forced quality warns only when a measured connection cannot carry it', () => {
  assert.equal(netWarnings({ quality: 'auto', mode: 'compact', serverMbps: 3, linkMbps: 3 }).length, 0)
  assert.equal(netWarnings({ quality: '2160', mode: 'compact', serverMbps: 0, linkMbps: 0 }).length, 0)
  assert.equal(netWarnings({ quality: '2160', mode: 'compact', serverMbps: 100, linkMbps: 100 }).length, 0)
  assert.equal(netWarnings({ quality: '480', mode: 'compact', serverMbps: 1, linkMbps: 1 }).length, 0)
  const w = netWarnings({ quality: '1080', mode: 'compact', serverMbps: 8, linkMbps: 9 })
  assert.deepEqual(w.map(x => x.k + ':' + x.v), ['quality:auto', 'quality:auto'])
})

test('best quality size warns on a slow server and offers Balanced', () => {
  const w = netWarnings({ quality: 'auto', mode: 'lossless', serverMbps: 20 })
  assert.deepEqual(w.map(x => x.k + ':' + x.v), ['sourceMode:balanced'])
  assert.equal(netWarnings({ quality: 'auto', mode: 'lossless', serverMbps: 20 }, { size: false }).length, 0)
  assert.equal(netWarnings({ quality: 'auto', mode: 'compact', serverMbps: 2 }).length, 0)
})

test('the size fix is the largest mode the server speed can carry', () => {
  const to = (mode, serverMbps) => netWarnings({ quality: 'auto', mode, serverMbps }).map(x => x.v)
  assert.deepEqual(to('lossless', 20), ['balanced'])
  assert.deepEqual(to('lossless', 8), ['compact'])
  assert.deepEqual(to('balanced', 8), ['compact'])
  assert.deepEqual(to('balanced', 19), ['compact'])
  assert.deepEqual(to('balanced', 20), [])
  assert.deepEqual(to('lossless', 79), ['balanced'])
  assert.deepEqual(to('lossless', 80), [])
})
