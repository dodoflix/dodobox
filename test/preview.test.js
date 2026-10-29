import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { sheet } from '../src/preview.js'
import { previewLayout } from '../public/js/previewmap.js'
import { tmpdir } from './support/tmp.js'

// width and height from the first start-of-frame marker of a JPEG
const size = b => { for (let i = 2; i < b.length; i += 2 + b.readUInt16BE(i + 2)) if (b[i + 1] >= 0xc0 && b[i + 1] <= 0xc2) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)]; return null }

test('the preview layout takes a frame every 10 s, or fewer frames for a long video, in rows of 10', () => {
  assert.deepEqual(previewLayout(25), { step: 10, n: 3, cols: 3, rows: 1, w: 192, h: 108 })
  assert.deepEqual(previewLayout(2700), { step: 12, n: 225, cols: 10, rows: 23, w: 192, h: 108 })
  assert.equal(previewLayout(2 * 3600 + 600).step, 33)
  assert.ok(previewLayout(0).n === 1 && previewLayout(undefined).cols === 1)
})

test('a video gets one sheet of frames sized by its layout, made once, and a file that cannot be read gets none', async () => {
  const dir = tmpdir('preview')
  const file = path.join(dir, 'clip.mkv')
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=25', '-g', '10', '-c:v', 'libx264', '-y', file])
  const { cols, rows, w, h } = previewLayout(25)
  const a = await sheet(file, 'clip', 25)
  assert.deepEqual(size(a), [cols * w, rows * h])
  assert.equal(await sheet(file, 'clip', 25), a, 'the same sheet is served again')
  assert.equal(await sheet(path.join(dir, 'missing.mkv'), 'missing', 25), null)
})
