import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { boot, shutdown, stub, json } from './harness.js'

let base
before(async () => {
  // 25 MB arriving slowly enough to be timed, as the real speed test would see it
  stub('speed.cloudflare.com', () => {
    let n = 0
    return new Response(new ReadableStream({
      async pull (controller) { await new Promise(r => setTimeout(r, 40)); controller.enqueue(new Uint8Array(256 * 1024)); if (++n >= 12) controller.close() }
    }))
  })
  ;({ base } = await boot({ speedtest: true, updates: true }))
})
after(shutdown)

test('the speed of the internet line is measured at start and reported', async () => {
  const mbps = async () => (await (await fetch(`${base}/api/server`)).json()).internetMbps
  const t0 = Date.now()
  while (!(await mbps())) { if (Date.now() - t0 > 20000) throw new Error('no speed measured'); await new Promise(r => setTimeout(r, 200)) }
  assert.ok(await mbps() > 1)
})

test('a newer release is announced once the update lookup finds one, and nothing can be installed from a server run', async () => {
  stub('api.github.com', () => json({ tag_name: 'v99.0.0', html_url: 'https://github.com/dodoflix/dodobox/releases/tag/v99.0.0' }))
  assert.equal((await (await fetch(`${base}/api/update`)).json()).phase, 'idle')
  const updates = await import('../src/update.js')
  assert.equal(await updates.lookup('0.0.1'), true)
  assert.equal(await updates.lookup('99.0.0'), false)
  const view = await (await fetch(`${base}/api/update`)).json()
  assert.equal(view.version, '99.0.0')
  assert.equal(view.phase, 'available')
  assert.match(view.hint, /./)
  assert.equal(view.canApply, false)
  assert.equal((await fetch(`${base}/api/update/check`, { method: 'POST' })).status, 200)
  assert.equal((await fetch(`${base}/api/update/download`, { method: 'POST' })).status, 409)
  assert.equal((await fetch(`${base}/api/update/install`, { method: 'POST' })).status, 409)
})

test('the desktop app can download an update and install it when the build can replace itself', async () => {
  const updates = await import('../src/update.js')
  const calls = []
  updates.useDriver({ self: true, check: () => calls.push('check'), download: async () => { calls.push('download'); updates.set({ phase: 'ready' }) }, install: () => calls.push('install') })
  const post = what => fetch(`${base}/api/update/${what}`, { method: 'POST' })
  assert.equal((await (await fetch(`${base}/api/update`)).json()).canApply, true)
  assert.equal((await post('install')).status, 409, 'nothing is ready yet')
  await post('check')
  assert.equal((await post('download')).status, 200)
  const t0 = Date.now()
  while ((await (await fetch(`${base}/api/update`)).json()).phase !== 'ready') { if (Date.now() - t0 > 5000) throw new Error('never ready'); await new Promise(r => setTimeout(r, 50)) }
  assert.equal((await post('install')).status, 200)
  assert.deepEqual(calls, ['check', 'download', 'install'])
  assert.equal(updates.info().version, '99.0.0')
})

// A start that cannot go on must say why and leave the data as it was: run as the real command would.
const dataFolder = files => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-data-'))
  process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text)
  return dir
}

test('a data folder made by a newer Dodobox is refused and left alone', () => {
  const dir = dataFolder({ 'schema.json': '{"version":99}', 'state.json': '{"profiles":{}}' })
  const run = spawnSync(process.execPath, ['server.js'], { env: { ...process.env, DATA_DIR: dir, PORT: '0', NO_MDNS: '1', NO_DHT: '1', NO_UPDATE_CHECK: '1', NO_SPEEDTEST: '1' }, encoding: 'utf8', timeout: 30000 })
  assert.equal(run.status, 1)
  assert.match(run.stderr, /newer Dodobox/)
  assert.equal(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8'), '{"version":99}')
})

test('an update to the data folder that fails halfway puts every file back', () => {
  const dir = dataFolder({ 'state.json': '{"profiles":{"a":1}}' })
  const script = `
    const { migrate } = await import('./src/migrate.js')
    const fs = await import('node:fs'); const path = await import('node:path')
    const steps = [
      { name: 'rewrite', up: t => t.write('state.json', { profiles: {} }) },
      { name: 'boom', up: () => { throw new Error('disk full') } }
    ]
    try { migrate(process.env.DIR, steps) } catch (e) { console.log(JSON.stringify({ code: e.code, message: e.message, state: fs.readFileSync(path.join(process.env.DIR, 'state.json'), 'utf8'), schema: fs.readFileSync(path.join(process.env.DIR, 'schema.json'), 'utf8') })) }`
  const out = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DIR: dir }, encoding: 'utf8' }))
  assert.equal(out.code, 'MIGRATION_FAILED')
  assert.match(out.message, /failed at "boom": disk full/)
  assert.equal(out.state, '{"profiles":{"a":1}}')
  assert.equal(out.schema, '{"version":0}')
})
