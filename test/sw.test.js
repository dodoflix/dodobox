import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

// Runs public/sw.js against a fake Cache API and network, and drives its events directly.
function boot () {
  const store = new Map() // cache name -> Map(url -> response)
  const listeners = {}
  const fetched = []
  const net = { fn: async () => new Response('{}') }
  const caches = {
    open: async name => {
      if (!store.has(name)) store.set(name, new Map())
      const m = store.get(name)
      return { match: async r => m.get(r.url ?? r), put: async (r, res) => { m.set(r.url ?? r, res) } }
    },
    match: async r => { for (const m of store.values()) if (m.has(r.url ?? r)) return m.get(r.url ?? r) },
    keys: async () => [...store.keys()],
    delete: async k => store.delete(k)
  }
  const self = { addEventListener: (t, f) => { listeners[t] = f }, location: { origin: 'http://x' }, clients: { claim: async () => {} }, skipWaiting: async () => {} }
  const ctx = vm.createContext({ self, caches, URL, Request, Response, AbortController, Map, location: self.location, fetch: (r, o) => { fetched.push({ r, o }); return net.fn(r, o) } })
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), ctx)
  const request = (path, headers = {}) => new Request('http://x' + path, { headers })
  const fire = async (path, headers, clientId = 'c1') => {
    let p
    listeners.fetch({ request: request(path, headers), clientId, respondWith: x => { p = x } })
    return p
  }
  return { store, listeners, fetched, net, fire }
}
const hdr = (lang, profile, filter) => ({ 'x-lang': lang, 'x-profile': profile, 'x-adult-filter': filter })
const offline = sw => { sw.net.fn = async () => { throw new Error('offline') } }
const reply = body => new Response(JSON.stringify(body))

test('offline, each language, profile and adult-filter setting gets its own cached answer', async () => {
  const sw = boot()
  const combos = [hdr('en', 'a', '0'), hdr('tr', 'a', '0'), hdr('en', 'b', '0'), hdr('en', 'a', '1')]
  for (const h of combos) { sw.net.fn = async () => reply(h); await (await sw.fire('/api/me', h)).json() }
  offline(sw)
  for (const h of combos) assert.deepEqual(await (await sw.fire('/api/me', h)).json(), h)
  assert.equal(await sw.fire('/api/me', hdr('fr', 'a', '0')), undefined, 'an unseen combination is not answered from another one')
})

test('offline, data cached with query strings is still found per request', async () => {
  const sw = boot()
  sw.net.fn = async () => reply({ n: 1 }); await sw.fire('/api/catalog?type=movie', hdr('en', 'a', '0'))
  offline(sw)
  assert.deepEqual(await (await sw.fire('/api/catalog?type=movie', hdr('en', 'a', '0'))).json(), { n: 1 })
  assert.equal(await sw.fire('/api/catalog?type=series', hdr('en', 'a', '0')), undefined)
})

test('installing fetches every shell file fresh and fails if one is missing, keeping the old release', async () => {
  const sw = boot()
  let done
  sw.listeners.install({ waitUntil: p => { done = p } })
  await done
  assert.ok(sw.fetched.length > 10 && sw.fetched.every(f => f.o.cache === 'reload'), 'shell files bypass the browser cache')
  const bad = boot()
  bad.net.fn = async r => new Response('', { status: r === '/js/player.js' ? 404 : 200 })
  await assert.rejects(new Promise((resolve, reject) => { bad.listeners.install({ waitUntil: p => p.then(resolve, reject) }) }))
})

test('error responses are never cached', async () => {
  const sw = boot()
  sw.net.fn = async () => new Response('nope', { status: 500 })
  await sw.fire('/js/main.js', {}); await sw.fire('/api/me', hdr('en', 'a', '0'))
  await new Promise(r => setImmediate(r))
  assert.equal([...sw.store.values()].reduce((n, m) => n + m.size, 0), 0)
})

test('one tab abandoning a request does not cancel another tab\'s request with the same number', async () => {
  const sw = boot()
  const signals = {}
  sw.net.fn = (r, o) => { signals[r.headers.get('x-profile')] = o.signal; return new Promise(() => {}) }
  sw.fire('/api/me', { ...hdr('en', 'p1', '0'), 'x-rid': '1' }, 'tabA')
  sw.fire('/api/me', { ...hdr('en', 'p2', '0'), 'x-rid': '1' }, 'tabB')
  await new Promise(r => setImmediate(r))
  sw.listeners.message({ data: { abort: ['1'] }, source: { id: 'tabA' } })
  assert.equal(signals.p1.aborted, true)
  assert.equal(signals.p2.aborted, false)
})
