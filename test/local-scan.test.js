import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('local-scan')
const data = path.join(tmp, 'data'); fs.mkdirSync(data)
const A = path.join(tmp, 'a'); const B = path.join(tmp, 'b'); fs.mkdirSync(A); fs.mkdirSync(B)
Object.assign(process.env, { DATA_DIR: data, HOME: tmp, NO_DHT: '1', MIN_LOCAL_BYTES: '1000' })
const film = (dir, name) => { const f = path.join(dir, name); fs.writeFileSync(f, Buffer.alloc(2000)); return f }
const one = film(A, 'One.Film.2020.mkv'); const two = film(B, 'Two.Film.2021.mkv')
const info = f => { const st = fs.statSync(f); return { mtime: st.mtimeMs, size: st.size, at: Date.now(), parsed: { kind: 'movie', title: f.includes('One') ? 'One Film' : 'Two Film' }, match: { type: 'movie', mid: f.includes('One') ? 'tt1' : 'tt2', name: 'N' } } }
// Saved by an older release: the matches must still be used.
fs.writeFileSync(path.join(data, 'local.json'), JSON.stringify({ app: '0.0.1', data: { [one]: info(one), [two]: info(two) } }))
const state = await import('../src/state.js')
state.setSettings({ mediaDirs: [A, B] })
const local = await import('../src/local.js')

let lookups = []
let gate = null
local.hooks.match = async p => { lookups.push(p.title); if (gate) await gate.promise; return { type: 'movie', mid: 'tt9', name: p.title } }
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const saved = () => JSON.parse(fs.readFileSync(path.join(data, 'local.json'), 'utf8'))

test('matches saved by another release are used as they are, not looked up again', async () => {
  assert.equal(await local.rescan(), 2)
  assert.deepEqual(lookups, [])
  assert.deepEqual(local.all().map(e => e.mid).sort(), ['tt1', 'tt2'])
})

test('files already matched stay playable while a rescan looks up a new one', async () => {
  const three = film(A, 'Three.Film.2022.mkv')
  gate = deferred(); lookups = []
  const scan = local.rescan()
  while (!lookups.length) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(local.all().map(e => e.mid).sort(), ['tt1', 'tt2'], 'the known files are listed before the new one is matched')
  assert.ok(local.find({ type: 'movie', id: 'tt1' }))
  gate.resolve(); gate = null
  assert.equal(await scan, 3)
  assert.ok(local.find({ type: 'movie', id: 'tt9' }), 'the new match joins the list')
  fs.rmSync(three)
  assert.equal(await local.rescan(), 2, 'a file that is gone leaves the list')
  assert.equal(Object.keys(saved().data).length, 2)
})

test('the matches of a folder that is briefly missing are kept for when it comes back', async () => {
  fs.renameSync(B, B + '.away')
  lookups = []
  assert.equal(await local.rescan(), 1)
  assert.ok(saved().data[two], 'the missing folder\'s entry is not forgotten')
  fs.renameSync(B + '.away', B)
  assert.equal(await local.rescan(), 2)
  assert.deepEqual(lookups, [], 'nothing is matched again')
})

test('a folder that is no longer configured is forgotten', async () => {
  state.setSettings({ mediaDirs: [A] })
  assert.equal(await local.rescan(), 1)
  assert.equal(saved().data[two], undefined)
})

test('a local file is served with the size it has now, not the one from the last scan', async () => {
  const id = local.all()[0].id
  fs.writeFileSync(one, Buffer.alloc(1500)) // cut short after the scan
  const out = []
  const res = new Writable({ write (c, _, cb) { out.push(c); cb() } })
  res.writeHead = (code, h) => { res.code = code; res.headers = h; return res }
  await local.serve(id, { headers: {} }, res)
  await new Promise(resolve => res.on('finish', resolve))
  assert.equal(res.headers['content-length'], 1500)
  assert.equal(Buffer.concat(out).length, 1500)
  fs.rmSync(one)
  let code; await local.serve(id, { headers: {} }, { writeHead: c => { code = c; return { end () {} } } })
  assert.equal(code, 404, 'a file that has gone is a 404')
})
