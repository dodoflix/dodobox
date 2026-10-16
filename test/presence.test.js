import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

test('watching sends a SET_ACTIVITY frame after the handshake', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-'))
  process.env.XDG_RUNTIME_DIR = dir
  process.env.DISCORD_CLIENT_ID = '123'
  const send = (s, op, o) => { const b = Buffer.from(JSON.stringify(o)); const h = Buffer.alloc(8); h.writeInt32LE(op, 0); h.writeInt32LE(b.length, 4); s.write(Buffer.concat([h, b])) }
  let srv; let peer
  const got = new Promise(resolve => {
    srv = net.createServer(s => {
      peer = s
      s.on('data', d => {
        const msg = JSON.parse(d.subarray(8))
        if (d.readInt32LE(0) === 0) { assert.equal(msg.client_id, '123'); send(s, 1, { cmd: 'DISPATCH', evt: 'READY' }) } else resolve(msg)
      })
    }).listen(path.join(dir, 'discord-ipc-0'))
  })
  const { watching, clear } = await import('../src/presence.js')
  watching({ name: 'Show', season: 2, episode: 3, pos: 100, dur: 1300 })
  const msg = await got
  assert.equal(msg.cmd, 'SET_ACTIVITY')
  assert.equal(msg.args.activity.details, 'Show')
  assert.equal(msg.args.activity.state, 'Season 2, episode 3')
  assert.equal(msg.args.activity.timestamps.end - msg.args.activity.timestamps.start, 1300)
  clear()
  peer.destroy()
  srv.close()
  fs.rmSync(dir, { recursive: true })
})
