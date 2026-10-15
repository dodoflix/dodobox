// Subtitle translation, on the server, for every device: English subtitles are translated into the viewer's language with
// the open-source engine and models behind Firefox Translations (Bergamot, MPL-2.0). It runs as WebAssembly in a worker
// thread, needs no GPU and no account, and the roughly 20 MB model for a language is downloaded once and kept.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import os from 'node:os'
import { Worker } from 'node:worker_threads'
import { DATA } from './paths.js'
import { fetchRetry } from './http.js'
import * as hq from './translate-hq.js'

const REGISTRY = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records'
const FILES = 'https://firefox-settings-attachments.cdn.mozilla.net/'
const DIR = path.join(DATA, 'translate')
const ENGINE_SRC = new URL('../node_modules/@browsermt/bergamot-translator/worker/', import.meta.url)
// Our interface language codes to the models' (everything else is the same code).
const MODEL_LANG = { zh: 'zh-Hans', no: 'nb' }
export const modelLang = code => MODEL_LANG[code] || code

// ---------- models ----------
let reg = null
async function registry () {
  if (reg && Date.now() - reg.at < 12 * 3600e3) return reg.data
  const file = path.join(DIR, 'registry.json')
  try {
    const r = await fetchRetry(REGISTRY, { timeout: 30000, tries: 4 })
    const data = (await r.json()).data.filter(x => x.fromLang === 'en' && !/[a-z]/i.test(x.version.replace(/\./g, '')))
    fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data))
    reg = { at: Date.now(), data }
  } catch (e) {
    // Offline: the list saved last time still says which models exist.
    try { reg = { at: Date.now() - 11 * 3600e3, data: JSON.parse(fs.readFileSync(file, 'utf8')) } } catch { throw e }
  }
  return reg.data
}

const newer = (a, b) => { const x = a.split('.').map(Number); const y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false }

// Languages English can be translated into.
export async function targets () { return [...new Set((await registry()).map(r => r.toLang))] }
export const canTranslateTo = async code => (await targets()).includes(modelLang(code))

export function pickSet (records) {
  const versions = [...new Set(records.map(r => r.version))].sort((a, b) => (newer(a, b) ? -1 : 1))
  for (const v of versions) {
    const at = Object.fromEntries(records.filter(r => r.version === v).map(r => [r.fileType, r]))
    if (at.model && at.lex && (at.vocab || (at.srcvocab && at.trgvocab))) return at
  }
  return null
}

// report({ stage: 'model', pct }) while model files are downloaded (nothing is reported when they are already on disk).
async function modelBuffers (code, report = () => {}) {
  const to = modelLang(code)
  // The newest version that has every file it needs: all from that one version (a language can still carry an older
  // shared vocabulary beside newer separate ones, and mixing versions crashes the engine).
  const records = (await registry()).filter(r => r.toLang === to)
  const set = pickSet(records)
  if (!set) throw Object.assign(new Error(`no translation model for ${code}`), { code: 404 })
  const best = set
  const need = best.vocab ? ['model', 'lex', 'vocab'] : ['model', 'lex', 'srcvocab', 'trgvocab']
  const dir = path.join(DIR, 'models', to); fs.mkdirSync(dir, { recursive: true })
  const files = need.map(k => best[k])
  const cached = r => { try { const b = fs.readFileSync(path.join(dir, `${r.version}-${r.name}`)); return crypto.createHash('sha256').update(b).digest('hex') === r.attachment.hash ? b : null } catch { return null } }
  const have = new Map(files.map(r => [r, cached(r)]))
  const total = files.filter(r => !have.get(r)).reduce((n, r) => n + r.attachment.size, 0)
  let got = 0
  const load = async r => {
    if (have.get(r)) return have.get(r)
    const res = await fetchRetry(FILES + r.attachment.location, { timeout: 120000, tries: 8 })
    const chunks = []; let mine = 0
    for await (const c of res.body) { chunks.push(c); mine += c.length; report({ stage: 'model', pct: Math.min(0.99, (got + mine) / total) }) }
    const buf = Buffer.concat(chunks)
    if (crypto.createHash('sha256').update(buf).digest('hex') !== r.attachment.hash) throw new Error(`corrupt download of ${r.name}`)
    fs.writeFileSync(path.join(dir, `${r.version}-${r.name}`), buf)
    got += buf.length
    return buf
  }
  const bytes = async r => { const b = await load(r); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }
  const [model, shortlist, ...vocabs] = [await bytes(best.model), await bytes(best.lex), ...(await Promise.all(files.filter(r => r.fileType.endsWith('vocab')).map(bytes)))]
  return { model, shortlist, vocabs }
}

// ---------- engine ----------
// The package's worker script is written for browsers and (with a shim) Node; as CommonJS next to its WebAssembly it
// runs unchanged in a worker thread. The files are copied beside the downloaded models, once.
function engineFile () {
  const dir = path.join(DIR, 'engine'); fs.mkdirSync(dir, { recursive: true })
  for (const [from, to] of [['translator-worker.js', 'translator-worker.cjs'], ['bergamot-translator-worker.js', 'bergamot-translator-worker.js'], ['bergamot-translator-worker.wasm', 'bergamot-translator-worker.wasm']]) {
    const src = new URL(from, ENGINE_SRC); const dst = path.join(dir, to)
    if (!fs.existsSync(dst) || fs.statSync(dst).size !== fs.statSync(src).size) fs.copyFileSync(src, dst)
  }
  return path.join(dir, 'translator-worker.cjs')
}

// Marian settings. The engine's defaults are Firefox's: greedy decoding (beam 1), chosen for speed on any laptop.
// A wider beam (5) reads clearly better than greedy on dialogue (a whole film takes about 14 s instead of 7).
const SETTINGS = { 'beam-size': +process.env.TRANSLATE_BEAM || 5 }

// A pool of workers (the engine itself is single-threaded): the lines of a subtitle are shared between them.
const SIZE = Math.min(4, Math.max(1, os.availableParallelism() - 1))
let pool = null; let idle
async function spawn () {
  const worker = new Worker(engineFile())
  const pending = new Map(); let serial = 0
  worker.on('message', ({ id, result, error }) => { const p = pending.get(id); pending.delete(id); if (p) error ? p.reject(Object.assign(new Error(error.message), { stack: error.stack })) : p.resolve(result) })
  worker.on('error', e => { for (const p of pending.values()) p.reject(e); pending.clear(); pool = null })
  worker.on('exit', () => { pool = null })
  const w = { worker, loaded: new Set(), call: (name, ...args) => new Promise((resolve, reject) => { pending.set(++serial, { resolve, reject }); worker.postMessage({ id: serial, name, args }) }) }
  await w.call('initialize', {})
  return w
}
async function ready (code, report) {
  pool ||= Promise.all(Array.from({ length: SIZE }, spawn))
  const workers = await pool
  clearTimeout(idle); idle = setTimeout(() => { workers.forEach(w => w.worker.terminate()); pool = null }, 10 * 60e3).unref() // the models take memory
  const need = workers.filter(w => !w.loaded.has(code))
  if (need.length) {
    const buffers = await modelBuffers(code, report)
    // Each worker takes its own copy of the model memory.
    await Promise.all(need.map(w => w.call('loadTranslationModel', { from: 'en', to: modelLang(code) }, { model: buffers.model.slice(0), shortlist: buffers.shortlist.slice(0), vocabs: buffers.vocabs.map(v => v.slice(0)), config: SETTINGS }).then(() => w.loaded.add(code))))
  }
  return workers
}

const cancelled = () => Object.assign(new Error('cancelled'), { code: 499 })

async function translateAll (code, texts, report = () => {}, j = {}) {
  const workers = await ready(code, report)
  if (j.stop) throw cancelled()
  const out = new Array(texts.length)
  const step = 60; let next = 0; let finished = 0
  await Promise.all(workers.map(async w => {
    for (;;) {
      const from = next; next += step
      if (from >= texts.length) return
      if (j.stop) throw cancelled()
      const part = await w.call('translate', { models: [{ from: 'en', to: modelLang(code) }], texts: texts.slice(from, from + step).map(text => ({ text, html: true })) })
      part.forEach((p, i) => { out[from + i] = p.target.text })
      finished += part.length; report({ stage: 'translating', pct: finished / texts.length })
    }
  }))
  return out
}

// ---------- subtitles ----------
const plain = t => t.replace(/<[^>]*>/g, '')
const ENDS = /[.!?\u2026"\u201d)\]\u266a]\s*$/
const DASH = /^\s*[-\u2013\u2014]\s*/

export function parseVtt (text) {
  const cues = []
  for (const block of text.replace(/\r/g, '').replace(/^\uFEFF/, '').split(/\n{2,}/)) {
    const lines = block.split('\n'); const k = lines.findIndex(l => l.includes('-->'))
    if (k < 0 || /^(NOTE|STYLE|REGION)/.test(lines[0])) continue
    const body = lines.slice(k + 1).join('\n').trim()
    if (body) cues.push({ head: lines.slice(0, k + 1).join('\n'), s: timeOf(lines[k]), e: timeOf(lines[k], 1), text: body })
  }
  return cues
}
function timeOf (line, end) {
  const m = line.match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/); if (!m) return 0
  const p = m[end ? 2 : 1].replace(',', '.').split(':').map(Number)
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]
}

// A sentence often runs over two or three subtitles; translating the fragments one by one reads badly. Neighbours that
// belong together are translated as one sentence and the result is shared back out by length.
export function plan (cues) {
  const units = []
  for (let i = 0; i < cues.length; i++) {
    const lines = cues[i].text.split('\n')
    // "- Hello" / "- Hi there": two speakers in one subtitle, each line its own sentence.
    if (lines.length > 1 && lines.every(l => DASH.test(l))) { units.push({ cues: [i], lines }); continue }
    const group = [i]
    while (group.length < 3) {
      const last = cues[group.at(-1)]; const next = cues[group.at(-1) + 1]
      if (!next || ENDS.test(plain(last.text)) || next.s - last.e > 1 || DASH.test(next.text) || next.text.split('\n').length > 1 && next.text.split('\n').every(l => DASH.test(l))) break
      group.push(group.at(-1) + 1)
    }
    i = group.at(-1)
    units.push({ cues: group, lines: [group.map(j => cues[j].text.replace(/\n/g, ' ')).join(' ')] })
  }
  return units
}

const wrap = t => {
  if (t.includes('\n') || plain(t).length <= 42) return t
  const mid = t.length / 2; let best = -1
  for (let i = 0; i < t.length; i++) if (t[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i
  return best > 0 ? t.slice(0, best) + '\n' + t.slice(best + 1) : t
}
// Shares translated words out to the subtitles of one sentence, in proportion to how long each was.
export function share (translated, weights) {
  if (weights.length === 1) return [translated]
  const clean = plain(translated).trim(); const words = clean.split(/\s+/)
  const total = weights.reduce((a, b) => a + b, 0) || 1
  const out = []; let at = 0; let acc = 0
  weights.forEach((w, k) => {
    acc += w
    const to = k === weights.length - 1 ? words.length : Math.max(at, Math.min(words.length, Math.round(words.length * acc / total)))
    out.push(words.slice(at, to).join(' ')); at = to
  })
  return out
}

// SHOUTED lines (signs, screams) are translated badly; sentence case reads like the rest of the text to the model.
export function prep (text) {
  const letters = plain(text).replace(/[^\p{L}]/gu, '')
  if (letters.length < 4 || letters !== letters.toLocaleUpperCase('en')) return text
  return text.toLocaleLowerCase('en').replace(/(^|[.!?]\s+|<i>)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase('en'))
}
// The models invent things now and then: a dash or a quotation mark the line never had, or a short line (a name) turned
// into a whole phrase. Those are put right, or the original word is kept.
export function clean (source, out) {
  const words = t => plain(t).trim().split(/\s+/).filter(Boolean).length
  if (words(source) <= 3 && words(out) >= words(source) * 2 + 1) return source
  if (!DASH.test(source)) out = out.replace(DASH, '')
  if (!source.includes('"')) out = out.replace(/"/g, '')
  return out
}

export function analyse (vtt) {
  const cues = parseVtt(vtt)
  const units = plan(cues)
  return { cues, units, texts: units.flatMap(u => u.lines) }
}
// The subtitle file from the translated lines. A line that is undefined (not translated yet) leaves its subtitles as the
// fallback cues have them.
export function assemble ({ cues, units }, lines, fallback) {
  const result = new Array(cues.length)
  let at = 0
  for (const u of units) {
    const mine = lines.slice(at, at + u.lines.length); at += u.lines.length
    if (mine.some(l => l == null)) { u.cues.forEach(j => { result[j] = fallback?.[j]?.text ?? plain(cues[j].text) }); continue }
    if (u.cues.length === 1) result[u.cues[0]] = wrap(mine.join('\n'))
    else share(mine[0], u.cues.map(j => plain(cues[j].text).length)).forEach((t, k) => { result[u.cues[k]] = wrap(t) })
  }
  // An empty result keeps the original words: a subtitle with no text would vanish when the file is read back.
  return 'WEBVTT\n\n' + cues.map((c, i) => `${c.head}\n${result[i]?.trim() ? result[i] : plain(c.text)}\n`).join('\n')
}

export async function translateVtt (vtt, code, report, j) {
  const a = analyse(vtt)
  if (!a.cues.length) return vtt
  const done = (await translateAll(code, a.texts.map(prep), report, j)).map((t, i) => clean(a.texts[i], t))
  return assemble(a, done)
}

// One translation at a time (the engine is single-threaded) and every result kept, so a subtitle is translated once.
const cache = new Map()
let chain = Promise.resolve()
// report({ stage: 'model' | 'translating', pct }) follows the work, for the viewer's progress display.
// signal: when every request waiting on this translation has gone away, the work stops (the part done is not kept).
const running = new Map()
const keyOf = (code, vtt) => crypto.createHash('sha1').update(code + '\n' + vtt).digest('hex')
export function translateSubtitle (vtt, code, report, signal) {
  const key = keyOf(code, vtt)
  const file = path.join(DIR, 'cache', key + '.vtt')
  if (cache.has(key)) return Promise.resolve(cache.get(key))
  try { const t = fs.readFileSync(file, 'utf8'); cache.set(key, t); return Promise.resolve(t) } catch {}
  let j = running.get(key)
  if (!j || j.stop) {
    j = { waiting: 0, stop: false }
    const mine = j
    mine.done = chain = chain.catch(() => {}).then(async () => {
      if (mine.stop) throw cancelled()
      const t = await translateVtt(vtt, code, report, mine)
      fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, t)
      cache.set(key, t); if (cache.size > 40) cache.delete(cache.keys().next().value)
      return t
    })
    mine.done.then(() => {}, () => {}).then(() => { if (running.get(key) === mine) running.delete(key) })
    running.set(key, mine)
  }
  const mine = j
  mine.waiting++
  signal?.addEventListener('abort', () => { if (--mine.waiting <= 0) mine.stop = true }, { once: true })
  return mine.done
}
export function stopBetter (vtt, code) { const j = jobs.get(keyOf(code, vtt)); if (j) j.stop = true }

// ---------- higher quality (optional) ----------
// The standard translation is served at once; the better engine then goes over the subtitle in the background, starting at
// the playhead, and every request returns the lines improved so far. One subtitle is worked on at a time.
const jobs = new Map()
let active = null
const STALE = 10 * 60e3 // nobody asked for it for this long: stop and keep what is done
const sane = (src, out) => out && out.length <= src.length * 3 + 20

// The standard translation's cues, only if they line up one to one with the source's (else wrong lines would be shown).
const aligned = (base, n) => { const c = parseVtt(base); return c.length === n ? c : null }
function job (key, vtt, code, base) {
  let j = jobs.get(key)
  if (j) return j
  const a = analyse(vtt)
  const starts = a.units.flatMap(u => u.lines.map(() => a.cues[u.cues[0]].s))
  const file = path.join(DIR, 'cache', key + '.hq.json')
  let saved = []
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) } catch {}
  j = { a, code, starts, file, base: aligned(base, a.cues.length), lines: a.texts.map((_, i) => saved[i] ?? undefined), taken: a.texts.map((_, i) => saved[i] != null), at: 0, seen: Date.now(), running: false }
  j.finished = j.taken.filter(Boolean).length
  jobs.set(key, j); if (jobs.size > 6) jobs.delete(jobs.keys().next().value)
  return j
}
const save = j => { try { fs.writeFileSync(j.file, JSON.stringify(j.lines.map(l => l ?? null))) } catch {} }
function next (j) {
  let i = j.starts.findIndex((t, k) => t >= j.at && !j.taken[k])
  if (i < 0) i = j.taken.indexOf(false)
  if (i >= 0) j.taken[i] = true
  return i
}
async function run (j) {
  if (j.running) return
  if (active && active !== j) active.stop = true
  active = j; j.running = true; j.stop = false
  const saver = setInterval(() => save(j), 20000).unref()
  try {
    const n = await hq.count()
    await Promise.all(Array.from({ length: n }, async (_, k) => {
      for (;;) {
        if (j.stop || Date.now() - j.seen > STALE) return
        const i = next(j); if (i < 0) return
        try {
          const out = clean(j.a.texts[i], await hq.line(k, j.code, prep(j.a.texts[i])))
          j.lines[i] = sane(j.a.texts[i], out) ? out : null
        } catch { j.lines[i] = null }
        j.finished++
      }
    }))
  } finally {
    clearInterval(saver); save(j); j.running = false
    // Lines taken but not finished (stopped mid-way) are free again.
    j.taken = j.taken.map((t, i) => j.lines[i] !== undefined)
    if (active === j) active = null
  }
}
// The subtitle as improved so far. done is 0..1; prep is set while the better engine is still being fetched.
export async function translateBetter (vtt, code, at, report, signal) {
  const base = await translateSubtitle(vtt, code, report, signal)
  if (!hq.supports(code)) return { vtt: base, done: 1 }
  if (!hq.installed()) {
    hq.ensure()
    return { vtt: base, done: Date.now() - hq.progress.failedAt < 2 * 60e3 ? 1 : 0, prep: hq.progress.pct }
  }
  const key = crypto.createHash('sha1').update(code + '\n' + vtt).digest('hex')
  const j = job(key, vtt, code, base)
  j.seen = Date.now(); j.at = at
  if (j.finished < j.lines.length) run(j).catch(() => {})
  // null (rejected by the checks) keeps the standard translation, as does a line not reached yet
  const lines = j.lines.map(l => l || undefined)
  return { vtt: assemble(j.a, lines, j.base), done: j.finished / Math.max(1, j.lines.length) }
}
