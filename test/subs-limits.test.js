import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('subs-limits')
const { fetchSubtitle } = await import('../src/subs.js')
const { unzipFirst } = await import('../src/yify.js')
const CACHE = path.join(process.env.DATA_DIR, 'subs')

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n'
const bomb = zlib.gzipSync(Buffer.alloc(40e6)) // a few tens of KB that expand to 40 MB
const reply = (body, headers) => new Response(body, { headers })
const serving = (t, res) => t.mock.method(globalThis, 'fetch', async () => res())

// One stored file in a ZIP, written by hand (the code under test has no zip writer to borrow).
function zip (name, data, method) {
  const body = method === 8 ? zlib.deflateRawSync(data) : data
  const nm = Buffer.from(name)
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nm.length, 26)
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10); central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nm.length, 28)
  const head = Buffer.concat([local, nm, body])
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + nm.length, 12); end.writeUInt32LE(head.length, 16)
  return Buffer.concat([head, central, nm, end])
}

test('a gzip bomb is refused while it is being expanded, and nothing is cached for it', async t => {
  serving(t, () => reply(bomb))
  await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/bomb.gz'), { code: 'ERR_BUFFER_TOO_LARGE' })
  assert.deepEqual(fs.existsSync(CACHE) ? fs.readdirSync(CACHE) : [], [])
})

test('a zip whose subtitle inflates past the limit is refused, a normal one is read', () => {
  assert.throws(() => unzipFirst(zip('a.srt', Buffer.alloc(10e6), 8)), { code: 'ERR_BUFFER_TOO_LARGE' })
  assert.equal(unzipFirst(zip('a.srt', Buffer.from(SRT), 8)).toString(), SRT)
  assert.equal(unzipFirst(zip('a.srt', Buffer.from(SRT), 0)).toString(), SRT)
})

test('a subtitle download that declares more than 5 MB is refused before its body is read', async t => {
  let pulled = false
  const body = new ReadableStream({ pull (c) { pulled = true; c.enqueue(Buffer.from('x')) } }, { highWaterMark: 0 })
  serving(t, () => reply(body, { 'content-length': String(6e6) }))
  await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/big.gz'), /subtitle too large/)
  assert.equal(pulled, false)
})

test('a subtitle download that goes past 5 MB without declaring its length is cut off', async t => {
  let sent = 0
  const body = new ReadableStream({ pull (c) { sent += 1e6; c.enqueue(Buffer.alloc(1e6, 65)) } })
  serving(t, () => reply(body))
  await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/endless.gz'), /subtitle too large/)
  assert.ok(sent <= 8e6, `stopped reading after ${sent} bytes`)
})

test('a subtitle is cached whole under its name, with no temp file left', async t => {
  serving(t, () => reply(zlib.gzipSync(SRT)))
  const vtt = await fetchSubtitle('https://dl.opensubtitles.org/ok.gz')
  assert.match(vtt, /^WEBVTT[\s\S]*Hello/)
  const files = fs.readdirSync(CACHE)
  assert.equal(files.length, 1)
  assert.ok(files[0].endsWith('.vtt'))
  assert.equal(fs.readFileSync(path.join(CACHE, files[0]), 'utf8'), vtt)
})
