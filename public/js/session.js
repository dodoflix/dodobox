import { api, setProfile, getProfile, setLang, setSafe } from './api.js'
import { $ } from './util.js'

export const S = { me: null }

export async function pickProfile (id) {
  setProfile(id)
  S.me = await api('/api/me')
  setLang(S.me.settings.lang); setSafe(S.me.settings.adultFilter)
  const a = $('#me-btn')
  a.textContent = S.me.name[0].toUpperCase()
  a.style.setProperty('--c', S.me.color)
  a.title = S.me.name
  return S.me
}
export const tryRestore = async () => { try { return getProfile() ? await pickProfile(getProfile()) : null } catch { return null } }

const pk = (t, id, s, e) => [t, id, s ?? '', e ?? ''].join('|')
export const progress = (t, id, s, e) => S.me.progress[pk(t, id, s, e)]
export const ratio = (t, id, s, e) => { const p = progress(t, id, s, e); return p ? p[0] / p[1] : null }
export const inList = (t, id) => S.me.list.some(x => x.type === t && x.id === id)

export async function toggleList (item) {
  const on = !inList(item.type, item.id)
  S.me.list = on ? [{ type: item.type, id: item.id, name: item.originalName || item.name, poster: item.poster, year: item.year, rating: item.rating }, ...S.me.list] : S.me.list.filter(x => !(x.type === item.type && x.id === item.id))
  api('/api/list', { method: 'PUT', body: { item: { ...item, name: item.originalName || item.name }, on } }).catch(() => {})
  return on
}

export function recordProgress (b) {
  S.me.progress[pk(b.type, b.id, b.season, b.episode)] = [b.pos, b.dur, Date.now()]
  const rest = S.me.recent.filter(r => !(r.type === b.type && r.id === b.id))
  S.me.recent = b.pos / b.dur > 0.95 ? rest : [{ ...b, at: Date.now() }, ...rest]
  api('/api/progress', { method: 'PUT', body: b }).catch(() => {})
}

export async function setSetting (k, v) {
  S.me.settings[k] = v
  if (k === 'lang') setLang(v)
  if (k === 'adultFilter') setSafe(v)
  await api('/api/me', { method: 'PATCH', body: { settings: { [k]: v } } }).catch(() => {})
  // The lists are filtered by the server, so they are asked for again under the new setting.
  if (k === 'adultFilter') Object.assign(S.me, await api('/api/me').then(({ list, recent, history, ratings }) => ({ list, recent, history, ratings }), () => ({})))
}

export const ratingOf = (t, id) => S.me.ratings?.[`${t}:${id}`]?.v || 0
export async function rate (item, value) {
  const k = `${item.type}:${item.id}`
  const next = ratingOf(item.type, item.id) === value ? 0 : value
  S.me.ratings ||= {}
  if (next) S.me.ratings[k] = { v: next, name: item.originalName || item.name, poster: item.poster, type: item.type, id: item.id, year: item.year, genres: (item.genres || []).slice(0, 4), at: Date.now() }
  else delete S.me.ratings[k]
  await api('/api/rating', { method: 'PUT', body: { item: { ...item, name: item.originalName || item.name }, value: next } }).catch(() => {})
  return next
}
