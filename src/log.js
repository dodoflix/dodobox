// Leveled log written to DATA/logs/dodobox.log so a user can send it. Imported first by server.js; console.* is captured too.
// LOG_LEVEL (debug | info | warn | error, default debug) limits the file; the terminal only gets info and above.
import fs from 'node:fs'
import path from 'node:path'
import util from 'node:util'
import { DATA } from './paths.js'

export const LOG_FILE = path.join(DATA, 'logs', 'dodobox.log')
const MAX = 8 * 1024 * 1024 // rotated once to dodobox.log.old, so two files at most
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
// Test runs without their own data folder would write into the developer's data/.
const off = !!process.env.NODE_TEST_CONTEXT && !process.env.DATA_DIR
const floor = off ? 9 : LEVELS[process.env.LOG_LEVEL] ?? 0

let size = -1
function write (level, text) {
  if (LEVELS[level] < floor || !text) return
  try {
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${text}\n`
    if (size < 0) {
      fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
      size = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).size : 0
    }
    if (size + line.length > MAX) { fs.renameSync(LOG_FILE, LOG_FILE + '.old'); size = 0 }
    fs.appendFileSync(LOG_FILE, line)
    size += line.length
  } catch {} // a full or read-only disk must not take the server down
}

const val = v => (typeof v === 'string' ? (/^[\w./:@-]+$/.test(v) ? v : JSON.stringify(v.length > 300 ? v.slice(0, 300) + '...' : v)) : v instanceof Error ? JSON.stringify(v.message) : util.inspect(v, { breakLength: Infinity, depth: 2 }))
const fields = f => { const e = Object.entries(f || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''); return e.length ? ' ' + e.map(([k, v]) => `${k}=${val(v)}`).join(' ') : '' }

const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error }
const term = { info: orig.log, warn: orig.warn, error: orig.error }

// log.info('torrent', 'ready', { hash, files: 3 }) -> "... INFO  [torrent] ready hash=ab12 files=3". An Error in `err` is written with its stack.
const emit = level => (tag, msg, f) => {
  const stack = f?.err instanceof Error ? f.err.stack : null
  const text = `[${tag}] ${msg}${fields(stack ? { ...f, err: undefined } : f)}${stack ? '\n' + stack : ''}`
  write(level, text)
  term[level]?.(`[${tag}] ${msg}${fields(f && { ...f, err: f.err?.message ?? f.err })}`)
}
export const log = { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') }

// Anything still printed with console.* (this code and its dependencies) lands in the file as well.
for (const [method, level] of [['log', 'info'], ['info', 'info'], ['warn', 'warn'], ['error', 'error']]) {
  console[method] = (...args) => { orig[method](...args); write(level, util.format(...args).trim()) }
}

process.on('warning', w => write('warn', `[node] ${w.name}: ${w.message}`))
process.on('exit', code => write('info', `---- exit code=${code}`))

write('info', `---- start pid=${process.pid} node=${process.version} ${process.versions.electron ? `electron=${process.versions.electron} ` : ''}${process.platform}/${process.arch} exec=${process.execPath} data=${DATA}`)
