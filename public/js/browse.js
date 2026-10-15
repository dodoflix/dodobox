import { cget } from './api.js'
import { $, esc, icon, poster, skeletons, enc, store } from './util.js'
import { calm } from './ambient.js'
import { dragScroll } from './drag.js'
import { GENRES, SORTS } from './genres.js'
import { upgradeSelects } from './dropdown.js'

const TYPES = { movie: 'Movies', series: 'Series', anime: 'Anime' }
export async function browse (root, type = 'movie', q) {
  calm()
  const genre = q.get('genre') || ''
  const sort = SORTS.some(x => x[0] === q.get('sort')) ? q.get('sort') : 'popular'
  if (!q.get('all') && !genre && sort === 'popular') { const { home } = await import('./home.js'); return home(root, type) }
  let page = 1; let busy = false; let end = false; let dead = false
  const here = (g, so = sort) => { const p = new URLSearchParams(); if (g) p.set('genre', g); if (so !== 'popular') p.set('sort', so); if (![...p].length) p.set('all', '1'); return `#/browse/${type}${[...p].length ? '?' + p : ''}` }
  const genres = genre ? [genre, ...GENRES[type].filter(g => g !== genre)] : GENRES[type]
  root.innerHTML = `<div class="view page">
    <div class="page-h"><h1>${TYPES[type]}</h1></div>
    <div class="modeseg" role="tablist"><a role="tab" aria-selected="false" href="#/browse/${type}">Discover</a><a role="tab" aria-selected="true" class="on" href="#/browse/${type}?all=1">Browse all</a></div>
    <div class="typeseg" role="tablist" aria-label="Type">${Object.entries(TYPES).map(([t, n]) => `<a role="tab" aria-selected="${t === type}" class="${t === type ? 'on' : ''}" href="#/browse/${t}?all=1${sort !== 'popular' ? '&sort=' + sort : ''}">${n}</a>`).join('')}</div>
    <div class="sortrow"><label for="sort">Sort by</label><select class="field" id="sort">${SORTS.map(([v, n]) => `<option value="${v}" ${v === sort ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="genres" id="genres" aria-label="Genres">
      ${genre ? `<a class="g on" href="${here(genre)}" aria-current="true">${esc(genre)}</a><a class="g all" href="${here('')}">All</a>` : `<a class="g all on" href="${here('')}" aria-current="true">All</a>`}
      ${genres.filter(g => g !== genre).map(g => `<a class="g" href="${here(g)}">${esc(g)}</a>`).join('')}
    </div>
    <div class="grid" id="grid">${skeletons(18)}</div><div class="sentinel" id="more"></div></div>`
  dragScroll($('#genres'))
  upgradeSelects(root)
  $('#sort').onchange = e => { location.hash = here(genre, e.target.value) }
  const grid = $('#grid'); const more = $('#more')
  const params = n => new URLSearchParams({ type, genre, sort, page: n })
  const tail = on => { grid.querySelectorAll('.sk-tail').forEach(n => n.remove()); if (on) grid.insertAdjacentHTML('beforeend', skeletons(8).replace(/class="poster"/g, 'class="poster sk-tail"')) }
  async function load () {
    if (busy || end || dead) return
    busy = true; more.innerHTML = ''
    if (page > 1) tail(true)
    try {
      const items = await cget(`/api/catalog?${params(page)}`)
      if (dead) return
      if (page === 1) grid.innerHTML = ''
      tail(false)
      grid.insertAdjacentHTML('beforeend', items.map(i => poster(i)).join(''))
      if (!items.length) end = true
      if (page === 1 && !items.length) grid.innerHTML = `<div class="empty"><div class="eico">${icon('compass')}</div><h2>Nothing here</h2>Try another genre.</div>`
      page++
      if (!end) cget(`/api/catalog?${params(page)}`).catch(() => {})
      busy = false
      if (!end && more.getBoundingClientRect().top < innerHeight + 1800) setTimeout(load, 60)
    } catch {
      tail(false)
      if (page === 1) grid.innerHTML = `<div class="empty"><h2>Can't reach the catalog</h2>Check your internet connection and come back.<p><button class="btn btn-ink" id="retry">Try again</button></p></div>`
      else more.innerHTML = `<div class="more-err"><span>Couldn't load more.</span><button class="btn btn-ghost sm" id="retry">Try again</button></div>`
      $('#retry', root)?.addEventListener('click', () => { busy = false; if (page === 1) grid.innerHTML = skeletons(18); load() })
    } finally { busy = false }
  }
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) load() }, { rootMargin: '1800px' })
  io.observe(more)
  await load()
  return () => { dead = true; io.disconnect() }
}

export async function search (root, q) {
  calm()
  const recent = store.get('recentSearch', [])
  root.innerHTML = `<div class="view page">
    <form class="searchbox" id="sf" role="search">${icon('search')}<input id="sq" type="search" placeholder="Movies, series, anime" autocomplete="off" enterkeyhint="search" value="${esc(q.get('q') || '')}" data-autofocus></form>
    <div id="res"></div></div>`
  const input = $('#sq'); const res = $('#res')
  let seq = 0; let t
  const sections = [['movie', 'Movies'], ['series', 'Series'], ['anime', 'Anime']]
  function idle () {
    res.innerHTML = recent.length ? `<h2 class="sec-h" style="margin-top:.5rem">Recent</h2><div class="recent">${recent.map(r => `<button class="chip" translate="no" data-q="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : `<div class="empty"><div class="eico">${icon('search')}</div><h2>Find something to watch</h2>Search any title. Results include movies, series and anime.</div>`
  }
  async function run (term) {
    const mine = ++seq
    if (term.length < 2) return idle()
    res.innerHTML = sections.map(([, n]) => `<h2 class="sec-h">${n}</h2><div class="rail">${skeletons(8)}</div>`).join('')
    const out = await Promise.allSettled(sections.map(([type]) => cget(`/api/catalog?${new URLSearchParams({ type, q: term })}`, 10 * 60e3)))
    if (mine !== seq) return
    const html = sections.map(([, n], k) => out[k].status === 'fulfilled' && out[k].value.length ? `<h2 class="sec-h">${n}</h2><div class="rail">${out[k].value.slice(0, 20).map(i => poster(i)).join('')}</div>` : '').join('')
    res.innerHTML = html || `<div class="empty"><div class="eico">${icon('search')}</div><h2>No results</h2>Nothing matched "${esc(term)}". Check the spelling or try fewer words.</div>`
    res.querySelectorAll('.rail').forEach(dragScroll)
    history.replaceState(null, '', `#/search?q=${enc(term)}`)
  }
  input.oninput = () => { clearTimeout(t); t = setTimeout(() => run(input.value.trim()), 280) }
  $('#sf').onsubmit = e => {
    e.preventDefault(); const v = input.value.trim(); input.blur()
    if (v.length > 1) { store.set('recentSearch', [v, ...recent.filter(r => r !== v)].slice(0, 8)) }
    run(v)
  }
  res.onclick = e => { const b = e.target.closest('[data-q]'); if (b) { input.value = b.dataset.q; run(b.dataset.q) } }
  q.get('q') ? run(q.get('q')) : idle()
  if (!q.get('q') && !matchMedia('(pointer: coarse)').matches) input.focus()
  return () => { seq++ }
}
