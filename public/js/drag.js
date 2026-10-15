// Mouse drag-to-scroll for horizontal rails and chip rows (touch already scrolls natively; wheel and trackpad do too).
// One pair of window listeners serves every rail (a page has dozens, and pages come and go): only the rail being dragged
// is tracked. Per-rail window listeners piled up with every navigation and slowed every pointer move.
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

export function dragScroll (el) {
  if (!el || el._drag) return
  el._drag = true
  const state = { x: 0, left: 0, moved: false }
  el.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return
    Object.assign(state, { x: e.clientX, left: el.scrollLeft, moved: false }); active = { el, state }
  })
  // A drag must not count as a click on the card under the cursor.
  el.addEventListener('click', e => { if (state.moved) { e.preventDefault(); e.stopPropagation(); state.moved = false } }, true)
  el.addEventListener('dragstart', e => e.preventDefault())
  // Plain mouse wheel scrolls rails sideways when the page is not the intended target.
  el.addEventListener('wheel', e => { if (e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault() } }, { passive: false })
}
