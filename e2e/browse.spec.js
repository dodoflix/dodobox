import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, MOVIE, SERIES, ANIME } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: false })) })
after(shutdown)

test('first run: create a profile, finish onboarding, land on a populated home', async () => {
  const { ctx, page, errors } = await newPage(base)
  await signIn(page, base, 'Ada')
  assert.ok(await page.locator('.hero-body h1').innerText())
  for (const shelf of [/Top 10 movies/i, /Top 10 series/i]) await page.locator('.shelf h2', { hasText: shelf }).first().waitFor()
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('a viewer in a region sees the Top 10 of their country', async () => {
  const { ctx, page } = await newPage(base, { locale: 'en-US' })
  await signIn(page, base, 'Ada')
  await page.locator('.shelf h2', { hasText: 'Top 10 movies in United States' }).waitFor()
  await page.locator('.shelf h2', { hasText: 'Top 10 series in United States' }).waitFor()
  await ctx.close()
})

test('a returning visitor picks the existing profile', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  assert.equal(await page.locator('#me-btn').innerText(), 'A')
  await ctx.close()
})

test('browse lists a catalog per type and filters by genre', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/browse/movie?all=1`)
  await page.locator('#grid .poster', { hasText: MOVIE.name }).waitFor()
  await page.locator('#grid .poster', { hasText: 'Quiet Orbit' }).waitFor()
  await page.goto(`${base}/#/browse/movie?genre=Sci-Fi`)
  await page.locator('#grid .poster', { hasText: 'Quiet Orbit' }).waitFor()
  assert.equal(await page.locator('#grid .poster', { hasText: MOVIE.name }).count(), 0)
  await page.goto(`${base}/#/browse/anime?all=1`)
  await page.locator('#grid .poster', { hasText: ANIME.name }).waitFor()
  await ctx.close()
})

test('search finds a title, opens its page and My List survives a reload', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.click('#top a[data-nav=search]')
  await page.fill('#qs input', 'harbor')
  await page.locator('#qs .qs-row', { hasText: MOVIE.name }).click()
  await page.locator('.d-body h1', { hasText: MOVIE.name }).waitFor()
  assert.match(await page.locator('#play').innerText(), /Play/)
  await page.click('#list')
  await page.locator('#list', { hasText: 'In My List' }).waitFor()
  await page.reload()
  await page.locator('#list', { hasText: 'In My List' }).waitFor()
  await page.goto(`${base}/#/library`)
  await page.locator('#l-list .poster', { hasText: MOVIE.name }).waitFor()
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('#list')
  await page.locator('#list', { hasText: 'My List' }).waitFor()
  await page.goto(`${base}/#/library`)
  await page.locator('#l-list').waitFor({ state: 'detached' })
  await ctx.close()
})

test('a series page lists its episodes', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/series/${SERIES.id}`)
  await page.locator('.d-body h1', { hasText: SERIES.name }).waitFor()
  await page.locator('#eps .ep', { hasText: 'Lantern 2' }).waitFor()
  assert.match(await page.locator('#play').innerText(), /Start watching/)
  await ctx.close()
})

test('profiles keep separate lists', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('#list')
  await page.locator('#list', { hasText: 'In My List' }).waitFor()
  await page.hover('#me-btn')
  await page.click('.pmenu [data-switch]')
  await page.click('[data-add]')
  await page.fill('input[name=name]', 'Bo')
  await page.click('text=Create')
  await page.waitForLoadState()
  await page.locator('.ob [data-next]').first().click()
  for (let i = 0; i < 2; i++) await page.click('.ob [data-next]')
  await page.locator('.hero-body').waitFor()
  await page.goto(`${base}/#/library`)
  await page.locator('#dl').waitFor()
  assert.equal(await page.locator('#l-list').count(), 0)
  await ctx.close()
})

test('settings page opens from the profile menu', async () => {
  const { ctx, page, errors } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.hover('#me-btn')
  await page.click('.pmenu a[href="#/settings"]')
  await page.locator('main h1').waitFor()
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('rating a title fills the home page with picks like it', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('.rate [data-r="2"]')
  await page.goto(`${base}/#/`)
  await page.locator('#s-picks .shelf h2', { hasText: `Because you liked ${MOVIE.name}` }).waitFor()
  await ctx.close()
})
