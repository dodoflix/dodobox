import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from './support/tmp.js'

const dir = tmpdir('locale')
process.env.DATA_DIR = dir
process.env.NO_DHT = '1'
const FILE = path.join(dir, 'locale-cache.json')
const now = Date.now()
// 5001 fresh entries, the oldest of them (tt5000) one too many for the cap, and one that is past its week.
const saved = { 'fr:tt9999999': { at: now - 8 * 86400e3, label: 'Vieux' } }
for (let i = 0; i <= 5000; i++) saved[`fr:tt${i}`] = { at: now - i * 1000, label: `Titre ${i}` }
fs.writeFileSync(FILE, JSON.stringify(saved))
const { localizeItems } = await import('../src/locale.js')

const until = async cond => { for (let i = 0; i < 2000 && !cond(); i++) await new Promise(resolve => setImmediate(resolve)); assert.ok(cond(), 'condition not reached') }

test('the saved translations are capped and drop what is past a week, and the file is written whole', async t => {
  const asked = []
  t.mock.method(globalThis, 'fetch', async url => {
    asked.push(decodeURIComponent(String(url)))
    return new Response(JSON.stringify({ results: { bindings: [{ id: { value: 'tt1234567' }, label: { value: 'Nouveau' } }] } }), { headers: { 'content-type': 'application/json' } })
  })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const kept = await localizeItems([{ id: 'tt0', name: 'Zero' }], 'fr')
  assert.equal(kept[0].name, 'Titre 0')
  assert.equal(asked.length, 0, 'a fresh entry is answered from the saved ones')
  const [last, week, fresh] = await localizeItems([{ id: 'tt5000', name: 'Last' }, { id: 'tt9999999', name: 'Week' }, { id: 'tt1234567', name: 'New' }], 'fr')
  assert.equal(asked.length, 1, 'the entry past the cap, the one past a week and the unknown one are looked up together')
  assert.match(asked[0], /"tt5000"/); assert.match(asked[0], /"tt9999999"/)
  assert.deepEqual([last.name, week.name, fresh.name], ['Last', 'Week', 'Nouveau'])
  t.mock.timers.tick(4000)
  await until(() => fs.readFileSync(FILE, 'utf8').includes('Nouveau'))
  const disk = JSON.parse(fs.readFileSync(FILE, 'utf8'))
  assert.ok(Object.keys(disk).length <= 5000, 'the file holds at most the cap')
  assert.equal(disk['fr:tt0'].label, 'Titre 0')
  assert.equal(disk['fr:tt9999999'].label, undefined)
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [])
})
