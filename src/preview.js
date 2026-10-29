// Seek-bar preview: one JPEG sheet of small frames for a whole video, taken from its keyframes.
import { run } from './transcode.js'
import { previewLayout } from '../public/js/previewmap.js'

const sheets = new Map() // key -> Promise of the JPEG, or null when ffmpeg could not make it (not retried)
let queue = Promise.resolve() // one sheet at a time, so playback keeps the processor

export function sheet (url, key, duration) {
  if (!sheets.has(key)) {
    const { step, cols, rows, w, h } = previewLayout(duration)
    const vf = `fps=1/${step},scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,tile=${cols}x${rows}`
    const job = queue.then(() => run(['-threads', '1', '-skip_frame', 'nokey', '-i', url, '-an', '-sn', '-vf', vf, '-frames:v', '1', '-q:v', '6', '-f', 'mjpeg', 'pipe:1'], null, 180000)).catch(() => null)
    queue = job
    sheets.set(key, job)
    if (sheets.size > 16) sheets.delete(sheets.keys().next().value)
  }
  return sheets.get(key)
}
