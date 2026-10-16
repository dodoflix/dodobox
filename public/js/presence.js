// Tells the server what this page is doing, for Discord Rich Presence: browsing, or the video that is playing or paused.
import { api } from './api.js'

let source = null
const beat = () => {
  const b = source?.() || { state: 'browsing' }
  if (b.state === 'browsing' && document.hidden) return
  api('/api/presence', { method: 'PUT', body: b }).catch(() => {})
}
// The player passes a function that describes the video; null goes back to browsing.
export function nowPlaying (fn) { source = fn; beat() }
export const pingPresence = beat
export const initPresence = () => { setInterval(beat, 15000); document.addEventListener('visibilitychange', beat); beat() }
