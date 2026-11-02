// Offline shell + stale-while-revalidate for catalog data and posters. Streams are never cached here.
const VERSION = 'dev' // the server serves the app version here, so each release drops the old caches
const SHELL = ['/', '/style.css', '/js/main.js', '/js/util.js', '/js/api.js', '/js/report.js', '/js/session.js', '/js/ambient.js', '/js/nav.js', '/js/profiles.js', '/js/pin.js', '/js/opensubs.js', '/js/home.js', '/js/browse.js', '/js/quicksearch.js', '/js/detail.js', '/js/library.js', '/js/settings.js', '/js/player.js', '/js/cast.js', '/js/trailer.js', '/js/drag.js', '/js/preview.js', '/js/onboarding.js', '/js/bandwidth.js', '/js/netwarn.js', '/js/volume.js', '/js/loader.js', '/js/update.js', '/js/presence.js', '/js/party.js', '/js/emoji.js', '/js/dropdown.js', '/js/menu.js', '/js/i18n.js', '/js/genres.js', '/js/syncmap.js', '/js/english.js', '/js/previewmap.js', '/js/lang/strings.js', '/fonts/figtree-latin-wght-normal.woff2', '/fonts/figtree-latin-ext-wght-normal.woff2', '/fonts/big-shoulders-display-latin-800-normal.woff2', '/fonts/big-shoulders-display-latin-900-normal.woff2', '/fonts/big-shoulders-display-latin-ext-800-normal.woff2', '/fonts/big-shoulders-display-latin-ext-900-normal.woff2', '/icons/icon.svg']
const DATA = /^\/api\/(catalog|meta|profiles|me|server)/
// Requests a page cancels are cancelled here too: the page sends the ids (x-rid header) of the ones it gave up on.
// Ids count per tab, so they are kept per client: one tab's navigation never cancels another tab's request.
const pending = new Map()
self.addEventListener('message', e => { for (const id of e.data?.abort || []) pending.get(`${e.source?.id}:${id}`)?.abort() })

self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => fetch(u, { cache: 'reload' }).then(r => { if (!r.ok) throw new Error(u + ' ' + r.status); return c.put(u, r) })))).then(() => self.skipWaiting())) })
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())) })

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url)
  if (e.request.method !== 'GET' || u.origin !== location.origin || /^\/(hls|raw)\//.test(u.pathname) || u.pathname === '/img' || e.request.headers.has('range')) return
  if (DATA.test(u.pathname)) {
    // The answer depends on the language, the profile, the adult filter and whether the viewer holds a PIN session token (x-token), so all four are part of the cache key.
    // Without the token, a PIN-locked profile's cached data is never handed out. (A #fragment would not do: cache matching ignores it.)
    const h = e.request.headers
    const key = new Request(`${e.request.url}${u.search ? '&' : '?'}_sw=${encodeURIComponent([h.get('x-lang'), h.get('x-profile'), h.get('x-adult-filter'), h.has('x-token')].join('|'))}`)
    e.respondWith(caches.open(VERSION).then(async c => {
      const hit = await c.match(key)
      const rid = h.get('x-rid'); const ac = new AbortController()
      const pid = rid && `${e.clientId}:${rid}`
      if (pid) pending.set(pid, ac)
      const net = fetch(e.request, { signal: ac.signal }).then(r => { if (r.ok) c.put(key, r.clone()); return r }).catch(() => hit).finally(() => pending.delete(pid))
      return net.then(r => r || hit)
    }))
  } else if (!u.pathname.startsWith('/api/')) {
    e.respondWith(fetch(e.request).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)) } return r }).catch(() => caches.match(e.request).then(r => r || caches.match('/'))))
  }
})
