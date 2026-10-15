import test from 'node:test'
import assert from 'node:assert/strict'
import { sidecarsFor, langOfName } from '../src/sidecar.js'

test('subtitle files inside a torrent: language from the name, and only the watched episode', () => {
  assert.equal(langOfName('Show - 01.en.srt'), 'eng')
  assert.equal(langOfName('Subs/Show.S01E02/2_Turkish.srt'), 'tur')
  assert.equal(langOfName('Show/Subs/Spanish/Show.S01E02.srt'), 'spa')
  assert.equal(langOfName('Show.S01E02.pt-BR.srt'), 'pob')
  assert.equal(langOfName('Show - It Takes Two - 03.srt'), 'und', 'a two-letter word in the title is not a language')
  assert.equal(langOfName('Show - 03 [tr].ass'), 'tur')
  const f = names => names.map(name => ({ name, length: 1000 }))
  const pack = f(['P/Show.S01E01.mkv', 'P/Show.S01E02.mkv', 'P/Show.S01E02.en.srt', 'P/Show.S01E01.en.srt', 'P/Subs/Show.S01E02/3_French.srt', 'P/Subs/Show.S01E01/3_French.srt', 'P/readme.txt'])
  assert.deepEqual(sidecarsFor(pack, 1, { type: 'series', season: 1, episode: 2 }).map(x => [x.name, x.lang]), [['Show.S01E02.en.srt', 'eng'], ['3_French.srt', 'fre']])
  const anime = f(['[G] Show - 01.mkv', '[G] Show - 02.mkv', '[G] Show - 02.eng.ass', '[G] Show - 011.eng.ass', 'Subs/[G] Show - 01/jpn.srt', 'Subs/[G] Show - 02/jpn.srt'])
  assert.deepEqual(sidecarsFor(anime, 1, { type: 'anime', episode: 2 }).map(x => x.name), ['[G] Show - 02.eng.ass', 'jpn.srt'])
  assert.equal(sidecarsFor(f(['Movie.2020.mkv', 'English.srt', 'Forced.Turkish.srt']), 0, { type: 'movie' }).length, 2, 'one video: every subtitle file is its own')
  assert.equal(sidecarsFor([{ name: 'a.mkv', length: 5 }, { name: 'a.srt', length: 9e6 }], 0).length, 0, 'huge files are not subtitles')
})
