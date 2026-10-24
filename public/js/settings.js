import { api, NOW } from './api.js'
import { S, setSetting } from './session.js'
import { $, esc, icon, bytes, store, isTV, toast } from './util.js'
import { calm } from './ambient.js'
import { showPicker } from './profiles.js'
import { LANGUAGES, langOf, SOURCE_MODES } from './onboarding.js'
import { netWarnings, notesHTML } from './netwarn.js'
import { bandwidth } from './bandwidth.js'
import { upgradeSelects, syncSelect } from './dropdown.js'
import { uiLangFor } from './i18n.js'
import { pingPresence } from './presence.js'
import { changePin } from './pin.js'
import { accountStatus, accountRow, connectAccount } from './opensubs.js'

const SUBS = [['off', 'Off'], ...LANGUAGES.map(([, c, n]) => [c, n]), ['pob', 'Português (Brasil)']]
const CAPS = [20, 40, 100, 250, 500, 1000]
// The PIN row: what is protected and the buttons for the state the profile is in.
const pinRow = me => `<div class="l"><b>PIN code</b><span>${me.hasPin ? 'On. Anyone opening this profile is asked for it.' : 'Off. Set one to keep your list, history and settings private.'} Downloads stay open to everyone.</span></div>
  <div class="pin-actions">${me.hasPin ? '<button class="btn btn-ghost sm" data-pin="change">Change</button><button class="btn btn-ghost sm" data-pin="remove">Remove</button>' : '<button class="btn btn-ghost sm" data-pin="set">Set a PIN</button>'}</div>`
const seg = (name, opts, cur) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`

let stopPolling = () => {}
export async function settings (root) {
  stopPolling() // a redraw of the page replaces the previous one's follow-up calls
  calm()
  // Scoped to the page: leaving before they arrive cancels them, so a slow page cannot draw over the one that replaced it.
  const get = path => api(path, { ref: { prio: NOW } })
  const [srv, g, st, os] = await Promise.all([get('/api/server'), get('/api/settings'), get('/api/storage'), get('/api/opensubtitles').catch(e => { if (e.name === 'AbortError') throw e; return { user: null } })])
  const me = S.me
  const url = srv.urls[0] || `http://localhost:${srv.port}`
  const dirs = srv.mediaDirs
  root.innerHTML = `<div class="view page">
    <div class="page-h prof"><span class="avatar big" style="--c:${esc(me.color)}" aria-hidden="true">${esc(me.name[0].toUpperCase())}</span><h1 translate="no">${esc(me.name)}</h1><button class="btn btn-ghost sm" id="switch">${icon('user')}Switch profile</button></div>
    <div class="cols"><div class="col">
    <div class="group"><h3>Playback</h3>
      <div class="set"><div class="l"><b>Language</b><span>Titles and descriptions are translated when a translation exists.</span></div>
        <select class="field" id="lang">${LANGUAGES.map(([c, , n]) => `<option value="${c}" ${c === me.settings.lang ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="set"><div class="l"><b>Subtitles</b><span>Turned on automatically when this language is available.</span></div>
        <select class="field" data-k="sublang">${SUBS.map(([c, n]) => `<option value="${c}" ${c === me.settings.sublang ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="set"><div class="l"><b>Interests</b><span>Your home screen leads with these.</span></div>
        <div class="seg" id="interests">${[['movie', 'Movies'], ['series', 'Series'], ['anime', 'Anime']].map(([t, n]) => `<button data-t="${t}" class="${(me.settings.interests || []).includes(t) ? 'on' : ''}">${n}</button>`).join('')}</div></div>
      <div class="set"><div class="l"><b>Video quality</b><span>Auto picks the best version your connection and screen can use${srv.internetMbps ? ` (this server's internet: about ${srv.internetMbps} Mbps)` : ''}. Choose a level to force it.</span></div>
        ${seg('quality', [['auto', 'Auto'], ['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', 'Data saver']], ['best'].includes(me.settings.quality) ? 'auto' : me.settings.quality)}<div class="netnotes" id="nn-quality"></div></div>
      <div class="set"><div class="l"><b>Download size</b><span>Smallest starts fastest. Balanced avoids huge files. Best quality accepts very large files.</span></div>
        ${seg('sourceMode', SOURCE_MODES, me.settings.sourceMode || 'compact')}<div class="netnotes" id="nn-size"></div></div>
      <div class="set"><div class="l"><b>Adult content filter</b><span>Hide titles that are marked as adult. Off by default.</span></div>
        <button class="switch" role="switch" data-k="adultFilter" aria-checked="${!!me.settings.adultFilter}" aria-label="Adult content filter"></button></div>
      <div class="set"><div class="l"><b>Best translation quality</b><span>Auto-translated subtitles use a larger translator. It downloads about 2 GB the first time, and each subtitle improves gradually while you watch.</span><span id="hqstat" class="dim"></span></div>
        <button class="switch" role="switch" data-k="bestTranslation" aria-checked="${!!me.settings.bestTranslation}" aria-label="Best translation quality"></button></div>
    </div>

    <div class="group"><h3>Subtitles</h3>
      <div class="set" id="osrow">${accountRow(os)}</div>
    </div>

    <div class="group"><h3>Profile lock</h3>
      <div class="set" id="pinrow">${pinRow(me)}</div>
    </div>

    <div class="group"><h3>Discord</h3>
      <div class="set"><div class="l"><b>Discord presence</b><span>Show what you are watching in Discord, when it runs on this computer.</span></div>
        <button class="switch" role="switch" data-k="discordPresence" aria-checked="${me.settings.discordPresence !== false}" aria-label="Discord presence"></button></div>
    </div>

    </div><div class="col">
    <div class="group"><h3>Connect a phone or TV</h3>
      <div class="connect"><img alt="QR code for ${esc(url)}" src="/api/qr.svg?text=${encodeURIComponent(url)}">
        <div><b>Scan with a phone camera, or type:</b><code>${esc(url)}</code>${srv.urls.slice(1).map(u => `<code class="dim">${esc(u)}</code>`).join('')}
        <ol class="steps"><li><b>Phone:</b> open the link, then Share, Add to Home Screen.</li><li><b>TV or Android TV:</b> open the browser and enter the address, or cast from your phone with the cast button in the player.</li><li><b>Apple TV:</b> play on iPhone, iPad or Mac in Safari and tap the AirPlay button.</li></ol></div></div>
    </div>

    <div class="group"><h3>Storage</h3>
      <div class="meter"><i style="width:${Math.min(100, st.used / st.cap * 100)}%"></i></div>
      <div class="set"><div class="l"><b>${bytes(st.used)} used</b><span>Dodobox removes the oldest downloads first when the limit is reached.</span></div>
        <select class="field" data-g="maxStorageGB">${CAPS.map(c => `<option value="${c}" ${c === g.maxStorageGB ? 'selected' : ''}>${c >= 1000 ? c / 1000 + ' TB' : c + ' GB'} limit</option>`).join('')}</select></div>
    </div>

    <div class="group"><h3>Sharing</h3>
      <div class="set"><div class="l"><b>Share while downloading</b><span>Lets other people on the torrent network download from this computer. Off keeps your upload line free for games and calls. Some downloads may start a little slower.</span></div>
        <button class="switch" role="switch" data-g="shareUploads" aria-checked="${!!g.shareUploads}" aria-label="Share while downloading"></button></div>
    </div>

    <div class="group"><h3>Your own files</h3>
      <div class="set"><div class="l"><b>${srv.localCount} titles found</b><span>${dirs.length ? 'Looking in: ' + dirs.map(esc).join(', ') : 'Dodobox checks your Videos and Movies folders automatically.'}</span></div>
        <button class="btn btn-ghost sm" id="rescan">${icon('refresh')}Scan now</button></div>
      <form class="set" id="addDir"><input class="field grow" name="dir" placeholder="Add another folder, e.g. /media/movies"><button class="btn btn-ghost sm" type="submit">${icon('plus')}Add</button></form>
    </div>

    <div class="group"><h3>This device</h3>
      <div class="set"><div class="l"><b>TV layout</b><span>Larger text and remote-control navigation. Turned on automatically on most smart TVs.</span></div>
        <button class="switch" role="switch" id="tv" aria-checked="${isTV}" aria-label="TV layout"></button></div>
      <div class="set"><div class="l"><b>Dodobox ${esc(srv.version)}</b><span>Video encoder: ${esc(srv.encoder === 'libx264' ? 'software' : srv.encoder)}${srv.update ? ` · <a href="${esc(srv.update.url)}" target="_blank" rel="noreferrer">Version ${esc(srv.update.version)} is available</a>` : ''}</span></div></div>
    </div>
    </div></div>
  </div>`

  upgradeSelects(root)
  const drawNotes = () => {
    const w = netWarnings({ quality: S.me.settings.quality, mode: S.me.settings.sourceMode || 'compact', serverMbps: srv.internetMbps, linkMbps: bandwidth() })
    $('#nn-quality').innerHTML = notesHTML(w.filter(x => x.k === 'quality'))
    $('#nn-size').innerHTML = notesHTML(w.filter(x => x.k === 'sourceMode'))
  }
  drawNotes()
  root.onchange = async e => {
    const t = e.target
    if (t.id === 'lang') {
      await setSetting('lang', t.value)
      store.set('ui', uiLangFor(t.value))
      if (me.settings.sublang !== 'off') { await setSetting('sublang', langOf(t.value)[1]); const sl = root.querySelector('[data-k="sublang"]'); sl.value = langOf(t.value)[1]; syncSelect(sl) }
      if (uiLangFor(t.value) !== document.documentElement.lang) location.reload()
      return
    }
    if (t.dataset.k) setSetting(t.dataset.k, t.value)
    if (t.dataset.g) { await api('/api/settings', { method: 'PUT', body: { [t.dataset.g]: +t.value } }) }
  }
  // The translator install is followed with a few calls spaced further and further apart, only while this page is open; it gives up after a while.
  let dead = false; let pollT; let polls = 0
  async function hqStatus (start) {
    clearTimeout(pollT)
    const el = $('#hqstat'); if (dead || !el || !root.contains(el)) return
    if (start !== false) polls = 0
    let r = await api('/api/translate/better', start ? { method: 'POST' } : {}).catch(() => null)
    if (r?.state === 'idle' && start === undefined && me.settings.bestTranslation) r = await api('/api/translate/better', { method: 'POST' }).catch(() => null)
    const on = !!S.me.settings.bestTranslation
    el.textContent = !on || !r ? '' : r.state === 'ready' ? (r.device === 'gpu' ? 'Installed and ready, using the graphics card' : 'Installed and ready') : r.state === 'installing' || r.state === 'idle' ? `Installing... ${Math.round((r.pct || 0) * 100)}%` : 'Could not install. Check the internet connection, then switch it off and on.'
    // 'idle' right after switching on means the install is about to start; if it stays idle it is not going to, so stop asking.
    if (on && r && (r.state === 'installing' || (r.state === 'idle' && polls < 4)) && ++polls < 60) pollT = setTimeout(() => hqStatus(false), Math.min(8000, 1000 + polls * 500))
  }
  if (me.settings.bestTranslation) hqStatus()
  root.onclick = async e => {
    const sw = e.target.closest('.switch')
    if (sw && sw.dataset.g) { const v = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', v); api('/api/settings', { method: 'PUT', body: { [sw.dataset.g]: v } }); return }
    if (sw && sw.dataset.k) { const v = sw.getAttribute('aria-checked') !== 'true'; sw.setAttribute('aria-checked', v); setSetting(sw.dataset.k, v); if (sw.dataset.k === 'bestTranslation') hqStatus(v); if (sw.dataset.k === 'discordPresence') pingPresence() }
    if (sw && sw.id === 'tv') { const v = sw.getAttribute('aria-checked') !== 'true'; store.set('tv', v); location.reload() }
    const it = e.target.closest('#interests button')
    if (it) { it.classList.toggle('on'); setSetting('interests', [...root.querySelectorAll('#interests .on')].map(b => b.dataset.t)); return }
    const sg = e.target.closest('[data-seg] button')
    if (sg) { const k = sg.parentElement.dataset.seg; setSetting(k, sg.dataset.v); sg.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === sg)); drawNotes() }
    const fx = e.target.closest('[data-fix]')
    if (fx) {
      const [k, v] = fx.dataset.fix.split(':'); setSetting(k, v)
      root.querySelectorAll(`[data-seg="${k}"] button`).forEach(b => b.classList.toggle('on', b.dataset.v === v))
      drawNotes()
    }
    const ob = e.target.closest('[data-os]')
    if (ob) {
      if (ob.dataset.os === 'remove') await api('/api/opensubtitles', { method: 'DELETE' })
      else if (!await connectAccount()) return
      $('#osrow').innerHTML = accountRow(await accountStatus())
      toast(ob.dataset.os === 'remove' ? 'OpenSubtitles disconnected' : 'OpenSubtitles connected')
    }
    const pb = e.target.closest('[data-pin]')
    if (pb) { if (await changePin(me, { remove: pb.dataset.pin === 'remove' })) { $('#pinrow').innerHTML = pinRow(me); toast(me.hasPin ? 'PIN saved' : 'PIN removed') } }
    if (e.target.closest('#switch')) { await showPicker({ dismissable: true }); location.hash = '#/'; location.reload() }
    if (e.target.closest('#rescan')) { const b = e.target.closest('#rescan'); b.disabled = true; b.textContent = 'Scanning...'; const r = await api('/api/local/rescan', { method: 'POST' }); b.textContent = `${r.count} titles found` }
  }
  $('#addDir').onsubmit = async e => {
    e.preventDefault()
    const d = e.target.dir.value.trim(); if (!d) return
    await api('/api/settings', { method: 'PUT', body: { mediaDirs: [...new Set([...dirs, d])] } })
    settings(root)
  }
  stopPolling = () => { dead = true; clearTimeout(pollT) }
  return () => stopPolling()
}
