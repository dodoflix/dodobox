// Live seeder counts from UDP trackers (BEP 15 scrape): up to 74 info hashes per tracker in one round trip.
// A source's own seeder number can be days old; a torrent listed with 300 seeders can have 7.
import dgram from 'node:dgram'
import dns from 'node:dns/promises'
import crypto from 'node:crypto'

export function scrapeTracker (tracker, hashes, timeout = 1200) {
  const u = new URL(tracker)
  return new Promise(resolve => {
    const sock = dgram.createSocket('udp4')
    const done = value => { clearTimeout(timer); try { sock.close() } catch {} resolve(value) }
    const timer = setTimeout(() => done(null), timeout)
    const tx1 = crypto.randomBytes(4); let tx2
    sock.on('error', () => done(null))
    sock.on('message', buf => {
      if (buf.length < 8) return
      const action = buf.readUInt32BE(0)
      if (action === 0 && buf.subarray(4, 8).equals(tx1) && buf.length >= 16) {
        tx2 = crypto.randomBytes(4)
        sock.send(Buffer.concat([buf.subarray(8, 16), Buffer.from([0, 0, 0, 2]), tx2, ...hashes.slice(0, 74).map(h => Buffer.from(h, 'hex'))]), +u.port, u.hostname)
      } else if (action === 2 && tx2 && buf.subarray(4, 8).equals(tx2)) {
        const out = new Map()
        for (let i = 0; i < Math.min(hashes.length, 74); i++) { const o = 8 + i * 12; if (o + 12 > buf.length) break; out.set(hashes[i], buf.readUInt32BE(o)) }
        done(out)
      } else if (action === 3) done(null)
    })
    dns.lookup(u.hostname, { family: 4 }).then(a => sock.send(Buffer.concat([Buffer.from('0000041727101980', 'hex'), Buffer.from([0, 0, 0, 0]), tx1]), +u.port, a.address)).catch(() => done(null))
  })
}

// hash -> { seeders, trackers }: the largest count any tracker gave, and how many trackers knew the hash. Returns once
// `enough` trackers have answered (plus a moment for a close fourth) instead of waiting for the slowest or dead ones.
export function scrape (hashes, trackers, timeout, enough = 3) {
  const out = new Map()
  return new Promise(resolve => {
    let pending = trackers.length; let answered = 0; let closing
    const finish = () => { clearTimeout(closing); resolve(out) }
    if (!pending) return finish()
    for (const t of trackers) {
      scrapeTracker(t, hashes, timeout).then(m => {
        if (m) {
          answered++
          for (const [h, n] of m) { const cur = out.get(h) || { seeders: 0, trackers: 0 }; out.set(h, { seeders: Math.max(cur.seeders, n), trackers: cur.trackers + 1 }) }
          if (answered === enough) closing = setTimeout(finish, 50)
        }
        if (--pending === 0) finish()
      })
    }
  })
}
