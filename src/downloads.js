// Download without watching: a queue that starts a few at a time. Downloads the user asks for are pinned and never evicted.
import { meta } from './meta.js'
import * as engine from './engine.js'
import * as local from './local.js'

const MAX_ACTIVE = 3
const queue = []
const failed = []
let play = null; let running = false

const key = j => `${j.type}:${j.id}:${j.season ?? ''}:${j.episode ?? ''}`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const active = () => engine.library().filter(r => r.pinned && r.phase !== 'done' && r.phase !== 'error').length

export const init = fn => { play = fn; setInterval(pump, 4000).unref() }
export const state = () => ({ queue: queue.map(({ key: k, type, id, title, poster, season, episode }) => ({ key: k, type, id, title, poster, season, episode })), failed })
export function cancel (k) {
  const i = queue.findIndex(j => j.key === k); if (i >= 0) queue.splice(i, 1)
  const f = failed.findIndex(j => j.key === k); if (f >= 0) failed.splice(f, 1)
}

export async function enqueue ({ type, id, season, episode, all, mode, audio, sublang }) {
  const m = await meta(type, id)
  const flat = type === 'movie' || m.movie
  const now = new Date()
  const targets = flat ? [{ season: null, episode: null }]
    : all ? (m.videos || []).filter(v => v.season === +season && (!v.released || new Date(v.released) <= now)).map(v => ({ season: v.season, episode: v.episode }))
      : [{ season: +season, episode: +episode }]
  let added = 0
  for (const t of targets) {
    const job = { type, id, title: m.name, poster: m.poster, mode, audio, sublang, ...t }
    job.key = key(job)
    if (queue.some(q => q.key === job.key) || local.find({ type, id, season: t.season, episode: t.episode })) continue
    const have = engine.findEntry({ type, id, season: t.season, episode: t.episode })
    if (have) { engine.pin(have.hash); continue }
    const f = failed.findIndex(x => x.key === job.key); if (f >= 0) failed.splice(f, 1)
    queue.push(job); added++
  }
  pump()
  return { queued: added, total: targets.length }
}

async function pump () {
  if (running || !play) return
  running = true
  try {
    while (queue.length && active() < MAX_ACTIVE) {
      const job = queue.shift()
      try { await play({ type: job.type, id: job.id, season: job.season, episode: job.episode, mode: job.mode, audio: job.audio, sublang: job.sublang, pin: true }) } catch (e) {
        failed.unshift({ key: job.key, type: job.type, id: job.id, title: job.title, poster: job.poster, season: job.season, episode: job.episode, error: e.message, at: Date.now() })
        failed.length = Math.min(failed.length, 20)
      }
      await sleep(900)
    }
  } finally { running = false }
}
