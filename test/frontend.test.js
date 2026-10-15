import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PUB = path.resolve('public')
const js = fs.readdirSync(path.join(PUB, 'js')).filter(f => f.endsWith('.js')).map(f => path.join(PUB, 'js', f))
const langFiles = fs.readdirSync(path.join(PUB, 'js', 'lang')).map(f => path.join(PUB, 'js', 'lang', f))

test('every frontend module parses', () => {
  for (const f of [...js, ...langFiles, path.join(PUB, 'sw.js')]) execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' })
})

test('module imports resolve to real exports', () => {
  const exports = {}
  for (const f of js) exports[path.basename(f)] = new Set([...fs.readFileSync(f, 'utf8').matchAll(/export (?:async )?(?:function|const|let|class) ([\w$]+)/g)].map(m => m[1]))
  for (const f of js) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/import \{([^}]+)\} from '\.\/(\w+)\.js'/g)) {
      for (const name of m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) {
        assert.ok(exports[`${m[2]}.js`]?.has(name), `${path.basename(f)} imports ${name} from ${m[2]}.js, which does not export it`)
      }
    }
  }
})

test('every icon the UI references exists in the sprite', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  const have = new Set([...html.matchAll(/<symbol id="i-([\w-]+)"/g)].map(m => m[1]))
  const used = new Set()
  for (const f of [...js, path.join(PUB, 'index.html')]) {
    const t = fs.readFileSync(f, 'utf8')
    for (const m of t.matchAll(/icon\('([\w-]+)'/g)) used.add(m[1])
    for (const m of t.matchAll(/#i-([\w-]+)"/g)) used.add(m[1])
  }
  for (const u of used) assert.ok(have.has(u), `icon ${u} missing from sprite`)
})

test('PWA manifest, icons and service worker shell list are real files', () => {
  const man = JSON.parse(fs.readFileSync(path.join(PUB, 'manifest.webmanifest'), 'utf8'))
  for (const i of man.icons) assert.ok(fs.existsSync(path.join(PUB, i.src)), i.src)
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  const shell = JSON.parse(sw.match(/const SHELL = (\[.*\])/)[1].replace(/'/g, '"'))
  const served = { '/vendor/hls.js': 1 }
  for (const f of shell) assert.ok(served[f] || fs.existsSync(path.join(PUB, f === '/' ? 'index.html' : f)), `${f} in service worker shell but not served`)
})

test('every frontend module is in the offline shell', () => {
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  for (const f of js) assert.ok(sw.includes(`/js/${path.basename(f)}`), `${path.basename(f)} missing from sw.js SHELL`)
})

test('every font file the stylesheet references exists', () => {
  const css = fs.readFileSync(path.join(PUB, 'style.css'), 'utf8')
  const files = [...css.matchAll(/url\(\/fonts\/([^)]+)\)/g)].map(m => m[1])
  assert.ok(files.length >= 10)
  for (const f of files) assert.ok(fs.existsSync(path.join(PUB, 'fonts', f)), `${f} missing`)
})

test('translations: every row has all four languages, and the helpers work', async () => {
  const { ROWS, PATTERNS, COLUMNS } = await import('../public/js/lang/strings.js')
  for (const r of ROWS) { assert.equal(r.length, 5, `row needs 5 columns: ${r[0]}`); assert.ok(r.every(c => typeof c === 'string' && c.length), `empty cell in: ${r[0]}`) }
  const keys = ROWS.map(r => r[0])
  assert.equal(new Set(keys).size, keys.length - keys.filter((k, i) => keys.indexOf(k) !== i).length)
  for (const [re, outs] of PATTERNS) assert.equal(outs.length, 4, `pattern ${re} needs 4 outputs`)
  assert.deepEqual(Object.keys(COLUMNS).sort(), ['de', 'es', 'fr', 'tr'])
  const sample = 'Season 3'.replace(PATTERNS.find(p => p[0].test('Season 3'))[0], PATTERNS.find(p => p[0].test('Season 3'))[1][0])
  assert.equal(sample, 'Sezon 3')
})

test('translations: every extra language file lines up with the dictionary', async () => {
  const { ROWS, PATTERNS } = await import('../public/js/lang/strings.js')
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  const codes = [...sw.matchAll(/\/js\/lang\/extra-(\w+)\.js/g)].map(m => m[1])
  assert.ok(codes.length >= 15)
  assert.ok(codes.every(c => fs.readFileSync(path.join(PUB, 'js/i18n.js'), 'utf8').includes(`'${c}'`)), 'language missing from i18n.js')
  for (const code of codes) {
    const x = await import(`../public/js/lang/extra-${code}.js`)
    assert.equal(x.rows.length, ROWS.length, `${code} rows`)
    assert.equal(x.patterns.length, PATTERNS.length, `${code} patterns`)
    x.rows.forEach((c, i) => assert.ok(typeof c === 'string' && c.length, `${code} empty row ${i} (${ROWS[i][0]})`))
    x.patterns.forEach((out, i) => {
      const groups = new RegExp(PATTERNS[i][0].source + '|').exec('').length - 1
      for (const n of out.matchAll(/\$(\d)/g)) assert.ok(+n[1] <= groups, `${code} pattern ${i} uses $${n[1]} of ${groups}`)
    })
  }
})
