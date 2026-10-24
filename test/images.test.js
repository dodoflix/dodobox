import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('images')
const { image } = await import('../src/images.js')

const URL_ = 'https://images.metahub.space/poster/small/tt0111161/img'
const cached = path.join(process.env.DATA_DIR, 'img', crypto.createHash('sha1').update(URL_).digest('hex'))
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])
const reply = (body, type = 'image/jpeg') => new Response(body, { headers: { 'content-type': type } })

test('a corrupt cached picture is dropped and fetched again', async t => {
  fs.writeFileSync(cached, 'oops'); fs.writeFileSync(cached + '.t', 'image/jpeg')
  t.mock.method(globalThis, 'fetch', async () => reply(jpeg))
  const r = await image(URL_, 0)
  assert.deepEqual(r.buf, jpeg)
  assert.deepEqual(fs.readFileSync(cached), jpeg)
})

test('an upstream answer that is not a picture is refused and not stored', async t => {
  fs.rmSync(cached, { force: true }); fs.rmSync(cached + '.t', { force: true })
  t.mock.method(globalThis, 'fetch', async () => reply('<html>nope</html>'))
  await assert.rejects(image(URL_, 0), { code: 502 })
  assert.equal(fs.existsSync(cached), false)
})

test('two requests for the same picture at once both succeed', async t => {
  fs.rmSync(cached, { force: true }); fs.rmSync(cached + '.t', { force: true })
  t.mock.method(globalThis, 'fetch', async () => reply(jpeg))
  const [a, b] = await Promise.all([image(URL_, 0), image(URL_, 0)])
  assert.deepEqual(a.buf, b.buf)
  assert.deepEqual(fs.readdirSync(path.dirname(cached)).filter(f => f.endsWith('.tmp')), [])
})
