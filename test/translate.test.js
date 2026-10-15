import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-translate-'))
const { parseVtt, plan, share, modelLang } = await import('../src/translate.js')

const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:03.000
I told you we should

2
00:00:03.200 --> 00:00:05.000
leave before dark.

3
00:00:10.000 --> 00:00:12.000
- Where are you going?
- Out.

4
00:00:20.000 --> 00:00:22.000
<i>Come on.</i>

5
00:00:22.500 --> 00:00:24.000
We have no time
`

test('subtitle parsing keeps timing lines and text', () => {
  const cues = parseVtt(vtt)
  assert.equal(cues.length, 5)
  assert.equal(cues[0].head, '1\n00:00:01.000 --> 00:00:03.000')
  assert.equal(cues[2].text, '- Where are you going?\n- Out.')
  assert.equal(cues[1].s, 3.2)
})

test('fragments of one sentence are translated together; speakers and finished sentences are not merged', () => {
  const units = plan(parseVtt(vtt))
  assert.deepEqual(units.map(u => u.cues), [[0, 1], [2], [3], [4]])
  assert.deepEqual(units[0].lines, ['I told you we should leave before dark.'])
  assert.deepEqual(units[1].lines, ['- Where are you going?', '- Out.']) // one sentence per speaker
})

test('a translated sentence is shared back to its subtitles in proportion to their length', () => {
  assert.deepEqual(share('Gitmemiz gerektiğini söylemiştim karanlık basmadan', [20, 18]), ['Gitmemiz gerektiğini söylemiştim', 'karanlık basmadan'])
  assert.deepEqual(share('Hepsi tek parça', [30]), ['Hepsi tek parça'])
  assert.equal(share('bir iki', [5, 5, 5]).filter(Boolean).length, 2) // never invents words
})

test('interface language codes map to the model languages', () => {
  assert.equal(modelLang('zh'), 'zh-Hans')
  assert.equal(modelLang('tr'), 'tr')
})

test('shouted lines are sentence-cased before translation and invented text is cleaned up', async () => {
  const { prep, clean } = await import('../src/translate.js')
  assert.equal(prep('GET OUT OF HERE! NOW!'), 'Get out of here! Now!')
  assert.equal(prep('Get out of here'), 'Get out of here') // mixed case is left alone
  assert.equal(prep('OK'), 'OK')
  assert.equal(clean('Boyd.', 'Çocuk. - Evet.'), 'Boyd.') // a name turned into a phrase: keep the name
  assert.equal(clean('Daniel, I am proud.', '"Daniel, gurur duyuyorum.'), 'Daniel, gurur duyuyorum.')
  assert.equal(clean('Hello there.', '- Merhaba.'), 'Merhaba.')
  assert.equal(clean('- Hello there.', '- Merhaba.'), '- Merhaba.')
})

test('model files are all taken from one version (an old shared vocabulary must not meet a newer model)', async () => {
  const { pickSet } = await import('../src/translate.js')
  const rec = (fileType, version) => ({ fileType, version, name: `${fileType}.x` })
  // Korean: an old shared vocabulary beside newer separate ones
  const ko = [rec('model', '2.0'), rec('lex', '2.0'), rec('vocab', '2.0'), rec('model', '2.1'), rec('lex', '2.1'), rec('srcvocab', '2.1'), rec('trgvocab', '2.1')]
  const set = pickSet(ko)
  assert.deepEqual(Object.values(set).map(r => r.version), ['2.1', '2.1', '2.1', '2.1'])
  assert.ok(!set.vocab)
  // the newest version is skipped when it is incomplete
  assert.equal(pickSet([rec('model', '1.1'), rec('model', '1.0'), rec('lex', '1.0'), rec('vocab', '1.0')]).model.version, '1.0')
  assert.equal(pickSet([rec('model', '1.0')]), null)
})

test('the optional better translator knows every interface language except English', async () => {
  const { supports } = await import('../src/translate-hq.js')
  const langs = 'tr es fr de it pt ru nl pl ja ko zh ar id sv hi vi el he'.split(' ')
  assert.deepEqual(langs.filter(c => !supports(c)), [])
  assert.equal(supports('en'), false)
})

test('a line the translator answers nothing for keeps its original words', async () => {
  const { assemble, analyse, parseVtt } = await import('../src/translate.js')
  const a = analyse('WEBVTT\n\n00:01.000 --> 00:02.000\nHello there.\n\n00:03.000 --> 00:04.000\nHow are you?\n')
  const out = parseVtt(assemble(a, ['', 'Nasılsın?']))
  assert.deepEqual(out.map(c => c.text), ['Hello there.', 'Nasılsın?'])
})
