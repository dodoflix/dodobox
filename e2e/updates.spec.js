import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, shutdown, stub, json, newPage, signIn } from './harness.js'

let base, updates
before(async () => {
  ({ base } = await boot())
  // The hourly lookup stays off (it was off at boot); only what the page asks for looks the release up.
  delete process.env.NO_UPDATE_CHECK
  updates = await import('../src/update.js')
})
after(shutdown)

const release = tag => stub('api.github.com', () => json({ tag_name: tag, html_url: `https://github.com/dodoflix/dodobox/releases/tag/${tag}` }))

test('opening the app looks for an update, and Later puts the notice off for a day while the profile button keeps a dot', async () => {
  release('v99.0.0')
  const { ctx, page, errors } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.locator('#upd', { hasText: 'Dodobox 99.0.0 is available' }).waitFor({ timeout: 15000 })
  assert.equal(await page.locator('#me-btn.upd').count(), 1)
  await page.click('#upd [data-a=hide]')
  await page.waitForFunction(() => localStorage.getItem('upd-later'))
  const later = await page.evaluate(() => JSON.parse(localStorage.getItem('upd-later')))
  assert.equal(later.v, '99.0.0')
  assert.ok(Math.abs(later.until - Date.now() - 24 * 3600e3) < 60e3, 'put off for a day')
  await page.reload()
  await page.locator('#me-btn.upd').waitFor({ timeout: 10000 })
  await page.waitForTimeout(4000) // past the page's own check
  assert.equal(await page.locator('#upd').count(), 0, 'the notice stays away during the day')
  await page.evaluate(() => localStorage.setItem('upd-later', JSON.stringify({ v: '99.0.0', until: Date.now() - 1 })))
  await page.reload()
  await page.locator('#upd', { hasText: 'Dodobox 99.0.0 is available' }).waitFor({ timeout: 10000 })
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('Check for updates in Settings looks right away and says what it found', async () => {
  updates.set({ version: null, url: null, phase: 'idle' })
  const { ctx, page, errors } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/settings`)
  const check = async text => {
    updates.set({ checkedAt: 0 }) // older than the 30 s a check from Settings reuses
    await page.click('#checkupd')
    await page.locator('#updstat', { hasText: text }).waitFor()
  }
  release('v0.0.1')
  await check('Dodobox is up to date')
  assert.equal(await page.locator('#upd').count(), 0)
  stub('api.github.com', () => new Response('', { status: 500 }))
  await check('Could not check for updates')
  // a version found from Settings is shown even when its notice was put off
  await page.evaluate(() => localStorage.setItem('upd-later', JSON.stringify({ v: '99.0.0', until: Date.now() + 3600e3 })))
  release('v99.0.0')
  updates.set({ checkedAt: 0 })
  await page.click('#checkupd')
  await page.locator('#checkupd >> xpath=..').locator('a', { hasText: 'Version 99.0.0 is available' }).waitFor()
  assert.equal(await page.locator('#updstat').textContent(), '', 'said once, by the link')
  await page.locator('#upd', { hasText: 'Dodobox 99.0.0 is available' }).waitFor()
  assert.deepEqual(errors.filter(e => !/status of 500/.test(e)), [])
  await ctx.close()
})

test('with NO_UPDATE_CHECK set, Settings offers no Check for updates instead of claiming Dodobox is up to date', async () => {
  process.env.NO_UPDATE_CHECK = '1'
  try {
    const { ctx, page } = await newPage(base)
    await signIn(page, base, 'Ada')
    await page.goto(`${base}/#/settings`)
    await page.locator('#updstat').waitFor({ state: 'attached' })
    assert.equal(await page.locator('#checkupd').count(), 0)
    await ctx.close()
  } finally { delete process.env.NO_UPDATE_CHECK }
})
