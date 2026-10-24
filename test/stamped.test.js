import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from './support/tmp.js'
import { APP_VERSION, readStamped, stamp } from '../src/stamped.js'

const dir = tmpdir('stamped')
const file = name => path.join(dir, name)

test('a saved file is read back by the version that wrote it', () => {
  fs.writeFileSync(file('a.json'), stamp({ k: 1 }))
  assert.deepEqual(readStamped(file('a.json')), { k: 1 })
})

test('a file from another version, from before versions were recorded, or unreadable gives nothing', () => {
  fs.writeFileSync(file('old.json'), JSON.stringify({ app: '0.0.1', data: { k: 1 } }))
  fs.writeFileSync(file('bare.json'), JSON.stringify({ k: 1 }))
  fs.writeFileSync(file('bad.json'), '{')
  for (const f of ['old.json', 'bare.json', 'bad.json', 'missing.json']) assert.equal(readStamped(file(f)), null, f)
})

// A fresh process per case: these caches are read when their module loads.
const run = (name, content, code) => {
  const d = tmpdir('stamped-run')
  fs.writeFileSync(path.join(d, name), JSON.stringify(content))
  return execFileSync(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, DATA_DIR: d, NO_DHT: '1' }, encoding: 'utf8' }).split('\n').pop()
}
const catalog = "const { cached } = await import('./src/meta.js'); process.stdout.write(await cached('meta8:series:tt1', 1e9, async () => 'fresh'))"
const entry = { 'meta8:series:tt1': { at: Date.now(), v: 'saved' } }

test('the catalog cache of another version is not served, this version is', () => {
  assert.equal(run('meta-cache.json', { app: '0.0.1', data: entry }, catalog), 'fresh')
  assert.equal(run('meta-cache.json', entry, catalog), 'fresh')
  assert.equal(run('meta-cache.json', { app: APP_VERSION, data: entry }, catalog), 'saved')
})

const known = "const l = await import('./src/local.js'); l.hooks.match = async () => ({ type: 'movie', mid: 'tt1', name: 'Fresh' }); process.stdout.write(String(await l.rescan()))"
test('matches of local files saved by another version are worked out again', () => {
  const media = tmpdir('stamped-media'); const f = path.join(media, 'Some.Film.2020.mkv')
  fs.writeFileSync(f, Buffer.alloc(2000)); const st = fs.statSync(f)
  const saved = { [f]: { mtime: st.mtimeMs, size: st.size, at: Date.now(), parsed: { kind: 'movie', title: 'Some Film' }, match: null } }
  const env = `process.env.MEDIA_DIR = ${JSON.stringify(media)}; process.env.MIN_LOCAL_BYTES = '1000';`
  // An unmatched file is only retried after an hour, so a saved entry that is read keeps the count at 0.
  assert.equal(run('local.json', { app: APP_VERSION, data: saved }, env + known), '0')
  assert.equal(run('local.json', { app: '0.0.1', data: saved }, env + known), '1')
})
