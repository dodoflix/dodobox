// Watch party: friends who know a code find each other on the torrent network (the same trackers and DHT the downloads use), connect
// directly, and keep playback in step. Nothing is hosted for it. The code is the only secret: it makes the hidden torrent id the members
// look for and the key every message is encrypted with, so strangers on the network see ciphertext they cannot read or forge.
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { EventEmitter } from 'node:events'

const scrypt = promisify(crypto.scrypt)
const EXT = 'dodobox_party'
export const LIMITS = { members: 12, message: 4096, hiEvery: 20e3, ttl: 70e3, seen: 500, skew: 10 * 60e3 }
// WebRTC trackers let two homes behind different routers connect (they exchange the offer, a STUN server does the rest); the others find plain TCP peers.
export const TRACKERS = ['wss://tracker.openwebtorrent.com', 'wss://tracker.webtorrent.dev', 'wss://tracker.btorrent.xyz', 'wss://tracker.files.fm:7073/announce',
  'udp://tracker.opentrackr.org:1337/announce', 'udp://open.stealth.si:80/announce']

// 80 random bits as four groups of four characters (no I, L, O or U, so it survives being read out loud).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export function newCode () {
  const bytes = crypto.randomBytes(10)
  let bits = 0n
  for (const b of bytes) bits = (bits << 8n) | BigInt(b)
  let out = ''
  for (let i = 0; i < 16; i++) { out = ALPHABET[Number(bits & 31n)] + out; bits >>= 5n }
  return out.match(/.{4}/g).join('-')
}
// What a person typed, made forgiving (case, dashes, spaces, look-alike letters); null if it cannot be a code.
export function cleanCode (text) {
  const c = String(text || '').toUpperCase().replace(/O/g, '0').replace(/[IL]/g, '1').replace(/[^0-9A-Z]/g, '')
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(c) ? c.match(/.{4}/g).join('-') : null
}
// Slow on purpose: the torrent id is visible to the network, and this keeps guessing the code from it out of reach.
export async function derive (code) {
  const k = await scrypt(code, 'dodobox-party-v1', 64, { N: 16384, r: 8, p: 1 })
  return { infoHash: k.subarray(0, 20).toString('hex'), key: k.subarray(32) }
}

export function seal (key, obj) {
  const nonce = crypto.randomBytes(12)
  const c = crypto.createCipheriv('aes-256-gcm', key, nonce)
  const body = Buffer.concat([c.update(JSON.stringify(obj)), c.final()])
  return Buffer.concat([nonce, body, c.getAuthTag()])
}
export function open (key, buf) {
  if (buf.length < 29 || buf.length > LIMITS.message) return null
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12))
    d.setAuthTag(buf.subarray(buf.length - 16))
    const j = JSON.parse(Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString())
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch { return null }
}

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '')
const int = v => (Number.isInteger(v) && v >= 0 && v < 1e5 ? v : null)
const secs = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e6 ? v : null)
// What another member says is being watched. Anything that does not fit is dropped, because it goes to the page and to the player.
export function cleanItem (x) {
  if (!x || typeof x !== 'object' || !['movie', 'series', 'anime'].includes(x.type) || typeof x.id !== 'string' || !/^[\w:.-]{1,64}$/.test(x.id)) return null
  return { type: x.type, id: x.id, season: int(x.season), episode: int(x.episode), title: str(x.title, 120) }
}
export const cleanSource = x => (x && typeof x.infoHash === 'string' && /^[0-9a-f]{40}$/.test(x.infoHash) ? { infoHash: x.infoHash } : null)
const sameItem = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id && a.season === b.season && a.episode === b.episode

export class Party extends EventEmitter {
  // options (for tests): trackers, dht, peers ("host:port" to connect to straight away)
  constructor (options = {}) {
    super()
    this.options = options
    this.reset()
  }

  reset () {
    this.code = null; this.key = null; this.client = null; this.torrent = null
    this.phase = 'idle' // idle, connecting (nobody else yet), live
    this.self = { id: crypto.randomBytes(4).toString('hex'), name: '', color: '' }
    this.members = new Map(); this.wires = new Set(); this.seen = new Set(); this.seq = 0
    this.state = null // what is playing: { item, source, pos, paused, at }
    clearInterval(this.timer)
  }

  get port () { return this.client?.torrentPort }

  async join (code, { name = 'Guest', color = '#888' } = {}, state = null) {
    if (this.phase !== 'idle') throw Object.assign(new Error('Already in a party'), { code: 409 })
    const clean = cleanCode(code)
    if (!clean) throw Object.assign(new Error('That is not a party code'), { code: 400 })
    const { infoHash, key } = await derive(clean)
    this.code = clean; this.key = key; this.phase = 'connecting'
    this.self.name = String(name).slice(0, 24); this.self.color = String(color).slice(0, 16)
    this.state = state
    const { default: WebTorrent } = await import('webtorrent')
    this.client = new WebTorrent({ dht: this.options.dht ?? true, lsd: false, utp: false })
    this.client.on('error', e => console.error('[party]', e.message))
    const trackers = this.options.trackers ?? TRACKERS
    this.torrent = this.client.add(`magnet:?xt=urn:btih:${infoHash}&dn=party${trackers.map(t => '&tr=' + encodeURIComponent(t)).join('')}`, { path: path.join(os.tmpdir(), 'dodobox-party') })
    this.torrent.on('error', e => console.error('[party]', e.message))
    this.torrent.on('warning', () => {})
    const party = this
    this.torrent.on('wire', wire => {
      class Channel {
        constructor (w) { this.wire = w }
        onExtendedHandshake () { party.wires.add(this.wire); party.say('hi', {}, this.wire) }
        onMessage (buf) { party.receive(Buffer.from(buf), this.wire) }
      }
      Channel.prototype.name = EXT
      wire.use(Channel)
      wire.once('close', () => party.wires.delete(wire))
    })
    const addPeers = () => { for (const p of this.options.peers || []) this.torrent.addPeer(p) }
    if (this.torrent.infoHash) addPeers(); else this.torrent.once('infoHash', addPeers)
    this.timer = setInterval(() => { this.say('hi'); this.prune() }, LIMITS.hiEvery)
    this.timer.unref?.()
    this.members.set(this.self.id, { ...this.self, at: Date.now() })
    this.changed()
    return this.status()
  }

  leave () {
    if (this.phase === 'idle') return
    try { this.say('by') } catch {}
    const client = this.client
    this.reset()
    this.emit('event', { type: 'status', ...this.status() })
    // The goodbye needs a moment to leave before the connections are closed.
    setTimeout(() => client?.destroy(() => {}), 300).unref?.()
  }

  // Everything that goes out: sealed, numbered, and sent to every direct peer (or just one).
  say (k, data = {}, only) {
    if (!this.key) return
    const msg = { f: this.self.id, q: ++this.seq, ts: Date.now(), k, ...data }
    if (k === 'hi') { msg.name = this.self.name; msg.color = this.self.color }
    this.seen.add(`${msg.f}:${msg.q}`)
    this.fan(seal(this.key, msg), only ? [only] : [...this.wires])
  }

  fan (buf, wires) { for (const w of wires) { try { w.extended(EXT, buf) } catch {} } }

  receive (buf, from) {
    const m = open(this.key, buf)
    if (!m || typeof m.f !== 'string' || !Number.isInteger(m.q) || typeof m.k !== 'string' || m.f === this.self.id) return
    const id = `${m.f}:${m.q}`
    if (this.seen.has(id) || Math.abs(Date.now() - (+m.ts || 0)) > LIMITS.skew) return
    this.seen.add(id)
    if (this.seen.size > LIMITS.seen) this.seen.delete(this.seen.values().next().value)
    // Members that cannot reach each other directly are bridged by whoever can reach both.
    this.fan(buf, [...this.wires].filter(w => w !== from))
    const known = this.members.has(m.f)
    if (!known && this.members.size >= LIMITS.members) return
    const who = this.members.get(m.f) || { id: m.f, name: '', color: '' }
    who.at = Date.now()
    if (m.k === 'hi') { who.name = str(m.name, 24) || 'Guest'; who.color = str(m.color, 16) }
    this.members.set(m.f, who)
    if (!known) { this.say('hi'); const now = this.status().now; if (now) this.say('st', now) }
    if (this.phase === 'connecting' && this.members.size > 1) this.phase = 'live'
    this.act(m, who)
    if (!known || m.k === 'hi') this.changed()
  }

  act (m, who) {
    const from = { id: who.id, name: who.name }
    const item = cleanItem(m.item); const source = cleanSource(m.source)
    const pos = secs(m.pos)
    if (m.k === 'by') { this.members.delete(m.f); this.changed(); this.emit('event', { type: 'left', from }); return }
    if (m.k === 'st' && item) { this.state = { item, source, pos: pos ?? 0, paused: !!m.paused, at: Date.now() }; this.emit('event', { type: 'state', from, ...this.state }) }
    if (m.k === 'ld' && item) { this.state = { item, source, pos: 0, paused: true, at: Date.now() }; this.emit('event', { type: 'load', from, item, source }) }
    if (['pl', 'pa', 'sk', 'tk'].includes(m.k) && pos != null) {
      if (this.state) Object.assign(this.state, { pos, paused: m.k === 'pa' || (m.k === 'tk' && !!m.paused), at: Date.now() })
      this.emit('event', { type: 'cmd', k: m.k, pos, paused: !!m.paused, from })
    }
  }

  // What the local page does is sent on, and remembered for members who join later.
  send (k, data = {}) {
    if (this.phase === 'idle') throw Object.assign(new Error('Not in a party'), { code: 409 })
    const item = cleanItem(data.item); const source = cleanSource(data.source); const pos = secs(data.pos)
    if (k === 'st' || k === 'ld') {
      if (!item) throw Object.assign(new Error('Bad title'), { code: 400 })
      this.state = { item, source, pos: pos ?? 0, paused: k === 'ld' ? true : !!data.paused, at: Date.now() }
      this.say(k, { item, source, pos: this.state.pos, paused: this.state.paused })
      // The local page learns what is playing the way everyone else does, from the status.
      return this.changed()
    }
    if (!['pl', 'pa', 'sk', 'tk'].includes(k) || pos == null) throw Object.assign(new Error('Bad message'), { code: 400 })
    if (this.state) Object.assign(this.state, { pos, paused: k === 'pa' || (k === 'tk' && !!data.paused), at: Date.now() })
    this.say(k, { pos, paused: !!data.paused })
  }

  prune () {
    let any = false
    for (const [id, m] of this.members) if (id !== this.self.id && Date.now() - m.at > LIMITS.ttl) { this.members.delete(id); any = true }
    if (any) this.changed()
  }

  changed () {
    if (this.phase === 'live' && this.members.size < 2) this.phase = 'connecting'
    this.emit('event', { type: 'status', ...this.status() })
  }

  status () {
    const s = this.state
    return {
      active: this.phase !== 'idle', phase: this.phase, code: this.code, self: this.self.id,
      members: [...this.members.values()].map(({ id, name, color }) => ({ id, name, color, you: id === this.self.id })),
      // Where the show is now, counting the time since it was reported.
      now: s && { item: s.item, source: s.source, pos: s.pos + (s.paused ? 0 : (Date.now() - s.at) / 1000), paused: s.paused }
    }
  }
}

export const party = new Party()
export const sameTitle = sameItem
