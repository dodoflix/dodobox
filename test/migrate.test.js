import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrate, MIGRATIONS, CURRENT } from '../src/migrate.js'

const dirOf = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-migrate-'))
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const version = dir => read(dir, 'schema.json').version

const steps = [
  { name: 'profiles list', up: ({ read, write }) => { const s = read('state.json'); if (!s) return; s.profiles = Object.values(s.profiles); write('state.json', s) } },
  { name: 'forget the cache', up: ({ drop }) => drop('meta-cache.json') }
]

test('every migration file is registered, in order, and named for the version it produces', async () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/migrations')
  const files = fs.readdirSync(dir).filter(f => /^\d{3}-.+\.js$/.test(f)).sort()
  assert.equal(files.length, MIGRATIONS.length, 'a file is missing from index.js, or index.js lists one that does not exist')
  for (const [i, f] of files.entries()) {
    assert.equal(+f.slice(0, 3), i + 1, `${f} is out of sequence`)
    assert.equal(MIGRATIONS[i], (await import(path.join(dir, f))).default, `${f} is not at position ${i + 1} in index.js`)
  }
  assert.ok(MIGRATIONS.every(m => m.name && typeof m.up === 'function'))
  assert.equal(new Set(MIGRATIONS.map(m => m.name)).size, MIGRATIONS.length, 'names are unique')
  assert.equal(CURRENT, MIGRATIONS.length)
})

test('a fresh folder is stamped current and nothing runs, no backup', () => {
  const dir = dirOf()
  assert.deepEqual(migrate(dir, steps), { from: 2, to: 2, ran: [] })
  assert.equal(version(dir), 2)
  assert.ok(!fs.existsSync(path.join(dir, 'backups')))
})

test('an unversioned folder is version 0: every step runs in order, once, with a backup', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: { a: { id: 'a' } } }))
  fs.writeFileSync(path.join(dir, 'meta-cache.json'), '{}')
  assert.deepEqual(migrate(dir, steps), { from: 0, to: 2, ran: ['profiles list', 'forget the cache'] })
  assert.deepEqual(read(dir, 'state.json').profiles, [{ id: 'a' }])
  assert.ok(!fs.existsSync(path.join(dir, 'meta-cache.json')))
  assert.equal(version(dir), 2)
  const [b] = fs.readdirSync(path.join(dir, 'backups'))
  assert.match(b, /^v0-\d{14}$/)
  assert.deepEqual(read(path.join(dir, 'backups', b), 'state.json').profiles, { a: { id: 'a' } }, 'the backup holds the old layout')
  assert.ok(!fs.existsSync(path.join(dir, 'backups', b, 'meta-cache.json')), 'caches are not backed up')
  assert.deepEqual(migrate(dir, steps), { from: 2, to: 2, ran: [] }, 'a second start does nothing')
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1)
})

test('an install that skipped releases runs only the steps it has not seen', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: { a: { id: 'a' } } }))
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify({ version: 1 }))
  fs.writeFileSync(path.join(dir, 'meta-cache.json'), '{}')
  assert.deepEqual(migrate(dir, steps), { from: 1, to: 2, ran: ['forget the cache'] })
  assert.deepEqual(read(dir, 'state.json').profiles, { a: { id: 'a' } }, 'the first step had already been applied')
})

test('the shipped baseline puts the version on an existing unversioned folder and changes nothing else', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), '{"profiles":{"a":{"id":"a"}},"settings":{}}')
  assert.deepEqual(migrate(dir), { from: 0, to: CURRENT, ran: MIGRATIONS.map(m => m.name) })
  assert.equal(read(dir, 'state.json').profiles.a.id, 'a')
  assert.equal(version(dir), CURRENT)
})

test('a failing step puts every file and the version back', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: { a: { id: 'a' } } }))
  const bad = [steps[0], { name: 'breaks', up: () => { throw new Error('boom') } }]
  assert.throws(() => migrate(dir, bad), e => e.code === 'MIGRATION_FAILED' && /"breaks": boom/.test(e.message))
  assert.deepEqual(read(dir, 'state.json').profiles, { a: { id: 'a' } }, 'the first step is undone too')
  assert.equal(version(dir), 0)
  assert.deepEqual(migrate(dir, steps), { from: 0, to: 2, ran: ['profiles list', 'forget the cache'] }, 'and the next start can try again')
})

test('a folder from a newer Dodobox is refused and left alone', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'schema.json'), JSON.stringify({ version: 9 }))
  fs.writeFileSync(path.join(dir, 'state.json'), '{"x":1}')
  assert.throws(() => migrate(dir, steps), e => e.code === 'NEWER_DATA' && /version 9/.test(e.message))
  assert.equal(version(dir), 9)
  assert.equal(read(dir, 'state.json').x, 1)
})

test('only the newest backups are kept', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: {} }))
  for (const n of ['v0-20200101000001', 'v0-20200101000002', 'v0-20200101000003', 'v0-20200101000004']) fs.mkdirSync(path.join(dir, 'backups', n), { recursive: true })
  migrate(dir, [steps[0]])
  const left = fs.readdirSync(path.join(dir, 'backups')).sort()
  assert.equal(left.length, 3)
  assert.ok(!left.includes('v0-20200101000001') && !left.includes('v0-20200101000002'))
})
