import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('translate-pool')
const { startPool } = await import('../src/translate.js')
const { npmCall } = await import('../src/translate-hq.js')

const fake = () => ({ terminated: false, terminate () { this.terminated = true } })

test('a failing worker ends every worker of its pool and clears the pool', async () => {
  let pool = null; const made = []
  const forget = p => { if (pool === p) pool = null }
  pool = startPool(async mine => { const w = { worker: fake() }; made.push(w); mine.workers.push(w); return w }, 3, forget)
  await pool.ready
  const first = pool
  first.stop()
  assert.ok(made.every(w => w.worker.terminated))
  assert.equal(pool, null)
})

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

test('the translator install runs npm.cmd through a shell with a quoted folder on Windows', () => {
  const dir = 'C:\\Users\\Ann Lee\\dodobox\\hq'
  const [cmd, args, opts] = npmCall('win32', dir)
  assert.equal(cmd, 'npm.cmd')
  assert.equal(opts.shell, true)
  assert.equal(args.at(-1), `"${dir}"`)
  const [ucmd, uargs, uopts] = npmCall('linux', '/home/ann lee/hq')
  assert.equal(ucmd, 'npm')
  assert.equal(uopts.shell, false)
  assert.equal(uargs.at(-1), '/home/ann lee/hq')
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
