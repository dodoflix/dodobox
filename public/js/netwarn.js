// Mbps the device link needs to stream a forced level: the same thresholds the player uses to cap quality on a slow link.
const LINK_NEED = { 2160: 30, 1080: 15, 720: 7 }
// A swarm rarely fills the line, so the server's internet is judged at about 45% of its measured speed: the Mbps its line needs is the files' bitrate divided by that.
// Forced levels average roughly 8 Mbps at 1080p and 14 to 25 at 4K. Balanced takes files up to 7.5 Mbps (1080p) or 17.5 (4K); a disc remux runs 30 to 40.
const SERVER_NEED = { 2160: 50, 1080: 20, 720: 9 }
const SIZE_NEED = { balanced: 20, lossless: 80 }
const LABEL = { 2160: '4K', 1080: '1080p', 720: '720p' }

// A forced quality or size that the measured connection cannot carry: the viewer sees buffering or a slow start and cannot tell why. Auto adapts on its own and Smallest is the floor, so neither warns.
// serverMbps: the server's internet (downloads the file). linkMbps: this device's link (streams it). 0 means unknown.
export function netWarnings ({ quality, mode, serverMbps = 0, linkMbps = 0 }, { size = true } = {}) {
  const out = []
  const serverNeed = SERVER_NEED[quality]; const linkNeed = LINK_NEED[quality]
  if (serverNeed && serverMbps && serverMbps < serverNeed) out.push({ text: `${LABEL[quality]} means a very large download, and this server's internet is about ${serverMbps} Mbps. Playback will start late and may pause.`, k: 'quality', v: 'auto', label: 'Use Auto' })
  if (linkNeed && linkMbps && linkMbps < linkNeed) out.push({ text: `${LABEL[quality]} needs about ${linkNeed} Mbps and this device measures ${linkMbps}. The picture will keep buffering.`, k: 'quality', v: 'auto', label: 'Use Auto' })
  const sizeNeed = SIZE_NEED[mode]
  if (size && sizeNeed && serverMbps && serverMbps < sizeNeed) {
    const to = mode === 'lossless' && serverMbps >= SIZE_NEED.balanced ? 'balanced' : 'compact'
    const text = mode === 'lossless' ? `Best quality accepts files of tens of GB, and this server's internet is about ${serverMbps} Mbps. Downloads will be slow.` : `Balanced picks files that need about ${sizeNeed} Mbps, and this server's internet is about ${serverMbps} Mbps. Downloads will be slow.`
    out.push({ text, k: 'sourceMode', v: to, label: to === 'balanced' ? 'Use Balanced' : 'Use Smallest' })
  }
  return out
}

// No util.js import: the module stays loadable by the unit test.
// Notes that offer the same fix are one problem for the user: only the first is shown.
export const notesHTML = list => list.filter((w, i) => list.findIndex(x => x.k === w.k && x.v === w.v) === i).map(w => `<div class="netnote" role="status"><svg class="i" aria-hidden="true"><use href="#i-speed"/></svg><p>${w.text}</p><button class="netfix" data-fix="${w.k}:${w.v}">${w.label}</button></div>`).join('')
