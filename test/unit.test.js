import test from 'node:test'
import assert from 'node:assert/strict'
import { releaseSubLangs, parseQuality, rank, lengthFits, measured } from '../src/sources.js'
import { srtToVtt, allowedSubUrl, sameShow, plausible } from '../src/subs.js'
import { playlist, run } from '../src/transcode.js'
import { upstream } from '../src/images.js'
import * as updates from '../src/update.js'
import { parseProbe } from '../src/transcode.js'
import { ENCODERS } from '../src/bin.js'
const { newer } = updates

test('ranking prefers healthy 1080p over huge, dead or cam releases', () => {
  const r = rank([
    { title: 'a CAM', quality: 1080, seeders: 900, size: 1e9 },
    { title: 'b 2160p remux', quality: 2160, seeders: 100, size: 40e9 },
    { title: 'c 1080p', quality: 1080, seeders: 200, size: 2e9 },
    { title: 'd 1080p', quality: 1080, seeders: 0, size: 2e9 },
    { title: 'e 720p', quality: 720, seeders: 150, size: 1e9 }
  ])
  assert.deepEqual(r.map(x => x.title[0]), ['c', 'e', 'b', 'a', 'd'])
  assert.equal(parseQuality('Movie.2160p.HDR'), 2160)
})

test('srt to vtt', () => {
  const vtt = srtToVtt('﻿1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\n')
  assert.equal(vtt, 'WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.000\nHello')
  assert.ok(srtToVtt('WEBVTT\n\n00:01.000 --> 00:02.000\nx').startsWith('WEBVTT'))
})

test('subtitle proxy only allows addon hosts', () => {
  assert.ok(allowedSubUrl('https://subs5.strem.io/en/download/x'))
  assert.ok(!allowedSubUrl('http://subs5.strem.io/x'))
  assert.ok(!allowedSubUrl('https://evil.example/strem.io'))
  assert.ok(!allowedSubUrl('https://notstrem.io/x'))
  assert.ok(!allowedSubUrl('nonsense'))
})

test('hls playlist covers the full duration', () => {
  const p = playlist(14, '?a=1')
  assert.equal((p.match(/#EXTINF/g) || []).length, 3)
  assert.match(p, /#EXTINF:2\.000,\nseg2\.ts\?a=1/)
  assert.ok(p.endsWith('#EXT-X-ENDLIST\n'))
})

test('ranking favors H.264 and compact encodes over heavy HEVC at equal health', () => {
  const r = rank([
    { title: 'Movie 1080p BluRay x265 10bit', quality: 1080, seeders: 200, size: 3e9 },
    { title: 'Movie 1080p WEB-DL x264', quality: 1080, seeders: 200, size: 3e9 },
    { title: 'Movie 1080p', quality: 1080, seeders: 200, size: 2e9, provider: 'YTS' }
  ])
  assert.match(r[0].provider || '', /YTS/)
  assert.match(r[1].title, /x264/)
  assert.match(r[2].title, /x265/)
})

test('only real mp4/webm count as browser-direct; mkv with H.264/AAC does not', async () => {
  const { execFileSync } = await import('node:child_process')
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
  const { probe } = await import('../src/transcode.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dodobox-probe-'))
  const src = ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1', '-f', 'lavfi', '-i', 'sine=duration=1']
  const mkv = path.join(dir, 'a.mkv'); const mp4 = path.join(dir, 'a.mp4'); const webm = path.join(dir, 'a.webm')
  execFileSync('ffmpeg', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mkv])
  execFileSync('ffmpeg', [...src, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', mp4])
  execFileSync('ffmpeg', [...src, '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', webm])
  assert.equal((await probe(mkv, 'k1', 'a.mkv')).direct, false)
  assert.equal((await probe(mp4, 'k2', 'a.mp4')).direct, true)
  assert.equal((await probe(webm, 'k3', 'a.webm')).direct, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('4K is chosen only when the line and the screen can use it; forcing overrides', () => {
  const r4 = { title: 'Movie 2160p WEB-DL x264', quality: 2160, seeders: 200, size: 20e9 }
  const r1 = { title: 'Movie 1080p WEB-DL x264', quality: 1080, seeders: 200, size: 4e9 }
  const best = ctx => rank([r1, r4], ctx)[0].quality
  assert.equal(best({ mbps: 500, display: 2160, runtimeMin: 110 }), 2160, 'fast line, 4K screen')
  assert.equal(best({ mbps: 500, display: 1080, runtimeMin: 110 }), 1080, 'no point on a 1080p screen')
  assert.equal(best({ mbps: 12, display: 2160, runtimeMin: 110 }), 1080, 'line too slow for 24 Mbps')
  assert.equal(best({ mbps: 0, display: 2160, runtimeMin: 110 }), 1080, 'unknown line stays safe')
  assert.equal(best({ mbps: 12, display: 1080, runtimeMin: 110, prefer: '2160' }), 2160, 'forced 4K wins even on a slow line')
  assert.equal(best({ mbps: 500, display: 2160, runtimeMin: 110, prefer: '480' }), 1080, 'forced 480 falls back to the closest available')
  const r480 = { title: 'Movie 480p x264', quality: 480, seeders: 200, size: 1e9 }
  assert.equal(rank([r1, r4, r480], { mbps: 500, display: 2160, prefer: '480' })[0].quality, 480)
})

test('quality parsing trusts explicit heights', () => {
  assert.equal(parseQuality('Movie 2010 UHD BDRip 1080p HDR10'), 1080)
  assert.equal(parseQuality('Movie 2160p WEB'), 2160)
  assert.equal(parseQuality('Movie UHD BluRay'), 2160)
})

test('zip reader finds the subtitle inside a downloaded archive', async () => {
  const { unzipFirst } = await import('../src/yify.js')
  const zip = Buffer.from('UEsDBBQAAAAIAHq4Tl2sKpPYBAAAAAIAAAAKAAAAcmVhZG1lLnR4dMvIBABQSwMEFAAAAAgAerhOXbqqp4AnAAAALwAAAA0AAABtb3ZpZS50dXIuc3J0M+QyMLACIUMdAwMDBV1dOwWogBFIgMs3tSgjMSlRIeXwnrzKRC4AUEsBAhQDFAAAAAgAerhOXawqk9gEAAAAAgAAAAoAAAAAAAAAAAAAAIABAAAAAHJlYWRtZS50eHRQSwECFAMUAAAACAB6uE5duqqngCcAAAAvAAAADQAAAAAAAAAAAAAAgAEsAAAAbW92aWUudHVyLnNydFBLBQYAAAAAAgACAHMAAAB+AAAAAAA=', 'base64')
  assert.match(unzipFirst(zip).toString('utf8'), /Merhaba dünya/)
  assert.throws(() => unzipFirst(Buffer.from('not a zip at all, just some text bytes')), /not a zip/)
})

test('legacy-encoded Turkish subtitles decode correctly', async () => {
  const { decode } = await import('../src/subs.js')
  const cp1254 = Buffer.from([0x47, 0xFD, 0x6C, 0x64, 0xFD, 0x7A]) // "Gıldız" in windows-1254
  assert.equal(decode(cp1254, 'windows-1254'), 'Gıldız')
})

test('download size modes: balanced skips 10 GB episodes, compact prefers small HEVC, lossless accepts big remuxes', () => {
  const r = (title, size, seeders = 100, extra = {}) => ({ title, release: title, size, seeders, quality: parseQuality(title), infoHash: title, ...extra })
  const huge = r('Show.S01E01.1080p.BluRay.REMUX.AVC.DTS-HD', 14e9)
  const web = r('Show.S01E01.1080p.WEB.h264', 3e9)
  const small = r('Show.S01E01.1080p.BluRay.x265', 1.2e9)
  const ctx = mode => ({ mode, runtimeMin: 50, display: 1080 })
  assert.notEqual(rank([huge, web, small], ctx('balanced'))[0], huge)
  assert.equal(rank([huge, web], ctx('balanced'))[0], web)
  assert.equal(rank([huge, web, small], ctx('compact'))[0], small)
  assert.equal(rank([huge, web], ctx('compact'))[0], web)
  assert.equal(rank([huge, web], ctx('lossless'))[0], huge)
})

test('ranking: foreign dubs lose unless they carry English or are the viewer\'s language; pack files use their own size', () => {
  const ita = { title: 'Show S01E01 1080p WEB ITA x264', release: '', size: 2e9, seeders: 200, quality: 1080, infoHash: 'a' }
  const eng = { title: 'Show S01E01 1080p WEB x264', release: '', size: 2e9, seeders: 60, quality: 1080, infoHash: 'b' }
  const dual = { ...ita, title: 'Show S01E01 1080p WEB ITA ENG x264', infoHash: 'c', seeders: 60 }
  assert.equal(rank([ita, eng], { runtimeMin: 50 })[0], eng)
  assert.equal(rank([ita, dual], { runtimeMin: 50 })[0], dual)
  assert.equal(rank([ita, eng], { runtimeMin: 50, audio: 'it' })[0], ita)
  // A season pack whose provider entry names the episode's file (fileIdx) is judged by that file's size, not the pack's.
  const bigPackFile = { title: 'Show S01 1080p', release: 'Show S01 1080p', size: 9e9, seeders: 100, quality: 1080, pack: true, fileIdx: 3, infoHash: 'd' }
  const goodPackFile = { ...bigPackFile, size: 1.3e9, infoHash: 'e' }
  assert.equal(rank([bigPackFile, goodPackFile], { runtimeMin: 50, mode: 'balanced' })[0], goodPackFile)
})

test('ranking uses real measured speed: a dead release sinks, a fast one rises', () => {
  const a = { title: 'A 1080p x264', release: '', size: 2e9, seeders: 100, quality: 1080, infoHash: 'speed-a' }
  const b = { ...a, title: 'B 1080p x264', infoHash: 'speed-b' }
  assert.ok(rank([a, b], { runtimeMin: 100 }).length === 2)
  measured.set('speed-a', { bps: 0, at: Date.now() })
  measured.set('speed-b', { bps: 6e6, at: Date.now() })
  assert.equal(rank([a, b], { runtimeMin: 100 })[0], b)
  measured.clear()
})

test('releases that carry the viewer\'s subtitle language built in are favoured', () => {
  const multi_ = '[GroupB] Show - 05 [1080p][Multiple Subtitle] [ENG][POR-BR][SPA-LA][SPA][ARA][FRE][GER][ITA][RUS][TUR]'
  assert.deepEqual([...releaseSubLangs(multi_)].sort(), ['ara', 'eng', 'fre', 'ger', 'ita', 'pob', 'rus', 'spa', 'tur'])
  assert.equal(releaseSubLangs('[GroupA] Show - 05 (1080p) [A1B2C3D4].mkv').size, 0)
  const sub = (title, seeders) => ({ title, release: title, size: 1.4e9, seeders, quality: 1080, infoHash: title, pack: false })
  const multi = sub(multi_, 40); const plain = sub('[GroupA] Show - 05 (1080p)', 60)
  assert.equal(rank([plain, multi], { runtimeMin: 24, sublang: 'tur' })[0], multi)
  assert.equal(rank([plain, multi], { runtimeMin: 24, sublang: 'eng' })[0], plain)
  assert.equal(rank([plain, multi], { runtimeMin: 24, sublang: 'off' })[0], plain)
  // "Multi-Subs" without a list of languages: a small nudge, enough to break a tie but not to beat a clearly better release
  const unlisted = sub('[GroupC] Show - 05 (1080p) [Multi-Subs]', 52)
  assert.equal(rank([plain, unlisted], { runtimeMin: 24, sublang: 'tur' })[0], unlisted)
  assert.equal(rank([plain, unlisted], { runtimeMin: 24, sublang: 'eng' })[0], plain)
  assert.equal(rank([sub('[GroupA] Show - 05 (720p)', 60), sub('[GroupC] Show - 05 (1080p) [Multi-Subs]', 5)], { runtimeMin: 24, sublang: 'tur' })[0].title, '[GroupA] Show - 05 (720p)')
})

test('anime subtitle results keep only the asked show and episode', () => {
  const q = { episode: 1, titles: ['Naruto'], imdb: 'tt0409591' }
  assert.ok(sameShow({ SeriesIMDBParent: '409591', SeriesEpisode: '1' }, q))
  assert.ok(!sameShow({ SeriesIMDBParent: '988824', SeriesEpisode: '1' }, q))
  assert.ok(!sameShow({ SeriesIMDBParent: '409591', SeriesEpisode: '257' }, q))
  assert.ok(sameShow({ MovieName: '"Naruto: Shippuden" Kikyo', SeriesEpisode: '1' }, { episode: 1, titles: ['Naruto: Shippuuden'] }))
  assert.ok(!sameShow({ MovieName: '"Naruto: Shippuden" Kikyo', SeriesEpisode: '1' }, { episode: 1, titles: ['Naruto'] }))
  assert.ok(plausible('Naruto.S01E01.WEBRip', q) && plausible('[ANBU]_Naruto_01_[ED]', q) && plausible('Naruto - S01E01 (001) 1080p', q))
  assert.ok(sameShow({ SeriesIMDBParent: '0', MovieKind: 'tv series', IDMovieImdb: '409591', SeriesEpisode: '0' }, q), 'a file filed as the show itself')
  assert.ok(!sameShow({ SeriesIMDBParent: '0', MovieKind: 'tv series', IDMovieImdb: '988824', SeriesEpisode: '0' }, q))
  const op = { episode: 1000, titles: ['One Piece'] }
  assert.ok(plausible('1000.ass', op) && plausible('[SubsPlease] One Piece - 1000 (1080p)', op) && plausible('One Piece (1999)', op))
  assert.ok(!plausible('[SubsPlease] One Piece - 1001 (1080p)', op) && !plausible('One Piece 600', op))
  assert.ok(!plausible('Naruto 101 Gotta See Gotta Know', q) && !plausible('Naruto Shippuden - 001', q) && !plausible('Naruto.S01E02', q) && !plausible('[ANBU]_Naruto_94_[D1]', q))
})

test('picture hosts that resize are asked for about the width needed', () => {
  const poster = 'https://images.metahub.space/poster/large/tt0111161/img'
  assert.equal(upstream(poster, 240), 'https://images.metahub.space/poster/small/tt0111161/img')
  assert.equal(upstream(poster, 400), 'https://images.metahub.space/poster/medium/tt0111161/img')
  assert.equal(upstream(poster, 700), poster)
  assert.equal(upstream('https://images.metahub.space/background/large/tt0111161/img', 240), 'https://images.metahub.space/background/large/tt0111161/img')
  assert.equal(upstream('https://m.media-amazon.com/images/M/MV5B@._V1_UX500_.jpg', 200), 'https://m.media-amazon.com/images/M/MV5B@._V1_UX240_.jpg')
  assert.equal(upstream('https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx21-x.jpg', 200), 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-x.jpg')
  assert.equal(upstream('https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx21-x.jpg', 400), 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/extraLarge/bx21-x.jpg')
  assert.equal(upstream('https://example.com/a.jpg', 240), 'https://example.com/a.jpg')
})

test('release versions compare by number, not by text', () => {
  assert.ok(newer('0.2.0', '0.1.9') && newer('1.0.0', '0.9.9') && newer('0.10.0', '0.9.0') && newer('v0.1.1', '0.1.0'))
  assert.ok(!newer('0.1.0', '0.1.0') && !newer('0.1.0', '0.2.0') && !newer('0.9.0', '0.10.0'))
  assert.ok(!newer('0.2.0-beta.1', '0.2.0'))
})

test('an update can be started only where the build can replace itself, and only in order', async () => {
  assert.equal(updates.view('0.1.0', true).canApply, false)
  assert.throws(() => updates.download(), { message: 'nothing to download' })
  let installed = 0
  updates.useDriver({ self: true, download: async () => {}, install: () => { installed++ }, check: () => {} })
  updates.set({ version: '0.2.0', url: 'u', phase: 'available' })
  assert.equal(updates.view('0.1.0', true).canApply, true)
  assert.equal(updates.view('0.1.0', false).canApply, false, 'a phone on the network cannot start it')
  assert.throws(() => updates.install(), { message: 'no update is ready' })
  await updates.download()
  assert.equal(updates.view('0.1.0', true).phase, 'downloading')
  updates.set({ phase: 'ready' })
  updates.install()
  assert.equal(installed, 1)
  updates.useDriver({ self: false, download: async () => {}, install: () => {}, check: () => {} })
  updates.set({ phase: 'available' })
  assert.equal(updates.view('0.1.0', true).canApply, false)
  assert.match(updates.view('0.1.0', true).hint, /installer/)
})

test('lookup finds a newer release by itself and reports a version once', async () => {
  const real = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ tag_name: 'v9.9.9', html_url: 'https://example.test/r' }), { headers: { 'content-type': 'application/json' } })
  const seen = []
  updates.onFound(i => seen.push(i.version))
  const log = console.log; console.log = () => {}
  try {
    updates.set({ version: '', phase: 'idle' })
    assert.equal(await updates.lookup('0.1.0'), true)
    assert.equal(await updates.lookup('0.1.0'), true)
    assert.equal(await updates.lookup('9.9.9'), false)
  } finally { globalThis.fetch = real; console.log = log }
  assert.deepEqual(seen, ['9.9.9'])
})

test('ffmpeg\'s file report is read as streams: codecs, languages, titles, defaults, size and duration', () => {
  const r = parseProbe(`Input #0, matroska,webm, from 'x.mkv':
  Metadata:
    title           : Some: Movie
  Duration: 01:02:03.50, start: 0.000000, bitrate: 5000 kb/s
  Stream #0:0(jpn): Video: hevc (Main 10), yuv420p10le(tv, bt709/unknown/unknown), 1920x1036, SAR 1:1 DAR 480:259, 23.98 fps, 23.98 tbr, 1k tbn (default)
    Metadata:
      title           : Video track
  Stream #0:1(fre): Audio: opus, 48000 Hz, 5.1, fltp (default) (forced)
    Metadata:
      title           : Francais: dub, v2
  Stream #0:2[0x1100](eng): Audio: ac3, 48000 Hz, stereo, fltp, 192 kb/s
  Stream #0:3(eng): Subtitle: subrip (srt) (default)
    Metadata:
      title           : English, SDH
  Stream #0:4: Attachment: none
    Metadata:
      filename        : font.ttf
`)
  assert.equal(r.format, 'matroska,webm')
  assert.equal(r.duration, 3723.5)
  assert.deepEqual(r.streams.map(s => [s.type, s.codec, s.lang, s.default, s.title]), [
    ['video', 'hevc', 'jpn', true, 'Video track'], ['audio', 'opus', 'fre', true, 'Francais: dub, v2'], ['audio', 'ac3', 'eng', false, undefined],
    ['subtitle', 'subrip', 'eng', true, 'English, SDH'], ['attachment', 'none', undefined, false, undefined]])
  assert.deepEqual([r.streams[0].pix_fmt, r.streams[0].width, r.streams[0].height], ['yuv420p10le', 1920, 1036])
  const mp4 = parseProbe('Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'a.mp4\':\n  Duration: 00:00:03.04, start: 0.0, bitrate: 1 kb/s\n  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 640x360 [SAR 1:1 DAR 16:9], 24 fps, 24 tbr (default)\n')
  assert.deepEqual([mp4.format, mp4.streams[0].codec, mp4.streams[0].pix_fmt, mp4.streams[0].width, mp4.streams[0].lang], ['mov,mp4,m4a,3gp,3g2,mj2', 'h264', 'yuv420p', 640, 'und'])
  assert.deepEqual(parseProbe(''), { format: '', duration: 0, streams: [] })
})

test('the encoder level covers the frame size, so 1440p and 2160p do not fail to start', () => {
  const level = (name, h) => { const a = ENCODERS[name].video(h); return a[a.indexOf('-level') + 1] }
  for (const name of ['libx264', 'h264_nvenc']) { assert.equal(level(name, 1080), '4.1'); assert.equal(level(name, 720), '4.1'); assert.equal(level(name, 1440), '5.1'); assert.equal(level(name, 2160), '5.1') }
  assert.equal(level('h264_videotoolbox', 1080), '4.2')
  assert.equal(level('h264_videotoolbox', 2160), '5.1')
})

test('an ffmpeg job stops when cancelled or when it runs too long', async () => {
  const slow = ['-f', 'lavfi', '-re', '-i', 'testsrc=size=64x64:rate=25', '-t', '60', '-f', 'null', '-']
  const ctl = new AbortController()
  setTimeout(() => ctl.abort(), 200)
  await assert.rejects(run(slow, null, 30000, ctl.signal), /cancelled/)
  await assert.rejects(run(slow, null, 300), /timed out/)
})

test('same-titled shows are told apart by year and by length', () => {
  const r = (title, seeders = 5) => ({ title, release: title, infoHash: title, seeders, size: 1e9, quality: 1080 })
  const ctx = { year: 2023, kind: 'series', runtimeMin: 48 }
  const [first] = rank([r('The Prince S01 1080p HMAX WEBRip', 9), r('The.Prince.2023.S01E03.1080p.WEB.h264-BETTY'), r('The.Prince.2012.S01E03.1080p')], ctx)
  assert.match(first.title, /2023/)
  assert.ok(lengthFits(2760, 48) && lengthFits(5400, 48))
  assert.ok(!lengthFits(782, 48) && !lengthFits(14400, 48))
  assert.ok(lengthFits(0, 48) && lengthFits(782, 0))
})
