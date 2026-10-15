import { store } from './util.js'

let mbps = store.get('bw', 0)
export const bandwidth = () => mbps
export const saveData = () => !!navigator.connection?.saveData
// Short side of the screen in physical pixels: a 4K TV reports 1080 CSS pixels at 2x.
export const displayPx = () => Math.round(Math.min(screen.width, screen.height) * (devicePixelRatio || 1))

export async function measure () {
  try {
    const bytes = 3e6
    const t0 = performance.now()
    const r = await fetch(`/api/speedtest?bytes=${bytes}&t=${Date.now()}`, { cache: 'no-store' })
    await r.arrayBuffer()
    const secs = (performance.now() - t0) / 1000
    let v = bytes * 8 / secs / 1e6
    const dl = navigator.connection?.downlink // the browser's own estimate; take the lower of the two
    if (dl) v = Math.min(v, dl * 1.5)
    mbps = Math.round(v * 10) / 10
    store.set('bw', mbps)
  } catch {}
  return mbps
}
