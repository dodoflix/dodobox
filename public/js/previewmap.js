// Where each frame of a video's seek-bar preview sheet sits; the server draws the sheet and the player reads it with the same numbers.
export const previewLayout = duration => {
  const step = Math.max(10, Math.ceil((duration || 0) / 240))
  const n = Math.max(1, Math.ceil((duration || 0) / step))
  const cols = Math.min(10, n)
  return { step, n, cols, rows: Math.ceil(n / cols), w: 192, h: 108 }
}
