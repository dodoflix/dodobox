import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE, SERIES, ORCHARD } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: ['movie', 'series', 'pack'] })) })
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
  await page.locator('.pl-subs .top', { hasText: `Hello from ${MOVIE.name}` }).waitFor() // the track's {\\an8} puts it at the top
  await ctx.close()
})

test('the seek bar and time follow a seek at once, before the video at the new spot has loaded', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
  await playing(page)
  await page.click('#pp')
  await page.waitForFunction(() => document.querySelector('.pl video').paused)
  // timeupdate only arrives once the new position has loaded; hold it back to stand in for a slow load
  await page.evaluate(() => addEventListener('timeupdate', e => e.stopPropagation(), true))
  const before = await page.locator('#time').textContent()
  await video(page).evaluate(v => { v.currentTime = v.currentTime + 6 })
  await page.waitForFunction(was => document.querySelector('#time').textContent !== was, before, { timeout: 3000 })
  await ctx.close()
})

test('hovering the seek bar shows the frame at that spot above the time, kept inside the bar at its ends', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  const sheets = []
  page.on('response', r => { if (/\/api\/preview\//.test(r.url())) sheets.push(r.status()) })
  await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
  await playing(page)
  // the frames appear once the sheet has been made; until then the time shows alone
  const scrub = page.locator('#scrub')
  const box = await scrub.boundingBox()
  const at = async f => { await page.mouse.move(box.x + box.width * f, box.y + box.height / 2); await page.mouse.move(box.x + box.width * f + 1, box.y + box.height / 2) }
  for (let i = 0; i < 60 && !(await page.locator('#scrub .fr').isVisible()); i++) { await at(0.5); await page.waitForTimeout(500) }
  await page.locator('#scrub .fr').waitFor({ state: 'visible', timeout: 1000 }).catch(e => { throw new Error('sheet responses: ' + sheets + ' ' + e.message.slice(0, 80)) })
  assert.ok(sheets.includes(200), `the sheet was served: ${sheets}`)
  const pos = async f => { await at(f); return page.locator('#scrub .fr').evaluate(e => e.style.backgroundPosition) }
  assert.notEqual(await pos(0.1), await pos(0.9), 'another spot, another frame')
  await at(0)
  const frame = await page.locator('#scrub .fr').boundingBox()
  assert.ok(frame.x >= 0 && Math.abs(frame.x - box.x) < 1, `the frame stays inside the bar at its start: ${frame.x} vs ${box.x}`)
  await at(1)
  const end = await page.locator('#scrub .fr').boundingBox()
  assert.ok(end.x + end.width <= box.x + box.width + 1, 'and at its end')
  await ctx.close()
})

test('a subtitle filed under the wrong language is skipped for the next one in the language', async () => {
  const english = Array.from({ length: 30 }, (_, i) => `${i + 1}\n00:00:${String(i + 1).padStart(2, '0')},000 --> 00:00:${String(i + 1).padStart(2, '0')},800\nYou have what they would never say about this, but I am not sure that you are here`).join('\n\n')
  stub('opensubtitles-v3.strem.io', () => json({ subtitles: [
    { lang: 'tur', url: 'https://subs5.strem.io/wrong.srt', movieReleaseName: MOVIE.file, g: '900' },
    { lang: 'tur', url: 'https://subs5.strem.io/right.srt', movieReleaseName: MOVIE.file, g: '5' }
  ] }))
  stub('rest.opensubtitles.org', () => json([]))
  stub('yifysubtitles.ch', () => new Response('<table></table>'))
  stub('subs5.strem.io', u => new Response(u.pathname === '/wrong.srt' ? english : '1\n00:00:01,000 --> 00:00:09,000\nMerhaba dunya\n'))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/settings`)
  await page.locator('[data-k=sublang]').evaluate(s => { s.value = 'tur'; s.dispatchEvent(new Event('change', { bubbles: true })) })
  await page.waitForFunction(async () => (await (await fetch('/api/settings')).json()).sublang === 'tur')
  await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
  await page.locator('.pl-subs', { hasText: 'Merhaba dunya' }).waitFor({ timeout: 30000 })
  assert.ok(!/never say/.test(await page.locator('.pl-subs').innerText()), 'the English file was shown')
  await ctx.close()
  resetStubs()
})

test('the subtitle list is asked for while the video is still being prepared, not after it', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  let listed = 0; let probed = 0
  page.on('request', r => { if (r.url().includes('/api/subs?') && !listed) listed = Date.now() })
  page.on('response', r => { if (r.url().includes('/api/info/') && !probed) probed = Date.now() })
  await page.route('**/api/info/**', async route => { await new Promise(r => setTimeout(r, 2000)); await route.continue().catch(() => {}) })
  await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
  await playing(page)
  assert.ok(listed && probed && listed < probed, `list asked at ${listed}, video ready at ${probed}`)
  await ctx.close()
})

test('a forced 4K setting does not offer or mark 4K for a file below it', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  try {
    await page.goto(`${base}/#/settings`)
    await page.click('[data-seg=quality] [data-v="2160"]')
    await page.waitForFunction(() => document.querySelector('[data-seg=quality] [data-v="2160"]').classList.contains('on'))
    await page.goto(`${base}/#/watch/movie/${MOVIE.id}`)
    await playing(page)
    await page.click('#m-quality')
    const rows = page.locator('#menu button[data-q]')
    await rows.first().waitFor()
    // The fixture is a tiny synthetic video, so its tier is below 1080p: whatever it is, 4K must not be listed and the best level it has is the marked one.
    const shown = await rows.evaluateAll(b => b.map(x => x.dataset.q))
    assert.ok(!shown.includes('2160'), `4K offered for a file without it: ${shown}`)
    assert.equal(await page.locator('#menu button[data-q].on').getAttribute('data-q'), shown[1], 'the highest level the file has is the one marked')
  } finally {
    await page.goto(`${base}/#/settings`)
    await page.click('[data-seg=quality] [data-v="auto"]')
    await page.waitForFunction(() => document.querySelector('[data-seg=quality] [data-v="auto"]').classList.contains('on'))
    await ctx.close()
  }
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
  await page.click(`#l-history [data-hist^="movie/${MOVIE.id}"]`)
  await page.locator('#l-history').waitFor({ state: 'detached' })
  await page.reload()
  await page.locator('#l-recent').waitFor({ state: 'detached' })
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

test('the opening an episode marks as a chapter can be skipped', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/watch/series/${ORCHARD.id}/1/1`)
  await playing(page)
  await page.locator('#skip', { hasText: /Skip intro/ }).click()
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime >= 8)
  await ctx.close()
})
