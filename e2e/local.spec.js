import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, HOME, SERIES } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: false, media: true })) })
after(shutdown)

const playing = page => page.waitForFunction(() => { const v = document.querySelector('.pl video'); return v && v.currentTime > 1.5 && !v.paused }, null, { timeout: 60000 })

test('files on the viewer own disk are matched to titles and listed under Your files', async () => {
  assert.equal((await (await fetch(`${base}/api/local/rescan`, { method: 'POST' })).json()).count, 2)
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/library`)
  await page.locator('#mine .poster', { hasText: HOME.name }).waitFor()
  await page.locator('#mine .poster', { hasText: SERIES.name }).waitFor()
  await ctx.close()
})

test('a local film plays straight from disk with the subtitle file beside it, and nothing is downloaded', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/${HOME.id}`)
  await page.click('#play')
  await playing(page)
  await page.click('#m-subs')
  await page.locator('#menu .sm-langs button', { hasText: 'English' }).click()
  await page.locator('#menu .sm-files button', { hasText: 'en.srt' }).click()
  await video(page).evaluate(v => { v.currentTime = 1.2 })
  await page.locator('.pl-subs', { hasText: 'Beside the file' }).waitFor()
  assert.deepEqual(await (await fetch(`${base}/api/library`)).json(), [])
  await ctx.close()
})

test('a local episode is offered on its series page and plays', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/series/${SERIES.id}/1/2`)
  await playing(page)
  await ctx.close()
})

const video = page => page.locator('.pl video')
