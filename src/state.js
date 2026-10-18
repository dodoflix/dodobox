// Household state: profiles (progress, My List, preferences) and server-wide settings, in one JSON file.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import './data.js'
import { DATA } from './paths.js'

const FILE = path.join(DATA, 'state.json')
const COLORS = ['#f2a65a', '#e5646e', '#6fb7e9', '#7ad3a0', '#b58cf0', '#f0d264']

let db = { profiles: {}, settings: {} }
try { db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) } } catch {}

for (const p of Object.values(db.profiles)) { p.history ||= {}; p.ratings ||= {}; p.settings = { ...DEFAULTS_INIT(), ...p.settings } }
function DEFAULTS_INIT () { return { sublang: 'off', lang: 'en', interests: [], autoNext: true, quality: 'auto', sourceMode: 'balanced', adultFilter: false, bestTranslation: false, discordPresence: true, onboarded: false } }

let timer
function persist () {
  clearTimeout(timer)
  timer = setTimeout(flush, 400)
}
export function flush () {
  clearTimeout(timer)
  const tmp = FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(db))
  fs.renameSync(tmp, FILE)
}

const DEFAULTS = { sublang: 'off', lang: 'en', interests: [], autoNext: true, quality: 'auto', sourceMode: 'balanced', adultFilter: false, bestTranslation: false, discordPresence: true, onboarded: false }
export const profiles = () => Object.values(db.profiles).map(({ id, name, color }) => ({ id, name, color }))
// Ids come from the URL and a header: "__proto__" must not find Object.prototype.
const own = id => (Object.hasOwn(db.profiles, id) ? db.profiles[id] : undefined)
export const profile = own

export function createProfile (name, color) {
  name = String(name || '').trim().slice(0, 24)
  if (!name) throw Object.assign(new Error('Name required'), { code: 400 })
  const n = Object.keys(db.profiles).length
  const id = crypto.randomBytes(4).toString('hex')
  db.profiles[id] = { id, name, color: color || COLORS[n % COLORS.length], created: Date.now(), progress: {}, recent: {}, history: {}, ratings: {}, list: [], settings: { ...DEFAULTS } }
  persist()
  return db.profiles[id]
}

export function updateProfile (id, patch) {
  const p = own(id)
  if (!p) return null
  if (patch.name) p.name = String(patch.name).trim().slice(0, 24) || p.name
  if (patch.color) p.color = patch.color
  if (patch.settings) Object.assign(p.settings, pickSettings(patch.settings))
  persist()
  return p
}

const pickSettings = s => Object.fromEntries(Object.entries(s).filter(([k]) => Object.hasOwn(DEFAULTS, k)))

export function deleteProfile (id) {
  const ok = delete db.profiles[id]
  persist()
  return ok
}

export const progressKey = (type, id, season, episode) => [type, id, season ?? '', episode ?? ''].join('|')

export function saveProgress (id, b) {
  const p = own(id)
  if (!p || !(b.dur > 0)) return false
  const now = Date.now()
  p.progress[progressKey(b.type, b.id, b.season, b.episode)] = [Math.floor(b.pos), Math.floor(b.dur), now]
  const tk = `${b.type}:${b.id}`
  const h = (p.history[tk] ||= { type: b.type, id: b.id, first: now })
  Object.assign(h, { name: b.name, poster: b.poster, at: now, season: b.season ?? null, episode: b.episode ?? null })
  if (b.season == null && b.pos / b.dur > 0.9) h.finished = true
  if (b.pos / b.dur > 0.95) delete p.recent[tk]
  else p.recent[tk] = { type: b.type, id: b.id, name: b.name, poster: b.poster, season: b.season ?? null, episode: b.episode ?? null, pos: Math.floor(b.pos), dur: Math.floor(b.dur), at: now }
  persist()
  return true
}

export function setList (id, item, on) {
  const p = own(id)
  if (!p) return null
  p.list = p.list.filter(x => !(x.type === item.type && x.id === item.id))
  if (on) p.list.unshift({ type: item.type, id: item.id, name: item.name, poster: item.poster, year: item.year, rating: item.rating, at: Date.now() })
  persist()
  return p.list
}

export function renameTitle (id, type, tid, name) {
  const p = own(id); if (!p) return
  for (const it of p.list) if (it.type === type && it.id === tid) it.name = name
  const r = p.recent[`${type}:${tid}`]; if (r) r.name = name
  persist()
}
export function markNamesFixed (id) { if (own(id)) { own(id).namesFixed = true; persist() } }

export function setRating (id, item, value) {
  const p = own(id); if (!p) return null
  const k = `${item.type}:${item.id}`
  if ([-1, 1, 2].includes(+value)) p.ratings[k] = { v: +value, at: Date.now(), type: item.type, id: item.id, name: item.name, poster: item.poster, year: item.year, genres: (item.genres || []).slice(0, 4) }
  else delete p.ratings[k]
  persist()
  return p.ratings
}

export const me = id => {
  const p = own(id)
  return p && { id: p.id, name: p.name, color: p.color, settings: p.settings, list: p.list, progress: p.progress, recent: Object.values(p.recent).sort((a, b) => b.at - a.at).slice(0, 20), history: Object.values(p.history).sort((a, b) => b.at - a.at).slice(0, 200), ratings: p.ratings }
}

const GLOBAL = { maxStorageGB: 40, mediaDirs: null }
export const settings = () => ({ ...GLOBAL, ...db.settings })
export function setSettings (patch) {
  if (patch.maxStorageGB != null) db.settings.maxStorageGB = Math.max(2, Math.min(5000, +patch.maxStorageGB || GLOBAL.maxStorageGB))
  if ('mediaDirs' in patch) db.settings.mediaDirs = Array.isArray(patch.mediaDirs) ? patch.mediaDirs.map(String).filter(Boolean) : null
  persist()
  return settings()
}

process.on('exit', () => { try { flush() } catch {} })
