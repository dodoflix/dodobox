import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from './support/tmp.js'

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const entries = { 'meta8:series:tt1': { at: Date.now(), v: 'saved' } }

// A fresh process per case: the file is read when the module loads.
const answer = file => {
  const dir = tmpdir('meta-cache')
  fs.writeFileSync(path.join(dir, 'meta-cache.json'), JSON.stringify(file))
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const { cached } = await import('./src/meta.js'); process.stdout.write(await cached('meta8:series:tt1', 1e9, async () => 'fresh'))"],
  { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' })
  return out.split('\n').pop()
}

test('a saved cache written by another version of the app is not served', () => {
  assert.equal(answer({ app: '0.0.1', entries }), 'fresh')
})

test('a saved cache from before versions were recorded is not served', () => {
  assert.equal(answer(entries), 'fresh')
})

test('a saved cache written by this version of the app is served', () => {
  assert.equal(answer({ app: version, entries }), 'saved')
})
