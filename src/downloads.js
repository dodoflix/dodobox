// Download without watching: a queue that starts a few at a time. Downloads the user asks for are pinned and never evicted.
import { meta } from './meta.js'
import * as engine from './engine.js'
import * as local from './local.js'
import { log } from './log.js'
import { racing } from './race.js'

const MAX_ACTIVE = 3
const queue = []
const failed = []
let play = null; let running = false
let current = null // the job being started: off the queue, not yet in the engine
const pending = () => (current ? [current, ...queue] : queue)

const key = j => `${j.type}:${j.id}:${j.season ?? ''}:${j.episode ?? ''}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const active = () => engine.library().filter(r => r.pinned && !r.held && !racing.has(r.hash) && r.phase !== 'done' && r.phase !== 'error').length

export const init = fn => { play = fn; setInterval(pump, 4000).unref() }
export const state = () => ({ queue: pending().map(({ key: k, type, id, title, poster, season, episode, priority }) => ({ key: k, type, id, title, poster, season, episode, priority: !!priority })), failed })
// A prioritized job goes to the front, behind earlier prioritized ones, and starts even when every slot is busy.
export function prioritize (k, on = true) {
  const i = queue.findIndex(j => j.key === k); if (i < 0) return false
  const [job] = queue.splice(i, 1)
  job.priority = on
  queue.splice(on ? queue.filter(j => j.priority).length : queue.length, 0, job)
  pump()
  return true
}
export function cancel (k) {
  log.info('downloads', 'cancel', { key: k })
  const i = queue.findIndex(j => j.key === k); if (i >= 0) queue.splice(i, 1)
  const f = failed.findIndex(j => j.key === k); if (f >= 0) failed.splice(f, 1)
}

export async function enqueue ({ type, id, season, episode, all, from, to, mode, audio, sublang, display, safe }) {
  const m = await meta(type, id)
  const flat = type === 'movie' || m.movie
  const now = new Date()
  const targets = flat ? [{ season: null, episode: null }]
    : all ? (m.videos || []).filter(v => v.season === +season && (from == null || v.episode >= +from) && (to == null || v.episode <= +to) && (!v.released || new Date(v.released) <= now)).map(v => ({ season: v.season, episode: v.episode }))
      : [{ season: +season, episode: +episode }]
  let added = 0
  for (const t of targets) {
    const job = { type, id, title: m.name, poster: m.poster, mode, audio, sublang, display, safe, ...t }
    job.key = key(job)
    if (pending().some(q => q.key === job.key) || local.find({ type, id, season: t.season, episode: t.episode })) continue
    const have = engine.findEntry({ type, id, season: t.season, episode: t.episode })
    if (have) { engine.pin(have.hash); continue }
    const f = failed.findIndex(x => x.key === job.key); if (f >= 0) failed.splice(f, 1)
    queue.push(job); added++
  }
  log.info('downloads', 'enqueued', { title: m.name, type, season, episode, added, total: targets.length, queue: queue.length })
  pump()
  return { queued: added, total: targets.length }
}

async function pump () {
  if (running || !play) return
  running = true
  try {
    while (queue.length && (queue[0].priority || active() < MAX_ACTIVE)) {
      const job = current = queue.shift()
      log.info('downloads', 'starting', { key: job.key, title: job.title, priority: job.priority, left: queue.length })
      try {
        await play({ type: job.type, id: job.id, season: job.season, episode: job.episode, mode: job.mode, audio: job.audio, sublang: job.sublang, display: job.display, safe: job.safe, pin: true })
        if (job.priority) engine.prioritizeCtx({ type: job.type, id: job.id, season: job.season, episode: job.episode }, true)
      } catch (e) {
        log.warn('downloads', 'failed', { key: job.key, title: job.title, err: e })
        failed.unshift({ key: job.key, type: job.type, id: job.id, title: job.title, poster: job.poster, season: job.season, episode: job.episode, error: e.message, at: Date.now() })
        failed.length = Math.min(failed.length, 20)
      }
      current = null
      await sleep(900)
    }
  } finally { running = false; current = null }
}
