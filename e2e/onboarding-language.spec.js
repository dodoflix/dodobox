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

test('first run: the language is chosen on the first screen and the onboarding and the whole app follow it', async () => {
  await freshInstall()
  const { ctx, page, errors } = await newPage(base, { locale: 'de' })
  await page.goto(base)
  await page.locator('input[name=name]').waitFor()
  await page.locator('h1', { hasText: 'Wer schaut?' }).waitFor()
  assert.equal(await page.locator('#pf-lang').inputValue(), 'de')
  await pick(page, '.new-form', 'Türkçe')
  await page.locator('h1', { hasText: 'Kim izliyor?' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'tr')
  await pick(page, '.new-form', 'العربية')
  await page.waitForFunction(() => document.documentElement.dir === 'rtl')
  await pick(page, '.new-form', 'Türkçe')
  await page.waitForFunction(() => document.documentElement.dir === 'ltr' && document.documentElement.lang === 'tr')
  await page.locator('input[name=name]').fill('Ada')
  await pick(page, '.new-form', 'English') // back to English restores the English text, and keeps the typed name
  await page.locator('h1', { hasText: "Who's watching?" }).waitFor()
  assert.equal(await page.locator('input[name=name]').inputValue(), 'Ada')
  await pick(page, '.new-form', 'Türkçe')
  await page.locator('h1', { hasText: 'Kim izliyor?' }).waitFor()
  await page.click('button[type=submit]')
  await page.locator('.ob h1', { hasText: 'Ada, burayı sana göre ayarlayalım' }).waitFor()
  assert.equal(await page.locator('#ob-lang').inputValue(), 'tr')
  await page.click('.ob [data-next]')
  await page.locator('.ob h1', { hasText: 'Neleri seversin?' }).waitFor()
  await page.click('.ob [data-back]')
  // a change on the first page applies at once, to this page and the next ones
  await pick(page, '.ob', 'Français')
  await page.locator('.ob h1', { hasText: 'Salut Ada, personnalisez' }).waitFor()
  await pick(page, '.ob', 'Türkçe')
  await page.locator('.ob h1', { hasText: 'Ada, burayı sana göre ayarlayalım' }).waitFor()
  await page.click('.ob [data-next]')
  await page.locator('.ob h1', { hasText: 'Neleri seversin?' }).waitFor()
  for (let i = 0; i < 2; i++) await page.click('.ob [data-next]')
  await page.locator('.ob').waitFor({ state: 'detached' })
  await shellIs(page, 'tr', 'Ana sayfa')
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('first run: English chosen on the first screen of a German browser redraws the whole app in English', async () => {
  await freshInstall()
  const { ctx, page, errors } = await newPage(base, { locale: 'de' })
  await page.goto(base)
  await page.locator('h1', { hasText: 'Wer schaut?' }).waitFor()
  await pick(page, '.new-form', 'English')
  await page.locator('h1', { hasText: "Who's watching?" }).waitFor()
  await page.locator('input[name=name]').fill('Bo')
  await page.click('button[type=submit]')
  await page.locator('.ob h1', { hasText: 'Bo, make it yours' }).waitFor()
  assert.equal(await page.locator('#ob-lang').inputValue(), 'en')
  for (let i = 0; i < 3; i++) await page.click('.ob [data-next]')
  await shellIs(page, 'en', 'Home')
  assert.deepEqual(errors, [])
  await ctx.close()
})

test('first run: a language chosen only on the first onboarding page redraws the whole app in it', async () => {
  await freshInstall()
  const { ctx, page, errors } = await newPage(base, { locale: 'de' })
  await page.goto(base)
  await page.locator('input[name=name]').fill('Cy')
  await page.click('button[type=submit]')
  await page.locator('.ob h1', { hasText: 'Hallo Cy, mach es zu deinem' }).waitFor()
  await pick(page, '.ob', 'Türkçe')
  await page.locator('.ob h1', { hasText: 'Cy, burayı sana göre ayarlayalım' }).waitFor()
  for (let i = 0; i < 3; i++) await page.click('.ob [data-next]')
  await shellIs(page, 'tr', 'Ana sayfa')
  assert.deepEqual(errors, [])
  await ctx.close()
})
