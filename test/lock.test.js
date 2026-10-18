import test from 'node:test'
import assert from 'node:assert/strict'
import { hashPin, matches, throttled, failed, succeeded, issue, valid, revokeAll, PIN_FORMAT } from '../src/lock.js'

test('a PIN is stored hashed and checked in constant time', async () => {
  const rec = await hashPin('2468')
  assert.ok(!JSON.stringify(rec).includes('2468'))
  assert.equal(await matches(rec, '2468'), true)
  assert.equal(await matches(rec, '2469'), false)
  assert.equal(await matches(null, '2468'), false)
  assert.notEqual((await hashPin('2468')).hash, rec.hash, 'each PIN gets its own salt')
  assert.deepEqual(['123', '1234', '12345678', '123456789', '12a4', ''].map(p => PIN_FORMAT.test(p)), [false, true, true, false, false, false])
})

test('five wrong PINs in a row lock the profile out for longer each time', () => {
  const t0 = 1e6
  for (let i = 0; i < 4; i++) failed('p1', t0)
  assert.equal(throttled('p1', t0), 0)
  failed('p1', t0)
  assert.equal(throttled('p1', t0), 30)
  failed('p1', t0 + 31e3)
  assert.equal(throttled('p1', t0 + 31e3), 60)
  succeeded('p1')
  assert.equal(throttled('p1', t0 + 31e3), 0)
})

test('a session token belongs to one profile and ends when revoked or old', () => {
  const t = issue('a')
  assert.equal(valid('a', t), true)
  assert.equal(valid('b', t), false)
  assert.equal(valid('a', t, Date.now() + 31 * 24 * 3600e3), false)
  const u = issue('a'); revokeAll('a')
  assert.equal(valid('a', u), false)
  assert.equal(valid('a', undefined), false)
})
