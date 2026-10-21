// Throttled swarm: does the automatic pick start and keep playing on a slow, high-latency line?
// Runs the real engine against local seeders inside an unprivileged network namespace shaped with tc (htb + netem).
// Each candidate release is backed by one seeder with its own aggregate peer rate; the line caps them all.
import { spawnSync, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const RUNTIME_MIN = 110
const MIN_BYTES = 3e6 // what the player waits for before it starts
const WINDOW_S = 40 // playback is simulated for this long after the first bytes
const MB = 96 * 1048576

// size/seeders are what a source lists; peerMbps is what the swarm really delivers (0 = nobody home); delay is extra one-way latency.
const SWARM = [
  { id: 'A', title: 'Movie.2020.1080p.BluRay.x264-GRP', quality: 1080, size: 8e9, seeders: 800, peerMbps: 12 },
  { id: 'B', title: 'Movie.2020.1080p.WEB.x265-GRP', quality: 1080, size: 3.5e9, seeders: 120, peerMbps: 6 },
  { id: 'C', title: 'Movie.2020.720p.BluRay.x264-GRP', quality: 720, size: 1.8e9, seeders: 60, peerMbps: 3 },
  { id: 'D', title: 'Movie.2020.2160p.UHD.BluRay.REMUX-GRP', quality: 2160, size: 40e9, seeders: 300, peerMbps: 20 },
  { id: 'E', title: 'Movie.2020.1080p.WEB-DL.x264-GRP', quality: 1080, size: 5e9, seeders: 2000, peerMbps: 1.5 },
  { id: 'F', title: 'Movie.2020.1080p.BluRay.x264-DEAD', quality: 1080, size: 7e9, seeders: 15, peerMbps: 0 },
  { id: 'G', title: 'Movie.2020.720p.WEBRip.x264-YTS', quality: 720, size: 1.1e9, seeders: 30, peerMbps: 2, delay: 500 }
].map(c => ({ ...c, bitrate: c.size * 8 / (RUNTIME_MIN * 60) / 1e6, provider: 'bench' }))

const LINES = [2, 5, 10, 25]
const RTTS = [20, 400]

const sh = (...a) => execFileSync(a[0], a.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] })
const tc = (...a) => sh('tc', ...a)

function shape (line, rtt, loss, ports) {
  try { tc('qdisc', 'del', 'dev', 'lo', 'root') } catch {}
  const half = rtt / 2
  tc('qdisc', 'add', 'dev', 'lo', 'root', 'handle', '1:', 'htb', 'default', '99')
  tc('class', 'add', 'dev', 'lo', 'parent', '1:', 'classid', '1:1', 'htb', 'rate', `${line}mbit`)
  tc('class', 'add', 'dev', 'lo', 'parent', '1:1', 'classid', '1:99', 'htb', 'rate', '100kbit', 'ceil', `${line}mbit`)
  tc('qdisc', 'add', 'dev', 'lo', 'parent', '1:99', 'netem', 'delay', `${half}ms`)
  SWARM.forEach((c, i) => {
    if (!ports[c.id]) return
    const n = 10 + i
    tc('class', 'add', 'dev', 'lo', 'parent', '1:1', 'classid', `1:${n}`, 'htb', 'rate', '50kbit', 'ceil', `${Math.min(c.peerMbps, line)}mbit`) // a rate above the parent's would bypass the line cap
    tc('qdisc', 'add', 'dev', 'lo', 'parent', `1:${n}`, 'netem', 'delay', `${half + (c.delay || 0)}ms`, ...loss ? ['loss', `${loss}%`] : [])
    tc('filter', 'add', 'dev', 'lo', 'parent', '1:', 'protocol', 'ip', 'prio', '1', 'u32', 'match', 'ip', 'sport', String(ports[c.id]), '0xffff', 'flowid', `1:${n}`)
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN }

export default async function throttle (args) {
  if (!process.env.BENCH_NETNS) {
    const r = spawnSync('unshare', ['-rn', 'sh', '-c', 'ip link set lo up mtu 1500 && exec "$@"', 'sh', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, BENCH_NETNS: '1' } })
    if (r.error || r.status === null) { console.error('needs unprivileged user+net namespaces (unshare -rn) and tc'); process.exit(1) }
    process.exit(r.status)
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-throttle-'))
  Object.assign(process.env, { DATA_DIR: path.join(tmp, 'data'), NO_DHT: '1', NO_MDNS: '1', NO_SPEEDTEST: '1', NO_UPDATE_CHECK: '1' })
  const { default: WebTorrent } = await import('webtorrent')
  const engine = await import('../../src/engine.js')
  const { measured } = await import('../../src/sources.js')
  const names = (args.alg || 'repo').split(',')
  const algs = await Promise.all(names.map(async n => (await import(`../candidates/swarm-${n}.js`)).default))
  const lines = args.line ? String(args.line).split(',').map(Number) : LINES
  const rtts = args.rtt ? String(args.rtt).split(',').map(Number) : RTTS
  const losses = args.loss ? String(args.loss).split(',').map(Number) : [0]

  const body = crypto.randomBytes(MB)
  const seeders = []; const ports = {}; const hashes = {}; const magnets = {}
  for (const c of SWARM) {
    if (!c.peerMbps) { hashes[c.id] = crypto.randomBytes(20).toString('hex'); magnets[c.id] = `magnet:?xt=urn:btih:${hashes[c.id]}`; continue }
    const w = new WebTorrent({ dht: false, lsd: false, utp: false, tracker: false })
    seeders.push(w)
    const t = await new Promise(r => w.seed(body, { name: `${c.title}.mkv`, announce: [] }, r))
    hashes[c.id] = t.infoHash; ports[c.id] = w.address().port
    magnets[c.id] = `magnet:?xt=urn:btih:${t.infoHash}&x.pe=127.0.0.1:${ports[c.id]}`
  }
  const byHash = Object.fromEntries(SWARM.map(c => [hashes[c.id], c]))
  const rows = SWARM.map(c => ({ infoHash: hashes[c.id], magnet: magnets[c.id], title: c.title, release: c.title, quality: c.quality, size: c.size, seeders: c.seeders, provider: c.provider }))

  const results = []
  for (const line of lines) for (const rtt of rtts) for (const loss of losses) {
    shape(line, rtt, loss, ports)
    // best a viewer could be given: the highest quality that the swarm and the line carry with 25% to spare
    const fits = SWARM.filter(c => Math.min(c.peerMbps, line * 0.9) >= c.bitrate * 1.25)
    const oracle = fits.length ? Math.max(...fits.map(c => c.quality)) : 0
    for (const alg of algs) {
      measured.clear()
      const ctx = { mbps: alg.lineMbps(line), display: 1080, mode: 'balanced', prefer: 'auto', runtimeMin: RUNTIME_MIN, kind: 'movie' }
      const start = pick => engine.add({ hash: pick.infoHash, magnet: pick.magnet, ctx: { type: 'movie', id: 'ttbench', title: 'Movie', year: 2020 } })
      const t0 = Date.now()
      const list = alg.rank(rows.map(r => ({ ...r })), ctx)
      const rivals = alg.rivalsOf(list, list[0], ctx)
      const pick = rivals.length > 1 ? await alg.race(rivals, start, ctx) : list[0]
      start(pick)
      const c = byHash[pick.infoHash]
      let first = 0; let base = 0
      for (let t = Date.now(); Date.now() - t < 90e3;) {
        const got = engine.status(pick.infoHash, false)?.downloaded ?? 0
        if (!first && got >= MIN_BYTES) { first = Date.now(); base = got; break }
        await sleep(250)
      }
      // Playback: starts with MIN_BYTES buffered, drains at the release's bitrate, and rebuffers to MIN_BYTES when empty.
      let stalled = 0; let events = 0
      if (first) {
        let bytes = MIN_BYTES; let playing = true; let prev = base; let tick = Date.now()
        for (const end = tick + WINDOW_S * 1000; tick < end;) {
          await sleep(250)
          const now = Date.now(); const got = engine.status(pick.infoHash, false)?.downloaded ?? 0
          bytes += got - prev; prev = got
          if (playing) { bytes -= c.bitrate * 125e3 * (now - tick) / 1000; if (bytes <= 0) { playing = false; events++ } }
          else { stalled += (now - tick) / 1000; if (bytes >= MIN_BYTES) playing = true }
          tick = now
        }
      }
      for (const r of rows) await engine.remove(r.infoHash).catch(() => {})
      const stall = !first || stalled > 2
      const r = { line, rtt, loss, alg: alg.id, pick: c.id, quality: c.quality, need: c.bitrate, startS: first ? (first - t0) / 1000 : Infinity, stalled, events, stall, oracle, raced: rivals.length }
      results.push(r)
      console.log(`${String(line).padStart(3)} Mbps ${String(rtt).padStart(3)} ms ${loss}% ${alg.id.padEnd(8)} pick ${c.id} ${String(c.quality).padStart(4)}p need ${c.bitrate.toFixed(1).padStart(5)} start ${first ? r.startS.toFixed(1).padStart(5) + 's' : ' never'} stalled ${stalled.toFixed(0).padStart(2)}s/${events} ${stall ? 'STALL' : 'ok   '} best ${oracle || '-'}p raced ${rivals.length}`)
    }
  }
  console.log('\nalg       profiles  stalls  below-best  unplayable  median-start')
  for (const alg of algs) {
    const rs = results.filter(r => r.alg === alg.id)
    console.log(`${alg.id.padEnd(9)} ${String(rs.length).padStart(8)} ${String(rs.filter(r => r.stall).length).padStart(7)} ${String(rs.filter(r => r.quality < r.oracle).length).padStart(11)} ${String(rs.filter(r => r.startS === Infinity).length).padStart(11)} ${median(rs.filter(r => r.startS < Infinity).map(r => r.startS)).toFixed(1).padStart(12)}s`)
  }
  for (const w of seeders) w.destroy()
  await engine.shutdown()
  if (args.keep) console.log('kept', tmp); else fs.rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
}
