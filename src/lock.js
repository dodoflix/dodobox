// Profile PINs. A profile with a PIN answers only to a session token that was issued for it after the right PIN was entered;
// everything not tied to a profile (the downloads, playing a title) stays open to everyone on the network.
import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
export const PIN_FORMAT = /^\d{4,8}$/
const SESSION_MS = 30 * 24 * 3600e3
const FREE_TRIES = 5
const MAX_WAIT_MS = 15 * 60e3
const tokens = new Map() // token -> { id, at }
const fails = new Map() // profile id -> { n, until }

export async function hashPin (pin) {
  const salt = crypto.randomBytes(16)
  return { salt: salt.toString('hex'), hash: (await scrypt(pin, salt, 32)).toString('hex') }
}
export async function matches (record, pin) {
  if (!record || typeof pin !== 'string') return false
  const want = Buffer.from(record.hash, 'hex')
  const got = await scrypt(pin, Buffer.from(record.salt, 'hex'), want.length)
  return crypto.timingSafeEqual(want, got)
}

// After a few wrong PINs the profile refuses every attempt for a while, longer each time, so a four digit PIN cannot be walked through.
export function throttled (id, now = Date.now()) {
  const f = fails.get(id)
  return f && f.until > now ? Math.ceil((f.until - now) / 1000) : 0
}
export function failed (id, now = Date.now()) {
  const f = fails.get(id) || { n: 0, until: 0 }
  f.n++
  if (f.n >= FREE_TRIES) f.until = now + Math.min(MAX_WAIT_MS, 30e3 * 2 ** (f.n - FREE_TRIES))
  fails.set(id, f)
}
export const succeeded = id => { fails.delete(id) }

export function issue (id) {
  const token = crypto.randomBytes(24).toString('hex')
  tokens.set(token, { id, at: Date.now() })
  return token
}
export function valid (id, token, now = Date.now()) {
  const t = typeof token === 'string' ? tokens.get(token) : null
  if (!t || t.id !== id) return false
  if (now - t.at > SESSION_MS) { tokens.delete(token); return false }
  return true
}
export const revoke = token => { tokens.delete(token) }
export function revokeAll (id) { for (const [t, v] of tokens) if (v.id === id) tokens.delete(t) }
