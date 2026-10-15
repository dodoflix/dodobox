// A small card when a newer release exists. Where this build can update itself (the desktop app, from the computer it runs on) the
// update is started from here; everywhere else it says what to do.
import { $, esc, store } from './util.js'
import { api } from './api.js'

let box = null
let timer
let restarting = false

const get = () => api('/api/update').catch(() => null)
const hidden = u => u.phase === 'available' && store.get('upd-hidden', '') === u.version

function paint (u) {
  if (restarting) return
  if (!u || u.phase === 'idle' || hidden(u)) { box?.remove(); box = null; return }
  if (!box) { box = document.createElement('div'); box.id = 'upd'; box.setAttribute('role', 'status'); document.body.append(box) }
  const link = `<a href="${esc(u.url || '#')}" target="_blank" rel="noreferrer">Release notes</a>`
  const bar = `<div class="hair"><i style="width:${u.progress || 0}%"></i></div>`
  box.innerHTML = {
    available: `<b>Dodobox ${esc(u.version)} is available</b><span>You have ${esc(u.current)}. ${u.canApply ? '' : esc(u.hint)} ${link}</span>
      <div class="acts">${u.canApply ? '<button class="btn btn-ink sm" data-a="download">Update now</button>' : `<a class="btn btn-ink sm" href="${esc(u.url || '#')}" target="_blank" rel="noreferrer">Download</a>`}<button class="btn btn-quiet sm" data-a="hide">Later</button></div>`,
    downloading: `<b>Downloading the update...</b><span>${u.progress || 0}%</span>${bar}`,
    ready: `<b>The update is ready</b><span>Dodobox restarts to finish it.</span><div class="acts"><button class="btn btn-ink sm" data-a="install">Restart to update</button></div>`,
    error: `<b>The update did not work</b><span>${esc(u.error || 'Something went wrong.')} ${link}</span><div class="acts">${u.canApply ? '<button class="btn btn-ink sm" data-a="download">Try again</button>' : ''}<button class="btn btn-quiet sm" data-a="hide">Close</button></div>`
  }[u.phase] || ''
}

async function refresh () {
  clearTimeout(timer)
  const u = await get()
  paint(u)
  // Quickly while a download runs, now and then otherwise.
  timer = setTimeout(refresh, u?.phase === 'downloading' ? 1000 : 10 * 60e3)
}

// The server goes away and comes back with the new version: reload when it does.
async function waitForRestart () {
  restarting = true
  if (box) box.innerHTML = '<b>Restarting Dodobox...</b><span>This page reloads by itself.</span>'
  let down = false
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 1500))
    const up = await fetch('/api/health', { cache: 'no-store' }).then(r => r.ok, () => false)
    if (!up) down = true
    else if (down) return location.reload()
  }
  restarting = false
  refresh()
}

export function initUpdates () {
  document.addEventListener('click', async e => {
    const b = e.target.closest('#upd [data-a]'); if (!b) return
    const a = b.dataset.a
    if (a === 'hide') { store.set('upd-hidden', (await get())?.version); box?.remove(); box = null; return }
    b.disabled = true
    try {
      paint(await api(`/api/update/${a}`, { method: 'POST' }))
      if (a === 'install') waitForRestart(); else refresh()
    } catch (err) { b.disabled = false; $('#upd span').textContent = err.message }
  })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh() })
  setTimeout(refresh, 3000)
}
