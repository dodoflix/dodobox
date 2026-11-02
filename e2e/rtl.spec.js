import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: ['movie'] })) })
after(shutdown)

// Arabic and Hebrew run right to left: pop-ups hang from the left edge of what opened them, the hero and every bar start at the right,
// and Left is "forward" (seek, volume, next slide), the way the screen shows it.
const setLang = async (page, code) => {
  await page.goto(`${base}/#/settings`)
  const lang = page.locator('#lang')
  await lang.waitFor({ state: 'attached' })
  if (await page.evaluate(() => document.documentElement.lang) === code) return
  await Promise.all([page.waitForEvent('load'), lang.evaluate((s, c) => { s.value = c; s.dispatchEvent(new Event('change', { bubbles: true })) }, code)])
  await page.waitForFunction(c => document.documentElement.lang === c, code)
  await page.locator('#lang').waitFor({ state: 'attached' })
}
const open = async (lang, hash) => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await setLang(page, lang)
  await page.goto(`${base}/${hash}`)
  return { ctx, page }
}
const box = (page, sel) => page.locator(sel).first().boundingBox()

for (const [lang, dir] of [['ar', 'rtl'], ['he', 'rtl'], ['en', 'ltr']]) {
  test(`${lang}: a dropdown and the profile menu hang from the anchor's end edge`, async () => {
    const { ctx, page } = await open(lang, '#/settings')
    assert.equal(await page.evaluate(() => document.documentElement.dir), dir)
    const edge = async (btn, pop) => { const b = await box(page, btn); const p = await box(page, pop); return dir === 'rtl' ? [p.x, b.x] : [p.x + p.width, b.x + b.width] }
    await page.locator('.dd-btn').first().click()
    const [a, b] = await edge('.dd-btn[aria-expanded=true]', '.dd-pop')
    assert.ok(Math.abs(a - b) < 2, `dropdown edge ${a} vs anchor edge ${b}`)
    await page.keyboard.press('Escape')
    await page.locator('#me-btn').hover() // a mouse opens it on hover; a click would close it again
    await page.locator('.pmenu').waitFor()
    const [c, d] = await edge('#me-btn', '.pmenu')
    assert.ok(Math.abs(c - d) < 2, `menu edge ${c} vs avatar edge ${d}`)
    await ctx.close()
  })
}

test('ar: the hero starts at the right, its dots and arrows follow, and the next slide is the one on the left', async () => {
  const { ctx, page } = await open('ar', '#/')
  await page.locator('.hero-body').waitFor()
  const hero = await box(page, '.hero')
  const dots = await box(page, '.dots')
  assert.ok(dots.x < hero.x + hero.width / 2, 'the dots sit at the end of the line, which is the left')
  const slide = n => box(page, `.hero .slide:nth-child(${n})`)
  const first = await slide(1)
  assert.ok(first.x >= hero.x - 1, `the first slide is on screen (${first.x})`)
  await page.locator('.hero-arrow.next').evaluate(b => b.click())
  await page.waitForFunction(() => document.querySelector('.hero .dots button.on')?.dataset.k === '1')
  await page.waitForTimeout(800)
  const second = await slide(2)
  assert.ok(Math.abs(second.x - hero.x) < 2, `the second slide slid in (${second.x} vs ${hero.x})`)
  await ctx.close()
})

test('ar: the seek bar fills from the right and Left seeks forward; volume follows the bar', async () => {
  const { ctx, page } = await open('ar', `#/watch/movie/${MOVIE.id}`)
  const v = page.locator('.pl video')
  await page.waitForFunction(() => { const e = document.querySelector('.pl video'); return e && e.currentTime > 1.5 && !e.paused })
  await page.click('#pp')
  await page.waitForFunction(() => document.querySelector('.pl video').paused)
  const bar = await box(page, '#scrub .track'); const done = await box(page, '#scrub .done')
  assert.ok(Math.abs(done.x + done.width - (bar.x + bar.width)) < 1.5, `progress hangs from the right end: ${done.x + done.width} vs ${bar.x + bar.width}`)
  // clicking near the right end is near the start of the film
  const dur = await v.evaluate(e => e.duration)
  await page.mouse.click(bar.x + bar.width * 0.9, bar.y + bar.height / 2)
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime >= 0)
  const t = await v.evaluate(e => e.currentTime)
  assert.ok(t < dur * 0.3, `a click at the right end seeks near the start: ${t} of ${dur}`)
  await v.evaluate(e => { e.currentTime = 2 })
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime >= 2)
  await page.locator('.pl').focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime > 5)
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime < 5)
  await v.evaluate(e => { e.volume = 0.5 })
  await page.locator('.vs').focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() => document.querySelector('.pl video').volume > 0.52)
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.pl video').volume < 0.48)
  await ctx.close()
})

test('ar: the trailer seek bar follows the same direction', async () => {
  const id = 'tt9000095' // not a fixture title, so no earlier test has its page cached
  stub('v3-cinemeta.strem.io', u => (/\/meta\/movie\//.test(u.pathname)
    ? json({ meta: { id, imdb_id: id, name: 'Short Reel', year: '2021', trailers: [{ source: 'dQw4w9WgXcQ', type: 'Trailer' }] } })
    : json({ metas: [] })))
  const { ctx, page } = await open('ar', '#/')
  await page.route(/youtube/, r => r.abort())
  await page.evaluate(t => { location.hash = `#/trailer/movie/${t}` }, id)
  await page.locator('#tp #scrub').waitFor({ state: 'attached' })
  await page.locator('#tp #scrub').focus()
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() => document.querySelector('#tp #time').textContent.startsWith('0:10'))
  await ctx.close()
  resetStubs()
})
