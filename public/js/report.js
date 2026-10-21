// Sends what the page sees (errors, player events, navigation, failed requests) to the server's log (POST /api/log), so the log holds both sides.
// Never throws. Errors and warnings are sent once each; everything is capped so a loop cannot flood the server.
import { store } from './util.js'

let sent = 0
const seen = new Set()
export function report (level, msg, f = {}) {
  try {
    const k = level + msg + (f.url || '')
    if (sent >= 400 || (level !== 'info' && level !== 'debug' && seen.has(k))) return
    seen.add(k); sent++
    fetch('/api/log', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json', 'x-profile': store.get('profile', '') }, body: JSON.stringify({ level, msg, f: { page: location.hash, ...f } }) }).catch(() => {})
  } catch {}
}

addEventListener('error', e => report('error', e.message || 'script error', { url: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack }))
addEventListener('unhandledrejection', e => report('error', 'unhandled rejection: ' + (e.reason?.message || e.reason), { stack: e.reason?.stack }))
addEventListener('hashchange', () => report('debug', 'navigate', { to: location.hash }))
addEventListener('online', () => report('info', 'browser online'))
addEventListener('offline', () => report('warn', 'browser offline'))
document.addEventListener('visibilitychange', () => report('debug', document.hidden ? 'tab hidden' : 'tab visible'))
const c = navigator.connection
report('info', 'page loaded', { ua: navigator.userAgent, viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}`, lang: navigator.language, ui: document.documentElement.lang, net: c && `${c.effectiveType} ${c.downlink}Mbps${c.saveData ? ' saveData' : ''}`, standalone: matchMedia('(display-mode: standalone)').matches || undefined, sw: !!navigator.serviceWorker?.controller })
