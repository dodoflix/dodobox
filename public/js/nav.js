// Remote / D-pad / keyboard spatial navigation, and the Back key on TV platforms.
import { isTV } from './util.js'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]'
let lastWasKey = false
addEventListener('keydown', () => { lastWasKey = true }, true)
addEventListener('pointerdown', () => { lastWasKey = false }, true)
export const usingKeys = () => lastWasKey || isTV

const scope = () => {
  const open = [...document.querySelectorAll('[data-modal]')].filter(el => !el.hidden && el.offsetParent !== null).pop()
  return open || document.getElementById('shell')
}

function candidates (root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => {
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) return false
    const cs = getComputedStyle(el)
    return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]') && !(el.closest('#tabbar') && getComputedStyle(document.getElementById('tabbar')).display === 'none')
  })
}

function nextFocus (from, dir, list) {
  const a = from.getBoundingClientRect()
  const ax = a.left + a.width / 2; const ay = a.top + a.height / 2
  let best = null; let bestScore = Infinity
  for (const el of list) {
    if (el === from) continue
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2; const cy = r.top + r.height / 2
    const dx = cx - ax; const dy = cy - ay
    const ahead = dir === 'ArrowRight' ? dx : dir === 'ArrowLeft' ? -dx : dir === 'ArrowDown' ? dy : -dy
    if (ahead <= 1) continue
    const off = dir === 'ArrowLeft' || dir === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx)
    const overlap = dir === 'ArrowLeft' || dir === 'ArrowRight' ? Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top) : Math.min(a.right, r.right) - Math.max(a.left, r.left)
    const score = ahead + off * (overlap > 0 ? 1.2 : 4)
    if (score < bestScore) { bestScore = score; best = el }
  }
  return best
}

export function focusFirst (root = scope()) {
  const el = root.querySelector('[data-autofocus]') || candidates(root).find(e => !e.closest('#top, #tabbar')) || candidates(root)[0]
  el?.focus({ preventScroll: true })
}

function reveal (el) {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  const r = el.getBoundingClientRect()
  const pad = innerHeight * 0.22
  if (r.top < pad + 70 || r.bottom > innerHeight - pad) scrollBy({ top: r.top - innerHeight / 2 + r.height / 2, behavior: 'smooth' })
}

const BACK = new Set(['Escape', 'BrowserBack', 'GoBack', 'XF86Back'])
const BACK_CODES = new Set([10009, 461, 4]) // Tizen, webOS, Android TV

export const onBack = { handler: null }

addEventListener('keydown', e => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return
  const t = e.target
  const typing = t.matches?.('input[type=text], input[type=search], input:not([type])') && !(e.key === 'ArrowDown' || e.key === 'ArrowUp')
  if (BACK.has(e.key) || BACK_CODES.has(e.keyCode) || (e.key === 'Backspace' && !typing && !t.matches?.('input'))) {
    if (typing && e.key === 'Backspace') return
    e.preventDefault()
    if (!onBack.handler?.()) history.back()
    return
  }
  if (!e.key.startsWith('Arrow') || typing) return
  if (t.matches?.('input[type=range], select') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
  const root = scope()
  if (root.dataset.keys === 'own') return // the player handles its own arrows until its controls are shown
  const list = candidates(root)
  const from = list.includes(document.activeElement) ? document.activeElement : null
  if (!from) { e.preventDefault(); focusFirst(root); return }
  const to = nextFocus(from, e.key, list)
  if (to) { e.preventDefault(); to.focus({ preventScroll: true }); reveal(to) }
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { /* let the page scroll */ }
  else { e.preventDefault(); from.dispatchEvent(new CustomEvent('navedge', { bubbles: true, detail: e.key })) }
}, true)

addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.matches?.('[role=button], [data-click]')) { e.preventDefault(); e.target.click() }
})
