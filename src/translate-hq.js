// Optional higher-quality translation: Meta's NLLB-200 (distilled, 600M) through transformers.js. Nothing of it is part of
// the install; turning the setting on fetches the library and the model (about 600 MB) into the data folder, once.
// It is far slower than the standard engine on a CPU, so it runs in low-priority child processes and only improves a
// subtitle that is already readable (see translate.js).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fork, spawn } from 'node:child_process'
import { DATA } from './paths.js'

const DIR = path.join(DATA, 'translate', 'hq')
const WORKER = new URL('./translate-hq-worker.js', import.meta.url).pathname
const READY = path.join(DIR, 'ready')
const GEN = 'v4'
// Our interface language codes to NLLB's.
const NLLB = { tr: 'tur_Latn', es: 'spa_Latn', fr: 'fra_Latn', de: 'deu_Latn', it: 'ita_Latn', pt: 'por_Latn', ru: 'rus_Cyrl', nl: 'nld_Latn', pl: 'pol_Latn', ja: 'jpn_Jpan', ko: 'kor_Hang', zh: 'zho_Hans', ar: 'arb_Arab', id: 'ind_Latn', sv: 'swe_Latn', hi: 'hin_Deva', vi: 'vie_Latn', el: 'ell_Grek', he: 'heb_Hebr' }
export const supports = code => code in NLLB
// The marker holds the engine generation and where it runs: 'gpu' or 'cpu'.
const marker = () => { try { return fs.readFileSync(READY, 'utf8').split(':') } catch { return [] } }
export const installed = () => marker()[0] === GEN
export const device = () => marker()[1] || null
// 0..1 while the library and the model are being fetched.
export const progress = { pct: 0, failedAt: 0 }

// Each process holds the model in memory and uses a few threads; a handful of them together are about twice as fast as
// one process with all the cores.
const CPUS = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 4)))
const size = () => (device() === 'gpu' ? 2 : CPUS) // two processes keep the card busy while one waits for its answer
let procs = null; let idle; let serial = 0; const waiting = new Map()
function start (_, k) {
  const c = fork(WORKER, [DIR, '3'], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
  try { os.setPriority(c.pid, 19) } catch {}
  const files = new Map()
  c.on('message', m => {
    if (m.type === 'progress') { if (k) return; files.set(m.file, m); const all = [...files.values()]; progress.pct = Math.min(0.99, 0.1 + 0.9 * all.reduce((n, f) => n + f.loaded, 0) / Math.max(1, all.reduce((n, f) => n + f.total, 0))); return }
    const p = waiting.get(m.id); waiting.delete(m.id)
    if (p) m.error ? p.reject(new Error(m.error)) : p.resolve(m.result)
  })
  c.on('exit', () => { procs = procs?.filter(x => x !== c); if (!procs?.length) procs = null; for (const p of waiting.values()) p.reject(new Error('translator stopped')); waiting.clear() })
  c.call = (msg) => new Promise((resolve, reject) => { waiting.set(++serial, { resolve, reject }); c.send({ ...msg, id: serial }) })
  return c
}
async function workers () {
  procs ||= Array.from({ length: size() }, start)
  // The graphics card's memory is given back soon after the work is done.
  clearTimeout(idle); idle = setTimeout(stop, (device() === 'gpu' ? 60e3 : 3 * 60e3)).unref()
  const list = procs
  const load = (c, d) => (c.loaded ||= c.call({ type: 'load', device: d }).catch(e => { c.loaded = null; throw e }))
  // The first one fetches the model into the shared cache (and finds out where it runs), the others then read it from there.
  const found = await load(list[0], device() || 'auto')
  // A card with little memory may fit only one copy of the model: the ones that cannot load are dropped.
  const rest = await Promise.allSettled(list.slice(1).map(c => load(c, found)))
  const ok = [list[0], ...list.slice(1).filter((c, i) => rest[i].status === 'fulfilled')]
  list.filter(c => !ok.includes(c)).forEach(c => c.kill())
  procs = ok
  workers.found = found
  return ok
}
function stop () { procs?.forEach(c => c.kill()); procs = null }
export async function count () { return (await workers()).length }
// Translates one line in worker k (the caller keeps each worker busy with one line at a time).
export async function line (k, code, text) { const w = await workers(); return w[k % w.length].call({ type: 'translate', to: NLLB[code], text }) }

let installing = null
export function ensure (retry) {
  if (retry) progress.failedAt = 0
  if (installed() || installing || Date.now() - progress.failedAt < 2 * 60e3) return
  progress.pct = 0
  installing = install().catch(e => { progress.failedAt = Date.now(); console.error('[translate-hq] install failed:', e.message) }).finally(() => { installing = null })
}
export function status () {
  if (installed()) return { state: 'ready', device: device() }
  if (installing) return { state: 'installing', pct: progress.pct }
  return { state: progress.failedAt && Date.now() - progress.failedAt < 2 * 60e3 ? 'failed' : 'idle' }
}
async function install () {
  fs.mkdirSync(DIR, { recursive: true })
  fs.writeFileSync(path.join(DIR, 'package.json'), '{"private":true,"type":"module"}')
  // The install scripts only fetch GPU binaries and image tooling this does not use.
  await new Promise((resolve, reject) => spawn('npm', ['install', '@huggingface/transformers@4.3.1', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', DIR], { stdio: 'ignore' }).on('exit', c => c ? reject(new Error('npm ' + c)) : resolve()).on('error', reject))
  progress.pct = 0.1
  await workers() // downloads the model on the first load
  fs.writeFileSync(READY, `${GEN}:${workers.found}`)
  stop() // the pool made while the device was unknown is the wrong size
}
