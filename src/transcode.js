// ffmpeg glue: probing, on-demand HLS for formats browsers can't play natively, embedded subtitles.
import { spawn, execFile } from 'node:child_process'
import { srtToVtt } from './subs.js'
import { FFMPEG, ENCODERS, encoder } from './bin.js'
import { log } from './log.js'

export const SEG = 6
const DIRECT_V = new Set(['h264', 'vp8', 'vp9', 'av1'])
const DIRECT_A = new Set(['aac', 'mp3', 'opus', 'vorbis'])
const TEXT_SUBS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'text'])

// ffmpeg's own report of a file (what it prints for `ffmpeg -i`) as { format, duration, streams }, so no separate ffprobe binary has to ship.
// Each stream is { type, codec, pix_fmt, width, height, lang, title, default }.
const topLevel = s => { const out = []; let depth = 0; let at = 0; for (let i = 0; i < s.length; i++) { const c = s[i]; if (c === '(' || c === '[') depth++; else if (c === ')' || c === ']') depth--; else if (c === ',' && !depth) { out.push(s.slice(at, i).trim()); at = i + 1 } } out.push(s.slice(at).trim()); return out }
export function parseProbe (text) {
  const lines = text.split(/\r?\n/)
  const format = (text.match(/^Input #0, ([^,]+(?:,[^,]+)*?), (?:from|to) /m) || [])[1] || ''
  const d = text.match(/^\s*Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/m)
  const duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0
  const streams = []
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s+Stream #0:\d+(?:\[0x[0-9a-f]+\])?(?:\(([^)]*)\))?: (Video|Audio|Subtitle|Data|Attachment): (.*)$/)
    if (!m) continue
    const [, lang, kind, rest] = m
    const parts = topLevel(rest)
    const s = { type: kind.toLowerCase(), codec: (parts[0].match(/^[\w.-]+/) || [''])[0], lang: lang || undefined, default: /\(default\)/.test(rest) }
    if (kind === 'Video') {
      s.pix_fmt = (parts[1]?.match(/^\w+/) || [''])[0]
      const dim = parts.map(p => p.match(/^(\d+)x(\d+)/)).find(Boolean)
      if (dim) { s.width = +dim[1]; s.height = +dim[2] }
    }
    // Stream metadata follows, indented one level deeper than the stream line.
    const indent = lines[i].match(/^\s*/)[0].length
    for (let j = i + 1; j < lines.length && lines[j].match(/^\s*/)[0].length > indent; j++) {
      const t = lines[j].match(/^\s+title\s*:\s?(.*)$/)
      if (t) { s.title = t[1]; break }
    }
    streams.push(s)
  }
  // Chapters sit between the format header and the streams: "Chapter #0:0: start 0.000000, end 90.090000" then a title line.
  const chapters = [...text.matchAll(/^\s+Chapter #\d+:\d+: start ([\d.]+), end ([\d.]+)\s*\r?\n\s+Metadata:\s*\r?\n\s+title\s*:\s?(.*)$/gm)].map(c => ({ start: +c[1], end: +c[2], title: c[3].trim() }))
  return { format, duration, streams, chapters }
}

const probes = new Map()
const probeKids = new Map()
// A text file named like a video (a playlist or script naming other addresses) is refused: ffmpeg would follow whatever it names.
const PLAYLIST = /#EXTM3U|ffconcat|<MPD|<\?xml|^\s*v=0/i
async function refusePlaylist (url) {
  if (!url.startsWith('http')) return
  const r = await fetch(url, { headers: { range: 'bytes=0-1023' } }).catch(() => null)
  if (!r) return
  if (r.status !== 206) return void r.body?.cancel()
  if (PLAYLIST.test(Buffer.from(await r.arrayBuffer()).toString('latin1'))) throw new Error('This is not a video file')
}
export function probe (url, key, name = '') {
  if (!probes.has(key)) {
    const t0 = Date.now()
    const p = refusePlaylist(url).then(() => new Promise((resolve, reject) => {
      // With no output file ffmpeg prints what it found and exits with an error, which is expected here.
      const kid = execFile(FFMPEG, ['-hide_banner', '-nostdin', '-probesize', '5000000', '-analyzeduration', '5000000', '-i', url], { maxBuffer: 1e7, timeout: 120000 }, (err, out, text) => {
        if (!/^Input #0/m.test(text || '')) { log.warn('probe', 'ffmpeg could not read the file', { key, name, err: err?.message, ffmpeg: String(text || '').trim().split('\n').slice(-3).join(' | ') }); return reject(err || new Error('ffmpeg could not read the file')) }
        const f = parseProbe(text)
        const v = f.streams.find(s => s.type === 'video')
        const audio = f.streams.filter(s => s.type === 'audio').map((s, i) => ({ i, codec: s.codec, lang: s.lang, title: s.title, default: s.default }))
        // The index is the track's place among all subtitle tracks (ffmpeg's 0:s:n), including picture-based ones that are not offered.
        const subs = f.streams.filter(s => s.type === 'subtitle').map((s, i) => ({ i, codec: s.codec, lang: s.lang, title: s.title }))
          .filter(s => TEXT_SUBS.has(s.codec))
        // Both Matroska and WebM report "matroska,webm"; only a real .webm is browser-safe, .mkv is not.
        const fmt = f.format
        const containerOk = /mp4/.test(fmt) || (fmt === 'matroska,webm' && /\.webm$/i.test(name))
        log.info('probe', 'ok', { key, name, ms: Date.now() - t0, format: f.format, duration: f.duration, streams: f.streams.map(s => `${s.type}:${s.codec}${s.lang ? ':' + s.lang : ''}${s.width ? ':' + s.width + 'x' + s.height : ''}`).join(' ') })
        resolve({
          duration: f.duration,
          width: v?.width || 0,
          height: v?.height || 0,
          vcodec: v?.codec || '',
          acodec: (audio.find(a => a.default) || audio[0])?.codec || '',
          // Resolution class by width, since widescreen films are often cropped to fewer lines (1920x800 is still 1080p).
          tier: !v ? 0 : v.width >= 3200 || v.height >= 2000 ? 2160 : v.width >= 1800 || v.height >= 1000 ? 1080 : v.width >= 1200 || v.height >= 680 ? 720 : 480,
          direct: !!(containerOk && v && DIRECT_V.has(v.codec) && v.pix_fmt === 'yuv420p' && (!audio.length || DIRECT_A.has((audio.find(a => a.default) || audio[0]).codec))),
          chapters: f.chapters,
          audio, subs
        })
      })
      probeKids.set(key, kid)
    }))
    p.catch(e => { log.warn('probe', 'failed', { key, name, ms: Date.now() - t0, err: e }); probes.delete(key) }).finally(() => probeKids.delete(key))
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

// A read of a torrent that stops getting pieces never ends by itself and would hold one of the few encoder slots for good.
export const run = (args, input, ms = 120000, signal) => new Promise((resolve, reject) => {
  const p = spawn(FFMPEG, ['-v', 'error', '-nostdin', ...args], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
  const out = []; let err = ''; const t0 = Date.now()
  log.debug('ffmpeg', 'start', { pid: p.pid, args: args.map(a => (String(a).length > 120 ? String(a).slice(0, 120) + '...' : a)).join(' ') })
  const timer = setTimeout(() => { err = 'ffmpeg timed out'; p.kill('SIGKILL') }, ms)
  signal?.addEventListener('abort', () => { err = 'cancelled'; p.kill('SIGKILL') }, { once: true })
  if (signal?.aborted) p.kill('SIGKILL')
  p.stdout.on('data', d => out.push(d))
  p.stderr.on('data', d => { err += d })
  p.on('error', e => { clearTimeout(timer); log.error('ffmpeg', 'could not start', { ffmpeg: FFMPEG, err: e }); reject(e) })
  p.on('close', (code, sig) => {
    clearTimeout(timer)
    log[code === 0 ? 'debug' : 'warn']('ffmpeg', code === 0 ? 'done' : 'failed', { pid: p.pid, code, sig, ms: Date.now() - t0, bytes: out.reduce((a, c) => a + c.length, 0), stderr: err.trim().split('\n').slice(-4).join(' | ') || undefined })
    code === 0 ? resolve(Buffer.concat(out)) : reject(Object.assign(new Error(err.trim() || `ffmpeg exit ${code}`), signal?.aborted && { code: 499 })) })
  if (input) p.stdin.on('error', () => {}).end(input)
})

const SEG_TIMEOUT = 45000
const segs = new Map()
let running = 0
const waiting = []
const MAX_JOBS = +process.env.MAX_TRANSCODES || 3
const slot = signal => new Promise((resolve, reject) => {
  if (signal.aborted) return reject(Object.assign(new Error('cancelled'), { code: 499 }))
  if (running < MAX_JOBS) { running++; return resolve() }
  waiting.push(resolve)
  signal.addEventListener('abort', () => { const i = waiting.indexOf(resolve); if (i >= 0) { waiting.splice(i, 1); reject(Object.assign(new Error('cancelled'), { code: 499 })) } }, { once: true })
})
const release = () => { const next = waiting.shift(); if (next) next(); else running-- }
export const encodes = () => ({ running, queued: waiting.length })

export function segment (url, key, n, audio = 0, maxH = 1080) {
  const k = `${key}:${audio}:${maxH}:${n}`
  if (!segs.has(k)) {
    const t = n * SEG
    const ctl = new AbortController()
    const p = (async () => {
      const name = await encoder()
      const t0 = Date.now()
      await slot(ctl.signal)
      const t1 = Date.now()
      try {
        // Re-encode (not copy) so every segment starts on a keyframe; -output_ts_offset keeps timestamps continuous.
        const encode = enc => run([...enc.pre, '-ss', String(t), '-i', url, '-t', String(SEG), '-map', '0:v:0', '-map', `0:a:${audio}?`, '-sn', '-dn',
          ...enc.video(maxH), '-af', 'aresample=async=1:first_pts=0', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000', '-f', 'mpegts', '-muxdelay', '0', '-muxpreload', '0', '-output_ts_offset', String(t), 'pipe:1'], null, SEG_TIMEOUT, ctl.signal)
        // A graphics card that refuses the job (a size or setting it cannot take) must not stop playback: the processor does it.
        return await encode(ENCODERS[name]).then(b => { log.debug('transcode', 'segment', { key, n, audio, maxH, encoder: name, queuedMs: t1 - t0, ms: Date.now() - t1, bytes: b.length }); return b }).catch(e => {
          if (name === 'libx264' || ctl.signal.aborted) throw e
          log.warn('transcode', 'graphics encoder failed, using the processor for this segment', { key, n, encoder: name, err: String(e.message).split('\n').pop().slice(0, 200) })
          return encode(ENCODERS.libx264)
        })
      } finally { release() }
    })()
    p.catch(e => { log[e.code === 499 ? 'debug' : 'warn']('transcode', 'segment failed', { key, n, audio, maxH, err: e.message?.split('\n').pop() }); segs.delete(k) })
    segs.set(k, { p, key, ctl })
    if (segs.size > 60) segs.delete(segs.keys().next().value)
  }
  return segs.get(k).p
}

// The player has been left: its queued and running encodes, and the probe, stop instead of holding the few encoder slots while they wait for pieces nobody downloads.
export function cancel (key) {
  log.debug('transcode', 'cancel', { key })
  for (const [k, e] of segs) if (e.key === key) { e.ctl.abort(); segs.delete(k) }
  probeKids.get(key)?.kill('SIGKILL')
}

export function warm (url, key, n, last, audio, maxH) {
  for (let i = n + 1; i <= Math.min(n + 2, last); i++) segment(url, key, i, audio, maxH).catch(() => {})
}

// `to` (seconds) limits how much of the file is read, so subtitles can be pulled from a download still in progress.
export const embeddedSub = async (url, n, to = 0) => srtToVtt((await run([...(to ? ['-t', String(to)] : []), '-i', url, '-map', `0:s:${n}`, '-f', 'srt', 'pipe:1'])).toString('utf8'))

// Through SRT rather than WebVTT: ffmpeg's WebVTT writer drops an ASS cue's alignment, its SRT writer keeps it as {\an8}, which srtToVtt turns into a cue setting.
export const anyToVtt = async buf => srtToVtt((await run(['-protocol_whitelist', 'pipe', '-i', 'pipe:0', '-f', 'srt', 'pipe:1'], buf)).toString('utf8'))
