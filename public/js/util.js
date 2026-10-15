export const $ = (s, r = document) => r.querySelector(s)
export const $$ = (s, r = document) => [...r.querySelectorAll(s)]
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const enc = encodeURIComponent
export const sleep = ms => new Promise(r => setTimeout(r, ms))
export const bytes = n => n >= 1e12 ? (n / 1e12).toFixed(2) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : Math.round(n / 1e3) + ' kB'
export const clock = s => {
  s = Math.max(0, Math.floor(s || 0))
  const h = Math.floor(s / 3600); const m = Math.floor(s % 3600 / 60); const x = s % 60
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0')
}
export const mins = s => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min` }

export const store = {
  get (k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } },
  set (k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }
}

// A trailer is a video stream: only on a link the browser reports as at least 5 Mbps.
export const canTrailer = () => (matchMedia('(hover: hover) and (pointer: fine)').matches || isTV) && !slowLink() && (navigator.connection?.downlink ?? 10) >= 5 && navigator.onLine
export const sized = (src, w) => (src && src.startsWith('/img?') ? `${src}&w=${w}` : src)
// A slow link (the browser's own hint, or what recent images actually took) gets smaller pictures and no trailers.
export const slowLink = () => {
  const c = navigator.connection; const bw = store.get('bw', 0)
  return !!(c && (c.saveData || /^(slow-2g|2g|3g)$/.test(c.effectiveType))) || (bw > 0 && bw < 4)
}
// Learns the link's speed from a picture that has just been downloaded (cached or tiny ones say nothing).
export function learnLink (img) {
  const e = performance.getEntriesByName(img.currentSrc || img.src).pop()
  if (!e || e.transferSize < 40e3 || e.responseEnd <= e.responseStart) return
  const mbps = e.transferSize * 8 / (e.responseEnd - e.responseStart) / 1000
  const old = store.get('bw', 0)
  store.set('bw', Math.round((old ? old * 0.6 + mbps * 0.4 : mbps) * 10) / 10)
}
// A tiny copy (64 px, about 1 KB) of a proxied picture: shown blurred while the real one arrives.
export const lowres = src => (src && src.startsWith('/img?') ? src.replace(/&w=\d+$/, '') + '&w=64' : '')
// A CSS value that shows the tiny copy until the real picture has loaded over it.
export const layered = (src, w) => (lowres(src) ? `url('${sized(src, w)}'), url('${lowres(src)}')` : `url('${src || ''}')`)
// Widths that match how large the picture is actually drawn (times the screen density), not a fixed big size.
const small = w => (slowLink() ? Math.min(w, 240) : w)
export const posterW = () => small(px((innerWidth <= 700 ? 134 : Math.min(200, Math.max(131, innerWidth * 0.124))) * 1.1))
export const thumbW = () => small(px(190))
export const peekW = () => (slowLink() ? Math.min(px(352), 480) : px(352))
export const fullWidth = () => { const w = Math.round(innerWidth * Math.min(devicePixelRatio || 1, 2)); return slowLink() ? Math.min(w, 960) : w }
export const px = css => Math.round(css * Math.min(devicePixelRatio || 1, 2))

export const icon = (n, c = '') => `<svg class="i ${c}" aria-hidden="true"><use href="#i-${n}"/></svg>`

export const ua = navigator.userAgent
export const isTV = /DodoboxTV|Tizen|Web0S|WebOS|SMART-TV|SmartTV|AFTT|AFTM|AFTS|Android.*TV|BRAVIA|HbbTV|NetCast|CrKey|PlayStation|Xbox|VIERA/i.test(ua) || /[?&]tv=1/.test(location.search) || store.get('tv', false)
export const isIPhone = /iPhone|iPod/.test(ua)
export const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(ua)

export function toast (msg, { action, ms = 3600 } = {}) {
  const host = $('#toasts')
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.append(document.createTextNode(msg))
  if (action) {
    const b = document.createElement('button')
    b.className = 'btn btn-ink sm'; b.textContent = action.label
    b.onclick = () => { action.run(); el.remove() }
    el.append(b)
  }
  host.append(el)
  setTimeout(() => el.remove(), ms)
}

export const hue = n => { let h = 0; for (const c of String(n || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
const initial = n => (String(n || '?').match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase()

export const known = new Map()
function remember (i) {
  if (!i.description && !i.background) return
  known.set(`${i.type}:${i.id}`, { type: i.type, id: i.id, name: i.name, year: i.year, rating: i.rating, runtime: i.runtime, description: (i.description || '').slice(0, 420), background: i.background, poster: i.poster, trailer: i.trailer })
  if (known.size > 800) known.delete(known.keys().next().value)
}

export function poster (i, { progress, sub, href } = {}) {
  remember(i)
  const link = href || `#/title/${i.type}/${enc(i.id)}`
  return `<a class="poster" href="${link}">
    <div class="art"><div class="ph" translate="no" style="--h:${hue(i.name)}"><b>${esc(initial(i.name))}</b><span>${esc(i.name)}</span></div>${i.poster ? `${lowres(i.poster) ? `<img class="lq in" loading="lazy" decoding="async" alt="" src="${esc(lowres(i.poster))}" onerror="this.remove()">` : ''}<img decoding="async" alt="" data-src="${esc(sized(i.poster, posterW()))}" onload="this.classList.add('in')" onerror="this.remove()">` : ''}</div>
    ${i.rating ? `<span class="badge">${icon('star')}${i.rating.toFixed(1)}</span>` : ''}
    <div class="cap" translate="no">${esc(i.name)}</div><div class="sub">${esc(sub ?? i.year ?? '')}</div>
    ${progress != null ? `<div class="prog"><i style="width:${Math.min(100, progress * 100)}%"></i></div>` : ''}
  </a>`
}
export const skeletons = n => Array.from({ length: n }, () => '<div class="poster"><div class="sk art"></div><div class="sk line"></div><div class="sk line short"></div></div>').join('')
