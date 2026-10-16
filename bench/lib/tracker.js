// UDP tracker scrape (BEP 15): live seeder counts for up to 74 info hashes in one round trip.
import dgram from 'node:dgram'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'

export const TRACKERS = ['udp://tracker.opentrackr.org:1337', 'udp://open.stealth.si:80', 'udp://tracker.torrent.eu.org:451', 'udp://explodie.org:6969', 'udp://tracker.bittor.pw:1337', 'udp://open.demonii.com:1337', 'udp://exodus.desync.com:6969']

export function scrape (tracker, hashes, timeout = 1500) {
  const u = new URL(tracker); const t0 = performance.now()
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4')
    const done = (value) => { clearTimeout(timer); try { sock.close() } catch {} resolve({ tracker, ms: Math.round(performance.now() - t0), ...value }) }
    const timer = setTimeout(() => done({ err: 'timeout' }), timeout)
    const tx1 = crypto.randomBytes(4); let tx2
    sock.on('error', e => done({ err: e.code }))
    sock.on('message', buf => {
      const action = buf.readUInt32BE(0)
      if (action === 0 && buf.subarray(4, 8).equals(tx1)) {
        tx2 = crypto.randomBytes(4)
        sock.send(Buffer.concat([buf.subarray(8, 16), Buffer.from([0, 0, 0, 2]), tx2, ...hashes.slice(0, 74).map(h => Buffer.from(h, 'hex'))]), +u.port, u.hostname)
      } else if (action === 2 && tx2 && buf.subarray(4, 8).equals(tx2)) {
        const out = {}
        for (let i = 0; i < Math.min(hashes.length, 74); i++) { const o = 8 + i * 12; if (o + 12 > buf.length) break; out[hashes[i]] = { seeders: buf.readUInt32BE(o), completed: buf.readUInt32BE(o + 4), leechers: buf.readUInt32BE(o + 8) } }
        done({ out })
      } else if (action === 3) done({ err: 'tracker error: ' + buf.subarray(8).toString() })
    })
    dns.lookup(u.hostname, { family: 4 }).then(a => sock.send(Buffer.concat([Buffer.from('0000041727101980', 'hex'), Buffer.from([0, 0, 0, 0]), tx1]), +u.port, a.address)).catch(() => done({ err: 'dns' }))
  })
}
