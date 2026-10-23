// Applies an automatic subtitle sync result (see src/sync.js). Shared by the server (to fix HLS subtitle tracks) and the player.
// A subtitle time t belongs at  t * ratio + offset(t * ratio)  in the film.
export function fitLine (pts) {
  const n = pts.length; const mt = pts.reduce((s, p) => s + p.t, 0) / n; const md = pts.reduce((s, p) => s + p.d, 0) / n
  let num = 0; let den = 0; for (const p of pts) { num += (p.t - mt) * (p.d - md); den += (p.t - mt) ** 2 }
  const b = den ? num / den : 0
  return { a: md - b * mt, b }
}

export function offsetAt (anchors, model, w) {
  if (!anchors.length) return 0
  if (anchors.length === 1) return anchors[0].d
  if (model === 'linear') { const l = fitLine(anchors); return l.a + l.b * w }
  if (w <= anchors[0].t) return anchors[0].d
  for (let i = 1; i < anchors.length; i++) if (w <= anchors[i].t) { const a = anchors[i - 1]; const b = anchors[i]; return a.d + (b.d - a.d) * (w - a.t) / (b.t - a.t) }
  return anchors.at(-1).d
}

export function mapTime (res, t) {
  const w = t * res.ratio
  return w + offsetAt(res.anchors, res.model, w)
}

const median = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
export const isLine = pts => { if (pts.length < 3) return pts.length === 2; const l = fitLine(pts); return pts.every(p => Math.abs(p.d - (l.a + l.b * p.t)) < 0.2) }

// Speech trails the start of its subtitle by a fraction of a second, so a tiny constant offset is measurement, not error.
export function classify (points, ratio = 1) {
  const pts = [...points].sort((a, b) => a.t - b.t)
  // Two windows that differ by measurement noise are one offset: a line through them would extrapolate that noise over the whole film.
  const km = pts.length === 2 ? (pts[0].d + pts[1].d) / 2 : median(pts.map(p => p.d)); const spread = Math.max(...pts.map(p => Math.abs(p.d - km)))
  if (spread < 0.3) return { model: 'constant', anchors: [{ t: 0, d: Math.abs(km) < 0.3 && ratio === 1 ? 0 : km }] }
  return { model: isLine(pts) ? 'linear' : 'piecewise', anchors: pts }
}
