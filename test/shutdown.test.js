// Ctrl-C and SIGTERM end the server even when the last save of its state fails.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from './support/tmp.js'

test('SIGTERM exits the process when saving state fails', { timeout: 30000 }, async () => {
  const tmp = tmpdir('shutdown')
  const data = path.join(tmp, 'data')
  const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: data, HOME: tmp, MEDIA_DIR: path.join(tmp, 'media'), NO_SPEEDTEST: '1', NO_UPDATE_CHECK: '1', NO_DHT: '1', NO_MDNS: '1', NO_DISCORD: '1', ALLOWED_HOSTS: 'localhost' }
  const kid = spawn(process.execPath, ['server.js'], { env, stdio: ['ignore', 'pipe', 'inherit'] })
  let out = ''
  const port = await new Promise((resolve, reject) => {
    kid.once('exit', code => reject(new Error(`server exited early: ${code}`)))
    kid.stdout.on('data', d => { out += d; const m = /localhost:(\d+)/.exec(out); if (m) resolve(m[1]) })
  })
  const closed = new Promise(resolve => kid.once('exit', (code, signal) => resolve({ code, signal })))
  try {
    // From here no file can be written in the data folder, and one change is waiting to be saved.
    fs.chmodSync(data, 0o500)
    const r = await fetch(`http://localhost:${port}/api/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Unsaved', color: '#abcdef' }) })
    assert.equal(r.status, 201)
    kid.kill('SIGTERM')
    const end = await closed
    assert.equal(end.signal, null, 'it ended by itself, not by being killed')
  } finally {
    fs.chmodSync(data, 0o700)
    kid.kill('SIGKILL')
  }
})
