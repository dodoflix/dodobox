import { cget, api, NOW, LATER, SOON } from './api.js'
import { S, toggleList, inList } from './session.js'
import { $, esc, icon, poster, skeletons, mins, enc, sized, fullWidth, hue, lowres, learnLink, slowLink, canTrailer } from './util.js'
import { glow, calm } from './ambient.js'
import { usingKeys } from './nav.js'
import { dragScroll } from './drag.js'
import { tr } from './i18n.js'
import { GENRES } from './genres.js'

// Shelves show a short row; these have a full list to open.
const shelfHref = id => {
  const [kind, type, g] = id.split(':')
  if (kind === 'genre') return `#/browse/${type}?genre=${enc(g)}`
  const sort = { new: 'new', rated: 'rating' }[kind]
  return sort ? `#/browse/${type}?all=1&sort=${sort}` : ''
}
const shelf = (title, body, { href, wide, id } = {}) => `<section class="shelf" ${id ? `id="${id}"` : ''}>
  <div class="shelf-h"><h2>${esc(title)}</h2>${href ? `<a href="${href}">See all</a>` : ''}</div>
  <div class="rail ${wide ? 'wide' : ''}">${body}</div></section>`

const TYPE_LABEL = { movie: 'Movie', series: 'Series', anime: 'Anime' }
const WORD = { movie: 'movies', series: 'series', anime: 'anime' }
const regionName = iso => { try { return new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(iso) || iso } catch { return iso } }
// The viewer's country, from the browser's language settings (en-US means US). Nothing is sent but the two letters.
const region = () => (navigator.languages || [navigator.language]).map(l => (l || '').split('-')[1]).find(r => /^[A-Za-z]{2}$/.test(r || ''))?.toUpperCase() || ''
function shelfTitle (id) {
  const [kind, t, x] = id.split(':')
  if (kind === 'top') return t === 'anime' ? 'Top 10 anime right now' : `Top 10 ${WORD[t]} this week`
  if (kind === 'country') return `Top 10 ${WORD[t]} in ${regionName(x)}`
  if (kind === 'new') return `New ${WORD[t]}`
  if (kind === 'rated') return `Top rated ${WORD[t]}`
  if (kind === 'airing') return 'Airing now'
  return `Popular ${tr(x)} ${WORD[t]}`
}
const rankedItem = (i, n) => `<div class="rk-item"><span class="rk" aria-hidden="true">${n}</span>${poster(i)}</div>`
const SHELF_TITLE = { movie: 'Popular movies', series: 'Popular series', anime: 'Trending anime' }

function heroHTML (i) {
  return `<div class="hero-body" data-id="${esc(i.id)}">
    <h1 class="title" translate="no">${esc(i.name)}</h1>
    <div class="meta"><span>${TYPE_LABEL[i.type]}</span>${i.year ? `<span>${i.year}</span>` : ''}${i.rating ? `<span>${icon('star')}${i.rating.toFixed(1)}</span>` : ''}${(i.genres || []).slice(0, 3).map(g => `<span>${esc(g)}</span>`).join('')}</div>
    <p translate="no">${esc(i.description || '')}</p>
    <div class="actions">
      <a class="btn btn-ink" href="#/title/${i.type}/${enc(i.id)}" data-autofocus>${icon('play')}Play</a>
      <button class="btn btn-ghost" data-list="${esc(i.id)}">${inList(i.type, i.id) ? icon('check') + 'In My List' : icon('plus') + 'My List'}</button>
    </div></div>`
}

const portraitQuery = matchMedia('(max-width: 700px) and (orientation: portrait)')
const heroSrc = i => portraitQuery.matches && i.poster ? { src: sized(i.poster, Math.round(innerWidth * Math.min(devicePixelRatio || 1, 3))), portrait: true } : { src: sized(i.background || i.poster, fullWidth()), portrait: false }

// Started before the profile is even known, so the lists behind the banner download while the rest of the page starts up.
export const warmHome = () => { for (const t of ['movie', 'series', 'anime']) cget(`/api/catalog?type=${t}&limit=15`, undefined, NOW, false).catch(() => {}) }

export async function home (root, only = '') {
  const recent = S.me.recent.filter(r => !only || r.type === only)
  const mine = S.me.list.filter(i => !only || i.type === only)
  const order = only ? [only] : (() => { const want = S.me.settings.interests || []; const base = ['movie', 'series', 'anime']; return [...want.filter(t => base.includes(t)), ...base.filter(t => !want.includes(t))] })()
  root.innerHTML = `<div class="view">
    <section class="hero" id="hero" aria-roledescription="carousel" aria-label="Featured titles">
      <div class="bg"></div><div class="trailer-layer" id="htr" aria-hidden="true"></div>
      <div id="hero-slot"><div class="hero-body" aria-hidden="true"><div class="sk" style="height:5.2rem;width:min(30rem,85%)"></div><div class="sk" style="height:1rem;width:min(18rem,70%);margin-top:1.2rem"></div><div class="sk" style="height:3.1rem;width:min(10.5rem,55%);border-radius:var(--r-field);margin-top:1.6rem"></div></div></div>
      <button class="hero-arrow l" aria-label="Previous title" tabindex="-1">${icon('left')}</button>
      <button class="hero-arrow r" aria-label="Next title" tabindex="-1">${icon('right')}</button>
      <button class="hero-sound" id="hsound" aria-label="Turn trailer sound on" hidden>${icon('mute')}</button>
      <div class="dots" id="dots"></div>
    </section>
    ${only ? `<div class="typebar"><div class="genres" id="tgenres" aria-label="Genres"><a class="g all" href="#/browse/${only}?all=1">${icon('compass')}Browse all</a>${GENRES[only].map(g => `<a class="g" href="#/browse/${only}?genre=${enc(g)}">${esc(g)}</a>`).join('')}</div></div>` : ''}
    <div id="shelves">
      ${recent.length ? shelf('Continue watching', recent.map(r => poster({ ...r, rating: null }, { progress: r.pos / r.dur, sub: (r.season != null ? `S${r.season} E${r.episode} · ` : '') + mins(Math.max(60, r.dur - r.pos)) + ' left' })).join(''), { id: 's-recent' }) : ''}
      ${mine.length ? shelf('My List', mine.map(i => poster(i)).join(''), { id: 's-list' }) : ''}
      <div id="s-local"></div><div id="s-picks"></div><div id="s-more"></div>
      ${order.map(t => shelf(SHELF_TITLE[t], skeletons(10), { href: `#/browse/${t}?all=1`, id: 's-' + t })).join('')}
    </div></div>`

  let items = []; let idx = 0; let dead = false
  // A slide stays DWELL seconds; one with a trailer stays as long as the trailer plays (TRAILER). Until it is known whether a trailer will play, the bar assumes it will.
  const DWELL = 7; const TRAILER = 18; let pauseUntil = 0; let held = 0; let limit = DWELL
  let trailer = null; let dwell; let muted = true; let visible = true
  dragScroll($('#tgenres'))
  const hero = $('#hero'); const bg = $('.bg', hero); const slot = $('#hero-slot'); const dots = $('#dots'); const htr = $('#htr'); const sound = $('#hsound')
  hero.querySelectorAll('.rail').forEach(dragScroll)

  // Each bar is a title; the current one fills over the dwell time, earlier ones stay full.
  const paintDots = () => { dots.innerHTML = items.map((_, k) => `<button class="${k === idx ? 'on' : ''}" data-k="${k}" aria-label="Show featured title ${k + 1} of ${items.length}" aria-current="${k === idx}"><i style="--p:${k < idx ? 1 : k === idx ? Math.min(1, held / limit) : 0}"></i></button>`).join('') }
  const fillDot = () => dots.children[idx]?.firstElementChild.style.setProperty('--p', Math.min(1, held / limit))
  const imgs = () => [...bg.querySelectorAll('img')]
  let track = null
  function place (animate, jump) {
    if (!track) return
    track.style.transition = animate && !jump ? '' : 'none'
    track.style.transform = `translateX(${-idx * 100}%)`
    if (jump) { bg.classList.remove('jump'); void bg.offsetWidth; bg.classList.add('jump') }
  }
  function loadAround (k) {
    for (const j of slowLink() ? [k, k + 1] : [k, k + 1, k - 1]) {
      const im = imgs()[(j + items.length) % items.length]
      if (!im || im.src) continue
      const lq = lowres(im.dataset.src)
      if (lq) im.previousElementSibling.style.backgroundImage = `url('${lq}')`
      im.fetchPriority = j === k ? 'high' : 'low'
      im.onload = () => { im.classList.add('in'); learnLink(im) }
      im.src = im.dataset.src
    }
  }
  function buildImages () {
    bg.innerHTML = `<div class="track">${items.map(i => { const h = heroSrc(i); return `<div class="slide" style="--h:${hue(i.name)}"><i class="lq"></i><img alt="" decoding="async" class="${h.portrait ? 'portrait' : ''}" data-src="${esc(h.src)}"></div>` }).join('')}</div>`
    track = $('.track', bg)
    place(false)
    loadAround(idx)
  }

  function stopTrailer () {
    clearTimeout(dwell)
    trailer?.destroy(); trailer = null
    hero.classList.remove('has-trailer'); sound.hidden = true
  }
  async function startTrailer (k) {
    if (dead || k !== idx || !visible || !canTrailer()) return
    // The banner comes first: a trailer would compete with it for the connection (and the first picture tells how fast that is).
    if (!imgs()[k]?.complete) { dwell = setTimeout(() => startTrailer(k), 800); return }
    const i = items[k]
    let id = i.trailer
    if (id === undefined) { try { id = (await cget(`/api/meta/${i.type}/${enc(i.id)}`, undefined, LATER)).trailer } catch { id = null }; i.trailer = id || null }
    if (!id && k === idx) limit = DWELL
    if (!id || dead || k !== idx || !visible) return
    const { mountTrailer } = await import('./trailer.js')
    if (dead || k !== idx || !visible) return
    trailer = mountTrailer(htr, id, {
      onPlaying: () => { hero.classList.add('has-trailer'); sound.hidden = false; limit = held + TRAILER; if (!muted) trailer.unmute() },
      onFail: () => { trailer = null; i.trailer = null; if (k === idx) limit = DWELL }
    })
  }

  function show (k, { user } = {}) {
    if (!items.length) return
    k = (k + items.length) % items.length
    stopTrailer()
    const jump = Math.abs(k - idx) > 1
    idx = k
    const i = items[k]
    loadAround(k)
    place(true, jump)
    slot.style.opacity = ''
    slot.innerHTML = heroHTML(i)
    held = 0; limit = canTrailer() && i.trailer !== null ? DWELL + TRAILER - 3 : DWELL
    paintDots(); glow(i.poster)
    if (user) pauseUntil = Date.now() + 20000
    dwell = setTimeout(() => startTrailer(k), 2200)
  }

  function add (list) {
    const fresh = list.filter(i => (i.background || i.poster) && !items.some(x => x.id === i.id))
    if (!fresh.length) return
    const first = !items.length
    items.push(...fresh)
    buildImages()
    if (first) { hero.classList.add('ready'); show(0); if (usingKeys()) $('[data-autofocus]', hero)?.focus({ preventScroll: true }) } else paintDots()
  }

  const tick = setInterval(() => {
    const now = Date.now()
    if (document.hidden || !visible || items.length < 2) { held = 0; fillDot(); return }
    if (now < pauseUntil) { held = Math.min(held, limit - 2); fillDot(); return }
    held++; fillDot()
    if (held >= limit) show(idx + 1)
  }, 1000)

  // Vertical scrolling still belongs to the page (touch-action: pan-y).
  let start = null; let swiped = false
  hero.addEventListener('pointerdown', e => { if (e.target.closest('a, button')) return; start = { x: e.clientX, y: e.clientY, t: Date.now(), live: false }; swiped = false })
  hero.addEventListener('pointermove', e => {
    if (!start) return
    const dx = e.clientX - start.x; const dy = e.clientY - start.y
    if (!start.live && Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) { start.live = true; swiped = true; stopTrailer(); document.body.classList.add('dragging'); window.dispatchEvent(new Event('dragstrip')) }
    if (!start.live || !track) return
    const edge = (idx === 0 && dx > 0) || (idx === items.length - 1 && dx < 0)
    const x = edge ? dx * 0.3 : dx
    track.style.transition = 'none'
    track.style.transform = `translateX(calc(${-idx * 100}% + ${x}px))`
    slot.style.opacity = String(1 - Math.min(Math.abs(x) / hero.clientWidth, 1) * 0.9)
  })
  const end = e => {
    if (!start) return
    const dx = e.clientX - start.x; const dy = e.clientY - start.y; const live = start.live
    const fast = Math.abs(dx) / Math.max(1, Date.now() - start.t) > 0.45
    start = null
    document.body.classList.remove('dragging')
    if (!live) return
    const go = (Math.abs(dx) > hero.clientWidth * 0.18 || fast) && Math.abs(dx) > Math.abs(dy) * 1.2
    const target = go ? idx + (dx < 0 ? 1 : -1) : idx
    if (go && target >= 0 && target < items.length) show(target, { user: true })
    else { place(true); slot.style.opacity = ''; pauseUntil = Date.now() + 20000 }
  }
  hero.addEventListener('pointerup', end); hero.addEventListener('pointercancel', e => end(e))
  hero.addEventListener('click', e => { if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false } }, true)
  hero.addEventListener('dragstart', e => e.preventDefault())
  hero.addEventListener('navedge', e => show(idx + (e.detail === 'ArrowLeft' ? -1 : 1), { user: true }))

  hero.addEventListener('click', e => {
    const d = e.target.closest('[data-k]'); if (d) return show(+d.dataset.k, { user: true })
    if (e.target.closest('.hero-arrow')) return show(idx + (e.target.closest('.hero-arrow').classList.contains('l') ? -1 : 1), { user: true })
    if (e.target.closest('#hsound')) { muted = !muted; muted ? trailer?.mute() : trailer?.unmute(); sound.innerHTML = icon(muted ? 'mute' : 'volume'); sound.setAttribute('aria-label', muted ? 'Turn trailer sound on' : 'Turn trailer sound off'); return }
    const l = e.target.closest('[data-list]')
    if (l) { const i = items[idx]; toggleList(i).then(() => { l.innerHTML = inList(i.type, i.id) ? icon('check') + 'In My List' : icon('plus') + 'My List' }) }
  })

  const io = new IntersectionObserver(es => {
    visible = es[0].intersectionRatio > 0.35
    if (!visible) stopTrailer(); else if (!trailer && items.length) { clearTimeout(dwell); dwell = setTimeout(() => startTrailer(idx), 1500) }
  }, { threshold: [0, 0.35, 0.6] })
  io.observe(hero)
  const onShape = () => { if (items.length) buildImages() }
  portraitQuery.addEventListener('change', onShape)

  const picks = {}
  for (const t of order) {
    cget(`/api/catalog?type=${t}&limit=15`, undefined, NOW).then(list => {
      if (dead) return
      const rail = $(`#s-${t} .rail`); rail.innerHTML = list.map(i => poster(i)).join(''); dragScroll(rail)
      picks[t] = list.filter(i => i.background || i.poster).slice(0, only ? 8 : 3)
      add(Array.from({ length: only ? 8 : 3 }, (_, n) => n).flatMap(n => order.map(o => picks[o]?.[n]).filter(Boolean)))
    }).catch(() => {
      if (dead) return
      $(`#s-${t} .rail`).innerHTML = `<p class="dim pad-x">Couldn't load this right now. It will retry when you come back.</p>`
    })
  }
  cget('/api/local', 60e3, LATER).then(local => {
    local = local.filter(e => !only || e.type === only)
    if (dead || !local.length) return
    const seen = new Set(); const uniq = local.filter(e => { const k = e.type + e.mid; return seen.has(k) ? false : (seen.add(k), true) })
    $('#s-local').outerHTML = shelf('On your server', uniq.map(e => poster({ type: e.type, id: e.mid, name: e.name, poster: e.poster, year: e.year })).join(''), { id: 's-local' })
    dragScroll($('#s-local .rail'))
  }).catch(() => {})
  if (Object.values(S.me.ratings || {}).some(r => r.v > 0)) api('/api/picks', { ref: { prio: LATER } }).then(groups => {
    groups = groups.filter(g => !only || g.items[0]?.type === only)
    if (dead || !groups.length) return
    $('#s-picks').innerHTML = groups.map((g, k) => shelf(`Because you liked ${g.because}`, g.items.map(i => poster(i)).join(''), { id: 's-pick' + k })).join('')
    $('#s-picks').querySelectorAll('.rail').forEach(dragScroll)
  }).catch(() => {})
  const lazy = new IntersectionObserver(es => es.forEach(async en => {
    if (!en.isIntersecting) return
    lazy.unobserve(en.target)
    const sec = en.target
    try {
      const list = await cget(`/api/shelf?id=${enc(sec.dataset.shelf)}`, 600e3)
      if (dead) return
      if (list.length < 4) return sec.remove()
      const rail = $('.rail', sec)
      rail.innerHTML = sec.dataset.ranked ? list.map((i, n) => rankedItem(i, n + 1)).join('') : list.map(i => poster(i)).join('')
      dragScroll(rail)
    } catch { sec.remove() }
  }), { rootMargin: '700px 0px' })
  cget(`/api/shelves?country=${region()}${only ? '&type=' + only : ''}`, 10 * 60e3, SOON).then(specs => {
    if (dead) return
    $('#s-more').innerHTML = specs.map(sp => `<section class="shelf" data-shelf="${esc(sp.id)}" ${sp.ranked ? 'data-ranked="1"' : ''}><div class="shelf-h"><h2>${esc(shelfTitle(sp.id))}</h2>${shelfHref(sp.id) ? `<a href="${shelfHref(sp.id)}">See all</a>` : ''}</div><div class="rail ${sp.ranked ? 'ranked' : ''}">${skeletons(8)}</div></section>`).join('')
    $('#s-more').querySelectorAll('.shelf').forEach(el => lazy.observe(el))
  }).catch(() => {})
  root.querySelectorAll('.rail').forEach(dragScroll)

  setTimeout(() => { if (!items.length && !dead) hero.style.display = 'none' }, 9000)
  return () => { dead = true; lazy.disconnect(); clearInterval(tick); stopTrailer(); io.disconnect(); portraitQuery.removeEventListener('change', onShape); calm() }
}
