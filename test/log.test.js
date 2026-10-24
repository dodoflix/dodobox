import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { CURRENT } from '../src/migrate.js'
import { tmpdir } from './support/tmp.js'

function run (code, env = {}) {
  const dir = tmpdir('log')
  execFileSync(process.execPath, ['--input-type=module', '-e', `const { log } = await import('./src/log.js'); ${code}`], { env: { ...process.env, DATA_DIR: dir, ...env }, stdio: 'pipe' })
  const lines = fs.readFileSync(path.join(dir, 'logs', 'dodobox.log'), 'utf8').trim().split('\n')
  return { dir, lines }
}

test('console output and log calls land in DATA/logs/dodobox.log', () => {
  const { dir, lines } = run("console.log('hello'); console.warn('careful'); log.info('torrent', 'ready', { hash: 'ab12', name: 'two words', skip: undefined }); log.debug('http', 'GET /x'); log.error('http', 'boom', { err: new Error('bad') })")
  assert.match(lines[0], /^\S+ INFO {2}---- start pid=\d+ node=/)
  assert.match(lines[1], /^\d{4}-\d\d-\d\dT[\d:.]+Z INFO {2}hello$/)
  assert.match(lines[2], / WARN {2}careful$/)
  assert.match(lines[3], / INFO {2}\[torrent\] ready hash=ab12 name="two words"$/)
  assert.match(lines[4], / DEBUG \[http\] GET \/x$/)
  assert.match(lines[5], / ERROR \[http\] boom$/)
  assert.match(lines[6], /^Error: bad/) // the stack follows
  fs.rmSync(dir, { recursive: true, force: true })
})

test('LOG_LEVEL limits the file', () => {
  const { dir, lines } = run("log.debug('a', 'quiet'); log.warn('a', 'loud')", { LOG_LEVEL: 'warn' })
  assert.equal(lines.filter(l => /quiet/.test(l)).length, 0)
  assert.equal(lines.filter(l => /loud/.test(l)).length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('a data folder holding only the log is still fresh (stamped current, no migration)', () => {
  const { dir } = run("log.info('a', 'x'); await import('./src/data.js')")
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8')).version, CURRENT)
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false)
  fs.rmSync(dir, { recursive: true, force: true })
})
