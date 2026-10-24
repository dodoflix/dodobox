import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, MOVIE, ORCHARD } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: ['movie', 'pack'] })) })
after(shutdown)

test('Download keeps a movie in the library, ready to play, until it is deleted', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/${MOVIE.id}`)
  await page.click('#dl')
  await page.goto(`${base}/#/library`)
  const row = page.locator('#dl .item', { hasText: MOVIE.name })
  await row.locator('text=Ready to watch').waitFor({ timeout: 60000 })
  assert.match(await row.innerText(), /Saved/)
  await row.locator('[data-del]').click()
  await page.locator('#dl .item').waitFor({ state: 'detached' })
  await page.locator('#dl', { hasText: 'Nothing downloaded' }).waitFor()
  await ctx.close()
})

test('a download that finds no source is listed as failed in the library', async () => {
  resetStubs()
  stub('torrentio.strem.fun', () => json({ streams: [] }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/movie/tt9000003`)
  await page.click('#dl')
  await page.goto(`${base}/#/library`)
  await page.locator('#dl .item', { hasText: 'Could not find a source' }).waitFor({ timeout: 60000 })
  resetStubs()
  await ctx.close()
})

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const library = async () => (await fetch(`${base}/api/library`)).json()
async function until (fn, ms = 60000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn(); if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 200))
  }
}

test('a season pack downloads once for both of its episodes, and each episode has its own controls', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/series/${ORCHARD.id}`)
  await page.click('#dlseason')
  const rows = await until(async () => { const l = (await library()).filter(r => r.ctx.id === ORCHARD.id); return l.length === 2 && l.every(r => r.phase === 'done') && l })
  assert.equal(new Set(rows.map(r => r.hash)).size, 1, 'one torrent')
  assert.deepEqual(rows.map(r => r.ctx.episode).sort(), [1, 2])
  await page.goto(`${base}/#/library`)
  await page.locator('#dl .item', { hasText: 'S1 E2' }).waitFor()
  const [one, two] = [rows.find(r => r.ctx.episode === 1), rows.find(r => r.ctx.episode === 2)]
  const act = (r, what) => post(`/api/library/${r.hash}:${r.fileIdx}/${what}`, {})
  assert.equal((await (await act(two, 'pause')).json()).ok, true)
  assert.equal((await library()).find(r => r.key === two.key).held, true)
  assert.equal((await (await act(two, 'prioritize')).json()).ok, true)
  assert.equal((await library()).find(r => r.key === two.key).priority, true)
  await act(two, 'unprioritize'); await act(two, 'resume')
  assert.equal((await library()).find(r => r.key === two.key).held, false)
  // leaving the first episode makes the second the main one; removing that one removes the torrent
  assert.equal((await (await fetch(`${base}/api/library/${one.hash}:${one.fileIdx}`, { method: 'DELETE' })).json()).ok, true)
  assert.equal((await library()).filter(r => r.ctx.id === ORCHARD.id).length, 1)
  assert.equal((await (await fetch(`${base}/api/library/${two.hash}:${two.fileIdx}`, { method: 'DELETE' })).json()).ok, true)
  assert.deepEqual((await library()).filter(r => r.ctx.id === ORCHARD.id), [])
  await ctx.close()
})

test('queued downloads can be moved to the front and cancelled before they start', async () => {
  assert.equal((await post('/api/download', { type: 'series', id: ORCHARD.id, season: 1, all: true })).status, 200)
  const queued = (await (await fetch(`${base}/api/downloads`)).json()).queue
  assert.equal(queued.length >= 1, true, 'the second episode waits behind the first')
  const key = encodeURIComponent(queued.at(-1).key)
  assert.equal((await (await post(`/api/downloads/${key}/prioritize`, {})).json()).ok, true)
  assert.equal((await (await fetch(`${base}/api/downloads`)).json()).queue[0].priority, true)
  assert.equal((await (await post(`/api/downloads/${key}/unprioritize`, {})).json()).ok, true)
  assert.equal((await (await post(`/api/downloads/${encodeURIComponent('series:nothing:1:1')}/prioritize`, {})).json()).ok, false)
  assert.equal((await fetch(`${base}/api/downloads/${key}`, { method: 'DELETE' })).status, 200)
  assert.equal((await (await fetch(`${base}/api/downloads`)).json()).queue.some(j => encodeURIComponent(j.key) === key), false)
  await until(async () => (await library()).some(r => r.ctx.id === ORCHARD.id && r.phase === 'done'))
})

test('the storage limit and media folders are server settings with sane bounds', async () => {
  const put = body => fetch(`${base}/api/settings`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await put({ maxStorageGB: 1 })).status, 200)
  assert.equal((await (await fetch(`${base}/api/settings`)).json()).maxStorageGB, 2, 'never below 2 GB')
  assert.equal((await put({ maxStorageGB: 80, mediaDirs: ['/nonexistent'] })).status, 200)
  const settings = await (await fetch(`${base}/api/settings`)).json()
  assert.equal(settings.maxStorageGB, 80)
  assert.deepEqual(settings.mediaDirs, ['/nonexistent'])
  assert.equal((await put({ mediaDirs: null })).status, 200)
})
