// First-run flows: once per device (layout tuning) and once per profile (language, subtitles, taste).
import { $, esc, icon, store, isTV, ua } from './util.js'
import { S, setSetting } from './session.js'
import { focusFirst } from './nav.js'
import { upgradeSelects } from './dropdown.js'
import { uiLangFor } from './i18n.js'
import { changePin } from './pin.js'
import { api, cget } from './api.js'
import { netWarnings, notesHTML } from './netwarn.js'

export const LANGUAGES = [['en', 'eng', 'English'], ['tr', 'tur', 'Türkçe'], ['es', 'spa', 'Español'], ['fr', 'fre', 'Français'], ['de', 'ger', 'Deutsch'], ['it', 'ita', 'Italiano'], ['pt', 'por', 'Português'], ['ru', 'rus', 'Русский'], ['ar', 'ara', 'العربية'], ['ja', 'jpn', '日本語'], ['ko', 'kor', '한국어'], ['zh', 'chi', '中文'], ['nl', 'dut', 'Nederlands'], ['pl', 'pol', 'Polski'], ['id', 'ind', 'Indonesia'], ['hi', 'hin', 'हिन्दी'], ['vi', 'vie', 'Tiếng Việt'], ['el', 'ell', 'Ελληνικά'], ['he', 'heb', 'עברית'], ['sv', 'swe', 'Svenska']]
export const SOURCE_MODES = [['compact', 'Smallest'], ['balanced', 'Balanced'], ['lossless', 'Best quality']]
export const langOf = code => LANGUAGES.find(l => l[0] === code) || LANGUAGES[0]

const layer = () => $('#layer')
function stage (html, step, total) {
  const l = layer(); l.className = 'onboard'; l.hidden = false
  l.innerHTML = `<div class="picker ob" data-modal>${html}<div class="ob-dots" aria-hidden="true">${Array.from({ length: total }, (_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('')}</div></div>`
  focusFirst(l)
  return l
}
const done = () => { const l = layer(); l.hidden = true; l.innerHTML = ''; l.className = '' }

// The device is detected, never asked: a TV user agent means TV, a touch screen under tablet size means phone.
export function detectDevice () {
  let d = store.get('device')
  if (!d) {
    d = isTV ? 'tv' : (matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900) ? 'phone' : 'computer'
    store.set('device', d)
  }
  return d
}

export function installTip () {
  if (store.get('device') !== 'phone' || store.get('tipShown') || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return
  store.set('tipShown', true)
  const ios = /iPhone|iPad|iPod/.test(ua)
  setTimeout(() => {
    const el = document.createElement('div')
    el.id = 'a2hs'; el.setAttribute('role', 'status')
    el.innerHTML = `<span class="ico">${icon('phone')}</span><span class="t">${ios ? 'Tip: tap Share, then Add to Home Screen, to open Dodobox like an app.' : 'Tip: open the browser menu and choose Add to Home screen.'}</span><button class="icon-btn" aria-label="Close">${icon('close')}</button>`
    el.querySelector('button').onclick = () => el.remove()
    document.body.append(el)
  }, 4000)
}

export async function profileOnboarding () {
  const guess = (navigator.language || 'en').slice(0, 2)
  let lang = langOf(S.me.settings.lang !== 'en' ? S.me.settings.lang : guess)[0]
  let subs = lang !== 'en'
  const interests = new Set(S.me.settings.interests || [])
  let mode = S.me.settings.sourceMode || 'compact'
  let adult = !!S.me.settings.adultFilter
  let discord = S.me.settings.discordPresence !== false
  let share = await api('/api/settings').then(x => !!x.shareUploads, () => false)
  const serverMbps = await cget('/api/server', 60e3).then(x => x.internetMbps || 0, () => 0)
  const sizeNote = () => notesHTML(netWarnings({ mode, serverMbps }).filter(w => w.k === 'sourceMode'))
  // Three short pages instead of one long one: language, taste, privacy. Choices live in the variables above, so Back never loses one.
  const chips = (list, on, attr) => list.map(([v, n]) => `<button class="chip ${on(v) ? 'on' : ''}" data-${attr}="${v}" aria-pressed="${on(v)}">${n}</button>`).join('')
  const PAGES = [
    { title: () => `Hi ${esc(S.me.name)}, make it yours`, rows: () => `
        <label class="ob-row"><span><b>Language</b><small>Titles, descriptions and subtitles use it when available.</small></span>
          <select class="field" id="ob-lang">${LANGUAGES.map(([c, , n]) => `<option value="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div class="ob-row"><span><b>Show subtitles</b><small>Turned on automatically when they exist.</small></span>
          <button class="switch" role="switch" id="ob-subs" aria-checked="${subs}" aria-label="Show subtitles"></button></div>` },
    { title: () => 'What do you like?', rows: () => `
        <div class="ob-row stack"><span><b>Your taste</b><small>Pick any. Your home screen starts with these.</small></span>
          <div class="chips">${chips([['movie', 'Movies'], ['series', 'Series'], ['anime', 'Anime']], v => interests.has(v), 'i')}</div></div>
        <div class="ob-row stack"><span><b>Download size</b><small>Smallest starts fastest. Balanced avoids huge files. Best quality accepts very large files.</small></span>
          <div class="chips">${chips(SOURCE_MODES, v => v === mode, 'm')}</div><div class="netnotes" id="nn-size">${sizeNote()}</div></div>` },
    { title: () => 'Your privacy', rows: () => `
        <div class="ob-row"><span><b>PIN code</b><small>Optional. Keeps your list, history and settings private: it is asked when someone opens this profile. Downloads stay open to everyone.</small></span>
          <button class="btn btn-ghost sm" id="ob-pin">${S.me.hasPin ? 'Change' : 'Set a PIN'}</button></div>
        <div class="ob-row"><span><b>Adult content filter</b><small>Hide titles that are marked as adult. Off by default.</small></span>
          <button class="switch" role="switch" id="ob-adult" aria-checked="${adult}" aria-label="Adult content filter"></button></div>
        <div class="ob-row"><span><b>Discord presence</b><small>Show what you are watching in Discord, when it runs on this computer.</small></span>
          <button class="switch" role="switch" id="ob-discord" aria-checked="${discord}" aria-label="Discord presence"></button></div>
        <div class="ob-row"><span><b>Share while downloading</b><small>Lets other people on the torrent network download from this computer. Off keeps your upload line free for games and calls. Some downloads may start a little slower.</small></span>
          <button class="switch" role="switch" id="ob-share" aria-checked="${share}" aria-label="Share while downloading"></button></div>` }
  ]
  let page = 0
  const draw = () => {
    const last = page === PAGES.length - 1
    const l = stage(`<h1>${PAGES[page].title()}</h1>
      <div class="ob-form">${PAGES[page].rows()}</div>
      <div class="actions">${page ? '<button class="btn btn-quiet" data-back>Back</button>' : ''}<button class="btn btn-ink" data-next data-autofocus>${last ? 'Start watching' : 'Next'}</button></div>`, page, PAGES.length)
    upgradeSelects(l)
    return l
  }
  const l = draw()
  await new Promise(resolve => {
    l.onchange = e => { if (e.target.id === 'ob-lang') { lang = e.target.value; subs = lang !== 'en' || subs; $('#ob-subs', l).setAttribute('aria-checked', subs) } }
    l.onclick = e => {
      const sw = e.target.closest('#ob-subs'); if (sw) { subs = !subs; sw.setAttribute('aria-checked', subs) }
      const c = e.target.closest('[data-i]'); if (c) { interests.has(c.dataset.i) ? interests.delete(c.dataset.i) : interests.add(c.dataset.i); c.classList.toggle('on'); c.setAttribute('aria-pressed', interests.has(c.dataset.i)) }
      const ad = e.target.closest('#ob-adult'); if (ad) { adult = !adult; ad.setAttribute('aria-checked', adult) }
      const pn = e.target.closest('#ob-pin'); if (pn) changePin(S.me).then(ok => { if (ok) pn.textContent = S.me.hasPin ? 'Change' : 'Set a PIN' })
      const dc = e.target.closest('#ob-discord'); if (dc) { discord = !discord; dc.setAttribute('aria-checked', discord) }
      const sh = e.target.closest('#ob-share'); if (sh) { share = !share; sh.setAttribute('aria-checked', share) }
      const mb = e.target.closest('[data-m]'); if (mb) { mode = mb.dataset.m; l.querySelectorAll('[data-m]').forEach(x => { x.classList.toggle('on', x === mb); x.setAttribute('aria-pressed', x === mb) }); $('#nn-size', l).innerHTML = sizeNote() }
      const fx = e.target.closest('[data-fix]'); if (fx) { mode = fx.dataset.fix.split(':')[1]; draw() }
      if (e.target.closest('[data-back]')) { page--; draw() }
      if (e.target.closest('[data-next]')) { if (page === PAGES.length - 1) resolve(); else { page++; draw() } }
    }
  })
  const [code, sub3] = langOf(lang)
  await Promise.all([setSetting('lang', code), setSetting('sublang', subs ? sub3 : 'off'), setSetting('interests', [...interests]), setSetting('sourceMode', mode), setSetting('adultFilter', adult), setSetting('discordPresence', discord), setSetting('onboarded', true), api('/api/settings', { method: 'PUT', body: { shareUploads: share } })])
  done()
  // The interface follows the language: reload once so every screen starts in it.
  store.set('ui', uiLangFor(code))
  if (uiLangFor(code) !== document.documentElement.lang) location.reload()
}
