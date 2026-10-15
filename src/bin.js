// ffmpeg discovery: a system install wins (usually has hardware encoders), then the static build from npm. The desktop installers leave
// that build out (desktop/prune.cjs) and ensureFfmpeg() fetches the same release into the data folder instead.
import { execFileSync, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createRequire } from 'node:module'
import { createGunzip } from 'node:zlib'
import ffmpegStatic from 'ffmpeg-static'
import { DATA } from './paths.js'

const pkg = createRequire(import.meta.url)('ffmpeg-static/package.json')
const works = bin => { try { execFileSync(bin, ['-version'], { stdio: 'ignore' }); return true } catch { return false } }
const pick = (env, system, bundled) => env || (works(system) ? system : bundled)

const downloaded = path.join(DATA, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
export let FFMPEG = pick(process.env.FFMPEG, 'ffmpeg', ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : downloaded)

const VAAPI_DEVICE = process.env.VAAPI_DEVICE || '/dev/dri/renderD128'

// Streams start on a keyframe with increasing timestamps (no B-frames), which Safari's native HLS requires; High 4.1 plays on every phone and TV.
// The level has to cover the frame size: the NVENC encoder refuses to start ("Invalid Level") when 1440p or 2160p is asked for with level 4.1.
const level = (h, small) => (h > 1088 ? '5.1' : small)
const safe = h => ['-profile:v', 'high', '-level', level(h, '4.1'), '-g', '48', '-keyint_min', '48', '-sc_threshold', '0', '-bf', '0']
const scale = h => `scale=-2:'min(${h},ih)'`
export const ENCODERS = {
  libx264: { pre: [], video: h => ['-vf', `${scale(h)},format=yuv420p`, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', ...safe(h)] },
  h264_nvenc: { pre: [], video: h => ['-vf', `${scale(h)},format=yuv420p`, '-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '23', ...safe(h)] },
  h264_videotoolbox: { pre: [], video: h => ['-vf', `${scale(h)},format=yuv420p`, '-c:v', 'h264_videotoolbox', '-b:v', '6M', '-profile:v', 'high', '-level', level(h, '4.2')] },
  h264_vaapi: { pre: ['-vaapi_device', VAAPI_DEVICE], video: h => ['-vf', `${scale(h)},format=nv12,hwupload`, '-c:v', 'h264_vaapi', '-qp', '23', '-profile:v', 'high'] }
}

export const trial = name => new Promise(resolve => {
  const e = ENCODERS[name]
  execFile(FFMPEG, ['-v', 'error', '-nostdin', ...e.pre, '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=5:duration=1', ...e.video(720), '-f', 'null', '-'],
    { timeout: 15000 }, err => resolve(!err))
})

let chosen
export async function encoder () {
  if (!chosen) {
    chosen = (async () => {
      await ensureFfmpeg()
      const forced = process.env.DODOBOX_ENCODER
      if (forced && ENCODERS[forced]) return forced
      if (!forced) for (const n of ['h264_nvenc', 'h264_videotoolbox', 'h264_vaapi']) if (await trial(n)) return n
      return 'libx264'
    })()
  }
  return chosen
}
export const haveFfmpeg = () => fs.existsSync(FFMPEG) || works(FFMPEG)

let fetching
// Resolves once FFMPEG can be run; every ffmpeg caller awaits it, so the first one after a fresh install waits for the download.
export function ensureFfmpeg () {
  if (haveFfmpeg()) return Promise.resolve()
  fetching ||= (async () => {
    const url = `${process.env.FFMPEG_BINARIES_URL || 'https://github.com/eugeneware/ffmpeg-static/releases/download'}/${pkg['ffmpeg-static']['binary-release-tag']}/ffmpeg-${process.platform}-${process.arch}.gz`
    console.log(`  Downloading ffmpeg (${url})`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`ffmpeg download failed: HTTP ${res.status}`)
    fs.mkdirSync(path.dirname(downloaded), { recursive: true })
    const tmp = `${downloaded}.part`
    await pipeline(Readable.fromWeb(res.body), createGunzip(), fs.createWriteStream(tmp, { mode: 0o755 }))
    fs.renameSync(tmp, downloaded)
    FFMPEG = downloaded
  })().finally(() => { fetching = null })
  return fetching
}
