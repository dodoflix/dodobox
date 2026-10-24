// Mbps a forced setting needs to run well, from the same thresholds the player uses to cap quality on a slow link.
const NEED = { 2160: 30, 1080: 15, 720: 7 }
const LOSSLESS_NEED = 40
const LABEL = { 2160: '4K', 1080: '1080p', 720: '720p' }

// A forced quality or size that the measured connection cannot carry: the viewer sees buffering or a slow start and cannot tell why. Auto and Balanced adapt on their own, so they never warn.
// serverMbps: the server's internet (downloads the file). linkMbps: this device's link (streams it). 0 means unknown.
export function netWarnings ({ quality, mode, serverMbps = 0, linkMbps = 0 }, { size = true } = {}) {
  const out = []
  const need = NEED[quality]
  if (need && serverMbps && serverMbps < need) out.push({ text: `${LABEL[quality]} means a very large download, and this server's internet is about ${serverMbps} Mbps. Playback will start late and may pause.`, k: 'quality', v: 'auto', label: 'Use Auto' })
  if (need && linkMbps && linkMbps < need) out.push({ text: `${LABEL[quality]} needs about ${need} Mbps and this device measures ${linkMbps}. The picture will keep buffering.`, k: 'quality', v: 'auto', label: 'Use Auto' })
  if (size && mode === 'lossless' && serverMbps && serverMbps < LOSSLESS_NEED) out.push({ text: `Best quality accepts files of tens of GB, and this server's internet is about ${serverMbps} Mbps. Downloads will be slow.`, k: 'sourceMode', v: 'balanced', label: 'Use Balanced' })
  return out
}

// No util.js import: the module stays loadable by the unit test.
export const notesHTML = list => list.map(w => `<div class="netnote" role="status"><svg class="i" aria-hidden="true"><use href="#i-speed"/></svg><p>${w.text}</p><button class="netfix" data-fix="${w.k}:${w.v}">${w.label}</button></div>`).join('')
