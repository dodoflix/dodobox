import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
after(shutdown)

// The header, the tab bar and the home page are all in the chosen language once the first run is over.
const shellIs = async (page, lang, home) => {
  await page.locator('.hero-body').waitFor()
  await page.waitForFunction(l => document.documentElement.lang === l, lang)
  for (const sel of ['#nav', '#tabbar']) assert.equal(await page.locator(`${sel} [data-nav=home]`).textContent(), home) // the tab bar is hidden on a desktop screen
  assert.match(await page.locator('.shelf h2').first().textContent(), lang === 'tr' ? /ilk 10/i : /Top 10/i)
  assert.equal(await page.evaluate(() => import('/js/session.js').then(m => m.S.me.settings.lang)), lang)
}

// Each test is a first run: the profile an earlier one made is removed.
const freshInstall = async () => { for (const p of await (await fetch(`${base}/api/profiles`)).json()) await fetch(`${base}/api/profiles/${p.id}`, { method: 'DELETE' }) }

const pick = async (page, scope, name) => {
  await page.locator(`${scope} .dd-btn`).click()
  await page.locator('.dd-pop [role=option]', { hasText: name }).click()
}

// The first screen is in the browser's language; the language is chosen on the first onboarding page.
const startOnboarding = async (page, name) => {
  await page.goto(base)
  await page.locator('h1', { hasText: 'Wer schaut?' }).waitFor()
  await page.locator('input[name=name]').fill(name)
  await page.click('button[type=submit]')
  await page.locator('.ob h1', { hasText: `Hallo ${name}, mach es zu deinem` }).waitFor()
  assert.equal(await page.locator('#ob-lang').inputValue(), 'de')
}

test('first run: a language chosen on the first onboarding page applies at once, to the next pages and the whole app', async () => {
  await freshInstall()
  const { ctx, page, errors } = await newPage(base, { locale: 'de' })
  await startOnboarding(page, 'Ada')
  await pick(page, '.ob', 'Français')
  await page.locator('.ob h1', { hasText: 'Salut Ada, personnalisez' }).waitFor()
  await pick(page, '.ob', 'العربية')
  await page.waitForFunction(() => document.documentElement.dir === 'rtl')
  await pick(page, '.ob', 'Türkçe')
  await page.locator('.ob h1', { hasText: 'Ada, burayı sana göre ayarlayalım' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dir), 'ltr')
  await page.click('.ob [data-next]')
  await page.locator('.ob h1', { hasText: 'Neleri seversin?' }).waitFor()
  for (let i = 0; i < 2; i++) await page.click('.ob [data-next]')
  await page.locator('.ob').waitFor({ state: 'detached' })
  await shellIs(page, 'tr', 'Ana sayfa')
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('first run: English chosen in a German browser redraws the whole app in English', async () => {
  await freshInstall()
  const { ctx, page, errors } = await newPage(base, { locale: 'de' })
  await startOnboarding(page, 'Bo')
  await pick(page, '.ob', 'English')
  await page.locator('.ob h1', { hasText: 'Hi Bo, make it yours' }).waitFor()
  for (let i = 0; i < 3; i++) await page.click('.ob [data-next]')
  await shellIs(page, 'en', 'Home')
  assert.deepEqual(errors, [])
  await ctx.close()
})
