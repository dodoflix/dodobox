import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { migrate, MIGRATIONS, CURRENT } from '../src/migrate.js'

const dirOf = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-migrate-'))
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
const version = dir => read(dir, 'schema.json').version

const steps = [
  { name: 'profiles list', up: ({ read, write }) => { const s = read('state.json'); if (!s) return; s.profiles = Object.values(s.profiles); write('state.json', s) } },
  { name: 'forget the cache', up: ({ drop }) => drop('meta-cache.json') }
]

test('the shipped data layout is version 1 until a migration is added', () => {
  assert.equal(CURRENT, MIGRATIONS.length + 1)
})

test('a fresh folder is stamped with the current version and gets no backup', () => {
  const dir = path.join(dirOf(), 'data')
  assert.deepEqual(migrate(dir, steps), { from: 3, to: 3, ran: [] }, 'an empty folder has nothing to migrate')
  assert.equal(version(dir), 3)
  assert.ok(!fs.existsSync(path.join(dir, 'backups')))
  const fresh = dirOf()
  assert.deepEqual(migrate(fresh, []), { from: 1, to: 1, ran: [] })
  assert.equal(version(fresh), 1)
})

test('an unversioned folder is version 1; steps run in order, once, and a backup is kept', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: { a: { id: 'a' } } }))
  fs.writeFileSync(path.join(dir, 'meta-cache.json'), '{}')
  const r = migrate(dir, steps)
  assert.deepEqual(r, { from: 1, to: 3, ran: ['profiles list', 'forget the cache'] })
  assert.deepEqual(read(dir, 'state.json').profiles, [{ id: 'a' }])
  assert.ok(!fs.existsSync(path.join(dir, 'meta-cache.json')))
  assert.equal(version(dir), 3)
  const [b] = fs.readdirSync(path.join(dir, 'backups'))
  assert.match(b, /^v1-\d{14}$/)
  assert.deepEqual(read(path.join(dir, 'backups', b), 'state.json').profiles, { a: { id: 'a' } }, 'the backup holds the old layout')
  assert.ok(!fs.existsSync(path.join(dir, 'backups', b, 'meta-cache.json')), 'caches are not backed up')
  assert.deepEqual(migrate(dir, steps), { from: 3, to: 3, ran: [] }, 'a second start does nothing')
  assert.equal(fs.readdirSync(path.join(dir, 'backups')).length, 1)
})

test('a failing step puts every file and the version back', () => {
  const dir = dirOf()
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ profiles: { a: { id: 'a' } } }))
  const bad = [steps[0], { name: 'breaks', up: () => { throw new Error('boom') } }]
  assert.throws(() => migrate(dir, bad), e => e.code === 'MIGRATION_FAILED' && /"breaks": boom/.test(e.message))
  assert.deepEqual(read(dir, 'state.json').profiles, { a: { id: 'a' } }, 'the first step is undone too')
  assert.equal(version(dir), 1)
  assert.deepEqual(migrate(dir, steps), { from: 1, to: 3, ran: ['profiles list', 'forget the cache'] }, 'and the next start can try again')
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
  for (const n of ['v1-20200101000001', 'v1-20200101000002', 'v1-20200101000003', 'v1-20200101000004']) fs.mkdirSync(path.join(dir, 'backups', n), { recursive: true })
  migrate(dir, [steps[0]])
  const left = fs.readdirSync(path.join(dir, 'backups')).sort()
  assert.equal(left.length, 3)
  assert.ok(!left.includes('v1-20200101000001') && !left.includes('v1-20200101000002'))
})
