import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { tmpdir } from './support/tmp.js'

process.env.DATA_DIR = tmpdir('osaccount')
const { fetchSubtitle, resetQuota } = await import('../src/subs.js')
const account = await import('../src/osaccount.js')

const rpc = members => new Response(`<?xml version="1.0"?><methodResponse><params><param><value><struct>${members}</struct></value></param></params></methodResponse>`)
const str = (name, v) => `<member><name>${name}</name><value><string>${v}</string></value></member>`
const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n'

test('opensubtitles account: takes over downloads once the anonymous quota is used up, and a wrong password is not kept', async () => {
  const real = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, opts = {}) => {
    const host = new URL(url).hostname
    if (host === 'dl.opensubtitles.org') { calls.push('anon'); return new Response('quota', { status: 404 }) }
    const body = String(opts.body || '')
    if (body.includes('<methodName>LogIn')) return rpc(body.includes('hunter2') ? str('token', 'T1') + str('status', '200 OK') : str('token', 'x') + str('status', '401 Unauthorized'))
    calls.push('account')
    assert.match(body, /<string>T1<\/string>[\s\S]*<int>1951976249<\/int>/, 'asks with the session token and the file id from the link')
    return rpc(str('status', '200 OK') + `<member><name>data</name><value><array><data><value><struct>${str('idsubtitlefile', '1951976249')}${str('data', zlib.gzipSync(SRT).toString('base64'))}</struct></value></data></array></value></member>`)
  }
  try {
    await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/en/download/src-api/vrf-1/filead/1951976249.gz', undefined, 'p1'), { code: 429 }, 'no account: limit error')
    await assert.rejects(account.connect('p1', 'me', 'wrong'), { message: 'Wrong username or password' })
    assert.equal(account.status('p1').user, null)
    await account.connect('p1', 'me', 'hunter2')
    assert.equal(account.status('p1').user, 'me')
    assert.equal(JSON.stringify(account.status('p1')).includes('hunter2'), false, 'the password never leaves the server')
    const vtt = await fetchSubtitle('https://dl.opensubtitles.org/en/download/src-api/vrf-1/filead/1951976249.gz', undefined, 'p1')
    assert.match(vtt, /^WEBVTT[\s\S]*00:00:01\.000 --> 00:00:02\.000[\s\S]*Hello/)
    assert.deepEqual(calls, ['anon', 'account'], 'the quota-hit host is not asked again, the account is')
    await assert.rejects(fetchSubtitle('https://dl.opensubtitles.org/en/download/src-api/vrf-1/filead/1951976251.gz', undefined, 'p2'), { code: 429 }, 'another profile does not borrow the account')
    account.disconnect('p1')
    assert.equal(account.ready('p1'), false)
  } finally { globalThis.fetch = real; resetQuota() }
})

test('opensubtitles account: a non-VIP account gets the placeholder, which is not cached, not shown, and the account is set aside', async () => {
  const real = globalThis.fetch
  let downloads = 0
  globalThis.fetch = async (url, opts = {}) => {
    if (new URL(url).hostname === 'dl.opensubtitles.org') return new Response('quota', { status: 404 })
    const body = String(opts.body || '')
    if (body.includes('<methodName>LogIn')) return rpc(str('token', 'T1') + str('status', '200 OK'))
    downloads++
    const ad = '1\n00:00:00,001 --> 04:00:00,003\nBecome OpenSubtitles.org VIP Member \nto get subtitles -> osdb.link/vip'
    return rpc(str('status', '200 OK') + `<member><name>data</name><value><array><data><value><struct>${str('data', zlib.gzipSync(ad).toString('base64'))}</struct></value></data></array></value></member>`)
  }
  const url = 'https://dl.opensubtitles.org/en/download/src-api/vrf-2/filead/1951976250.gz'
  try {
    await account.connect('p3', 'free', 'pw')
    await assert.rejects(fetchSubtitle(url, undefined, 'p3'), { code: 429 })
    assert.equal(account.status('p3').vipOnly, true, 'the user can be told why')
    assert.equal(account.ready('p3'), false)
    await assert.rejects(fetchSubtitle(url, undefined, 'p3'), { code: 429 })
    assert.equal(downloads, 1, 'the account is not asked again')
    assert.equal(fs.existsSync(path.join(process.env.DATA_DIR, 'subs')) && fs.readdirSync(path.join(process.env.DATA_DIR, 'subs')).length, 1, 'only the first test\'s real file is cached, not the placeholder')
    await account.connect('p3', 'free', 'pw')
    assert.equal(account.status('p3').vipOnly, false, 'reconnecting asks again')
  } finally { account.disconnect('p3'); globalThis.fetch = real; resetQuota() }
})
