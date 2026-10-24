import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, MOVIE } from './harness.js'

let base; let friend; let Party; let party
before(async () => {
  ({ base } = await boot())
  // after boot: the harness points DATA_DIR at a temp folder, and a static import would load the module before that
  ;({ Party, party } = await import('../src/party.js'))
  // No public trackers or DHT: the friend connects straight to this server's party port.
  party.options = { trackers: [], dht: false }
})
after(async () => {
  friend?.leave(); party.leave()
  await shutdown()
})

async function until (fn, ms = 20000) {
  const t0 = Date.now()
  for (;;) {
    const v = await fn(); if (v) return v
    if (Date.now() - t0 > ms) throw new Error('timeout')
    await new Promise(r => setTimeout(r, 100))
  }
}

test('a viewer starts a party, a friend joins by code and they chat, react and follow what is playing', async () => {
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.hover('#me-btn')
  await page.click('.pmenu [data-party]')
  await page.click('.party-pop .pp-start .btn-ink')
  const code = await page.locator('.party-pop .pp-codeline b').innerText()
  await page.locator('.party-pop .pp-note', { hasText: 'Looking for your friends' }).waitFor()

  friend = new Party({ trackers: [], dht: false, peers: [`127.0.0.1:${await until(() => party.port)}`] })
  const heard = []
  friend.on('event', e => { if (e.type === 'chat') heard.push(e.msg) })
  await friend.join(code, { name: 'Bo', color: '#6fb7e9' })
  await page.locator('.party-pop .pp-count', { hasText: '2 of 12' }).waitFor()
  await page.locator('.party-pop .pp-members', { hasText: 'Bo' }).waitFor()

  await until(() => friend.phase === 'live')
  friend.send('ch', { text: 'Hi from Bo' })
  await page.locator('.party-pop .pp-log li', { hasText: 'Hi from Bo' }).waitFor()

  await page.fill('.party-pop input[name=chat]', 'Hello Bo')
  await page.press('.party-pop input[name=chat]', 'Enter')
  const mine = await until(() => heard.find(m => m.text === 'Hello Bo'))
  friend.send('rx', { to: mine.id, e: '👍' })
  await page.locator('.party-pop .pp-rx', { hasText: '👍' }).waitFor()

  friend.send('ld', { item: { type: 'movie', id: MOVIE.id, title: MOVIE.name } })
  await page.locator('.party-pop .pp-now', { hasText: MOVIE.name }).waitFor()
  await page.locator('.party-pop .pp-log li', { hasText: `Bo is watching ${MOVIE.name}` }).waitFor()

  await page.click('.party-pop [data-a=leave]')
  await until(() => friend.members.size === 1)
  await page.locator('.party-pop .pp-start').waitFor()
  await ctx.close()
})

test('party requests that are wrong are refused', async () => {
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  assert.equal((await post('/api/party/join', { code: 'nope' })).status, 400)
  assert.equal((await post('/api/party/send', { k: 'pl', pos: 1 })).status, 409)
  assert.equal((await post('/api/party/start', { item: { type: 'game', id: 'x' } })).status, 400)
  const started = await (await post('/api/party/start', { password: 'secret', item: { type: 'movie', id: MOVIE.id, title: MOVIE.name } })).json()
  assert.equal(started.locked, true)
  assert.equal((await post('/api/party/start', {})).status, 409)
  assert.equal((await post('/api/party/send', { k: 'ch', text: 'x' })).status, 409)
  assert.equal((await post('/api/party/send', { k: 'zz' })).status, 400)
  assert.equal((await post('/api/party/leave', {})).status, 200)
})
