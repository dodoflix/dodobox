// ffmpeg glue: probing, on-demand HLS for formats browsers can't play natively, embedded subtitles.
import { spawn, execFile } from 'node:child_process'
import { srtToVtt } from './subs.js'
import { FFMPEG, FFPROBE, ENCODERS, encoder } from './bin.js'

export const SEG = 6
const DIRECT_V = new Set(['h264', 'vp8', 'vp9', 'av1'])
const DIRECT_A = new Set(['aac', 'mp3', 'opus', 'vorbis'])
const TEXT_SUBS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'])

const probes = new Map()
export function probe (url, key, name = '') {
  if (!probes.has(key)) {
    const p = new Promise((resolve, reject) => {
      execFile(FFPROBE, ['-v', 'error', '-probesize', '5000000', '-analyzeduration', '5000000', '-show_format', '-show_streams', '-of', 'json', url], { maxBuffer: 1e7, timeout: 120000 }, (err, out) => {
        if (err) return reject(err)
        const j = JSON.parse(out)
        const v = j.streams.find(s => s.codec_type === 'video')
        const audio = j.streams.filter(s => s.codec_type === 'audio').map((s, i) => ({ i, codec: s.codec_name, lang: s.tags?.language, title: s.tags?.title, default: s.disposition?.default === 1 }))
        // The index is the track's place among all subtitle tracks (ffmpeg's 0:s:n), including picture-based ones that are not offered.
        const subs = j.streams.filter(s => s.codec_type === 'subtitle').map((s, i) => ({ i, codec: s.codec_name, lang: s.tags?.language, title: s.tags?.title }))
          .filter(s => TEXT_SUBS.has(s.codec))
        // ffprobe calls both Matroska and WebM "matroska,webm"; only a real .webm is browser-safe, .mkv is not.
        const fmt = j.format.format_name
        const containerOk = /mp4/.test(fmt) || (fmt === 'matroska,webm' && /\.webm$/i.test(name))
        resolve({
          duration: parseFloat(j.format.duration) || 0,
          height: v?.height || 0,
          // Resolution class by width, since widescreen films are often cropped to fewer lines (1920x800 is still 1080p).
          tier: !v ? 0 : v.width >= 3200 || v.height >= 2000 ? 2160 : v.width >= 1800 || v.height >= 1000 ? 1080 : v.width >= 1200 || v.height >= 680 ? 720 : 480,
          direct: !!(containerOk && v && DIRECT_V.has(v.codec_name) && v.pix_fmt === 'yuv420p' && (!audio.length || DIRECT_A.has((audio.find(a => a.default) || audio[0]).codec))),
          audio, subs
        })
      })
    })
    p.catch(() => probes.delete(key))
    probes.set(key, p)
  }
  return probes.get(key)
}

export function playlist (duration, query) {
  const n = Math.ceil(duration / SEG)
  let m3u = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${SEG}\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-INDEPENDENT-SEGMENTS\n`
  for (let i = 0; i < n; i++) m3u += `#EXTINF:${Math.min(SEG, duration - i * SEG).toFixed(3)},\nseg${i}.ts${query}\n`
  return m3u + '#EXT-X-ENDLIST\n'
}

export const run = (args, input) => new Promise((resolve, reject) => {
  const p = spawn(FFMPEG, ['-v', 'error', '-nostdin', ...args], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  const out = []; let err = ''
  p.stdout.on('data', d => out.push(d))
  p.stderr.on('data', d => { err += d })
  p.on('close', code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(err.trim() || `ffmpeg exit ${code}`)))
  if (input) p.stdin.on('error', () => {}).end(input)
})

const segs = new Map()
let running = 0
const waiting = []
const MAX_JOBS = +process.env.MAX_TRANSCODES || 3
const slot = () => new Promise(resolve => running < MAX_JOBS ? (running++, resolve()) : waiting.push(resolve))
const release = () => { const next = waiting.shift(); if (next) next(); else running-- }

export function segment (url, key, n, audio = 0, maxH = 1080) {
  const k = `${key}:${audio}:${maxH}:${n}`
  if (!segs.has(k)) {
    const t = n * SEG
    const p = (async () => {
      const enc = ENCODERS[await encoder()]
      await slot()
      try {
        // Re-encode (not copy) so every segment starts on a keyframe; -output_ts_offset keeps timestamps continuous.
        return await run([...enc.pre, '-ss', String(t), '-i', url, '-t', String(SEG), '-map', '0:v:0', '-map', `0:a:${audio}?`, '-sn', '-dn',
          ...enc.video(maxH), '-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000', '-f', 'mpegts', '-muxdelay', '0', '-muxpreload', '0', '-output_ts_offset', String(t), 'pipe:1'])
      } finally { release() }
    })()
    p.catch(() => segs.delete(k))
    segs.set(k, p)
    if (segs.size > 60) segs.delete(segs.keys().next().value)
  }
  return segs.get(k)
}

export function warm (url, key, n, last, audio, maxH) {
  for (let i = n + 1; i <= Math.min(n + 2, last); i++) segment(url, key, i, audio, maxH).catch(() => {})
}

// `to` (seconds) limits how much of the file is read, so subtitles can be pulled from a download still in progress.
export const embeddedSub = async (url, n, to = 0) => srtToVtt((await run([...(to ? ['-t', String(to)] : []), '-i', url, '-map', `0:s:${n}`, '-f', 'webvtt', 'pipe:1'])).toString('utf8'))

export const anyToVtt = async buf => (await run(['-i', 'pipe:0', '-f', 'webvtt', 'pipe:1'], buf)).toString('utf8')
