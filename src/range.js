// HTTP range responses for anything that can open a byte-range stream (torrent files, local files).
export function sendRange (req, res, { length, type, stream }) {
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '')
  let start = 0; let end = length - 1
  if (m) {
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end) } else if (m[2]) start = Math.max(0, length - +m[2])
    if (start > end) { res.writeHead(416, { 'content-range': `bytes */${length}` }).end(); return }
  }
  res.writeHead(m ? 206 : 200, {
    'content-type': type,
    'accept-ranges': 'bytes',
    'content-length': end - start + 1,
    ...(m && { 'content-range': `bytes ${start}-${end}/${length}` })
  })
  const s = stream(start, end)
  s.on('error', () => res.destroy())
  res.on('close', () => s.destroy())
  s.pipe(res)
}

export const MIME = { mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo', mov: 'video/quicktime', ts: 'video/mp2t' }
