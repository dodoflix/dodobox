import { $, $$, esc, isTV, toast } from './util.js'
import { initAmbient } from './ambient.js'
import { S, tryRestore, pickProfile } from './session.js'
import { api } from './api.js'
import { showPicker } from './profiles.js'
import { focusFirst, usingKeys, onBack } from './nav.js'
import { home } from './home.js'
import { browse, search } from './browse.js'
import { title } from './detail.js'
import { library } from './library.js'
import { settings } from './settings.js'
import { watch } from './player.js'
import { initLoader, resetLoader } from './loader.js'
import { watchTrailer } from './trailer.js'
import { initPreview } from './preview.js'
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

async function route () {
  const mine = ++seq
  dropImages()
  const [path, query = ''] = location.hash.slice(1).split('?')
  const [, page = 'home', ...args] = path.split('/').map(decodeURIComponent)
  const q = new URLSearchParams(query)

  if (page === 'trailer') {
    player?.(); player = null
    try { player = await watchTrailer(args[0], args[1]) } catch (e) { toast(e.message); location.hash = '#/' }
    if (mine !== seq) { player?.(); player = null }
    return
  }
  if (page === 'watch') {
    player?.(); player = null
    try { player = await watch(args[0], args[1], args[2], args[3]) } catch (e) { toast(e.message); location.hash = '#/' }
    if (mine !== seq) { player?.(); player = null }
    return
  }
  if (player) { player(); player = null }

  scrolls.set(lastPage, scrollY)
  cleanup?.(); cleanup = null
  mark(page, args[0])
  document.title = 'Dodobox'
  const key = location.hash
  try {
    if (page === 'browse') cleanup = await browse(main, args[0], q)
    else if (page === 'search') cleanup = await search(main, q)
    else if (page === 'title') cleanup = await title(main, args[0], args[1])
    else if (page === 'library') cleanup = await library(main)
    else if (page === 'settings') await settings(main)
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
document.addEventListener('keydown', e => { if (e.key === '/' && !e.target.matches('input, textarea')) { e.preventDefault(); location.hash = '#/search' } })

async function boot () {
  initAmbient()
  await initI18n(savedUiLang())
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('/sw.js').catch(() => {})
  detectDevice()
  const first = await tryRestore()
  if (!first) {
    const all = await api('/api/profiles').catch(() => [])
    if (all.length === 1) await pickProfile(all[0].id); else await showPicker()
  }
  if (!S.me.settings.onboarded) await profileOnboarding()
  store.set('ui', uiLangFor(S.me.settings.lang))
  await initI18n(S.me.settings.lang)
  installTip(toast)
  initProfileMenu()
  initLoader()
  initPreview()
  await route()
}
boot()
