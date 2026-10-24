import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE, SERIES } from './harness.js'

let base
before(async () => { ({ base } = await boot()) })
after(shutdown)

const video = page => page.locator('.pl video')
const playing = page => page.waitForFunction(() => { const v = document.querySelector('.pl video'); return v && v.currentTime > 1.5 && !v.paused })

test('a movie streams from a torrent through HLS and plays', async () => {
  const { ctx, page, errors } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('#play')
  await playing(page)
  assert.ok(await video(page).evaluate(v => v.videoWidth) > 0, 'decoded frames')
  assert.deepEqual(errors.filter(e => !/404/.test(e)), [])
  await ctx.close()
})

test('pause, seek and the embedded subtitle track work', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
  await playing(page)
  await page.click('#pp')
  await page.waitForFunction(() => document.querySelector('.pl video').paused)
  await video(page).evaluate(v => { v.currentTime = 10 })
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime >= 10)
  await video(page).evaluate(v => { v.currentTime = 2 })
  await page.click('#m-subs')
  await page.locator('#menu .sm-langs button', { hasText: 'English' }).click()
  await page.locator('#menu .sm-files button').first().click()
  await page.locator('.pl-subs', { hasText: `Hello from ${MOVIE.name}` }).waitFor()
  await ctx.close()
})

test('leaving the player saves progress and the title offers Resume', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
  await playing(page)
  await video(page).evaluate(v => { v.currentTime = 8 })
  await page.waitForTimeout(1500)
  await page.click('#back')
  await page.locator('#play', { hasText: 'Resume' }).waitFor()
  await page.goto(`${base}/#/library`)
  await page.locator('#l-recent .poster', { hasText: MOVIE.name }).waitFor()
  await ctx.close()
})

test('a series episode plays from its page and its intro can be skipped', async () => {
  stub('api.introdb.app', () => json({ intro: { start_sec: 1, end_sec: 9 } }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/series/${SERIES.id}`)
  await page.click('#play')
  await playing(page)
  await page.locator('#skip', { hasText: /Skip intro/ }).click()
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime >= 9)
  await ctx.close()
  resetStubs()
})

test('a title with no source tells the viewer instead of hanging', async () => {
  resetStubs()
  stub('torrentio.strem.fun', () => json({ streams: [] }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/movie/tt9000003`)
  await page.locator('#l-line', { hasText: /Nothing is available/ }).waitFor({ timeout: 60000 })
  await page.locator('#retry').waitFor()
  await ctx.close()
  resetStubs()
})
