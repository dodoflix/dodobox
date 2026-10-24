import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { boot, newPage, shutdown, signIn, MOVIE } from './harness.js'

let base; let dir
before(async () => {
  ({ base } = await boot({
    // What an install from before data had a version looks like, with a couple of entries a hand edit or an old release left wrong.
    data: d => {
      dir = d
      fs.writeFileSync(path.join(d, 'state.json'), JSON.stringify({
        profiles: {
          old1: { id: 'old1', name: 'Veteran', color: 'not-a-colour', list: [{ type: 'movie', id: MOVIE.id, name: 'Nacht Hafen' }, { type: 'game', id: 'x' }], history: { 'movie:tt1': { type: 'movie', id: 'tt1', name: 'Seen' }, junk: 5 }, ratings: {}, recent: {}, progress: {}, settings: { lang: 'en', quality: 7, autoNext: true, onboarded: true } }
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
  await new Promise(r => setTimeout(r, 300)) // saved names that differ from the catalog's are put right in the background
  assert.equal((await (await fetch(`${base}/api/me`, { headers: { 'x-profile': 'old1' } })).json()).list[0].name, MOVIE.name)
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
