import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { boot, newPage, shutdown, signIn, stub, json, MOVIE } from './harness.js'

let base; let dir
before(async () => {
  ({ base } = await boot({
    seed: false,
    // What an install from before data had a version looks like, with a couple of entries a hand edit or an old release left wrong.
    data: d => {
      dir = d
      fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({
        profiles: {
          old1: { id: 'old1', name: 'Veteran', color: 'not-a-colour', list: [{ type: 'movie', id: MOVIE.id, name: MOVIE.name }, { type: 'game', id: 'x' }], history: { 'movie:tt1': { type: 'movie', id: 'tt1', name: 'Seen' }, junk: 5 }, ratings: {}, recent: {}, progress: {}, settings: { lang: 'en', quality: 7, autoNext: true, onboarded: true } }
        },
        settings: {}
      }))
    }
  }))
})
after(shutdown)

test('an install from before data versions is brought up to date and keeps its profile', async () => {
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'schema.json'), 'utf8')).version, 1)
  assert.ok(fs.readdirSync(path.join(dir, 'backups')).length === 1, 'a copy is kept before anything changes')
  const profiles = await (await fetch(`${base}/api/profiles`)).json()
  assert.deepEqual(profiles.map(p => p.name), ['Veteran'])
  assert.match(profiles[0].color, /^#[\da-f]{3,8}$/i)
})

test('entries the old data got wrong are dropped when the profile loads, the rest is kept', async () => {
  const me = await (await fetch(`${base}/api/me`, { headers: { 'x-profile': 'old1' } })).json()
  assert.deepEqual(me.list.map(i => i.id), [MOVIE.id])
  assert.deepEqual(me.history.map(i => i.id), ['tt1'])
  assert.equal(me.settings.quality, 'auto')
  assert.equal('autoNext' in me.settings, false)
})

test('the existing profile is offered on the first visit and opens the home page', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Veteran')
  await page.goto(`${base}/#/library`)
  await page.locator('#l-list .poster', { hasText: MOVIE.name }).waitFor()
  await ctx.close()
})

test('a newer release is announced once the update lookup finds one, and nothing can be installed from a server run', async () => {
  stub('api.github.com', () => json({ tag_name: 'v99.0.0', html_url: 'https://github.com/dodoflix/dodobox/releases/tag/v99.0.0' }))
  assert.equal((await (await fetch(`${base}/api/update`)).json()).phase, 'idle')
  const updates = await import('../src/update.js')
  assert.equal(await updates.lookup('0.0.1'), true)
  assert.equal(await updates.lookup('99.0.0'), false)
  const view = await (await fetch(`${base}/api/update`)).json()
  assert.equal(view.version, '99.0.0')
  assert.equal(view.phase, 'available')
  assert.match(view.hint, /./)
  assert.equal(view.canApply, false)
  assert.equal((await fetch(`${base}/api/update/check`, { method: 'POST' })).status, 200)
  assert.equal((await fetch(`${base}/api/update/install`, { method: 'POST' })).status, 409)
})
