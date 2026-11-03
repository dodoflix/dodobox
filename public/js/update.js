// A small card when a newer release exists. Where this build can update itself (the desktop app, from the computer it runs on) the
// update is started from here; everywhere else it says what to do.
import { $, esc, store } from './util.js'
import { api } from './api.js'

let box = null
let timer
let restarting = false

const get = () => api('/api/update').catch(() => null)
const ask = force => api(`/api/update/check${force ? '?force=1' : ''}`, { method: 'POST' }).catch(() => null)
// "Later" puts the notice off for a day, not for good: { v: version, until: time }.
const later = () => store.get('upd-later', null)
const hidden = u => u.phase === 'available' && later()?.v === u.version && Date.now() < later().until

function paint (u) {
  if (restarting) return
  // While an update waits, also when its notice was put off, the profile button carries a dot.
  $('#me-btn')?.classList.toggle('upd', !!u && u.phase !== 'idle')
  if (!u || u.phase === 'idle' || hidden(u)) { box?.remove(); box = null; return }
  if (!box) { box = document.createElement('div'); box.id = 'upd'; box.setAttribute('role', 'status'); document.body.append(box) }
  const link = `<a href="${esc(u.url || '#')}" target="_blank" rel="noreferrer">Release notes</a>`
  const bar = `<div class="hair"><i style="--p:${(u.progress || 0) / 100}"></i></div>`
  box.innerHTML = {
    available: `<div class="t"><b>Dodobox ${esc(u.version)} is available</b><span><span>You have ${esc(u.current)}.</span> ${u.canApply ? '' : `<span>${esc(u.hint)}</span>`} ${link}</span></div>
      <div class="acts">${u.canApply ? '<button class="btn btn-ink sm" data-a="download">Update now</button>' : `<a class="btn btn-ink sm" href="${esc(u.url || '#')}" target="_blank" rel="noreferrer">Download</a>`}<button class="btn btn-quiet sm" data-a="hide">Later</button></div>`,
    downloading: `<div class="t"><b>Downloading the update...</b><span>${u.progress || 0}%</span></div>${bar}`,
    ready: `<div class="t"><b>The update is ready</b><span>Dodobox restarts to finish it.</span></div><div class="acts"><button class="btn btn-ink sm" data-a="install">Restart to update</button></div>`,
    error: `<div class="t"><b>The update did not work</b><span>${u.error ? esc(u.error) : '<span>Something went wrong.</span>'} ${link}</span></div><div class="acts">${u.canApply ? '<button class="btn btn-ink sm" data-a="download">Try again</button>' : ''}<button class="btn btn-quiet sm" data-a="hide">Close</button></div>`
  }[u.phase] || ''
}

// check: ask the server to look the release up (it reuses a recent answer), as the page does when it opens or comes back into view.
async function refresh (check) {
  clearTimeout(timer)
  const u = await (check ? ask() : get())
  paint(u)
  // Quickly while a download runs, now and then otherwise.
  timer = setTimeout(refresh, u?.phase === 'downloading' ? 1000 : 10 * 60e3)
}

// The server goes away and comes back with the new version: reload when it does.
async function waitForRestart () {
  restarting = true
  if (box) box.innerHTML = '<div class="t"><b>Restarting Dodobox...</b><span>This page reloads by itself.</span></div>'
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

// Settings' "Check for updates": looks now, and shows a version found this way even when its notice was put off.
export async function checkNow () {
  const u = await ask(true)
  if (u) { store.set('upd-later', null); paint(u) }
  return u
}

export function initUpdates () {
  try { localStorage.removeItem('upd-hidden') } catch {} // "Later" from before it was a snooze
  document.addEventListener('click', async e => {
    const b = e.target.closest('#upd [data-a]'); if (!b) return
    const a = b.dataset.a
    if (a === 'hide') { store.set('upd-later', { v: (await get())?.version, until: Date.now() + 24 * 3600e3 }); box?.remove(); box = null; return }
    b.disabled = true
    try {
      paint(await api(`/api/update/${a}`, { method: 'POST' }))
      if (a === 'install') waitForRestart(); else refresh()
    } catch (err) { b.disabled = false; $('#upd .t span').textContent = err.message }
  })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(true) })
  setTimeout(() => refresh(true), 3000)
}
