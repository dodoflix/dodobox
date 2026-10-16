import { $, $$, esc, isTV, toast, known, lowres } from './util.js'
import { initAmbient } from './ambient.js'
import { S, tryRestore, pickProfile } from './session.js'
import { api, newPage, setLang } from './api.js'
import { showPicker } from './profiles.js'
import { focusFirst, usingKeys, onBack } from './nav.js'
import { home, warmHome } from './home.js'
import { initLoader, resetLoader } from './loader.js'
import { initProfileMenu } from './menu.js'
import { detectDevice, installTip, profileOnboarding } from './onboarding.js'
import { store } from './util.js'
import { initI18n, savedUiLang, uiLangFor } from './i18n.js'

if (isTV) document.documentElement.classList.add('tv')
const main = $('#main')
let cleanup = null
let player = null
let seq = 0
const scrolls = new Map()
let lastPage = ''

const NAV = { home: ['home'], browse: ['browse'], search: ['search'], library: ['library'], settings: ['settings'] }
function mark (page, arg) {
  const on = page === 'browse' ? ['browse', arg] : page === 'title' ? [arg] : (NAV[page] || ['home'])
  for (const a of $$('#nav a, #tabbar a')) a.classList.toggle('on', on.includes(a.dataset.nav))
  $('#top .icon-btn').classList.toggle('on', page === 'search')
}

// Pictures of the page being left stop downloading, so they do not hold up the next page's.
const dropImages = () => { resetLoader(); for (const im of main.querySelectorAll('img')) if (!im.complete) im.removeAttribute('src') }

// The player and trailer code is fetched when first needed: until it arrives the screen already shows the title, not a black page.
function pending (type, id) {
  const k = known.get(`${type}:${id}`)
  const layer = $('#layer')
  layer.className = 'player'; layer.hidden = false
  layer.innerHTML = `<div class="pl"><div class="pl-load"><div class="bg" style="background-image:url('${esc(lowres(k?.poster) || k?.poster || '')}')"></div><div class="msg"><h2 translate="no">${esc(k?.name || '')}</h2><p>Getting ready...</p><div class="hair"><i></i></div></div></div></div>`
}

async function route () {
  const mine = ++seq
  dropImages()
  const [path, query = ''] = location.hash.slice(1).split('?')
  const [, page = 'home', ...args] = path.split('/').map(decodeURIComponent)
  const q = new URLSearchParams(query)

  if (page === 'trailer') {
    player?.(); player = null
    pending(args[0], args[1])
    try { player = await (await import('./trailer.js')).watchTrailer(args[0], args[1]) } catch (e) { toast(e.message); location.hash = '#/' }
    if (mine !== seq) { player?.(); player = null }
    return
  }
  if (page === 'watch') {
    player?.(); player = null
    pending(args[0], args[1])
    try { player = await (await import('./player.js')).watch(args[0], args[1], args[2], args[3]) } catch (e) { toast(e.message); location.hash = '#/' }
    if (mine !== seq) { player?.(); player = null }
    return
  }
  if (player) { player(); player = null }

  scrolls.set(lastPage, scrollY)
  newPage()
  cleanup?.(); cleanup = null
  mark(page, args[0])
  document.title = 'Dodobox'
  const key = location.hash
  try {
    // Only the home page is in the first download; every other page's code loads when it is first opened.
    if (page === 'browse') cleanup = await (await import('./browse.js')).browse(main, args[0], q)
    else if (page === 'search') cleanup = await (await import('./browse.js')).search(main, q)
    else if (page === 'title') cleanup = await (await import('./detail.js')).title(main, args[0], args[1])
    else if (page === 'library') cleanup = await (await import('./library.js')).library(main)
    else if (page === 'settings') cleanup = await (await import('./settings.js')).settings(main)
    else cleanup = await home(main)
  } catch (e) {
    if (mine !== seq) return
    main.innerHTML = `<div class="view page"><div class="empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p><p><a class="btn btn-ink" href="${esc(key)}" onclick="location.reload()">Try again</a></p></div></div>`
  }
  if (mine !== seq) return
  lastPage = key
  scrollTo(0, scrolls.get(key) || 0)
  if (usingKeys()) focusFirst()
}

onBack.handler = null
addEventListener('hashchange', route)
addEventListener('scroll', () => $('#top').classList.toggle('solid', scrollY > 40), { passive: true })
addEventListener('online', () => toast('Back online'))
addEventListener('offline', () => toast('You are offline. Saved titles still play.'))
// Search opens over the current page; the TV layout keeps the search page, which a remote navigates better.
const quickSearch = () => import('./quicksearch.js').then(m => m.openSearch())
document.addEventListener('click', e => {
  const a = e.target.closest('a[data-nav="search"]')
  if (!a || isTV || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault(); quickSearch()
})
document.addEventListener('keydown', e => { if (e.key === '/' && !e.target.matches?.('input, textarea')) { e.preventDefault(); isTV ? location.hash = '#/search' : quickSearch() } })

async function boot () {
  setLang(savedUiLang())
  if (/^#?\/?$/.test(location.hash)) warmHome()
  initAmbient()
  await initI18n(savedUiLang())
  detectDevice()
  const first = await tryRestore()
  if (!first) {
    const all = await api('/api/profiles').catch(() => [])
    if (all.length === 1) await pickProfile(all[0].id); else await showPicker()
  }
  if (!S.me.settings.onboarded) await profileOnboarding()
  store.set('ui', uiLangFor(S.me.settings.lang))
  await initI18n(S.me.settings.lang)
  installTip()
  initProfileMenu()
  initLoader()
  await route()
  // Offline caching and the hover preview start once the page is up, so they never compete with it.
  import('./preview.js').then(m => m.initPreview())
  import('./update.js').then(m => m.initUpdates())
  import('./presence.js').then(m => m.initPresence(() => S.me.settings.discordPresence !== false))
  import('./party.js').then(m => m.initParty())
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) setTimeout(() => navigator.serviceWorker.register('/sw.js').catch(() => {}), 4000)
}
boot()
