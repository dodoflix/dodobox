import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('translate-pool')
const { startPool, attach } = await import('../src/translate.js')
const { npmInstall } = await import('../src/translate-hq.js')

const fake = () => ({ terminated: false, terminate () { this.terminated = true } })

test('a late stop of an old pool leaves its replacement in place', async () => {
  let pool = null
  const forget = p => { if (pool === p) pool = null }
  const make = async mine => { const w = { worker: fake() }; mine.workers.push(w); return w }
  const old = startPool(make, 2, forget); pool = old; await old.ready
  pool = null
  const fresh = startPool(make, 2, forget); pool = fresh; await fresh.ready
  old.stop()
  assert.equal(pool, fresh)
  assert.ok(fresh.workers.every(w => !w.worker.terminated))
})

test('a pool whose startup rejects terminates the workers it made and can be replaced', async () => {
  let pool = null; const made = []
  const forget = p => { if (pool === p) pool = null }
  let n = 0
  pool = startPool(async mine => { const w = { worker: fake() }; made.push(w); mine.workers.push(w); if (++n === 2) throw new Error('initialize failed'); return w }, 3, forget)
  await assert.rejects(pool.ready, /initialize failed/)
  assert.equal(pool, null)
  assert.ok(made.every(w => w.worker.terminated))
})

test('a worker that stops fails its pending and later calls and ends the whole pool', async () => {
  let pool = null
  const forget = p => { if (pool === p) pool = null }
  const threads = []
  pool = startPool(async mine => { const t = Object.assign(new EventEmitter(), { sent: [], postMessage (m) { this.sent.push(m) }, terminate () { if (!this.stopped) setImmediate(() => this.emit('exit', 1)); this.stopped = true } }); threads.push(t); return attach(t, mine) }, 2, forget)
  const [a, b] = await pool.ready
  const answered = a.call('x'); threads[0].emit('message', { id: 1, result: 'ok' })
  assert.equal(await answered, 'ok')
  const waiting = b.call('y')
  threads[0].emit('error', new Error('boom'))
  await assert.rejects(waiting, /stopped/)
  assert.ok(threads.every(t => t.stopped))
  assert.equal(pool, null)
  await assert.rejects(a.call('z'), /boom/) // a call made after the stop must not wait forever
  await new Promise(resolve => setImmediate(resolve)) // their exit events arrive late and change nothing
  await assert.rejects(b.call('z'), /stopped/)
})

test('the translator install runs npm in the folder, through a shell, with a path holding spaces', { skip: process.platform === 'win32' }, async () => {
  const dir = path.join(tmpdir('translate-npm'), 'Ann Lee')
  fs.mkdirSync(dir)
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  const out = path.join(dir, 'out.txt')
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/sh\npwd > "$OUT"\necho "$@" >> "$OUT"\nexit ${FAIL:-0}\n', { mode: 0o755 })
  process.env.OUT = out; process.env.PATH = bin + path.delimiter + process.env.PATH
  await npmInstall(dir)
  const [cwd, args] = fs.readFileSync(out, 'utf8').split('\n')
  assert.equal(fs.realpathSync(cwd), fs.realpathSync(dir))
  assert.match(args, /^install @huggingface\/transformers@4\.3\.1 .*--prefix \.$/)
  process.env.FAIL = '3'
  await assert.rejects(npmInstall(dir), /npm 3/)
})

test('the better translator is offered nowhere the desktop app runs it', async () => {
  const real = process.versions.electron
  Object.defineProperty(process.versions, 'electron', { value: '1.0.0', configurable: true })
  try {
    const hq = await import('../src/translate-hq.js?electron')
    assert.equal(hq.available, false)
    assert.equal(hq.supports('tr'), false)
    hq.ensure(true)
    assert.equal(hq.status().state, 'idle')
  } finally {
    if (real === undefined) delete process.versions.electron; else Object.defineProperty(process.versions, 'electron', { value: real })
  }
})
