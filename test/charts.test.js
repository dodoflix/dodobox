import test from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('charts')
const tsv = rows => rows.map(r => r.join('\t')).join('\n') + '\n'
const json = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const titles = { Alpha: 'tt1', Beta: 'tt2', Gamma: 'tt3' }
globalThis.fetch = async url => {
  const u = new URL(url)
  if (u.hostname === 'www.netflix.com' && u.pathname.endsWith('all-weeks-global.tsv')) {
    return new Response(tsv([['week', 'category', 'rank', 'title', 'x', 'hours'], ['2026-01-11', 'Films (English)', '1', 'Alpha', '', '500'], ['2026-01-11', 'Films (English)', '2', 'Beta', '', '900'], ['2026-01-11', 'TV (English)', '1', 'Gamma', '', '100'], ['2026-01-04', 'Films (English)', '1', 'Old', '', '9999']]))
  }
  if (u.hostname === 'www.netflix.com' && u.pathname.endsWith('all-weeks-countries.tsv')) {
    return new Response(tsv([['country_name', 'country_iso2', 'week', 'category', 'weekly_rank', 'show_title', 'season_title'], ['Turkey', 'TR', '2026-01-11', 'Films', '2', 'Beta', ''], ['Turkey', 'TR', '2026-01-11', 'Films', '1', 'Alpha', ''], ['Turkey', 'TR', '2026-01-11', 'TV', '1', 'Gamma', ''], ['Turkey', 'TR', '2026-01-04', 'Films', '1', 'Old', ''], ['Peru', 'PE', '2026-01-11', 'Films', '1', 'Beta', '']]))
  }
  if (u.hostname === 'v3-cinemeta.strem.io') {
    const [, kind, type, id] = u.pathname.match(/^\/(catalog|meta)\/(\w+)\/([^/]+?)(?:\/.+)?\.json$/) || []
    const named = n => ({ id: titles[n], imdb_id: titles[n], name: n, year: '2020', genres: ['Drama'], description: `About ${n}` })
    if (kind === 'meta') { const n = Object.keys(titles).find(k => titles[k] === id); return n ? json({ meta: named(n) }) : json({}, 404) }
    const q = new URLSearchParams(u.pathname.split('/').pop().replace('.json', '')).get('search')
    return json({ metas: Object.keys(titles).filter(n => type === 'series' ? n === 'Gamma' : n !== 'Gamma').filter(n => !q || n === q).map(named) })
  }
  return new Response('{}', { status: 404 })
}

test('the weekly Top 10 uses the newest week, ranked by views, and matches each title in the catalog', async () => {
  const { chartTitles, chartItems } = await import('../src/charts.js')
  assert.deepEqual(await chartTitles('movie'), ['Beta', 'Alpha'])
  assert.deepEqual(await chartTitles('series'), ['Gamma'])
  const items = await chartItems('movie')
  assert.deepEqual(items.map(i => i.name), ['Beta', 'Alpha'])
  assert.equal(items[0].description, 'About Beta')
})

test('a country chart keeps the newest week of that country, in rank order', async () => {
  const { chartTitles, chartItems } = await import('../src/charts.js')
  assert.deepEqual(await chartTitles('movie', 'TR'), ['Alpha', 'Beta'])
  assert.deepEqual(await chartTitles('movie', 'PE'), ['Beta'])
  assert.deepEqual(await chartTitles('movie', 'ZZ'), [])
  assert.deepEqual((await chartItems('series', 'TR')).map(i => i.name), ['Gamma'])
})
