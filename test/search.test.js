import test from 'node:test'
import assert from 'node:assert/strict'
import { fuse, catalog } from '../src/meta.js'

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

test('a search that failed is not remembered as "no results"', async () => {
  const real = globalThis.fetch
  let up = false
  globalThis.fetch = async url => {
    if (!up) return new Response('busy', { status: 500 })
    if (String(url).includes('media-imdb')) return new Response(JSON.stringify({ d: [{ id: 'tt0001234', l: 'Stub Anarchy', qid: 'tvSeries', y: 2008 }] }))
    return new Response(JSON.stringify({ metas: [{ id: 'tt0001234', imdb_id: 'tt0001234', name: 'Stub Anarchy', year: '2008' }] }))
  }
  try {
    await assert.rejects(catalog({ type: 'series', q: 'stub anarchy' }), 'both services failed: an error, not an empty list')
    up = true
    const list = await catalog({ type: 'series', q: 'stub anarchy' })
    assert.deepEqual(list.map(x => x.id), ['tt0001234'], 'the next search is not served the failure')
  } finally { globalThis.fetch = real }
})
