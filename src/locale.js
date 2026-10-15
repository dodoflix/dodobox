// Translated titles and descriptions from a public knowledge base for languages the catalog sources lack; a miss keeps the English text.
import fs from 'node:fs'
import path from 'node:path'
import { DATA } from './paths.js'
import { fetchRetry } from './http.js'

const FILE = path.join(DATA, 'locale-cache.json')
const WEEK = 7 * 24 * 3600e3
const UA = { 'user-agent': 'dodobox/1.0 (self-hosted media app)', accept: 'application/sparql-results+json' }
const cache = new Map()
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) cache.set(k, v) } catch {}
let saveT
const save = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(Object.fromEntries(cache)), () => {}), 4000).unref() }

const valid = lang => /^[a-z]{2,3}$/.test(lang || '') && lang !== 'en'
// Each catalog id type lives under a different property.
const prop = id => /^tt\d+$/.test(id) ? 'P345' : /^al:\d+$/.test(id) ? 'P8729' : null
const key = id => id.replace(/^al:/, '')

async function sparql (lang, ids) {
  const groups = { P345: ids.filter(i => prop(i) === 'P345'), P8729: ids.filter(i => prop(i) === 'P8729') }
  const parts = Object.entries(groups).filter(([, v]) => v.length).map(([p, v]) => `{ VALUES ?id { ${v.map(i => `"${key(i)}"`).join(' ')} } ?item wdt:${p} ?id.
    OPTIONAL { ?item rdfs:label ?label FILTER(LANG(?label) = "${lang}") }
    OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://${lang}.wikipedia.org/>; schema:name ?an } }`)
  if (!parts.length) return []
  const q = `SELECT ?id ?label ?an WHERE { ${parts.join(' UNION ')} }`
  const r = await fetchRetry('https://query.wikidata.org/sparql?query=' + encodeURIComponent(q), { headers: UA, timeout: 9000, tries: 2 })
  return (await r.json()).results.bindings
}

export async function localizeItems (items, lang) {
  if (!valid(lang) || !items.length) return items
  const need = items.map(i => i.id).filter(id => prop(id) && !(cache.get(`${lang}:${id}`)?.at > Date.now() - WEEK))
  if (need.length) {
    try {
      const rows = await sparql(lang, need)
      const byId = new Map()
      for (const r of rows) byId.set(r.id.value, { label: r.label?.value, article: r.an?.value })
      for (const id of need) cache.set(`${lang}:${id}`, { at: Date.now(), ...(byId.get(key(id)) || {}) })
      save()
    } catch { /* offline or throttled: show English */ }
  }
  return items.map(i => {
    const l = cache.get(`${lang}:${i.id}`)
    return l?.label && l.label !== i.name ? { ...i, name: l.label, originalName: i.name } : i
  })
}

export async function localizeMeta (item, lang) {
  if (!valid(lang)) return item
  const [one] = await localizeItems([item], lang)
  const l = cache.get(`${lang}:${item.id}`)
  let description = item.description
  if (l?.article) {
    const dk = `desc:${lang}:${item.id}`
    let d = cache.get(dk)
    if (!d || d.at < Date.now() - WEEK) {
      d = { at: Date.now() }
      try {
        const r = await fetchRetry(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(l.article.replace(/ /g, '_'))}`, { headers: { 'user-agent': UA['user-agent'] }, timeout: 7000, tries: 2 })
        const j = await r.json(); if (j.type === 'standard' && (j.extract || '').length > 60) d.text = j.extract
      } catch {}
      cache.set(dk, d); save()
    }
    if (d.text) description = d.text
  }
  return { ...one, description, localized: !!(description !== item.description || one.name !== item.name) }
}
