// Tells the server what this page is doing, for Discord Rich Presence: browsing, or the video that is playing or paused.
import { api } from './api.js'
import { tr } from './i18n.js'

let source = null; let allowed = () => true; let sent = false
// The words Discord shows, in the page's language; the server only fits them into the activity.
const words = b => ({
  browsing: tr('Browsing'), looking: tr('Looking for something to watch'), party: tr('In a watch party'), picking: tr('Picking something to watch'),
  paused: tr('Paused'), episode: b.season != null ? tr(`Season ${b.season} · Episode ${b.episode}`) : '', get: tr('Get Dodobox'), releases: tr('Releases')
})
const put = body => api('/api/presence', { method: 'PUT', body: body.state === 'off' ? body : { ...body, t: words(body) } }).catch(() => {})
const beat = () => {
  // Switching it off clears Discord once; a page that never sent anything leaves other devices' presence alone.
  if (!allowed()) { if (sent) { sent = false; put({ state: 'off' }) } return }
  const b = source?.() || { state: 'browsing' }
  if (b.state === 'browsing' && document.hidden) return
  sent = true
  put(b)
}
// The player passes a function that describes the video; null goes back to browsing.
export function nowPlaying (fn) { source = fn; beat() }
export const pingPresence = beat
export function initPresence (isAllowed) { allowed = isAllowed; setInterval(beat, 15000); document.addEventListener('visibilitychange', beat); beat() }
