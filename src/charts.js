// "Top 10 this week": Netflix publishes its weekly charts, globally and per country, as open files. Titles are matched
// to IMDb ids through the same search the app uses, so every card opens like any other title.
import { fetchRetry, once } from './http.js'
import { catalog, meta, cached } from './meta.js'

const BASE = 'https://www.netflix.com/tudum/top10/data/'
const KIND = { movie: /^Films/, series: /^TV/ }

// The country file is large (tens of MB), sorted by country and then newest week first. One pass keeps the latest week of
// every country (a few KB in all); that is cached for a day, so the download happens about once a day.
const allCountries = () => once('chart:countries', () => cached('chart:countries', 24 * 3600e3, async () => {
  const r = await fetchRetry(BASE + 'all-weeks-countries.tsv', { timeout: 120000, tries: 2 })
  const reader = r.body.getReader(); const dec = new TextDecoder()
  const out = {}; const week = {}; let rest = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    rest += dec.decode(value, { stream: true })
    const lines = rest.split('\n'); rest = lines.pop()
    for (const line of lines) {
      const c = line.split('\t')
      if (c.length < 7 || c[1] === 'country_iso2') continue
      week[c[1]] ??= c[2]
      if (c[2] === week[c[1]]) (out[c[1]] ||= []).push({ category: c[3], rank: +c[4], title: c[5] })
    }
  }
  if (!Object.keys(out).length) throw new Error('empty chart file')
  return out
}))
const countryRows = async iso => (await allCountries())[iso] || []

async function globalRows () {
  const text = await (await fetchRetry(BASE + 'all-weeks-global.tsv', { timeout: 30000, tries: 2 })).text()
  const lines = text.split('\n').slice(1).map(l => l.split('\t')).filter(c => c.length >= 6)
  const week = lines[0]?.[0]
  // English and non-English charts are listed apart; merge them by viewing hours.
  return lines.filter(c => c[0] === week).map(c => ({ category: c[1], title: c[3], hours: +c[5] || 0 }))
}

const top10 = (rows, kind) => rows.filter(r => KIND[kind].test(r.category)).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (b.hours ?? 0) - (a.hours ?? 0)).slice(0, 10).map(r => r.title)

// Titles for one chart, in rank order. Empty when the country has no chart.
export const chartTitles = (kind, iso) => cached(`chart:${kind}:${iso || 'world'}`, 12 * 3600e3, async () => top10(iso ? await countryRows(iso) : await globalRows(), kind))

const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
// "Show Name" -> the IMDb title it most likely is: an exact (normalised) name wins, else the search's first hit.
export async function chartItems (kind, iso) {
  const names = await chartTitles(kind, iso)
  const found = await Promise.all(names.map(n => cached(`chartmap:${kind}:${n}`, 7 * 24 * 3600e3, async () => {
    const hits = await catalog({ type: kind, q: n, page: 1 })
    return hits.find(h => norm(h.name) === norm(n)) || hits[0] || null
  }).catch(() => null)))
  const seen = new Set()
  const items = found.filter(i => i && !seen.has(i.id) && seen.add(i.id))
  // A chart hit is only a name and a poster; the full details (cached, quick) let hover previews open without another request.
  return Promise.all(items.map(async i => {
    const m = await meta(i.type, i.id).catch(() => null)
    return m ? { ...i, background: m.background, description: m.description, trailer: m.trailer, runtime: m.runtime, rating: m.rating, genres: m.genres, year: i.year || m.year } : i
  }))
}
