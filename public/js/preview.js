// Hover preview: rest the pointer on a poster and a small card plays the trailer.
import { cget } from './api.js'
import { S, toggleList, inList } from './session.js'
import { esc, icon, enc, sized, isTV, known, hue, lowres, canTrailer, peekW } from './util.js'
import { mountTrailer } from './trailer.js'

const fine = matchMedia('(hover: hover) and (pointer: fine)')
const played = new Map()
let card = null; let trailer = null; let showT; let hideT; let trailerT; let current = null

const aired = v => !(v.released && new Date(v.released) > new Date())
// A show's size: its seasons when it has several, otherwise its episodes. Only meta (not a catalog card) lists episodes.
const size = m => {
  const v = (m.videos || []).filter(aired); const seasons = new Set(v.map(x => x.season)).size
  return seasons > 1 ? `${seasons} seasons` : v.length ? `${v.length} episode${v.length > 1 ? 's' : ''}` : ''
}
const facts = m => {
  const flat = m.type === 'movie' || m.movie
  return [m.year, flat && m.runtime && esc(m.runtime), m.rating && `${icon('star')}${m.rating.toFixed(1)}`, !flat && size(m)].filter(Boolean).map(x => `<span>${x}</span>`).join('')
}
const cats = m => (m.genres || []).slice(0, 3).map(esc).join(' · ')

const parse = a => { const m = (a.getAttribute('href') || '').match(/^#\/(?:title|watch)\/(\w+)\/([^/]+)/); return m && { type: m[1], id: decodeURIComponent(m[2]) } }

function close () {
  clearTimeout(showT); clearTimeout(hideT); clearTimeout(trailerT)
  trailer?.destroy(); trailer = null
  card?.remove(); card = null; current = null
}

async function open (poster) {
  const ref = parse(poster); if (!ref || !fine.matches) return
  let m = known.get(`${ref.type}:${ref.id}`)
  if (!m) { try { m = await cget(`/api/meta/${ref.type}/${enc(ref.id)}`) } catch { return } }
  if (current !== poster) return
  close(); current = poster
  const r = poster.getBoundingClientRect()
  const w = 352
  const left = Math.max(10, Math.min(innerWidth - w - 10, r.left + r.width / 2 - w / 2))
  const top = Math.max(76, Math.min(innerHeight - 330, r.top - 30))
  const mine = card = document.createElement('div')
  card.className = 'peek'; card.style.cssText = `left:${left}px;top:${top}px`
  card.innerHTML = `<div class="pv" style="--h:${hue(m.name)}"><i class="lq" style="background-image:url('${esc(lowres(sized(m.background || m.poster, 0)))}')"></i><img alt="" src="${esc(sized(m.background || m.poster, peekW()))}" onload="this.classList.add('in')"></div>
    <div class="pb"><b translate="no">${esc(m.name)}</b>
    <div class="meta">${facts(m)}</div>
    <div class="cats">${cats(m)}</div>
    <p translate="no">${esc(m.description || '')}</p>
    <div class="acts"><a class="btn btn-ink sm" href="#/title/${m.type}/${enc(m.id)}">${icon('play')}Play</a><button class="btn btn-ghost sm" data-list>${inList(m.type, m.id) ? icon('check') + 'In list' : icon('plus') + 'My List'}</button></div></div>`
  document.body.append(card)
  // Episodes and seasons come with the full entry, which a catalog card does not carry.
  if (m.type !== 'movie' && !m.videos) cget(`/api/meta/${m.type}/${enc(m.id)}`).then(f => { if (card === mine) { m = f; mine.querySelector('.meta').innerHTML = facts(f); mine.querySelector('.cats').innerHTML = cats(f) } }).catch(() => {})
  card.addEventListener('pointerenter', () => clearTimeout(hideT))
  card.addEventListener('pointerleave', () => { hideT = setTimeout(close, 200) })
  card.addEventListener('click', e => {
    const l = e.target.closest('[data-list]')
    if (l) { toggleList(m).then(() => { l.innerHTML = inList(m.type, m.id) ? icon('check') + 'In list' : icon('plus') + 'My List' }); return }
    if (!e.target.closest('a')) location.hash = `#/title/${m.type}/${enc(m.id)}`
  })
  // A trailer is a new player page and a video stream every time, so it starts only when the pointer really rests, only on a good link,
  // at a small size, and not again for the same title within a minute (the card still shows the picture).
  if (m.trailer && canTrailer() && Date.now() - (played.get(m.trailer) || 0) > 60e3) {
    trailerT = setTimeout(() => { if (card === mine) { played.set(m.trailer, Date.now()); trailer = mountTrailer(mine.querySelector('.pv'), m.trailer, { width: 640, onFail: () => { trailer = null } }) } }, 1500)
  }
}

export function initPreview () {
  if (isTV) return
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse' || !fine.matches || !S.me || e.buttons || document.body.classList.contains('dragging')) return
    const p = e.target.closest?.('.poster')
    if (!p || p === current || p.closest('#toasts')) { if (!p && !e.target.closest?.('.peek') && card) { clearTimeout(hideT); hideT = setTimeout(close, 250) } return }
    clearTimeout(showT); clearTimeout(hideT)
    showT = setTimeout(() => { current = p; open(p) }, 280)
  })
  document.addEventListener('pointerout', e => {
    const p = e.target.closest?.('.poster')
    if (p && !p.contains(e.relatedTarget)) { clearTimeout(showT); if (!card) current = null; else { clearTimeout(hideT); hideT = setTimeout(() => { if (!card?.matches(':hover')) close() }, 250) } }
  })
  addEventListener('scroll', close, { passive: true })
  document.addEventListener('pointerdown', e => { if (!card?.contains(e.target)) close() }, true)
  addEventListener('dragstrip', close)
  addEventListener('hashchange', close)
}
