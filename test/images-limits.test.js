import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('images-limits')
const { image } = await import('../src/images.js')
const DIR = path.join(process.env.DATA_DIR, 'img')

const U = 'https://images.metahub.space/poster/small/tt0000001/img'
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)])
const until = async cond => { for (let i = 0; i < 2000 && !cond(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(cond(), 'condition not reached') }

test('the picture cache is trimmed to its size: unused old files go, the new picture stays', async t => {
  // Sparse files: they count as 400 MB without using the disk.
  for (const [name, days] of [['stale-a', 9], ['stale-b', 8]]) {
    const f = path.join(DIR, name); fs.writeFileSync(f, ''); fs.truncateSync(f, 200e6)
    const old = new Date(Date.now() - days * 86400e3); fs.utimesSync(f, old, old)
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }))
  assert.deepEqual((await image(U, 0)).buf, jpeg)
  await until(() => !fs.existsSync(path.join(DIR, 'stale-a')))
  const kept = crypto.createHash('sha1').update(U).digest('hex')
  assert.ok(fs.existsSync(path.join(DIR, kept)), 'the picture just fetched is not trimmed')
  assert.ok(fs.existsSync(path.join(DIR, 'stale-b')), 'trimming stops once the folder is back under its size')
})

test('a picture that declares more than 8 MB is refused before its body is read', async t => {
  let pulled = false
  const body = new ReadableStream({ pull (c) { pulled = true; c.enqueue(jpeg) } }, { highWaterMark: 0 })
  t.mock.method(globalThis, 'fetch', async () => new Response(body, { headers: { 'content-type': 'image/jpeg', 'content-length': String(9e6) } }))
  await assert.rejects(image('https://images.metahub.space/poster/small/tt0000002/img', 0), /image too large/)
  assert.equal(pulled, false)
})
