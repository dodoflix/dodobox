import test from 'node:test'
import assert from 'node:assert/strict'

const { measure, downMbps } = await import('../src/speed.js')
const realFetch = globalThis.fetch
test.afterEach(() => { globalThis.fetch = realFetch })

// A body that sends `kb` kB every 20 ms (10 kB is about 4 Mbps), then ends the way the stream does.
const body = (end, kb) => {
  let n = 0
  return new ReadableStream({
    async pull (c) {
      await new Promise(r => setTimeout(r, 20))
      if (end === 'error' && ++n > 20) return c.error(new Error('timed out'))
      c.enqueue(new Uint8Array(kb * 1e3))
    }
  })
}

test('a link too slow to finish the download is measured, not unknown', async () => {
  globalThis.fetch = async () => new Response(body('never', 20))
  await measure(500) // the window ends the read of a body that never ends
  assert.ok(downMbps() > 6 && downMbps() < 12, `measured ${downMbps()}`)
})

test('a read that fails part way still counts what arrived', async () => {
  globalThis.fetch = async () => new Response(body('error', 10))
  await measure(60e3)
  assert.ok(downMbps() > 2 && downMbps() < 6, `measured ${downMbps()}`)
})
