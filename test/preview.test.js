import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { sheet } from '../src/preview.js'
import { previewLayout, chunkShape } from '../public/js/previewmap.js'
import { tmpdir } from './support/tmp.js'

// width and height from the first start-of-frame marker of a JPEG
const size = b => { for (let i = 2; i < b.length; i += 2 + b.readUInt16BE(i + 2)) if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; return null }

test('the preview takes a frame every 10 s, or fewer frames for a long video, in sections of 30 laid out in rows of 10', () => {
  assert.deepEqual(previewLayout(25), { step: 10, n: 3, per: 30, chunks: 1, w: 192, h: 108 })
  const L = previewLayout(2700)
  assert.deepEqual([L.step, L.n, L.chunks], [12, 225, 8])
  assert.deepEqual([chunkShape(L, 0), chunkShape(L, 7)], [{ count: 30, cols: 10, rows: 3 }, { count: 15, cols: 10, rows: 2 }])
  assert.equal(previewLayout(2 * 3600 + 600).step, 33)
  assert.ok(previewLayout(0).n === 1 && previewLayout(undefined).chunks === 1)
})

test('each section of a video is its own sheet, made once; a section that does not exist and a file that cannot be read get none', async () => {
  const dir = tmpdir('preview')
  const file = path.join(dir, 'clip.mkv')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2:duration=700', '-g', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', file])
  const L = previewLayout(700) // 70 frames: sections of 30, 30 and 10
  assert.equal(L.chunks, 3)
  const [a, b, c] = await Promise.all([0, 1, 2].map(k => sheet(file, 'clip', 700, k)))
  assert.deepEqual(size(a), [1920, 324])
  assert.deepEqual(size(b), [1920, 324])
  assert.deepEqual(size(c), [1920, 108])
  assert.notDeepEqual(a, b, 'another stretch of the video, another sheet')
  assert.equal(await sheet(file, 'clip', 700, 1), b, 'the same sheet is served again')
  assert.equal(sheet(file, 'clip', 700, 3), null)
  assert.equal(await sheet(path.join(dir, 'missing.mkv'), 'missing', 700, 0), null)
})

test('a section of a download still going that could not be made is tried again, one of a finished file is not', async () => {
  const dir = tmpdir('preview-retry')
  const file = path.join(dir, 'late.mkv')
  assert.equal(await sheet(file, 'late', 100, 0, false), null)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2:duration=100', '-g', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', file])
  assert.ok(await sheet(file, 'late', 100, 0, false), 'made once the file is there')
  assert.equal(await sheet(path.join(dir, 'gone.mkv'), 'gone', 100, 0, true), null)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=2:duration=100', '-g', '20', '-c:v', 'libx264', '-preset', 'ultrafast', '-y', path.join(dir, 'gone.mkv')])
  assert.equal(await sheet(path.join(dir, 'gone.mkv'), 'gone', 100, 0, true), null, 'a finished file is not asked again')
})
