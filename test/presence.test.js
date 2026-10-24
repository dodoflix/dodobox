import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from './support/tmp.js'

test('report sends playing, paused and browsing activities after the handshake', { skip: process.platform === 'win32' }, async () => {
  const dir = tmpdir('ipc')
  process.env.XDG_RUNTIME_DIR = dir
  process.env.DISCORD_CLIENT_ID = '123'
  const send = (s, op, o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(b.length, 4); s.write(Buffer.concat([h, b])) }
  const frames = []; let wake; let peer
  const srv = net.createServer(s => {
    peer = s
    s.on('data', d => {
      const msg = JSON.parse(d.subarray(8))
      if (d.readInt32LE(0) === 0) { assert.equal(msg.client_id, '123'); send(s, 1, { cmd: 'DISPATCH', evt: 'READY' }) } else { frames.push(msg.args.activity); wake?.() }
    })
  }).listen(path.join(dir, 'discord-ipc-0'))
  const next = n => new Promise(resolve => { wake = () => frames.length >= n && resolve(); wake() })
  const { report } = await import('../src/presence.js')

  const play = { name: 'Show', art: 'https://images.metahub.space/poster/large/tt1/img', season: 2, episode: 3, pos: 100, dur: 1300 }
  report({ ...play, state: 'playing' })
  await next(1)
  assert.equal(frames[0].details, 'Show')
  assert.equal(frames[0].state, 'Season 2 · Episode 3')
  assert.equal(frames[0].timestamps.end - frames[0].timestamps.start, 1300)
  assert.equal(frames[0].assets.large_image, play.art)
  assert.ok(frames[0].buttons.length)

  report({ ...play, state: 'playing', pos: 101 })
  report({ ...play, state: 'paused', pos: 105 })
  await next(2)
  assert.equal(frames.length, 2, 'a timer that moved with the clock is not sent again')
  assert.equal(frames[1].state, 'Season 2 · Episode 3 · Paused')
  assert.equal(frames[1].timestamps, undefined)

  report({ state: 'browsing' })
  await next(3)
  assert.equal(frames[2].details, 'Browsing')
  assert.equal(frames[2].assets.large_image, 'logo')

  report({ state: 'browsing', t: { browsing: 'Göz atıyor', looking: 'İzleyecek bir şey arıyor', get: 'Dodobox\'ı indir' } })
  await next(4)
  assert.equal(frames[3].details, 'Göz atıyor')
  assert.equal(frames[3].buttons[0].label, 'Dodobox\'ı indir')
  assert.equal(frames[3].buttons[1].label, 'Releases', 'a word the page did not send falls back to English')

  report({ state: 'browsing', party: { id: 'abc', size: 3, max: 12 } })
  await next(5)
  assert.deepEqual(frames[4].party, { id: 'abc', size: [3, 12] })
  assert.equal(frames[4].details, 'In a watch party')

  report({ state: 'off' })
  await next(6)
  assert.equal(frames[5], null)
  peer.destroy()
  srv.close()
  fs.rmSync(dir, { recursive: true })
})
