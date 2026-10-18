import { icon } from './util.js'

// Mouse drag-to-scroll for horizontal rails. One pair of window listeners serves every rail: per-rail listeners piled up with each navigation and slowed pointer moves.
let active = null
addEventListener('pointermove', e => {
  if (!active) return
  const { el, state } = active
  const dx = e.clientX - state.x
  if (Math.abs(dx) > 5) { state.moved = true; el.classList.add('dragging'); document.body.classList.add('dragging'); window.dispatchEvent(new Event('dragstrip')) }
  if (state.moved) { el.style.scrollSnapType = 'none'; el.scrollLeft = state.left - dx }
})
addEventListener('pointerup', () => {
  if (!active) return
  const { el } = active; active = null
  el.classList.remove('dragging'); document.body.classList.remove('dragging'); el.style.scrollSnapType = ''
})

const reduced = matchMedia('(prefers-reduced-motion: reduce)')

// Previous/next buttons for a strip, for people who cannot swipe or drag. Shown on hover with a mouse, only while there is more to scroll that way.
function arrows (el) {
  const host = el.parentElement; if (!host) return
  host.classList.add('strip-host')
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
  const mk = dir => {
    const b = document.createElement('button'); b.type = 'button'; b.hidden = true; b.tabIndex = -1
    b.className = `strip-arrow ${dir}`; b.setAttribute('aria-label', dir === 'l' ? 'Scroll left' : 'Scroll right'); b.innerHTML = icon(dir === 'l' ? 'left' : 'right')
    b.onclick = () => el.scrollBy({ left: (dir === 'l' ? -1 : 1) * el.clientWidth * 0.8, behavior: reduced.matches ? 'auto' : 'smooth' })
    return b
  }
  const l = mk('l'); const r = mk('r'); host.append(l, r)
  const place = () => {
    const max = el.scrollWidth - el.clientWidth; const x = el.scrollLeft
    const rtl = getComputedStyle(el).direction === 'rtl'
    const more = el.offsetParent && max > 2
    l.hidden = !more || (rtl ? x <= 2 - max : x < 2); r.hidden = !more || (rtl ? x > -2 : x > max - 2)
    if (!more) return
    const h = host.getBoundingClientRect(); const e = el.getBoundingClientRect(); const t = (el.querySelector('.art') || el).getBoundingClientRect()
    l.classList.toggle('sm', e.height < 90); r.classList.toggle('sm', e.height < 90)
    for (const b of [l, r]) b.style.top = `${t.top - h.top + t.height / 2 - (b.offsetHeight || 40) / 2}px`
    l.style.left = `${e.left - h.left + 8}px`
    r.style.left = `${e.right - h.left - (r.offsetWidth || 40) - 8}px`
  }
  el.addEventListener('scroll', place, { passive: true })
  host.addEventListener('pointerenter', place)
  new ResizeObserver(place).observe(el)
  new MutationObserver(place).observe(el, { childList: true })
}

export function dragScroll (el) {
  if (!el || el._drag) return
  el._drag = true
  arrows(el)
  const state = { x: 0, left: 0, moved: false }
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    Object.assign(state, { x: e.clientX, left: el.scrollLeft, moved: false }); active = { el, state }
  })
  // A drag must not count as a click on the card under the cursor.
  el.addEventListener('click', e => { if (state.moved) { e.preventDefault(); e.stopPropagation(); state.moved = false } }, true)
  el.addEventListener('dragstart', e => e.preventDefault())
  el.addEventListener('wheel', e => { if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault() } }, { passive: false })
}
