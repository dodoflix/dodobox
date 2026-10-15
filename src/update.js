// Looks up the latest release now and then and says so in the log when it is newer than this version (the desktop app asks
// the user and updates itself, see desktop/main.js). Turn it off with NO_UPDATE_CHECK=1.
import fs from 'node:fs'
import { getJSON } from './http.js'

const REPO = 'dodoflix/dodobox'
let found = null

const parts = v => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0)
export function newer (a, b) {
  const x = parts(a); const y = parts(b)
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0)
  return false
}

const howTo = () => fs.existsSync('/.dockerenv')
  ? `pull the new image and recreate the container: docker pull ghcr.io/${REPO}:latest`
  : 'download it from the release page, or pull the new source and run npm install'

async function run (current) {
  try {
    const r = await getJSON(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { accept: 'application/vnd.github+json' }, tries: 1 })
    const latest = String(r.tag_name || '').replace(/^v/, '')
    if (!latest || !newer(latest, current)) { found = null; return }
    const first = found?.version !== latest
    found = { version: latest, url: r.html_url }
    if (first) console.log(`\n  Update available: Dodobox ${latest} (you have ${current}). To update, ${howTo()}\n  ${r.html_url}\n`)
  } catch { /* offline or rate limited: try again later */ }
}

export function watch (current) {
  if (process.env.NO_UPDATE_CHECK || process.env.DODOBOX_DESKTOP) return
  setTimeout(() => run(current), 10e3).unref()
  setInterval(() => run(current), 12 * 3600e3).unref()
}

// { version, url } when a newer release exists.
export const available = () => found
