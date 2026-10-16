// Tells the server what this page is doing, for Discord Rich Presence: browsing, or the video that is playing or paused.
import { api } from './api.js'

let source = null; let allowed = () => true; let sent = false
const put = body => api('/api/presence', { method: 'PUT', body }).catch(() => {})
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
