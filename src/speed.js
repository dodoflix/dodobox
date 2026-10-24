import { log } from './log.js'
// Internet speed of the machine running Dodobox. Source ranking uses it so a slow line is not handed a 60 GB remux.
const probe = { down: 0, at: 0 }
let peak = 0
const WINDOW_MS = 8000

export async function measure (windowMs = WINDOW_MS) {
  if (process.env.NO_SPEEDTEST) return
  try {
    const r = await fetch('https://speed.cloudflare.com/__down?bytes=25000000', { signal: AbortSignal.timeout(15000) })
    const reader = r.body.getReader()
    let t0 = 0; let bytes = 0
    // Under ~13 Mbps the whole 25 MB cannot arrive before the timeout: what arrived by then or by WINDOW_MS is the speed.
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!t0) t0 = performance.now() // exclude connection setup
        else bytes += value.length
        if (performance.now() - t0 > windowMs) { await reader.cancel(); break }
      }
    } catch {}
    const secs = (performance.now() - t0) / 1000
    if (secs > 0.2 && bytes > 1e5) { probe.down = bytes * 8 / secs / 1e6; probe.at = Date.now(); log.info('speed', 'internet speed measured', { downMbps: Math.round(probe.down) }) }
  } catch (e) { log.warn('speed', 'speed test failed', { err: e }) }
}

// Torrent throughput seen in practice also counts: it can exceed a short HTTP test.
export const observe = bytesPerSec => { peak = Math.max(peak * 0.999, bytesPerSec * 8 / 1e6) }
export const downMbps = () => Math.max(probe.down, peak)

export function start () {
  measure()
  setInterval(measure, 6 * 3600e3).unref() // each run fills the line for up to 8 s, which every other device on it feels as lag
}

const chunk = Buffer.alloc(256 * 1024).map(() => Math.floor(Math.random() * 256))
export function sendTestBytes (res, bytes) {
  bytes = Math.max(1e5, Math.min(8e6, bytes || 2e6))
  res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes, 'cache-control': 'no-store' })
  let left = bytes
  const write = () => {
    while (left > 0) {
      const part = left >= chunk.length ? chunk : chunk.subarray(0, left)
      left -= part.length
      if (!res.write(part)) return void res.once('drain', write)
    }
    res.end()
  }
  write()
}
