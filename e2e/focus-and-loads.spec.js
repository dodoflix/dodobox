import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE, LONG } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
after(shutdown)

const settled = page => page.evaluate(() => new Promise(requestAnimationFrame))

test('a player whose title cannot be loaded gives the screen back with a message', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/watch/movie/tt0000404' })
  await page.locator('.toast').first().waitFor()
  await page.waitForFunction(() => location.hash === '#/')
  assert.equal(await page.locator('#layer').evaluate(l => l.hidden), true)
  assert.equal(await page.locator('#layer').evaluate(l => l.innerHTML), '')
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lock')), false)
  await ctx.close()
})

test('a trailer whose title cannot be loaded gives the screen back with a message', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/trailer/movie/tt0000404' })
  await page.locator('.toast').first().waitFor()
  await page.waitForFunction(() => location.hash === '#/')
  assert.equal(await page.locator('#layer').evaluate(l => l.hidden), true)
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lock')), false)
  await ctx.close()
})

test('going back while the player is still loading clears the overlay and shows no error', async () => {
  resetStubs()
  let release
  const gate = new Promise(r => { release = r })
  stub('v3-cinemeta.strem.io', async u => { if (u.pathname.includes(LONG.id)) { await gate; return json({}, 404) } return json({ meta: {} }, 404) })
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(id => { location.hash = `#/watch/movie/${id}` }, LONG.id)
  await page.locator('#layer .pl-load').waitFor()
  await page.evaluate(() => { location.hash = '#/library' })
  await page.locator('#dl').waitFor()
  assert.equal(await page.locator('#layer').evaluate(l => l.hidden), true)
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('lock')), false)
  release()
  await settled(page)
  assert.equal(await page.locator('.toast').count(), 0)
  assert.equal(await page.evaluate(() => location.hash), '#/library')
  await ctx.close()
  resetStubs()
})

test('a library page that failed to load does not keep polling when the tab is shown again', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  let storage = 0
  await page.route('**/api/storage', route => { storage++; route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }) })
  await page.evaluate(() => { location.hash = '#/library' })
  await page.locator('.empty h2', { hasText: 'Something went wrong' }).waitFor()
  const before = storage
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
  await page.evaluate(() => fetch('/api/storage'))
  await settled(page)
  assert.equal(storage, before + 1) // only the request made here
  await ctx.close()
})

test('the player stops listening for screen-size changes when it is closed', async () => {
  const { ctx, page } = await newPage(base)
  await page.addInitScript(() => {
    const real = matchMedia
    window.__mq = 0
    window.matchMedia = q => {
      const m = real.call(window, q)
      if (q === '(max-width: 700px)') {
        const add = m.addEventListener.bind(m); const rem = m.removeEventListener.bind(m)
        m.addEventListener = (t, f, o) => { if (t === 'change') window.__mq++; add(t, f, o) }
        m.removeEventListener = (t, f, o) => { if (t === 'change') window.__mq--; rem(t, f, o) }
      }
      return m
    }
  })
  await signIn(page, base, 'Ada')
  await page.evaluate(id => { location.hash = `#/watch/movie/${id}` }, MOVIE.id)
  await page.locator('#layer .pl video').waitFor()
  assert.equal(await page.evaluate(() => window.__mq), 1)
  await page.evaluate(() => { location.hash = '#/' })
  await page.locator('#layer').evaluate(l => new Promise(r => { const t = setInterval(() => { if (l.hidden) { clearInterval(t); r() } }, 20) }))
  assert.equal(await page.evaluate(() => window.__mq), 0)
  await ctx.close()
})

test('a dropdown moves through its options with the arrows and Escape closes it without leaving the page', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/settings' })
  const btn = page.locator('.dd-btn').first()
  await btn.waitFor()
  await btn.click()
  const items = page.locator('.dd-pop button')
  assert.ok(await items.count() > 2)
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  const at = await page.evaluate(() => [...document.querySelectorAll('.dd-pop button')].indexOf(document.activeElement))
  const start = await page.evaluate(() => [...document.querySelectorAll('.dd-pop button')].findIndex(b => b.classList.contains('on')))
  assert.equal(at, Math.min(start + 2, await items.count() - 1))
  await page.keyboard.press('Escape')
  await page.locator('.dd-pop').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => location.hash), '#/settings')
  await ctx.close()
})

test('the profile menu moves through its items with the arrows and Escape closes it without leaving the page', async () => {
  const { ctx, page, errors } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/library' })
  await page.locator('#dl').waitFor()
  await page.focus('#me-btn')
  await page.keyboard.press('Enter')
  await page.locator('.pmenu').waitFor()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.hasAttribute('data-party')), true)
  await page.keyboard.press('Escape')
  await page.locator('.pmenu').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => location.hash), '#/library')
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('quick search keeps the arrows inside the panel and Escape closes it without leaving the page', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/library' })
  await page.locator('#dl').waitFor()
  await page.keyboard.press('/')
  await page.locator('#qs input').waitFor()
  await page.fill('#qs input', 'night')
  await page.locator('#qs .qs-row').first().waitFor()
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.classList.contains('qs-row')), true)
  await page.keyboard.press('Escape')
  await page.locator('#qs').waitFor({ state: 'hidden' })
  assert.equal(await page.evaluate(() => location.hash), '#/library')
  await ctx.close()
})

test('the PIN keypad takes the arrows, not the page behind it, and Escape closes it without leaving the page', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/library' })
  await page.locator('#dl').waitFor()
  await page.evaluate(async () => { (await import('/js/pin.js')).askPin({ title: 'Test PIN' }) })
  await page.locator('.pin-layer').waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => !!document.activeElement.closest('.pin-layer')), true)
  await page.keyboard.press('Escape')
  await page.locator('.pin-layer').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => location.hash), '#/library')
  await ctx.close()
})

test('the watch party panel closes with Escape without leaving the page', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.evaluate(() => { location.hash = '#/library' })
  await page.locator('#dl').waitFor()
  await page.focus('#me-btn')
  await page.keyboard.press('Enter')
  await page.locator('.pmenu [data-party]').click()
  await page.locator('.party-pop.in-page').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.party-pop.in-page').waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => location.hash), '#/library')
  await ctx.close()
})
