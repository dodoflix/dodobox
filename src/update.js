// What the app knows about a newer release, for the page and the logs. A server run (Docker, npm, source) looks the release up itself
// and only says so; the desktop app registers a driver (see desktop/main.js) that can also download and install it.
// Turn the lookup off with NO_UPDATE_CHECK=1.
import fs from 'node:fs'
import { getJSON } from './http.js'
import { log } from './log.js'

const REPO = 'dodoflix/dodobox'
const state = { version: null, url: null, phase: 'idle', progress: 0, error: null }
let driver = null

const parts = v => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
export function newer (a, b) {
  const x = parts(a); const y = parts(b)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

const hint = () => driver ? (driver.self ? '' : 'Download the new installer and run it.')
  : fs.existsSync('/.dockerenv') ? `Pull the new image and recreate the container: docker pull ghcr.io/${REPO}:latest` : 'Download the new release, or pull the new source and run npm install.'

let found = null
// Called once for each newly found version (the desktop app asks its question from here).
export const onFound = fn => { found = fn }

// Looks the latest release up now. Resolves true when it is newer than `current`.
export async function lookup (current) {
  try {
    const r = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, tries: 1 })
    const latest = String(r.tag_name || '').replace(/^v/, '')
    if (!latest || !newer(latest, current)) { log.debug('update', 'up to date', { current, latest }); return false }
    const first = state.version !== latest
    Object.assign(state, { version: latest, url: r.html_url, phase: 'available' })
    if (first) { console.log(`\n  Update available: Dodobox ${latest} (you have ${current}). ${hint()}\n  ${r.html_url}\n`); found?.({ ...state }) }
    return true
  } catch (e) { log.debug('update', 'check failed', { err: e }); return false /* offline or rate limited: try again later */ }
}

export function watch (current) {
  if (process.env.NO_UPDATE_CHECK || process.env.DODOBOX_DESKTOP) return
  setTimeout(() => lookup(current), 10e3).unref()
  setInterval(() => lookup(current), 12 * 3600e3).unref()
}

// The desktop app: self is true when this build can replace itself (then it reports what it finds with set()); other builds only
// register themselves so the page says to download the installer.
export function useDriver (d) { driver = d }
export const set = patch => { Object.assign(state, patch) }

// canApply: the person asking sits at the computer Dodobox runs on and this build can update itself.
export const view = (current, local) => ({ current, ...state, hint: state.phase === 'idle' ? '' : hint(), canApply: !!driver?.self && local })

// Starts the download and returns at once with the promise of it finishing; progress and the end are reported with set().
export function download () {
  if (!driver?.self || !['available', 'error'].includes(state.phase)) throw Object.assign(new Error('nothing to download'), { code: 409 })
  Object.assign(state, { phase: 'downloading', progress: 0, error: null })
  return Promise.resolve(driver.download()).catch(e => { Object.assign(state, { phase: 'error', error: e.message }); throw e })
}
export function install () {
  if (!driver?.self || state.phase !== 'ready') throw Object.assign(new Error('no update is ready'), { code: 409 })
  driver.install()
}
export const check = () => driver?.check()
export const info = () => (state.phase === 'idle' ? null : { version: state.version, url: state.url })
