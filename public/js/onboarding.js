// First-run flows: once per device (layout tuning) and once per profile (language, subtitles, taste).
import { $, esc, store, isTV, ua } from './util.js'
import { S, setSetting } from './session.js'
import { focusFirst } from './nav.js'
import { upgradeSelects } from './dropdown.js'
import { uiLangFor } from './i18n.js'

export const LANGUAGES = [['en', 'eng', 'English'], ['tr', 'tur', 'Türkçe'], ['es', 'spa', 'Español'], ['fr', 'fre', 'Français'], ['de', 'ger', 'Deutsch'], ['it', 'ita', 'Italiano'], ['pt', 'por', 'Português'], ['ru', 'rus', 'Русский'], ['ar', 'ara', 'العربية'], ['ja', 'jpn', '日本語'], ['ko', 'kor', '한국어'], ['zh', 'chi', '中文'], ['nl', 'dut', 'Nederlands'], ['pl', 'pol', 'Polski'], ['id', 'ind', 'Indonesia'], ['hi', 'hin', 'हिन्दी'], ['vi', 'vie', 'Tiếng Việt'], ['el', 'ell', 'Ελληνικά'], ['he', 'heb', 'עברית'], ['sv', 'swe', 'Svenska']]
export const SOURCE_MODES = [['balanced', 'Balanced'], ['compact', 'Smallest'], ['lossless', 'Best quality']]
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

export function installTip (toast) {
  if (store.get('device') !== 'phone' || store.get('tipShown') || matchMedia('(display-mode: standalone)').matches || navigator.standalone) return
  store.set('tipShown', true)
  const ios = /iPhone|iPad|iPod/.test(ua)
  setTimeout(() => toast(ios ? 'Tip: tap Share, then Add to Home Screen, to open Dodobox like an app.' : 'Tip: open the browser menu and choose Add to Home screen.', { ms: 9000 }), 4000)
}

export async function profileOnboarding () {
  const guess = (navigator.language || 'en').slice(0, 2)
  let lang = langOf(S.me.settings.lang !== 'en' ? S.me.settings.lang : guess)[0]
  let subs = lang !== 'en'
  const interests = new Set(S.me.settings.interests || [])
  let mode = S.me.settings.sourceMode || 'balanced'
  let adult = !!S.me.settings.adultFilter
  const draw = () => {
    const l = stage(`<h1>Hi ${esc(S.me.name)}, make it yours</h1>
      <div class="ob-form">
        <label class="ob-row"><span><b>Language</b><small>Titles, descriptions and subtitles use it when available.</small></span>
          <select class="field" id="ob-lang">${LANGUAGES.map(([c, , n]) => `<option value="${c}" ${c === lang ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <div class="ob-row"><span><b>Show subtitles</b><small>Turned on automatically when they exist.</small></span>
          <button class="switch" role="switch" id="ob-subs" aria-checked="${subs}" aria-label="Show subtitles"></button></div>
        <div class="ob-row stack"><span><b>What do you like?</b><small>Pick any. Your home screen starts with these.</small></span>
          <div class="chips">${[['movie', 'Movies'], ['series', 'Series'], ['anime', 'Anime']].map(([t, n]) => `<button class="chip ${interests.has(t) ? 'on' : ''}" data-i="${t}" aria-pressed="${interests.has(t)}">${n}</button>`).join('')}</div></div>
        <div class="ob-row stack"><span><b>Download size</b><small>Balanced avoids huge files. Smallest starts fastest. Best quality accepts very large files.</small></span>
          <div class="chips">${SOURCE_MODES.map(([m, n]) => `<button class="chip ${m === mode ? 'on' : ''}" data-m="${m}" aria-pressed="${m === mode}">${n}</button>`).join('')}</div></div>
        <div class="ob-row"><span><b>Adult content filter</b><small>Hide titles that are marked as adult. Off by default.</small></span>
          <button class="switch" role="switch" id="ob-adult" aria-checked="${adult}" aria-label="Adult content filter"></button></div>
      </div>
      <div class="actions"><button class="btn btn-ink" data-save data-autofocus>Start watching</button></div>`, 0, 1)
    return l
  }
  const l = draw()
  upgradeSelects(l)
  await new Promise(resolve => {
    l.onchange = e => { if (e.target.id === 'ob-lang') { lang = e.target.value; subs = lang !== 'en' || subs; $('#ob-subs', l).setAttribute('aria-checked', subs) } }
    l.onclick = e => {
      const sw = e.target.closest('#ob-subs'); if (sw) { subs = !subs; sw.setAttribute('aria-checked', subs) }
      const c = e.target.closest('[data-i]'); if (c) { interests.has(c.dataset.i) ? interests.delete(c.dataset.i) : interests.add(c.dataset.i); c.classList.toggle('on'); c.setAttribute('aria-pressed', interests.has(c.dataset.i)) }
      const ad = e.target.closest('#ob-adult'); if (ad) { adult = !adult; ad.setAttribute('aria-checked', adult) }
      const mb = e.target.closest('[data-m]'); if (mb) { mode = mb.dataset.m; l.querySelectorAll('[data-m]').forEach(x => { x.classList.toggle('on', x === mb); x.setAttribute('aria-pressed', x === mb) }) }
      if (e.target.closest('[data-save]')) resolve()
    }
  })
  const [code, sub3] = langOf(lang)
  await Promise.all([setSetting('lang', code), setSetting('sublang', subs ? sub3 : 'off'), setSetting('interests', [...interests]), setSetting('sourceMode', mode), setSetting('adultFilter', adult), setSetting('onboarded', true)])
  done()
  // The interface follows the language: reload once so every screen starts in it.
  store.set('ui', uiLangFor(code))
  if (uiLangFor(code) !== document.documentElement.lang) location.reload()
}
