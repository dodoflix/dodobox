// Pictures with a data-src (and tiles with a data-art background) load nearest the top of the screen first, a few at a time, so what is on screen is never behind what is
// off it and data requests keep their share of the connection. Whatever scrolls away before its turn is dropped from the queue.
import { slowLink } from './util.js'

const queue = new Set()
const inflight = new Set()
const seen = new WeakSet()
const max = () => (slowLink() ? 3 : 5)

const rank = im => {
  const r = im.getBoundingClientRect()
  const on = r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
  return (on ? 0 : 1e6) + Math.abs(r.top) * 10 + Math.abs(r.left) / 100
}

function pump () {
  // A picture removed while it waits for a retry never fires load or error again, and would hold its slot for good.
  for (const im of inflight) if (!im.isConnected) inflight.delete(im)
  while (inflight.size < max() && queue.size) {
    let best = null; let score = Infinity
    for (const im of queue) { const s = rank(im); if (s < score) { score = s; best = im } }
    queue.delete(best)
    if (!best.isConnected || best.getAttribute('src')) continue
    inflight.add(best)
    const done = () => { best.removeEventListener('load', done); best.removeEventListener('error', done); inflight.delete(best); pump() }
    best.addEventListener('load', done); best.addEventListener('error', done)
    best.fetchPriority = 'low'
    best.src = best.dataset.src
  }
}

const io = new IntersectionObserver(entries => {
  for (const e of entries) {
    const el = e.target
    // A background picture (data-art) is set when its tile comes near the screen; it is one shared picture, so it is not queued.
    if (el.dataset.art !== undefined) { if (e.isIntersecting) { el.style.setProperty('--art', el.dataset.art); io.unobserve(el) } continue }
    e.isIntersecting ? queue.add(el) : queue.delete(el)
  }
  pump()
}, { rootMargin: '300px 500px' })

const watch = el => {
  for (const im of el.matches('img[data-src], [data-art]') ? [el] : el.querySelectorAll('img[data-src], [data-art]')) {
    if (!seen.has(im)) { seen.add(im); io.observe(im) }
  }
}

// A picture that fails is asked for again (twice, a little later) under a new address, so neither a hiccup nor a bad copy in the
// browser cache leaves it blank for good. Only when the retries are spent does the failure reach the tile's own onerror.
const RETRY = [1500, 5000]
function retryFailed (e) {
  const im = e.target
  if (im.tagName !== 'IMG' || !im.dataset.src || !im.getAttribute('src')) return
  const n = +im.dataset.tries || 0
  if (n >= RETRY.length) return
  e.stopPropagation()
  im.dataset.tries = n + 1
  setTimeout(() => { if (im.isConnected) im.src = im.dataset.src + (im.dataset.src.includes('?') ? '&' : '?') + 'r=' + (n + 1) }, RETRY[n])
}

export function initLoader () {
  addEventListener('error', retryFailed, true)
  new MutationObserver(ms => { for (const m of ms) m.addedNodes.forEach(n => { if (n.nodeType === 1) watch(n) }) }).observe(document.body, { childList: true, subtree: true })
  watch(document.body)
}

// The page is being left: nothing queued or in flight matters any more.
export function resetLoader () {
  queue.clear(); inflight.clear()
}
