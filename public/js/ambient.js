import { $ } from './util.js'

// Samples the artwork (same-origin via /img) for its dominant lit color and washes the page with it.
const cache = new Map()
const DEFAULT = '242 166 90'

export function sample (url) {
  if (!url) return Promise.resolve(DEFAULT)
  if (cache.has(url)) return cache.get(url)
  const p = new Promise(resolve => {
    const im = new Image()
    im.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = 24; c.height = 36
        const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(im, 0, 0, 24, 36)
        const d = x.getImageData(0, 0, 24, 36).data
        let r = 0; let g = 0; let b = 0; let w = 0
        for (let i = 0; i < d.length; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]); const mn = Math.min(d[i], d[i + 1], d[i + 2])
          const sat = mx ? (mx - mn) / mx : 0
          const wt = (sat * sat + 0.02) * (mx / 255)
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt
        }
        if (!w) return resolve(DEFAULT)
        r /= w; g /= w; b /= w
        const mx = Math.max(r, g, b) || 1
        const k = Math.min(1.9, Math.max(0.75, 205 / mx))
        resolve([r, g, b].map(v => Math.min(255, Math.round(v * k))).join(' '))
      } catch { resolve(DEFAULT) }
    }
    im.onerror = () => resolve(DEFAULT)
    im.src = url
  })
  cache.set(url, p)
  return p
}

let flip = 0
export async function glow (url) {
  const rgb = await sample(url)
  document.documentElement.style.setProperty('--glow', rgb)
  const layers = [...document.querySelectorAll('#ambient i')]
  const next = layers[flip ^= 1]
  next.style.setProperty('--g', rgb.replace(/ /g, ' '))
  layers.forEach((l, i) => l.classList.toggle('on', i === flip))
}
export const calm = () => glow(null)
export const initAmbient = () => { $('#ambient').innerHTML = '<i></i><i></i>'; glow(null) }
