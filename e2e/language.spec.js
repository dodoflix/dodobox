import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, json, MOVIE } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: false })) })
after(shutdown)

test('switching the language translates the interface and the titles', async () => {
  stub('query.wikidata.org', () => json({ results: { bindings: [{ id: { value: MOVIE.id }, label: { value: 'Gece Limani' } }] } }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/settings`)
  const lang = page.locator('#lang')
  await lang.waitFor({ state: 'attached' })
  await lang.evaluate(s => { s.value = 'tr'; s.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForFunction(() => document.documentElement.lang === 'tr')
  await page.goto(`${base}/#/browse/movie?all=1`)
  const card = page.locator('#grid .poster', { hasText: 'Gece Limani' })
  await card.waitFor()
  assert.match(await card.textContent(), /Gece Limani/)
  await ctx.close()
})
