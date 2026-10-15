import { $, esc, icon } from './util.js'
import { S } from './session.js'
import { showPicker } from './profiles.js'

let pop = null; let hideT
const close = () => { clearTimeout(hideT); pop?.remove(); pop = null; $('#me-btn').setAttribute('aria-expanded', 'false') }

function open (focus) {
  if (pop || !S.me) return
  const btn = $('#me-btn'); const r = btn.getBoundingClientRect()
  pop = document.createElement('div'); pop.className = 'pmenu'; pop.setAttribute('role', 'menu'); pop.dataset.modal = ''
  pop.innerHTML = `<div class="pm-head"><span class="avatar" style="--c:${esc(S.me.color)}">${esc(S.me.name[0].toUpperCase())}</span><b translate="no">${esc(S.me.name)}</b></div>
    <a role="menuitem" href="#/settings">${icon('gear')}Settings</a>
    <a role="menuitem" href="#/library">${icon('film')}Library</a>
    <button role="menuitem" data-party>${icon('party')}Watch party</button>
    <button role="menuitem" data-switch>${icon('user')}Switch profile</button>`
  document.body.append(pop)
  pop.style.top = r.bottom + 8 + 'px'
  pop.style.left = Math.max(8, Math.min(innerWidth - pop.offsetWidth - 8, r.right - pop.offsetWidth)) + 'px'
  btn.setAttribute('aria-expanded', 'true')
  pop.addEventListener('pointerenter', () => clearTimeout(hideT))
  // Touch fires pointerleave right after the tap lifts; only a mouse leaving should close the menu.
  pop.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideT = setTimeout(close, 250) })
  pop.addEventListener('click', async e => {
    const sw = e.target.closest('[data-switch]')
    if (e.target.closest('[data-party]')) { close(); import('./party.js').then(p => p.openPanel(document.body, null)); return }
    if (sw) { close(); await showPicker({ dismissable: true }); location.hash = '#/'; location.reload() } else if (e.target.closest('a')) close()
  })
  pop.addEventListener('keydown', e => {
    const items = [...pop.querySelectorAll('[role=menuitem]')]; const i = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); items[(i + 1) % items.length].focus() } else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); items[(i - 1 + items.length) % items.length].focus() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); btn.focus() }
  })
  if (focus) pop.querySelector('[role=menuitem]').focus()
}

export function initProfileMenu () {
  const btn = $('#me-btn')
  const fine = matchMedia('(hover: hover) and (pointer: fine)')
  btn.addEventListener('click', () => (pop ? close() : open(true)))
  btn.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && fine.matches) { clearTimeout(hideT); open(false) } })
  btn.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideT = setTimeout(() => { if (pop && !pop.matches(':hover')) close() }, 250) })
  document.addEventListener('pointerdown', e => { if (pop && !pop.contains(e.target) && !btn.contains(e.target)) close() }, true)
  addEventListener('hashchange', close)
}
