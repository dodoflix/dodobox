// Where a cue sits (ASS alignment) survives each way a subtitle reaches the player that goes through ffmpeg.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from './support/tmp.js'

const tmp = tmpdir('placed-subs')
process.env.DATA_DIR = path.join(tmp, 'data')
const { embeddedSub, anyToVtt } = await import('../src/transcode.js')

const ASS = `[Script Info]
ScriptType: v4.00+
PlayResX: 384
PlayResY: 288

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,2,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,{\\an8}Sign at the top
Dialogue: 0,0:00:02.00,0:00:03.00,Default,,0,0,0,,{\\an4\\i1}Slanted, middle left{\\i0}
Dialogue: 0,0:00:03.00,0:00:04.00,Default,,0,0,0,,{\\an3}Bottom right
Dialogue: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,{\\pos(100,100)\\fad(100,100)}Plain speech
`
const file = name => path.join(tmp, name)
const mkv = (name, sub, codec) => {
  fs.writeFileSync(file(sub.name), sub.text)
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=6', '-i', file(sub.name), '-c:v', 'mpeg4', '-c:s', codec, '-y', file(name)])
  return file(name)
}

test('a built-in ASS track keeps its alignment, italics and nothing else of the styling', async () => {
  const out = await embeddedSub(mkv('a.mkv', { name: 'a.ass', text: ASS }, 'ass'), 0)
  assert.match(out, /^WEBVTT/)
  assert.match(out, /00:00:01\.000 --> 00:00:02\.000 line:0\nSign at the top/)
  assert.match(out, /00:00:02\.000 --> 00:00:03\.000 line:50% align:start\n<i>Slanted, middle left<\/i>/)
  assert.match(out, /00:00:03\.000 --> 00:00:04\.000 align:end\nBottom right/)
  assert.match(out, /00:00:04\.000 --> 00:00:05\.000\nPlain speech/)
  assert.ok(!out.includes('{'), 'no override block is left in the text')
})

test('a built-in SRT track whose text carries {\\an8} is placed too', async () => {
  const out = await embeddedSub(mkv('s.mkv', { name: 's.srt', text: '1\n00:00:01,000 --> 00:00:02,000\n{\\an9}Top right\n\n2\n00:00:03,000 --> 00:00:04,000\nPlain\n' }, 'srt'), 0)
  assert.match(out, /00:00:01\.000 --> 00:00:02\.000 line:0 align:end\nTop right/)
  assert.match(out, /00:00:03\.000 --> 00:00:04\.000\nPlain/)
})

test('a built-in WebVTT or mov_text track still reads, and a limit on how much is read still applies', async () => {
  const vtt = await embeddedSub(mkv('w.mkv', { name: 'w.vtt', text: 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nOne\n\n00:00:04.000 --> 00:00:05.000\nTwo\n' }, 'webvtt'), 0)
  assert.match(vtt, /One/)
  assert.match(vtt, /Two/)
  assert.match(await embeddedSub(file('w.mkv'), 0, 3), /One/, 'reading only the first seconds works')
  assert.match(await embeddedSub(mkv('m.mp4', { name: 'm.srt', text: '1\n00:00:01,000 --> 00:00:02,000\nTitled\n' }, 'mov_text'), 0), /Titled/)
})

test('an uploaded ASS file keeps its alignment, and a file that is not a subtitle fails', async () => {
  const out = await anyToVtt(Buffer.from(ASS))
  assert.match(out, /^WEBVTT/)
  assert.match(out, /line:0\nSign at the top/)
  assert.match(out, /line:50% align:start\n<i>Slanted, middle left<\/i>/)
  assert.match(out, /align:end\nBottom right/)
  assert.ok(!out.includes('{'))
  await assert.rejects(anyToVtt(Buffer.from('not a subtitle at all')))
})
