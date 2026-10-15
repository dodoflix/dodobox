// Offline shell + stale-while-revalidate for catalog data and posters. Streams are never cached here.
const VERSION = 'v28'
const SHELL = ['/', '/style.css', '/js/main.js', '/js/util.js', '/js/api.js', '/js/session.js', '/js/ambient.js', '/js/nav.js', '/js/profiles.js', '/js/home.js', '/js/browse.js', '/js/detail.js', '/js/library.js', '/js/settings.js', '/js/player.js', '/js/cast.js', '/js/trailer.js', '/js/drag.js', '/js/preview.js', '/js/onboarding.js', '/js/bandwidth.js', '/js/volume.js', '/js/loader.js', '/js/update.js', '/js/dropdown.js', '/js/menu.js', '/js/i18n.js', '/js/genres.js', '/js/syncmap.js', '/js/lang/strings.js', '/fonts/figtree-latin-wght-normal.woff2', '/fonts/figtree-latin-ext-wght-normal.woff2', '/fonts/big-shoulders-display-latin-800-normal.woff2', '/fonts/big-shoulders-display-latin-900-normal.woff2', '/fonts/big-shoulders-display-latin-ext-800-normal.woff2', '/fonts/big-shoulders-display-latin-ext-900-normal.woff2', '/icons/icon.svg']
const DATA = /^\/api\/(catalog|meta|profiles|me|server)/
// Requests a page cancels are cancelled here too: the page sends the ids (x-rid header) of the ones it gave up on.
const pending = new Map()
self.addEventListener('message', e => { for (const id of e.data?.abort || []) pending.get(id)?.abort() })

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())) })

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin || /^\/(hls|raw)\//.test(u.pathname) || u.pathname === '/img' || e.request.headers.has('range')) return
  if (DATA.test(u.pathname)) {
    // The answer depends on the profile language, so the language is part of the cache key.
    const key = new Request(e.request.url + (e.request.headers.get('x-lang') ? '#' + e.request.headers.get('x-lang') : ''))
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(key)
      const rid = e.request.headers.get('x-rid'); const ac = new AbortController()
      if (rid) pending.set(rid, ac)
      const net = fetch(e.request, { signal: ac.signal }).then(r => { if (r.ok) c.put(key, r.clone()); return r }).catch(() => hit).finally(() => pending.delete(rid))
      return net.then(r => r || hit)
    }))
  } else if (!u.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return r }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))))
  }
})
