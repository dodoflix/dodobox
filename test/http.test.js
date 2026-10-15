import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { fetchRetry, getJSON, once } from '../src/http.js'

function server (handler) {
  return new Promise(resolve => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s)) })
}
const url = (s, p = '/') => `http://127.0.0.1:${s.address().port}${p}`

test('retries rate limits and server errors, then succeeds', async () => {
  let n = 0
  const s = await server((req, res) => { n++; if (n < 3) res.writeHead(n === 1 ? 429 : 503, { 'retry-after': '0' }).end(); else res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}') })
  assert.deepEqual(await getJSON(url(s)), { ok: true })
  assert.equal(n, 3)
  s.closeAllConnections(); s.close()
})

test('does not retry client errors', async () => {
  let n = 0
  const s = await server((req, res) => { n++; res.writeHead(404).end() })
  await assert.rejects(fetchRetry(url(s), { tries: 4 }), { status: 404 })
  assert.equal(n, 1)
  s.closeAllConnections(); s.close()
})

test('gives up after the allowed attempts', async () => {
  let n = 0
  const s = await server((req, res) => { n++; res.writeHead(500, { 'retry-after': '0' }).end() })
  await assert.rejects(fetchRetry(url(s), { tries: 3 }), { status: 500 })
  assert.equal(n, 3)
  s.closeAllConnections(); s.close()
})

test('identical concurrent requests share one fetch', async () => {
  let n = 0
  const s = await server((req, res) => { n++; setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"v":1}'), 80) })
  const [a, b, c] = await Promise.all([getJSON(url(s, '/x')), getJSON(url(s, '/x')), getJSON(url(s, '/x'))])
  assert.deepEqual([a.v, b.v, c.v], [1, 1, 1])
  assert.equal(n, 1)
  s.closeAllConnections(); s.close()
  let calls = 0
  const [p, q] = await Promise.all([once('k', async () => ++calls), once('k', async () => ++calls)])
  assert.equal(p, q); assert.equal(calls, 1)
})
