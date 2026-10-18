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

function DEFAULTS_INIT () { return { sublang: 'off', lang: 'en', interests: [], quality: 'auto', sourceMode: 'balanced', adultFilter: false, bestTranslation: false, discordPresence: true, onboarded: false } }

// Everything a client sends is checked on the way in: the pages draw these values (colours go into style attributes, a rating is called
// toFixed on), so a wrong shape breaks a profile's pages and a free-form string is a way to inject CSS.
const MAX_PROFILES = 32
const KINDS = ['movie', 'series', 'anime']
const text = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const tint = v => (typeof v === 'string' && /^#[\da-f]{3,8}$/i.test(v) ? v : null)
const picture = v => (typeof v === 'string' && v.length < 600 && /^(https:\/\/|\/img\?)[^\s'"\\<>]*$/.test(v) ? v : '')
const year = v => (typeof v === 'number' ? v : /^[\d\u2013\u2014-]{1,12}$/.test(v) ? v : null)
function entry (x) {
  if (!x || !KINDS.includes(x.type) || typeof x.id !== 'string' || !/^[\w:.-]{1,64}$/.test(x.id)) throw Object.assign(new Error('Bad title'), { code: 400 })
  return { type: x.type, id: x.id, name: text(x.name, 200), poster: picture(x.poster), year: year(x.year) ?? undefined, rating: num(x.rating) ?? undefined }
}

const DEFAULTS = DEFAULTS_INIT()
// A setting keeps the type it was born with; text settings are short plain words (language codes, mode names).
const settingOk = (k, v) => (typeof DEFAULTS[k] === 'string' ? typeof v === 'string' && /^[\w-]{0,16}$/.test(v) : Array.isArray(DEFAULTS[k]) ? Array.isArray(v) && v.length <= 20 && v.every(x => typeof x === 'string' && /^[\w -]{1,30}$/.test(x)) : typeof v === typeof DEFAULTS[k])
// Data saved before values were checked (or edited by hand) is cleaned once at start, so one bad entry cannot break a profile's pages.
const keep = o => { try { return { ...o, ...entry(o) } } catch { return null } }
const keepAll = m => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).map(([k, v]) => [k, keep(v)]).filter(([, v]) => v))
for (const p of Object.values(db.profiles)) {
  p.history = keepAll(p.history); p.ratings = keepAll(p.ratings); p.recent = keepAll(p.recent); p.progress ||= {}
  p.list = (Array.isArray(p.list) ? p.list : []).map(keep).filter(Boolean)
  p.color = tint(p.color) || COLORS[0]
  p.settings = { ...DEFAULTS_INIT(), ...p.settings }
  delete p.settings.autoNext // the next episode always follows the credits now
  for (const [k, v] of Object.entries(p.settings)) if (Object.hasOwn(DEFAULTS, k) && !settingOk(k, v)) p.settings[k] = DEFAULTS_INIT()[k]
}

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

export const profiles = () => Object.values(db.profiles).map(({ id, name, color }) => ({ id, name, color }))
// Ids come from the URL and a header: "__proto__" must not find Object.prototype.
const own = id => (Object.hasOwn(db.profiles, id) ? db.profiles[id] : undefined)
export const profile = own

export function createProfile (name, color) {
  name = String(name || '').trim().slice(0, 24)
  if (!name) throw Object.assign(new Error('Name required'), { code: 400 })
  const n = Object.keys(db.profiles).length
  if (n >= MAX_PROFILES) throw Object.assign(new Error('Too many profiles'), { code: 409 })
  const id = crypto.randomBytes(4).toString('hex')
  db.profiles[id] = { id, name, color: tint(color) || COLORS[n % COLORS.length], created: Date.now(), progress: {}, recent: {}, history: {}, ratings: {}, list: [], settings: { ...DEFAULTS } }
  persist()
  return db.profiles[id]
}

export function updateProfile (id, patch) {
  const p = own(id)
  if (!p) return null
  if (patch.name) p.name = String(patch.name).trim().slice(0, 24) || p.name
  if (tint(patch.color)) p.color = patch.color
  if (patch.settings) Object.assign(p.settings, pickSettings(patch.settings))
  persist()
  return p
}

const pickSettings = s => Object.fromEntries(Object.entries(s && typeof s === 'object' ? s : {}).filter(([k, v]) => Object.hasOwn(DEFAULTS, k) && settingOk(k, v)))

export function deleteProfile (id) {
  const ok = delete db.profiles[id]
  persist()
  return ok
}

export const progressKey = (type, id, season, episode) => [type, id, season ?? '', episode ?? ''].join('|')

export function saveProgress (id, b) {
  const p = own(id)
  if (!p || !b || !(b.dur > 0) || !Number.isFinite(b.dur) || !(b.pos >= 0) || !Number.isFinite(b.pos)) return false
  const { type, id: tid, name, poster } = entry(b)
  const season = Number.isInteger(b.season) ? b.season : null; const episode = Number.isInteger(b.episode) ? b.episode : null
  const now = Date.now()
  p.progress[progressKey(type, tid, season, episode)] = [Math.floor(b.pos), Math.floor(b.dur), now]
  const tk = `${type}:${tid}`
  const h = (p.history[tk] ||= { type, id: tid, first: now })
  Object.assign(h, { name, poster, at: now, season, episode })
  if (season == null && b.pos / b.dur > 0.9) h.finished = true
  if (b.pos / b.dur > 0.95) delete p.recent[tk]
  else p.recent[tk] = { type, id: tid, name, poster, season, episode, pos: Math.floor(b.pos), dur: Math.floor(b.dur), at: now }
  persist()
  return true
}

export function removeHistory (id, type, tid) {
  const p = own(id); if (!p) return false
  delete p.recent[`${type}:${tid}`] // continue watching comes from the same record
  const ok = delete p.history[`${type}:${tid}`]
  persist()
  return ok
}

export function setList (id, item, on) {
  const p = own(id)
  if (!p) return null
  const it = entry(item)
  p.list = p.list.filter(x => !(x.type === it.type && x.id === it.id))
  if (on) p.list.unshift({ ...it, at: Date.now() })
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
  const it = entry(item)
  const k = `${it.type}:${it.id}`
  if ([-1, 1, 2].includes(value)) p.ratings[k] = { v: value, at: Date.now(), ...it, genres: (Array.isArray(item.genres) ? item.genres : []).slice(0, 4).map(g => text(g, 30)).filter(Boolean) }
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
