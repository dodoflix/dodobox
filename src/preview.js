// Seek-bar preview: the frames of a video from its keyframes, one JPEG per section of the video, made when first asked for.
import { run } from './transcode.js'
import { previewLayout, chunkShape } from '../public/js/previewmap.js'

const sheets = new Map() // key:section -> Promise of the JPEG, or null when ffmpeg could not make it (not retried)
let queue = Promise.resolve() // one at a time, so playback keeps the processor

// `final`: the file is complete; a section made from a download still going may fail for a missing stretch, so that is tried again later
export function sheet (file, key, duration, k, final = true) {
  const L = previewLayout(duration)
  if (!(k >= 0 && k < L.chunks)) return null
  const id = `${key}:${k}`
  if (!sheets.has(id)) {
    const { count, cols, rows } = chunkShape(L, k)
    const vf = `fps=1/${L.step},scale=${L.w}:${L.h}:force_original_aspect_ratio=decrease,pad=${L.w}:${L.h}:(ow-iw)/2:(oh-ih)/2,tile=${cols}x${rows}`
    const job = queue.then(() => run(['-threads', '1', '-skip_frame', 'nokey', '-ss', String(k * L.per * L.step), '-t', String(count * L.step), '-i', file, '-an', '-sn', '-vf', vf, '-frames:v', '1', '-q:v', '6', '-f', 'mjpeg', 'pipe:1'], null, 60000)).catch(() => null)
    queue = job
    sheets.set(id, job)
    if (!final) job.then(b => { if (!b && sheets.get(id) === job) sheets.delete(id) })
    if (sheets.size > 64) sheets.delete(sheets.keys().next().value)
  }
  return sheets.get(id)
}
