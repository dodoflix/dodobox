// Volume control shared by both players: a mute button and a slider that opens on hover or focus.
import { icon } from './util.js'

export const volumeHTML = () => `<div class="vol"><button class="cbtn vm" aria-label="Mute">${icon('volume')}</button>
  <div class="vs" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100"><div class="vt"><i class="vf"></i><b class="vk"></b></div></div></div>`

// get(): 0..1, set(v): number, toggle(): flips mute. Returns update(volume, muted) to reflect outside changes.
export function bindVolume (root, { get, set, toggle }) {
  const vol = root.querySelector('.vol'); const vs = root.querySelector('.vs'); const vt = root.querySelector('.vt'); const btn = root.querySelector('.vm')
  const at = e => { const r = vt.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) }
  let drag = false
  vs.addEventListener('pointerdown', e => { drag = true; vol.classList.add('drag'); vs.setPointerCapture(e.pointerId); set(at(e)) })
  vs.addEventListener('pointermove', e => { if (drag) set(at(e)) })
  const end = () => { drag = false; vol.classList.remove('drag') }
  vs.addEventListener('pointerup', end); vs.addEventListener('pointercancel', end)
  vs.addEventListener('wheel', e => { e.preventDefault(); set(Math.max(0, Math.min(1, get() + (e.deltaY < 0 ? 0.05 : -0.05)))) }, { passive: false })
  vs.addEventListener('keydown', e => {
    const d = { ArrowRight: 0.05, ArrowUp: 0.05, ArrowLeft: -0.05, ArrowDown: -0.05 }[e.key]
    if (d) { e.preventDefault(); e.stopPropagation(); set(Math.max(0, Math.min(1, get() + d))) }
  })
  btn.addEventListener('click', toggle)
  return function update (v, muted) {
    const shown = muted ? 0 : v
    vol.style.setProperty('--v', shown)
    btn.innerHTML = icon(shown === 0 ? 'mute' : 'volume')
    btn.setAttribute('aria-label', shown === 0 ? 'Unmute' : 'Mute')
    vs.setAttribute('aria-valuenow', Math.round(shown * 100))
  }
}
