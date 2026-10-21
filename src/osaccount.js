// A profile's own OpenSubtitles account, used for that profile's downloads once the anonymous quota of this IP is used up.
// Talks to the legacy XML-RPC service because it takes the same file ids the search already returns and needs no app key.
import fs from 'node:fs'
import path from 'node:path'
import { DATA } from './paths.js'
import { fetchRetry } from './http.js'
import { log } from './log.js'

const FILE = path.join(DATA, 'opensubtitles.json')
const RPC = 'https://api.opensubtitles.org/xml-rpc'
const AGENT = 'TemporaryUserAgent'
const DAY = 24 * 3600e3

// Saved logins by profile id; the rest (session token, limits) lives in memory.
const accounts = new Map()
try {
  for (const [id, a] of Object.entries(JSON.parse(fs.readFileSync(FILE, 'utf8')))) if (a && typeof a.user === 'string' && typeof a.pass === 'string') accounts.set(id, { user: a.user, pass: a.pass })
} catch (e) { if (e.code !== 'ENOENT') log.error('subs', 'opensubtitles.json could not be read', { err: e }) }
const save = () => { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(Object.fromEntries(accounts)), { mode: 0o600 }) }

const fail = (msg, code) => Object.assign(new Error(msg), { code })
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const value = v => (Array.isArray(v) ? `<array><data>${v.map(x => `<value>${value(x)}</value>`).join('')}</data></array>` : typeof v === 'number' ? `<int>${v}</int>` : `<string>${esc(v)}</string>`)
const member = (xml, name) => (xml.match(new RegExp(`<name>${name}</name>\\s*<value>\\s*<(?:string|int)>([^<]*)<`)) || [])[1] || ''

async function call (method, ...params) {
  const body = `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params.map(p => `<param><value>${value(p)}</value></param>`).join('')}</params></methodCall>`
  const r = await fetchRetry(RPC, { method: 'POST', body, headers: { 'content-type': 'text/xml', 'user-agent': AGENT }, timeout: 15000, tries: 2 })
  return r.text()
}

async function login (user, pass) {
  const xml = await call('LogIn', user, pass, 'en', AGENT)
  if (!member(xml, 'status').startsWith('200')) throw fail('Wrong username or password', 401)
  return member(xml, 'token')
}

// Checks the login before keeping it.
export async function connect (id, user, pass) {
  user = String(user || '').trim(); pass = String(pass || '')
  if (!user || !pass) throw fail('Enter your OpenSubtitles username and password', 400)
  const token = await login(user, pass).catch(e => { throw e.code ? e : fail('OpenSubtitles could not be reached, try again in a moment', 502) })
  accounts.set(id, { user, pass, token, limitedUntil: 0, rejected: false, vipOnly: false })
  save()
  log.info('subs', 'opensubtitles account connected', { profile: id, user })
}

export function disconnect (id) {
  if (accounts.delete(id)) save()
}

export const ready = id => { const a = accounts.get(id); return !!a && !a.rejected && Date.now() >= (a.limitedUntil || 0) }
// Asked again after a day, so a membership bought meanwhile is noticed without reconnecting.
export function refuse (id) {
  const a = accounts.get(id); if (!a) return
  a.vipOnly = true; a.limitedUntil = Date.now() + DAY
  log.warn('subs', 'opensubtitles account got a placeholder instead of the file (not a VIP member), skipping it for a day', { profile: id })
}
export function status (id) {
  const a = accounts.get(id); const limited = !!a && Date.now() < (a.limitedUntil || 0)
  return { user: a?.user || null, rejected: !!a?.rejected, limited, vipOnly: limited && !!a.vipOnly }
}

// The file id is the last number of the download link. Returns the file as the service keeps it (gzip).
export async function download (id, url) {
  const a = accounts.get(id)
  const fileId = +(url.match(/(\d+)\.\w+$/) || [])[1]
  if (!a || !fileId) throw fail('unknown subtitle id', 502)
  for (let again = 0; ; again++) {
    a.token ||= await login(a.user, a.pass).catch(e => { if (e.code === 401) { a.rejected = true; log.warn('subs', 'opensubtitles account login refused, ignoring it', { profile: id }) } throw e })
    const xml = await call('DownloadSubtitles', a.token, [fileId])
    const st = member(xml, 'status')
    if (st.startsWith('200')) return Buffer.from(member(xml, 'data'), 'base64')
    if (st.startsWith('407')) { a.vipOnly = false; a.limitedUntil = Date.now() + DAY; log.warn('subs', 'opensubtitles account download limit reached, skipping for a day', { profile: id }); throw fail('opensubtitles download limit reached for now', 429) }
    if (st.startsWith('401') && !again) { a.token = null; continue } // the session timed out
    throw fail(`opensubtitles answered ${st || 'nothing'}`, 502)
  }
}
