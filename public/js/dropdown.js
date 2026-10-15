// Replaces native <select class="field"> with a dropdown that matches the rest of the interface.
// The select stays in the DOM (hidden) as the source of truth, so existing change handlers keep working.
import { esc, icon } from './util.js'

let open = null
const close = () => { if (open) { open.pop.remove(); open.btn.setAttribute('aria-expanded', 'false'); open.btn.focus({ preventScroll: true }); document.removeEventListener('pointerdown', outside, true); open = null } }
const outside = e => { if (open && !open.pop.contains(e.target) && !open.btn.contains(e.target)) close() }

function build (sel) {
  const wrap = document.createElement('div'); wrap.className = 'dd'
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'dd-btn'
  btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false')
  const label = sel.closest('.set, .ob-row')?.querySelector('b')?.textContent
  if (label) btn.setAttribute('aria-label', label)
  sel.hidden = true
  sel.after(wrap); wrap.append(btn)
  const paint = () => { btn.innerHTML = `<span>${esc(sel.selectedOptions[0]?.textContent || '')}</span>${icon('chevron')}` }
  paint()

  btn.addEventListener('click', () => (open?.btn === btn ? close() : show()))
  btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (open?.btn !== btn) show() } })

  function show () {
    close()
    const pop = document.createElement('div')
    pop.className = 'dd-pop'; pop.setAttribute('role', 'listbox'); pop.dataset.modal = ''
    pop.innerHTML = [...sel.options].map((o, i) => `<button type="button" role="option" data-i="${i}" aria-selected="${o.selected}" class="${o.selected ? 'on' : ''}"><span>${esc(o.textContent)}</span>${o.selected ? icon('check') : ''}</button>`).join('')
    document.body.append(pop)
    const r = btn.getBoundingClientRect()
    const below = innerHeight - r.bottom
    const h = Math.min(pop.scrollHeight, innerHeight * 0.5)
    pop.style.minWidth = Math.max(r.width, 180) + 'px'
    pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px'
    pop.style.top = (below > h + 16 || below > r.top ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px'
    pop.style.maxHeight = Math.min(innerHeight * 0.5, Math.max(below, r.top) - 16) + 'px'
    btn.setAttribute('aria-expanded', 'true')
    open = { pop, btn }
    document.addEventListener('pointerdown', outside, true)
    ;(pop.querySelector('.on') || pop.firstElementChild)?.focus()
    pop.querySelector('.on')?.scrollIntoView({ block: 'center' })
    pop.addEventListener('click', e => {
      const o = e.target.closest('[data-i]'); if (!o) return
      sel.selectedIndex = +o.dataset.i
      paint(); close()
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    pop.addEventListener('keydown', e => {
      const items = [...pop.children]; const i = items.indexOf(document.activeElement)
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[Math.min(items.length - 1, i + 1)].focus() }
      else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[Math.max(0, i - 1)].focus() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
      else if (e.key.length === 1) { const n = items.find(b => b.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())); n?.focus() }
    })
  }
  sel._sync = paint
}

export function upgradeSelects (root) { root.querySelectorAll('select.field').forEach(s => { if (!s._sync) build(s) }) }
export const syncSelect = sel => sel._sync?.()
