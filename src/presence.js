// Discord Rich Presence over the local Discord client's IPC socket. A no-op when Discord is not
// running on the machine the server runs on.
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1560673013807054931'
// Progress is saved about every 9 s while playing, so silence means paused or stopped.
const IDLE_MS = 30e3
const RETRY_MS = 60e3

const OP = { handshake: 0, frame: 1, close: 2, ping: 3, pong: 4 }
let sock; let ready; let retryAt = 0; let idle

function candidates () {
  if (process.platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`)
  const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || os.tmpdir()
  // Flatpak and Snap builds keep the socket in their own subfolder.
  const dirs = [base, path.join(base, 'app/com.discordapp.Discord'), path.join(base, 'snap.discord')]
  return dirs.flatMap(d => Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)))
}

const encode = (op, data) => {
  const body = Buffer.from(JSON.stringify(data))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0); head.writeInt32LE(body.length, 4)
  return Buffer.concat([head, body])
}

// Resolves with the socket once Discord answers the handshake with READY.
function dial (file) {
  return new Promise((resolve, reject) => {
    const s = net.connect(file).unref()
    let buf = Buffer.alloc(0)
    s.on('connect', () => s.write(encode(OP.handshake, { v: 1, client_id: CLIENT_ID })))
    s.on('error', reject)
    s.on('close', () => { if (sock === s) sock = ready = null; reject(new Error('closed')) })
    s.on('data', chunk => {
      buf = Buffer.concat([buf, chunk])
      while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
        const op = buf.readInt32LE(0)
        const msg = buf.subarray(8, 8 + buf.readInt32LE(4)).toString()
        buf = buf.subarray(8 + buf.readInt32LE(4))
        if (op === OP.ping) s.write(encode(OP.pong, JSON.parse(msg)))
        else if (op === OP.close) s.destroy()
        else if (JSON.parse(msg).evt === 'READY') resolve(s)
      }
    })
  })
}

async function connect () {
  if (sock) return sock
  if (Date.now() < retryAt) throw new Error('discord unavailable')
  ready ||= (async () => {
    for (const file of candidates()) {
      try { return (sock = await dial(file)) } catch {}
    }
    retryAt = Date.now() + RETRY_MS
    ready = null
    throw new Error('discord unavailable')
  })()
  return ready
}

async function setActivity (activity) {
  const s = await connect()
  s.write(encode(OP.frame, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: String(Date.now()) }))
}

export const clear = () => { clearTimeout(idle); if (sock) setActivity(null).catch(() => {}) }

// b is the body of PUT /api/progress: { name, season, episode, pos, dur }.
export function watching (b) {
  if (process.env.NO_DISCORD) return
  clearTimeout(idle)
  idle = setTimeout(clear, IDLE_MS)
  idle.unref()
  const start = Math.floor(Date.now() / 1000) - Math.floor(b.pos)
  setActivity({
    type: 3,
    details: String(b.name || 'Dodobox').slice(0, 128),
    state: b.season != null ? `Season ${b.season}, episode ${b.episode}` : undefined,
    timestamps: { start, end: start + Math.floor(b.dur) },
    assets: { large_image: 'logo', large_text: 'Dodobox' }
  }).catch(() => {})
}
