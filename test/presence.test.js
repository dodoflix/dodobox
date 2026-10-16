import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('report sends playing, paused and browsing activities after the handshake', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'))
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
  const { report, clear } = await import('../src/presence.js')

  const play = { name: 'Show', art: 'https://images.metahub.space/poster/large/tt1/img', season: 2, episode: 3, pos: 100, dur: 1300 }
  report({ ...play, state: 'playing' })
  await next(1)
  assert.equal(frames[0].details, 'Show')
  assert.equal(frames[0].state, 'Season 2, episode 3')
  assert.equal(frames[0].timestamps.end - frames[0].timestamps.start, 1300)
  assert.equal(frames[0].assets.large_image, play.art)
  assert.ok(frames[0].buttons.length)

  report({ ...play, state: 'playing', pos: 101 })
  report({ ...play, state: 'paused', pos: 105 })
  await next(2)
  assert.equal(frames.length, 2, 'a timer that moved with the clock is not sent again')
  assert.equal(frames[1].state, 'Season 2, episode 3 (paused)')
  assert.equal(frames[1].timestamps, undefined)

  report({ state: 'browsing' })
  await next(3)
  assert.equal(frames[2].details, 'Browsing')
  assert.equal(frames[2].assets.large_image, 'logo')

  clear()
  await next(4)
  assert.equal(frames[3], null)
  peer.destroy()
  srv.close()
  fs.rmSync(dir, { recursive: true })
})
