import { icon, along, stepOf } from './util.js'

export const volumeHTML = () => `<div class="vol"><button class="cbtn vm" aria-label="Mute">${icon('volume')}</button>
  <div class="vs" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100"><div class="vt"><i class="vf"></i><b class="vk"></b></div></div></div>`

export function bindVolume (root, { get, set, toggle }) {
  const vol = root.querySelector('.vol'); const vs = root.querySelector('.vs'); const vt = root.querySelector('.vt'); const btn = root.querySelector('.vm')
  const at = e => along(e, vt)
  let drag = false
  vs.addEventListener('pointerdown', e => { drag = true; vol.classList.add('drag'); vs.setPointerCapture(e.pointerId); set(at(e)) })
  vs.addEventListener('pointermove', e => { if (drag) set(at(e)) })
  const end = () => { drag = false; vol.classList.remove('drag') }
  vs.addEventListener('pointerup', end); vs.addEventListener('pointercancel', end)
  vs.addEventListener('wheel', e => { e.preventDefault(); set(Math.max(0, Math.min(1, get() + (e.deltaY < 0 ? 0.05 : -0.05)))) }, { passive: false })
  vs.addEventListener('keydown', e => {
    const d = e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowDown' ? -0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowRight' ? 0.05 * stepOf(e.key) : 0
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
