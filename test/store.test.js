import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from './support/tmp.js'
import { putFile, putFileSync, readCapped, touch, trim, trimSoon } from '../src/store.js'

const dir = () => tmpdir('store')
const day = 86400e3
const age = (f, days) => { const t = new Date(Date.now() - days * day); fs.utimesSync(f, t, t) }
const until = async cond => { for (let i = 0; i < 2000 && !(await cond()); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(await cond(), 'condition not reached') }

test('a file is written whole under its name and no temp file stays behind', async () => {
  const d = dir()
  await putFile(path.join(d, 'a'), 'one'); putFileSync(path.join(d, 'b'), 'two')
  assert.deepEqual(fs.readdirSync(d).sort(), ['a', 'b'])
  assert.equal(fs.readFileSync(path.join(d, 'a'), 'utf8') + fs.readFileSync(path.join(d, 'b'), 'utf8'), 'onetwo')
})

test('a body over the limit is refused from its declared length without reading it, or while reading when none is declared', async () => {
  let pulled = false
  const declared = new Response(new ReadableStream({ pull (c) { pulled = true; c.enqueue(Buffer.from('x')) } }, { highWaterMark: 0 }), { headers: { 'content-length': '100' } })
  await assert.rejects(readCapped(declared, 10, 'thing'), { message: 'thing too large', code: 'TOO_LARGE' })
  assert.equal(pulled, false)
  await assert.rejects(readCapped(new Response(Buffer.alloc(100)), 10), /download too large/)
  assert.equal((await readCapped(new Response('hello'), 10)).toString(), 'hello')
  assert.equal((await readCapped(new Response(null, { status: 204 }), 10)).length, 0)
})

test('a folder over its size loses its least recently used files first, down to 90%, and keeps the rest', async () => {
  const d = dir()
  for (const [name, days] of [['old', 5], ['mid', 3], ['new', 1], ['newest', 0]]) { const f = path.join(d, name); fs.writeFileSync(f, Buffer.alloc(100)); age(f, days) }
  await trim(d, 400)
  assert.equal(fs.readdirSync(d).length, 4, 'at the limit nothing goes')
  await trim(d, 399)
  assert.deepEqual(fs.readdirSync(d).sort(), ['mid', 'new', 'newest'], 'only enough is removed, the oldest first')
  await trim(d, 150)
  assert.deepEqual(fs.readdirSync(d), ['newest'])
})

test('a file that was just used outlives one that was not', async () => {
  const d = dir()
  for (const [name, days] of [['used', 9], ['idle', 5]]) { const f = path.join(d, name); fs.writeFileSync(f, Buffer.alloc(100)); age(f, days) }
  touch(path.join(d, 'used'))
  await until(() => Date.now() - fs.statSync(path.join(d, 'used')).mtimeMs < day)
  await trim(d, 150)
  assert.deepEqual(fs.readdirSync(d), ['used'])
})

test('temp files of a write that died are cleaned up, a recent one is left to finish', async () => {
  const d = dir()
  fs.writeFileSync(path.join(d, 'x.1.tmp'), 'dead'); age(path.join(d, 'x.1.tmp'), 1)
  fs.writeFileSync(path.join(d, 'x.2.tmp'), 'live')
  fs.mkdirSync(path.join(d, 'sub'))
  await trim(d, 1e9)
  assert.deepEqual(fs.readdirSync(d).sort(), ['sub', 'x.2.tmp'])
})

test('trimming a folder that does not exist is not an error, and a second trim while one runs is skipped', async () => {
  await trim(path.join(dir(), 'missing'), 1)
  const d = dir(); fs.writeFileSync(path.join(d, 'a'), Buffer.alloc(100))
  await Promise.all([trim(d, 10), trim(d, 10)])
  assert.deepEqual(fs.readdirSync(d), [])
})

test('trimSoon checks a folder at most once a minute', async () => {
  const d = dir(); fs.writeFileSync(path.join(d, 'a'), Buffer.alloc(100))
  trimSoon(d, 10)
  await until(() => fs.readdirSync(d).length === 0)
  fs.writeFileSync(path.join(d, 'b'), Buffer.alloc(100))
  trimSoon(d, 10)
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(fs.readdirSync(d), ['b'], 'the second call within the minute does nothing')
})
