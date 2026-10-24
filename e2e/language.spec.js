import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, json, MOVIE } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
after(shutdown)

test('switching the language translates the interface and the titles', async () => {
  stub('tr.wikipedia.org', () => json({ type: 'standard', extract: 'Bu aciklama Vikipedi tarafindan verilir ve altmis karakterden daha uzundur, bu yuzden kullanilir.' }))
  stub('query.wikidata.org', () => json({ results: { bindings: [{ id: { value: MOVIE.id }, label: { value: 'Gece Limani' }, an: { value: 'Gece Limani (film)' } }] } }))
  // A title lookup that is slow is answered in English and finished in the background (by design), so ask until the answer is kept.
  const asked = async path => { for (let i = 0; i < 100; i++) { const r = await (await fetch(base + path, { headers: { 'x-lang': 'tr' } })).json(); if (JSON.stringify(r).includes('Vikipedi') || JSON.stringify(r).includes('Gece Limani')) return; await new Promise(r => setTimeout(r, 100)) } throw new Error(`still English: ${path}`) }
  await asked('/api/catalog?type=movie')
  await asked(`/api/meta/movie/${MOVIE.id}`)
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/settings`)
  const lang = page.locator('#lang')
  await lang.waitFor({ state: 'attached' })
  // the page reloads itself in the new language; moving on before that lands would be overwritten by the reload
  await Promise.all([page.waitForEvent('load'), lang.evaluate(s => { s.value = 'tr'; s.dispatchEvent(new Event('change', { bubbles: true })) })])
  await page.waitForFunction(() => document.documentElement.lang === 'tr')
  await page.locator('#lang').waitFor({ state: 'attached' })
  await page.goto(`${base}/#/browse/movie?all=1`)
  const card = page.locator('#grid .poster', { hasText: 'Gece Limani' })
  await card.waitFor()
  assert.match(await card.textContent(), /Gece Limani/)
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.locator('#lede', { hasText: 'Vikipedi' }).waitFor()
  await ctx.close()
})
