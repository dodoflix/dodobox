import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const PUB = path.resolve('public')
const js = fs.readdirSync(path.join(PUB, 'js')).filter(f => f.endsWith('.js')).map(f => path.join(PUB, 'js', f))
const groupsOf = re => new RegExp(re.source + '|').exec('').length - 1
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
  assert.deepEqual(keys.filter((k, i) => keys.indexOf(k) !== i), [], 'a repeated English row never gets used: the later one wins')
  for (const [re, outs] of PATTERNS) {
    assert.equal(outs.length, 4, `pattern ${re} needs 4 outputs`)
    outs.forEach((out, l) => { for (let n = 1; n <= groupsOf(re); n++) assert.ok(out.includes(`$${n}`), `${['tr', 'es', 'fr', 'de'][l]} drops $${n} of ${re}`) })
  }
  assert.deepEqual(Object.keys(COLUMNS).sort(), ['de', 'es', 'fr', 'tr'])
  const sample = 'Season 3'.replace(PATTERNS.find(p => p[0].test('Season 3'))[0], PATTERNS.find(p => p[0].test('Season 3'))[1][0])
  assert.equal(sample, 'Sezon 3')
})

test('translations: every extra language file lines up with the dictionary', async () => {
  const { ROWS, PATTERNS } = await import('../public/js/lang/strings.js')
  const codes = fs.readdirSync(path.join(PUB, 'js/lang')).map(f => f.match(/^extra-(\w+)\.js$/)?.[1]).filter(Boolean)
  assert.ok(codes.length >= 15)
  assert.ok(codes.every(c => fs.readFileSync(path.join(PUB, 'js/i18n.js'), 'utf8').includes(`'${c}'`)), 'language missing from i18n.js')
  for (const code of codes) {
    const x = await import(`../public/js/lang/extra-${code}.js`)
    assert.equal(x.rows.length, ROWS.length, `${code} rows`)
    assert.equal(x.patterns.length, PATTERNS.length, `${code} patterns`)
    x.rows.forEach((c, i) => assert.ok(typeof c === 'string' && c.length, `${code} empty row ${i} (${ROWS[i][0]})`))
    x.patterns.forEach((out, i) => {
      const groups = groupsOf(PATTERNS[i][0])
      for (const n of out.matchAll(/\$(\d)/g)) assert.ok(+n[1] <= groups, `${code} pattern ${i} uses $${n[1]} of ${groups}`)
      for (let n = 1; n <= groups; n++) assert.ok(out.includes(`$${n}`), `${code} pattern ${i} drops $${n}`)
    })
  }
})

test('the first download is preloaded in one go', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  const listed = new Set([...html.matchAll(/rel="modulepreload" href="\/js\/([\w-]+\.js)"/g)].map(m => m[1]))
  const graph = new Set()
  const walk = f => {
    if (graph.has(f)) return
    graph.add(f)
    for (const m of fs.readFileSync(path.join(PUB, 'js', f), 'utf8').matchAll(/^import[^\n]*from '\.\/([\w-]+\.js)'/gm)) walk(m[1])
  }
  walk('main.js')
  graph.delete('main.js')
  assert.deepEqual([...graph].sort(), [...listed].sort(), 'modulepreload list differs from the static imports of main.js')
})

test('English text is recognised, and text in other languages is not', async () => {
  const { looksEnglish } = await import('../public/js/english.js')
  const lines = (...s) => Array.from({ length: 40 }, (_, i) => s[i % s.length])
  assert.ok(looksEnglish(lines('You have what they would never say about this.', "I'm not sure that you are here, but it's fine.")))
  assert.ok(!looksEnglish(lines('Oğlumu aldın ve sana söz veriyorum, bu kutlamalar bitmeden.', 'Göze göz, dişe diş, oğula oğul olacak.')))
  assert.ok(!looksEnglish(lines('Ich habe nicht gesagt, dass du das alles wissen musst.', 'Und was ist mit der Frau, die gestern hier war?')))
  assert.ok(!looksEnglish(lines('Te lo prometo, antes de que acaben estas celebraciones.', 'No es lo que pensaba, pero está bien así.')))
  assert.ok(!looksEnglish(['Too short to tell.']), 'a few words prove nothing')
})

// A minimal DOM with real MutationObserver semantics: every write, even of an identical value, queues a record.
globalThis.location ??= { search: '' } // util.js reads it on import
function fakeDom () {
  const observers = []
  const queue = obs => obs.records.splice(0)
  const note = rec => observers.forEach(o => o.records.push(rec))
  const el = (attrs = {}) => {
    const e = {
      nodeType: 1, attrs, children: [],
      closest: () => null,
      hasAttribute: a => a in e.attrs, getAttribute: a => e.attrs[a] ?? null,
      setAttribute (a, v) { e.attrs[a] = v; note({ type: 'attributes', target: e, attributeName: a }) },
      querySelectorAll: () => []
    }
    return e
  }
  const text = (value, parent) => {
    let v = value
    const t = { nodeType: 3, parentElement: parent, get nodeValue () { return v }, set nodeValue (x) { v = x; note({ type: 'characterData', target: t }) } }
    return t
  }
  const body = el()
  body.nodes = []
  body.append = node => { body.nodes.push(node); note({ type: 'childList', addedNodes: [node] }) }
  const walk = root => { const l = [...(root.nodes || [])]; const w = { currentNode: null, nextNode: () => { if (!l.length) return false; w.currentNode = l.shift(); return true } }; return w }
  globalThis.document = { body, documentElement: {}, createTreeWalker: walk }
  globalThis.NodeFilter = { SHOW_TEXT: 4 }
  globalThis.MutationObserver = class {
    constructor (cb) { this.cb = cb; this.records = []; observers.push(this) }
    observe () {}
    disconnect () { observers.splice(observers.indexOf(this), 1) }
    takeRecords () { return queue(this) }
  }
  // Deliver pending records the way the browser does, round after round; returns how many rounds it took to go quiet.
  const settle = (max = 20) => { for (let round = 0; round < max; round++) { const o = observers[0]; if (!o?.records.length) return round; o.cb(queue(o)) } return Infinity }
  return { el, text, body, settle }
}

test('the interface translator settles: a runtime-set label that translates to itself does not loop', async () => {
  const { ROWS } = await import('../public/js/lang/strings.js')
  const { initI18n, tr, UI_LANGS } = await import('../public/js/i18n.js')
  for (const lang of UI_LANGS.filter(l => l !== 'en')) {
    const dom = fakeDom()
    await initI18n(lang)
    const pp = dom.el({ 'aria-label': 'Play' })
    dom.body.append(pp)
    assert.ok(dom.settle() < 20)
    // what the player does when playback starts ("Pause": French and German keep the word), and any other string a language leaves as it is
    for (const key of ['Pause', ...ROWS.map(r => r[0]).filter(k => tr(k) === k)]) {
      pp.setAttribute('aria-label', key)
      assert.ok(dom.settle() < 20, `${lang} keeps rewriting aria-label="${key}"`)
    }
  }
  await initI18n('en')
})

test('text the translator wrote is not translated a second time', async () => {
  const { initI18n } = await import('../public/js/i18n.js')
  const dom = fakeDom()
  await initI18n('it')
  const h = dom.el()
  const t = dom.text('Downloads', h)
  h.nodes = [t]
  dom.body.append(h)
  assert.ok(dom.settle() < 20)
  assert.equal(t.nodeValue, 'Download', '"Downloads" is "Download" in Italian; "Download" is a different English string ("Scarica")')
  await initI18n('en')
})

test('the storage sentence keeps "Downloads you start yourself are kept" in every language', async () => {
  const { initI18n, tr, UI_LANGS } = await import('../public/js/i18n.js')
  const en = '1.2 GB of 10 GB used. Oldest unwatched downloads are removed automatically when it fills up. Downloads you start yourself are kept.'
  const seen = new Set()
  for (const code of UI_LANGS.filter(l => l !== 'en')) {
    fakeDom()
    await initI18n(code)
    const out = tr(en)
    assert.ok(out.includes('1.2 GB') && out.includes('10 GB'), code)
    assert.ok(!out.includes('you start'), `${code}: sentence left in English`)
    assert.notEqual(tr('First'), 'First', `${code}: "First" is not translated`)
    seen.add(out)
  }
  assert.equal(seen.size, UI_LANGS.length - 1, 'one distinct sentence per language')
  await initI18n('en')
})
