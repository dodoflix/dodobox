import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE, SERIES, ANIME } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
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
  const seen = []
  page.on('response', r => { if (/shelf/.test(r.url())) seen.push(`${r.status()} ${r.url()}`) })
  page.on('requestfailed', r => seen.push(`FAILED ${r.url()} ${r.failure()?.errorText}`))
  await signIn(page, base, 'Ada')
  // the shelves load as they scroll into view
  try {
    for (const kind of ['movies', 'series']) {
      await page.waitForFunction(k => {
        const shelf = [...document.querySelectorAll('.shelf')].find(x => x.querySelector('h2')?.textContent.includes(`Top 10 ${k} in United States`))
        shelf?.scrollIntoView()
        return !!shelf?.querySelector('.poster .cap')
      }, kind)
    }
  } catch (e) {
    const shelves = await page.evaluate(() => [...document.querySelectorAll('.shelf')].map(s => `${s.querySelector('h2')?.textContent}=${s.querySelectorAll('.poster').length}`))
    throw new Error(`${e.message}\nshelf answers: ${seen.join(' | ')}\nshelves: ${shelves.join(' | ')}`, { cause: e })
  }
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

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64')
// ids that are not fixture titles, so no earlier test has their page cached
const seasons = (id, ...counts) => counts.flatMap((n, s) => Array.from({ length: n }, (_, e) => ({ season: s + 1, episode: e + 1, name: `Ep ${s + 1}x${e + 1}`, released: '2021-01-01T00:00:00.000Z', thumbnail: `https://episodes.metahub.space/${id}/${s + 1}/${e + 1}/w780.jpg` })))
const series = (id, extra) => u => (/\/meta\/series\//.test(u.pathname) ? json({ meta: { id, imdb_id: id, name: 'Wide Season', year: '2021', genres: SERIES.genres, description: SERIES.description, ...extra } }) : json({ metas: [] }))

test('an episode list shows a plain runtime when the catalog adds junk to the number', async () => {
  const id = 'tt9000098'
  stub('v3-cinemeta.strem.io', series(id, { runtime: '32S min', videos: seasons(id, 2) }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/series/${id}`)
  await page.locator('#eps .ep').first().waitFor()
  assert.match(await page.locator('#eps .d').first().innerText(), /~32 min$/)
  await ctx.close()
  resetStubs()
})

test('episode pictures that failed in one season do not stop another season from loading its own', async () => {
  const id = 'tt9000099'
  stub('v3-cinemeta.strem.io', series(id, { videos: seasons(id, 5, 6) }))
  stub('episodes.metahub.space', u => (u.pathname.includes(`/${id}/2/`) ? new Response('', { status: 404 }) : new Response(PNG, { headers: { 'content-type': 'image/png' } })))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/series/${id}`)
  await page.locator('#seasons [data-s="2"]').click()
  await page.waitForFunction(() => document.querySelectorAll('#eps img[data-tries]').length === 5)
  // leave while the failed pictures are waiting to be asked for again
  await page.locator('#seasons [data-s="1"]').click()
  await page.waitForFunction(() => { const i = [...document.querySelectorAll('#eps img')]; return i.length === 5 && i.every(x => x.complete && x.naturalWidth) }, null, { timeout: 10000 })
  await ctx.close()
  resetStubs()
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
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('.rate [data-r="2"]') // the same rating again takes it back
  await page.goto(`${base}/#/library`)
  await page.locator('#l-loved').waitFor({ state: 'detached' })
  await ctx.close()
})

test('a profile can be deleted from the profile picker, and its data goes with it', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.hover('#me-btn')
  await page.click('.pmenu [data-switch]')
  await page.click('[data-manage]')
  await page.locator('.pf', { hasText: 'Bo' }).click()
  await page.click('[data-del]')
  await page.click('[data-del]') // asks to be tapped again
  await page.locator('.pf[data-id]', { hasText: 'Bo' }).waitFor({ state: 'detached' })
  assert.deepEqual((await (await fetch(`${base}/api/profiles`)).json()).map(p => p.name), ['Ada'])
  await ctx.close()
})
