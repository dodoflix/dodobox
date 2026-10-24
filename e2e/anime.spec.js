import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, stub, resetStubs, json, ANIME } from './harness.js'

let base
before(async () => { ({ base } = await boot({ seed: ['anime'] })) })
after(shutdown)
afterEach(resetStubs)

test('an anime episode plays from its page and the opening is skipped with the community times', async () => {
  stub('api.aniskip.com', () => json({ results: [
    { skipType: 'op', interval: { startTime: 1, endTime: 9 }, episodeLength: 20 },
    { skipType: 'op', interval: { startTime: 2, endTime: 8 }, episodeLength: 20 },
    { skipType: 'recap', interval: { startTime: 0, endTime: 3 }, episodeLength: 999 },
    { skipType: 'ed', interval: { startTime: 12, endTime: 19 }, episodeLength: 20 },
    { skipType: 'mixed-op', interval: { startTime: 1, endTime: 9 }, episodeLength: 20 }
  ] }))
  const { ctx, page } = await newPage(base)
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/#/title/anime/${ANIME.id}`)
  await page.locator('.d-body h1', { hasText: ANIME.name }).waitFor()
  await page.locator('#eps .ep', { hasText: 'Episode 1' }).click()
  await page.waitForFunction(() => { const v = document.querySelector('.pl video'); return v && v.currentTime > 1.5 && !v.paused })
  await page.locator('#skip', { hasText: /Skip intro/ }).click()
  await page.waitForFunction(() => document.querySelector('.pl video').currentTime >= 9)
  await ctx.close()
})

test('subtitles for an anime episode keep only the asked show and episode', async () => {
  const row = (n, extra) => ({ SubFormat: 'srt', SubLanguageID: 'eng', SubDownloadLink: `https://dl.opensubtitles.org/en/download/src-api/vrf-1/sid-${n}.gz`, MovieReleaseName: 'Moon.Station.Nine.S01E01.1080p', SubDownloadsCnt: '50', SeriesEpisode: '1', SeriesSeason: '1', SeriesIMDBParent: '9000009', MovieKind: 'tv series', ...extra })
  stub('opensubtitles-v3.strem.io', () => json({ subtitles: [{ lang: 'eng', url: 'https://subs5.strem.io/anime.srt', movieReleaseName: 'Moon.Station.Nine.S01E01.1080p', g: '2' }, { lang: 'eng', url: 'https://subs5.strem.io/boruto.srt', movieReleaseName: 'Boruto.S01E01', g: '2' }] }))
  stub('rest.opensubtitles.org', () => json([
    row(1),
    row(2, { SeriesEpisode: '2', MovieReleaseName: 'Moon.Station.Nine.S01E02.1080p' }),
    row(3, { MovieKind: 'movie', MovieReleaseName: 'Moon.Station.Nine.The.Movie' }),
    row(4, { SeriesSeason: '2' }),
    row(5, { SeriesIMDBParent: '1234567' }),
    row(6, { SubFormat: 'idx' })
  ]))
  // the slower provider may miss the quick answer on a busy machine: the list is complete on a later ask
  let list
  for (let i = 0; i < 40; i++) { list = await (await fetch(`${base}/api/subs?type=anime&id=${ANIME.id}&season=1&episode=1&langs=eng&release=Moon.Station.Nine.S01E01.1080p`)).json(); if (list.length >= 2) break; await new Promise(r => setTimeout(r, 250)) }
  assert.deepEqual(list.map(s => s.url).sort(), ['https://dl.opensubtitles.org/en/download/src-api/vrf-1/sid-1.gz', 'https://subs5.strem.io/anime.srt'])
})
