import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
after(shutdown)

test('Download keeps a movie in the library, ready to play, until it is deleted', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('#dl')
  await page.goto(`${base}/#/library`)
  const row = page.locator('#dl .item', { hasText: MOVIE.name })
  await row.locator('text=Ready to watch').waitFor({ timeout: 60000 })
  assert.match(await row.innerText(), /Saved/)
  await row.locator('[data-del]').click()
  await page.locator('#dl .item').waitFor({ state: 'detached' })
  await page.locator('#dl', { hasText: 'Nothing downloaded' }).waitFor()
  await ctx.close()
})

test('a download that finds no source is listed as failed in the library', async () => {
  resetStubs()
  stub('torrentio.strem.fun', () => json({ streams: [] }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/tt9000003`)
  await page.click('#dl')
  await page.goto(`${base}/#/library`)
  await page.locator('#dl .item', { hasText: 'Could not find a source' }).waitFor({ timeout: 60000 })
  resetStubs()
  await ctx.close()
})
