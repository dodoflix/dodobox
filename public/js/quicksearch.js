// Search without leaving the page: a panel over whatever is open. The #/search page stays for links and the TV layout.
import { cget, NOW } from './api.js'
import { $, esc, icon, enc, sized, store } from './util.js'

const TYPES = [['movie', 'Movies'], ['series', 'Series'], ['anime', 'Anime']]
const LABEL = { movie: 'Movie', series: 'Series', anime: 'Anime' }
const SHOWN = 5
let el = null; let input = null; let res = null; let seq = 0; let t; let opener = null

const row = i => `<a class="qs-row" href="#/title/${i.type}/${enc(i.id)}"><span class="qs-th" ${i.poster ? `style="background-image:url('${esc(sized(i.poster, 120))}')"` : ''}></span><span class="qs-t"><span translate="no">${esc(i.name)}</span><small>${LABEL[i.type]}${i.year ? ` · ${i.year}` : ''}</small></span></a>`

function idle () {
  const recent = store.get('recentSearch', [])
  res.innerHTML = recent.length ? `<h2 class="qs-h">Recent</h2><div class="recent">${recent.map(r => `<button class="chip" translate="no" data-q="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : ''
}

async function run (term) {
  const mine = ++seq
  if (term.length < 2) return idle()
  const found = await Promise.all(TYPES.map(([type]) => cget(`/api/catalog?${new URLSearchParams({ type, q: term })}`, 10 * 60e3, NOW, false).catch(() => [])))
  if (mine !== seq) return
  const html = found.map((list, k) => list.length ? `<h2 class="qs-h">${TYPES[k][1]}</h2>${list.slice(0, SHOWN).map(row).join('')}` : '').join('')
  res.innerHTML = html ? html + `<a class="btn btn-ghost sm qs-all" href="#/search?q=${enc(term)}">See all</a>` : '<p class="qs-none">No results</p>'
}

export function closeSearch () {
  if (!el || el.hidden) return
  el.hidden = true; seq++
  document.documentElement.classList.remove('lock')
  $('#top .icon-btn')?.classList.remove('on')
  opener?.focus?.({ preventScroll: true }); opener = null
}

function build () {
  el = document.createElement('div')
  el.id = 'qs'; el.hidden = true
  el.innerHTML = `<div class="qs-box" role="dialog" aria-label="Search">
    <form class="searchbox" role="search">${icon('search')}<input type="search" placeholder="Movies, series, anime" autocomplete="off" enterkeyhint="search"><button type="button" class="icon-btn" aria-label="Close">${icon('close')}</button></form>
    <div class="qs-res"></div></div>`
  document.body.append(el)
  input = $('input', el); res = $('.qs-res', el)
  input.oninput = () => { clearTimeout(t); t = setTimeout(() => run(input.value.trim()), 250) }
  $('form', el).onsubmit = e => {
    e.preventDefault()
    const v = input.value.trim(); if (v.length < 2) return
    store.set('recentSearch', [v, ...store.get('recentSearch', []).filter(r => r !== v)].slice(0, 8))
    closeSearch(); location.hash = `#/search?q=${enc(v)}`
  }
  $('.icon-btn', el).onclick = closeSearch
  el.onclick = e => {
    if (e.target === el) return closeSearch()
    const chip = e.target.closest('[data-q]')
    if (chip) { input.value = chip.dataset.q; run(chip.dataset.q); return }
    if (e.target.closest('a')) closeSearch()
  }
  el.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); return closeSearch() }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const rows = [input, ...el.querySelectorAll('.qs-row')]
    const at = rows.indexOf(document.activeElement)
    const next = rows[at + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus() }
  })
  addEventListener('hashchange', closeSearch)
}

export function openSearch () {
  if (!el) build()
  opener = document.activeElement
  el.hidden = false
  document.documentElement.classList.add('lock')
  $('#top .icon-btn')?.classList.add('on')
  input.value = ''; idle()
  input.focus()
}
