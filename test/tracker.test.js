import test from 'node:test'
import assert from 'node:assert/strict'
import dgram from 'node:dgram'
import { scrape } from '../src/tracker.js'

// A tracker that speaks just enough of BEP 15: connect, then scrape.
function fakeTracker (counts) {
  const sock = dgram.createSocket('udp4')
  sock.on('message', (buf, rinfo) => {
    const action = buf.readUInt32BE(8)
    if (action === 0) {
      const out = Buffer.alloc(16); out.writeUInt32BE(0, 0); buf.copy(out, 4, 12, 16); out.write('connid00', 8)
      sock.send(out, rinfo.port, rinfo.address)
    } else if (action === 2) {
      const n = (buf.length - 16) / 20
      const out = Buffer.alloc(8 + n * 12); out.writeUInt32BE(2, 0); buf.copy(out, 4, 12, 16)
      for (let i = 0; i < n; i++) out.writeUInt32BE(counts[buf.subarray(16 + i * 20, 36 + i * 20).toString('hex')] ?? 0, 8 + i * 12)
      sock.send(out, rinfo.port, rinfo.address)
    }
  })
  return new Promise(resolve => sock.bind(0, '127.0.0.1', () => resolve({ sock, url: `udp://127.0.0.1:${sock.address().port}` })))
}

test('tracker scrape returns the largest count and how many trackers knew the hash', async () => {
  const a = 'a'.repeat(40); const b = 'b'.repeat(40)
  const t1 = await fakeTracker({ [a]: 7, [b]: 0 })
  const t2 = await fakeTracker({ [a]: 12 })
  try {
    const out = await scrape([a, b], [t1.url, t2.url, 'udp://127.0.0.1:9'], 500)
    assert.deepEqual(out.get(a), { seeders: 12, trackers: 2 })
    assert.deepEqual(out.get(b), { seeders: 0, trackers: 2 })
  } finally { t1.sock.close(); t2.sock.close() }
})

test('tracker scrape does not wait for dead trackers once enough have answered', async () => {
  const h = 'c'.repeat(40)
  const live = await Promise.all([1, 2, 3].map(() => fakeTracker({ [h]: 5 })))
  const t0 = Date.now()
  try {
    // the fourth tracker never answers and has a 5 s timeout
    const out = await scrape([h], [...live.map(t => t.url), 'udp://127.0.0.1:9'], 5000)
    assert.ok(Date.now() - t0 < 1000, 'returned early')
    assert.deepEqual(out.get(h), { seeders: 5, trackers: 3 })
  } finally { for (const t of live) t.sock.close() }
})
