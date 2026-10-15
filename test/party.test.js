import test from 'node:test'
import assert from 'node:assert/strict'
import { Party, newCode, cleanCode, derive, seal, open, cleanItem, cleanSource } from '../src/party.js'

const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 25)) } }
const item = { type: 'series', id: 'tt1', season: 1, episode: 2, title: 'Show' }
const mk = (peers = []) => new Party({ trackers: [], dht: false, peers })
const events = p => { const list = []; p.on('event', e => list.push(e)); return list }

test('codes are 80 bits in four groups, and typing one forgivingly still finds it', () => {
  const c = newCode()
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/)
  assert.notEqual(newCode(), c)
  assert.equal(cleanCode(c.toLowerCase().replace(/-/g, ' ')), c)
  assert.equal(cleanCode('oooo-iiii-llll-0000'), '0000-1111-1111-0000')
  assert.equal(cleanCode('too short'), null)
  assert.equal(cleanCode(''), null)
  assert.equal(cleanCode('UUUU-UUUU-UUUU-UUUU'), null, 'U is not in the alphabet')
})

test('the code makes the torrent id and the key, and messages are sealed, authenticated and size-limited', async () => {
  const a = await derive('0000-1111-2222-3333'); const b = await derive('0000-1111-2222-3334')
  assert.match(a.infoHash, /^[0-9a-f]{40}$/)
  assert.notEqual(a.infoHash, b.infoHash)
  assert.deepEqual((await derive('0000-1111-2222-3333')).key, a.key)
  const msg = { k: 'pl', pos: 12.5 }
  const sealed = seal(a.key, msg)
  assert.deepEqual(open(a.key, sealed), msg)
  assert.equal(open(b.key, sealed), null, 'another code cannot read it')
  const flipped = Buffer.from(sealed); flipped[20] ^= 1
  assert.equal(open(a.key, flipped), null, 'a changed message is refused')
  assert.equal(open(a.key, Buffer.alloc(5000)), null)
  assert.equal(open(a.key, Buffer.from('short')), null)
})

test('what another member says is checked before it reaches the page', () => {
  assert.deepEqual(cleanItem({ ...item, extra: 'x' }), item)
  assert.equal(cleanItem({ ...item, type: 'game' }), null)
  assert.equal(cleanItem({ ...item, id: '../etc' }), null)
  assert.equal(cleanItem({ ...item, season: -1 }).season, null)
  assert.equal(cleanItem({ ...item, title: 'x'.repeat(500) }).title.length, 120)
  assert.equal(cleanItem(null), null)
  assert.deepEqual(cleanSource({ infoHash: 'a'.repeat(40) }), { infoHash: 'a'.repeat(40) })
  assert.equal(cleanSource({ infoHash: 'magnet:?xt=evil' }), null)
  assert.equal(cleanSource({ infoHash: 'A'.repeat(40) }), null)
})

test('members find each other, share what is playing, follow each other, and leave', async () => {
  const code = newCode()
  const a = mk(); const ea = events(a)
  await a.join(code, { name: 'Ana', color: '#f00' }, { item, source: { infoHash: 'b'.repeat(40) }, pos: 5, paused: true, at: Date.now() })
  await until(() => a.port)
  const b = mk([`127.0.0.1:${a.port}`]); const eb = events(b)
  await b.join(code, { name: 'Bob', color: '#0f0' })
  await until(() => a.status().members.length === 2 && b.status().members.length === 2)
  assert.deepEqual(a.status().members.map(m => m.name).sort(), ['Ana', 'Bob'])
  assert.equal(a.status().phase, 'live')
  await until(() => b.status().now)
  assert.deepEqual([b.status().now.item, b.status().now.source.infoHash, b.status().now.paused], [item, 'b'.repeat(40), true], 'a new member is told what is on')
  a.send('pl', { pos: 7 })
  await until(() => eb.some(e => e.type === 'cmd' && e.k === 'pl'))
  assert.equal(eb.find(e => e.type === 'cmd').pos, 7)
  assert.equal(eb.find(e => e.type === 'cmd').from.name, 'Ana')
  assert.equal(b.status().now.paused, false)
  b.send('sk', { pos: 100 })
  await until(() => ea.some(e => e.type === 'cmd' && e.k === 'sk'))
  b.send('ld', { item: { ...item, episode: 3 }, source: null })
  await until(() => ea.some(e => e.type === 'load'))
  assert.equal(ea.find(e => e.type === 'load').item.episode, 3)
  assert.throws(() => a.send('xx', { pos: 1 }), /Bad message/)
  assert.throws(() => a.send('pl', { pos: -1 }), /Bad message/)
  b.leave()
  await until(() => a.status().members.length === 1)
  assert.equal(ea.some(e => e.type === 'left' && e.from.name === 'Bob'), true)
  a.leave()
  assert.equal(a.status().active, false)
  assert.throws(() => a.send('pl', { pos: 1 }), /Not in a party/)
})

test('a member who cannot reach another directly is bridged, and strangers and replays are ignored', async () => {
  const code = newCode()
  const a = mk(); await a.join(code, { name: 'A' }); await until(() => a.port)
  const b = mk([`127.0.0.1:${a.port}`]); await b.join(code, { name: 'B' }); await until(() => b.port)
  const c = mk([`127.0.0.1:${b.port}`]); const ec = events(c); await c.join(code, { name: 'C' }) // C only knows B
  await until(() => a.status().members.length === 3 && c.status().members.length === 3)
  a.send('pa', { pos: 33 })
  await until(() => ec.some(e => e.type === 'cmd' && e.k === 'pa'))
  const count = ec.filter(e => e.type === 'cmd').length
  // The same sealed message again (a replay) and one sealed with another code do nothing.
  const wire = [...c.wires][0]
  const replay = seal(c.key, { f: a.self.id, q: 1, ts: Date.now(), k: 'pa', pos: 1 })
  c.receive(replay, wire); c.receive(replay, wire)
  const other = (await derive('9999-9999-9999-9999')).key
  c.receive(seal(other, { f: 'zz', q: 1, ts: Date.now(), k: 'pa', pos: 2 }), wire)
  c.receive(seal(c.key, { f: 'old', q: 1, ts: Date.now() - 3600e3, k: 'pa', pos: 3 }), wire)
  await new Promise(r => setTimeout(r, 200))
  assert.equal(ec.filter(e => e.type === 'cmd').length, count + 1, 'only the first copy of a new message counts')
  assert.equal(c.status().members.some(m => m.id === 'zz' || m.id === 'old'), false)
  for (const p of [a, b, c]) p.leave()
})

test('joining with a bad code, or twice, is refused', async () => {
  const p = mk()
  await assert.rejects(p.join('nope'), /not a party code/)
  await p.join(newCode(), { name: 'X' })
  await assert.rejects(p.join(newCode()), /Already in a party/)
  p.leave()
})
