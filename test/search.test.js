import test from 'node:test'
import assert from 'node:assert/strict'
import { fuse } from '../src/meta.js'

const it = (id, name) => ({ id, name })

test('search fusion: titles both services agree on rise, the catalog\'s richer item is kept', () => {
  const suggested = [it('tt1', 'Wrong Hit'), it('tt2', 'Right Title short')]
  const searched = [it('tt2', 'Right Title'), it('tt3', 'Other')]
  const out = fuse(suggested, searched)
  assert.deepEqual(out.map(x => x.id), ['tt2', 'tt1', 'tt3'])
  assert.equal(out[0].name, 'Right Title')
})

test('search fusion: one empty list leaves the other as it was', () => {
  assert.deepEqual(fuse([it('tt1', 'a'), it('tt2', 'b')], []).map(x => x.id), ['tt1', 'tt2'])
  assert.deepEqual(fuse([], [it('tt9', 'z')]).map(x => x.id), ['tt9'])
})
