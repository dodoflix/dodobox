// Where each frame of a video's seek-bar preview sits. The frames come in sections of `per`, each its own JPEG, so the first ones can be
// shown while the rest are still being made; the server draws them and the player reads them with the same numbers.
export const previewLayout = duration => {
  const step = Math.max(10, Math.ceil((duration || 0) / 240))
  const n = Math.max(1, Math.ceil((duration || 0) / step))
  const per = 10
  return { step, n, per, chunks: Math.ceil(n / per), w: 192, h: 108 }
}
// How section k is laid out: its frames in rows of up to 10
export const chunkShape = (L, k) => {
  const count = Math.min(L.per, L.n - k * L.per)
  const cols = Math.min(10, count)
  return { count, cols, rows: Math.ceil(count / cols) }
}
