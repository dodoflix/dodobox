import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dbx-infra-'))

const dataFrom = (cwd, env = {}) => {
  const e = { ...process.env, ...env }
  if (!env.DATA_DIR) delete e.DATA_DIR
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DATA } from ${JSON.stringify(path.join(root, 'src/paths.js'))}; console.log(DATA)`], { cwd, env: e, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim()
}

test('the default data folder is beside the app wherever the server is started from', () => {
  const cwd = tmp()
  assert.equal(dataFrom(cwd), path.join(root, 'data'))
  fs.rmSync(cwd, { recursive: true })
})

test('an older data folder in the working directory is still used while the app has none', () => {
  // the repo has its own data folder when it was ever run, so copy the module beside a bare app root
  const app = tmp(); const cwd = tmp()
  fs.mkdirSync(path.join(app, 'src'))
  fs.copyFileSync(path.join(root, 'src/paths.js'), path.join(app, 'src/paths.js'))
  fs.mkdirSync(path.join(cwd, 'data'))
  const run = () => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import { DATA } from ${JSON.stringify(path.join(app, 'src/paths.js'))}; console.log(DATA)`], { cwd, env: { ...process.env, DATA_DIR: '' }, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return fs.realpathSync(r.stdout.trim())
  }
  assert.equal(run(), fs.realpathSync(path.join(cwd, 'data')))
  fs.mkdirSync(path.join(app, 'data'))
  assert.equal(run(), fs.realpathSync(path.join(app, 'data')))
  fs.rmSync(app, { recursive: true }); fs.rmSync(cwd, { recursive: true })
})

test('DATA_DIR still overrides the default', () => {
  const d = tmp()
  assert.equal(dataFrom(os.tmpdir(), { DATA_DIR: d }), d)
  fs.rmSync(d, { recursive: true })
})

const floor = (lcov, ...args) => {
  const d = tmp(); const f = path.join(d, 'r.lcov')
  fs.writeFileSync(f, lcov)
  const r = spawnSync(process.execPath, [path.join(root, 'scripts/coverage-floor.js'), f, '90', ...args], { cwd: root, encoding: 'utf8' })
  fs.rmSync(d, { recursive: true })
  return r
}
const rec = (name, found, hit) => `TN:\nSF:${name}\nLF:${found}\nLH:${hit}\nend_of_record\n`

test('the coverage floor passes when every file is over it', () => {
  assert.equal(floor(rec('src/a.js', 10, 10) + rec('src/b.js', 10, 9)).status, 0)
})

test('the coverage floor fails for a file under it even when the average is high', () => {
  const r = floor(rec('src/a.js', 100, 100) + rec('src/b.js', 10, 5))
  assert.equal(r.status, 1)
  assert.match(r.stderr, /src\/b\.js: 50\.0%/)
})

test('the coverage floor fails on an empty report instead of printing NaN', () => {
  const r = floor('')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /nothing was checked/)
  assert.doesNotMatch(r.stdout, /NaN/)
})

test('the coverage floor fails when a named file is not in the report', () => {
  const r = floor(rec('src/a.js', 10, 10), 'src/a.js', 'src/typo.js')
  assert.equal(r.status, 1)
  assert.match(r.stderr, /not in the report: src\/typo\.js/)
})

test('the coverage floor matches a named file by absolute or relative path', () => {
  assert.equal(floor(rec('src/a.js', 10, 10), path.join(root, 'src/a.js')).status, 0)
  assert.equal(floor(rec('src/a.js', 10, 10) + rec('src/b.js', 10, 1), 'src/a.js').status, 0)
})

test('the container health check follows PORT', () => {
  const line = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8').split('\n').find(l => l.startsWith('HEALTHCHECK'))
  assert.match(line, /process\.env\.PORT/)
  assert.doesNotMatch(line, /:3000\//)
})

test('dependency and base image updates are released as fixes', () => {
  const yml = fs.readFileSync(path.join(root, '.github/dependabot.yml'), 'utf8')
  const block = eco => yml.split(/^ {2}- package-ecosystem: /m).find(b => b.startsWith(eco))
  assert.match(block('npm'), /prefix: fix\n/)
  assert.match(block('npm'), /prefix-development: chore/)
  assert.match(block('docker'), /prefix: fix\n/)
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'release-please-config.json'), 'utf8'))
  assert.ok(!cfg['changelog-sections'].find(s => s.type === 'fix').hidden)
})

test('the ffmpeg licence notice ships in the installers and the container image', () => {
  assert.ok(fs.existsSync(path.join(root, 'THIRD_PARTY_NOTICES.md')))
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).build.files.includes('THIRD_PARTY_NOTICES.md'))
  assert.match(fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8'), /COPY .*THIRD_PARTY_NOTICES\.md/)
  assert.match(fs.readFileSync(path.join(root, '.dockerignore'), 'utf8'), /^!THIRD_PARTY_NOTICES\.md$/m)
})
