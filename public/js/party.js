// Watch party, the page's side: a panel to start, join and leave, and the player's playback kept in step with the other members.
// The server (src/party.js) talks to them; this page hears about it over /api/party/events and answers with /api/party/send.
import { esc, enc, toast, icon, hue, sized } from './util.js'
import { api, cget } from './api.js'
import { emojify, PICKER, REACTIONS, onlyEmoji, parseLink, LINK, trimLink } from './emoji.js'

const LAG = 0.25 // seconds a command is old by the time it arrives
const DRIFT = 1.5 // seconds apart before a heartbeat moves the video
// Hidden as it is typed, with a button to show it (a wrong password cannot be told apart from an empty party, so a typo has to be easy to see).
// A text field that is drawn as dots, not type=password: this is not a login, and browsers and password managers offer saved logins for anything typed password.
// Where the dots are not supported (Firefox) it falls back to type=password.
// It is also read-only until it gets focus, because browsers skip autofill on read-only fields and ignore autocomplete=off on the rest.
const MASK = CSS.supports('-webkit-text-security', 'disc')
// A paste button where the browser allows reading the clipboard (not on a plain http address other than localhost); otherwise Ctrl+V or a long press still works.
const CAN_PASTE = !!navigator.clipboard?.readText
const pasteBtn = CAN_PASTE ? `<button type="button" class="icon-btn" data-a="paste" aria-label="Paste">${icon('paste')}</button>` : ''
const passField = `<div class="pp-pass" style="--n:${CAN_PASTE ? 2 : 1}"><input class="field${MASK ? ' masked' : ''}" name="partykey" type="${MASK ? 'text' : 'password'}" placeholder="Password (optional)" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="64" enterkeyhint="go" readonly aria-label="Password (optional)" data-lpignore="true" data-1p-ignore data-bwignore data-form-type="other"><span class="pp-act">${pasteBtn}<button type="button" class="icon-btn" data-a="peek" aria-label="Show password" aria-pressed="false">${icon('eye')}</button></span></div>`
const codeField = `<div class="pp-pass" style="--n:${CAN_PASTE ? 1 : 0}"><input id="pp-code" class="field" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24"><span class="pp-act">${pasteBtn}</span></div>`
// A code pasted inside a sentence ("join my party: ABCD-...") is picked out of it: codes are shown with dashes, so that form wins; anything else is left as pasted.
const fill = (f, text) => { const t = text.trim(); f.value = (f.name === 'code' ? codeIn(t) : t).slice(0, f.maxLength) }
const codeIn = text => text.match(/\b[0-9A-Za-z]{4}(?:-[0-9A-Za-z]{4}){3}\b/)?.[0] ?? text
const href = i => `#/watch/${i.type}/${enc(i.id)}` + (i.season != null ? `/${i.season}/${i.episode}` : '')
const same = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id && (a.season ?? null) === (b.season ?? null) && (a.episode ?? null) === (b.episode ?? null)

let status = { active: false, members: [], now: null }; let statusAt = Date.now()
let es = null; let player = null; let pop = null; let popPanel = null; let seen = null
let chat = []; let draft = ''; let unread = 0; let picking = false
const revealed = new Set()
const sinks = new Set()

const take = s => { status = s; statusAt = Date.now() }
// Where the show is now, counting the time since the server last said.
export const nowPos = () => (status.now ? status.now.pos + (status.now.paused ? 0 : (Date.now() - statusAt) / 1000) : 0)

function onEvent (e) {
  const was = status.now?.item
  if (e.type === 'status') {
    const ids = new Set(e.members.map(m => m.id))
    if (seen && e.active) {
      for (const m of e.members) if (!seen.has(m.id) && !m.you) toast(`${m.name} joined the party`, { key: 'presence' })
    }
    seen = e.active ? ids : null
    take(e)
    if (e.chat) chat = e.chat
    if (!e.active) { chat = []; unread = 0; if (es) { es.close(); es = null } }
  } else if (e.type === 'chat') {
    chat.push(e.msg); if (chat.length > 100) chat.shift()
    if (!e.msg.sys && e.msg.from.id !== status.self && !(pop || player?.menu?.isParty())) { unread++; if (!player) toast(`${e.msg.from.name}: ${e.msg.text}`.slice(0, 140), { key: 'chat' }) }
  } else if (e.type === 'left') toast(`${e.from.name} left the party`, { key: 'presence' })
  else if (e.type === 'state' || e.type === 'load') { take({ ...status, now: { item: e.item, source: e.source, pos: e.pos ?? 0, paused: e.type === 'load' ? true : e.paused } }) } else if (e.type === 'cmd' && status.now) take({ ...status, now: { ...status.now, pos: e.pos, paused: e.k === 'pa' || (e.k === 'tk' && e.paused) } })
  if (e.type === 'load') {
    const line = `${e.from.name} is watching ${e.item.title || ''}`.trim()
    // Someone moving on to the next episode of what you are watching together takes you along; anything else is an invitation.
    if (player && same(player.item, was) && player.item.type === e.item.type && player.item.id === e.item.id && !same(player.item, e.item)) { toast(line, { key: 'load' }); location.replace(href(e.item)) } else if (!(player && same(player.item, e.item))) toast(line, { key: 'load', ms: 12000, action: { label: 'Join', run: () => { location.hash = href(e.item) } } })
  }
  for (const f of sinks) f(e)
  paintChip()
  if (e.type === 'chat') return hear(e.msg)
  if (e.type === 'react') return reacted(e)
  if (pop) draw()
  if (player?.menu?.isParty()) player.menu.redraw()
}

function listen () {
  if (es) return
  es = new EventSource('/api/party/events')
  es.onmessage = m => { try { onEvent(JSON.parse(m.data)) } catch {} }
}

// Shortcodes and emoticons turn into emoji as they are typed (only at the end of the text, so editing in the middle is never rewritten).
document.addEventListener('input', e => {
  const f = e.target
  if (f.name !== 'chat' || !f.closest('.party-pop')) return
  if (f.selectionStart === f.value.length) { const v = emojify(f.value); if (v !== f.value) f.value = v }
  draft = f.value
})
// Ctrl+V or a long press in the code field gets the same treatment as the paste button: a code inside a copied message is picked out of it.
document.addEventListener('paste', e => { if (e.target.matches?.('.pp-pass input[name=code]')) { e.preventDefault(); fill(e.target, e.clipboardData?.getData('text') || '') } })
document.addEventListener('focusin', e => { if (e.target.matches?.('.pp-pass input[readonly]')) e.target.removeAttribute('readonly') })
// Escape closes the emoji picker before it closes the panel.
document.addEventListener('keydown', e => {
  if (!e.target.closest?.('.party-pop')) return
  if (e.key === 'Escape' && (picking || trayFor)) { e.stopPropagation(); picking = false; document.querySelectorAll('.pp-emoji').forEach(p => { p.hidden = true }); hideTray() }
  else if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('.pp-log p')) { e.preventDefault(); showTray(e.target.closest('li')); document.querySelector('.pp-tray button')?.focus() }
}, true)

const loaded = api('/api/party').then(s => { take(s); chat = s.chat || []; seen = s.active ? new Set(s.members.map(m => m.id)) : null; if (s.active) listen() }).catch(() => {})
export const ready = () => loaded

// A small pill by the profile button while in a party: who is here, and a way back to the panel.
let chip = null
function paintChip () {
  if (!chip) return
  chip.hidden = !status.active
  chip.innerHTML = `${icon('party')}<span>${status.members.length}</span>`
  chip.classList.toggle('live', status.members.length > 1)
  chip.classList.toggle('unread', unread > 0)
}
export async function initParty () {
  await loaded
  const me = document.getElementById('me-btn')
  if (!me || chip) return
  chip = document.createElement('button')
  chip.className = 'party-chip'; chip.dataset.party = ''; chip.setAttribute('aria-label', 'Watch party'); chip.hidden = true
  chip.onclick = () => openPanel(document.body)
  me.before(chip)
  paintChip()
}
export const active = () => status.active
// The version the party is on, for the player to start with when it opens the same title.
// Whether the party is on this title (the page may then start where the others are).
export const onThis = item => status.active && same(status.now?.item, item)
export const sourceFor = item => (status.active && same(status.now?.item, item) ? status.now.source?.infoHash : undefined)

// ---- the panel ----
const posters = new Map()
const posterOf = item => {
  const k = `${item.type}:${item.id}`
  if (!posters.has(k)) { posters.set(k, ''); cget(`/api/meta/${item.type}/${enc(item.id)}`).then(m => { posters.set(k, m.poster || ''); if (pop) draw() }).catch(() => {}) }
  return posters.get(k)
}

// Messages from the same person in a row share one name (mine says You and sits on the right). Lines about what a member did sit between them.
const clock = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const link = l => `<a class="pp-link" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer" translate="no">${icon('link')}<b>${esc(l.host)}</b>${l.path ? `<span>${esc(l.path)}</span>` : ''}</a>`
// A picture from a link is only fetched when someone asks for it, so a link in the chat never makes this computer contact that site by itself.
const pic = l => `<a class="pp-pic" href="${esc(l.href)}" target="_blank" rel="noopener noreferrer"><img alt="" referrerpolicy="no-referrer" src="${esc(l.href)}"></a>`
const embed = l => (revealed.has(l.href) ? pic(l) : `<button type="button" class="pp-link pp-embed" data-a="embed" data-src="${esc(l.href)}" aria-label="Show image">${icon('image')}<b translate="no">${esc(l.host)}</b></button>`)
function rich (text) {
  let out = ''; let last = 0
  for (const m of text.matchAll(LINK)) {
    const raw = trimLink(m[0]); const l = parseLink(raw)
    if (!l) continue
    out += esc(text.slice(last, m.index)) + (l.image ? embed(l) : link(l))
    last = m.index + raw.length
  }
  return out + esc(text.slice(last))
}
const who = ids => ids.map(id => status.members.find(m => m.id === id)?.name).filter(Boolean).join(', ')
const rxChips = m => Object.entries(m.rx || {}).map(([e, ids]) => `<button type="button" class="pp-rx${ids.includes(status.self) ? ' on' : ''}" data-a="react" data-e="${e}" title="${esc(who(ids))}">${e}<span>${ids.length}</span></button>`).join('')
function bubble (m, prev, animate) {
  const fx = animate ? ' in' : ''
  if (m.sys) return `<li class="sys${fx}" title="${clock(m.at)}"><p>${esc(m.text)}</p></li>`
  const mine = m.from.id === status.self
  const again = prev && !prev.sys && prev.from.id === m.from.id
  const head = again ? '' : `<span class="pp-who${mine ? ' you' : ''}"${mine ? '' : ` style="--c:${esc(m.from.color)}"`}>${mine ? '<span>You</span>' : `<span translate="no">${esc(m.from.name)}</span>`}<time>${clock(m.at)}</time></span>`
  return `<li class="${mine ? 'me' : ''}${fx}" data-id="${esc(m.id)}">${head}<p tabindex="0" title="${clock(m.at)}"${onlyEmoji(m.text) ? ' class="big"' : ''}>${rich(m.text)}</p><div class="pp-rxs">${rxChips(m)}</div></li>`
}
function chatHtml (s) {
  const live = s.phase === 'live'
  const log = chat.map((m, i) => bubble(m, chat[i - 1])).join('')
  return `<section class="pp-chat"><ul class="pp-log" tabindex="-1" aria-live="polite" aria-label="Messages">${log}</ul>
    <form class="pp-say"><div class="pp-emoji" role="group" aria-label="Emoji"${picking && live ? '' : ' hidden'}>${PICKER.map(e => `<button type="button" data-a="pick" data-e="${e}">${e}</button>`).join('')}</div>
      <input class="field" name="chat" placeholder="Message the party" value="${esc(draft)}" autocomplete="off" maxlength="500" enterkeyhint="send" aria-label="Message the party"${live ? '' : ' disabled'}>
      <button type="button" class="icon-btn" data-a="emoji" aria-label="Emoji" aria-expanded="${picking && live}"${live ? '' : ' disabled'}>${icon('smile')}</button>
      <button class="icon-btn" aria-label="Send"${live ? '' : ' disabled'}>${icon('send')}</button></form></section>`
}
const nearEnd = log => log.scrollHeight - log.scrollTop - log.clientHeight < 40
// A log that was at the bottom stays at the bottom when its height changes (a poster arriving above it, a person wrapping to a new line).
const stuck = new WeakMap()
const pin = new ResizeObserver(rows => { for (const { target } of rows) if (stuck.get(target) !== false) target.scrollTop = target.scrollHeight })
let glideUntil = 0
const glide = log => { glideUntil = performance.now() + 700; log.scrollTo({ top: log.scrollHeight, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }) }
// A reaction changes only that message's chips.
function reacted (e) {
  const m = chat.find(x => x.id === e.id)
  if (!m) return
  m.rx = e.rx
  for (const li of document.querySelectorAll('.party-pop .pp-log li[data-id]')) if (li.dataset.id === e.id) li.querySelector('.pp-rxs').innerHTML = rxChips(m)
}
// The reaction tray floats over the messages (never between them): on hover where there is a mouse, on tap where there is not.
let trayFor = null; let trayTimer = 0
const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches
const liFor = id => [...document.querySelectorAll('.party-pop .pp-log li[data-id]')].find(li => li.dataset.id === id)
function hideTray () { clearTimeout(trayTimer); trayFor = null; document.querySelectorAll('.pp-tray').forEach(t => t.remove()) }
// It sits on the top edge of the bubble, on the bubble's own side, and stays inside the visible log.
function placeTray (li, el) {
  const box = li.closest('.pp-chat').getBoundingClientRect(); const log = li.closest('.pp-log').getBoundingClientRect(); const b = li.querySelector('p').getBoundingClientRect()
  if (b.bottom < log.top + 8 || b.top > log.bottom - 8) return hideTray()
  el.style.top = `${Math.max(b.top - el.offsetHeight + 8, log.top - 4) - box.top}px`
  if (li.classList.contains('me')) { el.style.right = `${Math.max(box.right - b.right, 0)}px`; el.style.left = 'auto' } else { el.style.left = `${Math.max(b.left - box.left, 0)}px`; el.style.right = 'auto' }
}
function showTray (li) {
  clearTimeout(trayTimer)
  const box = li.closest('.pp-chat')
  if (trayFor === li.dataset.id && box.querySelector('.pp-tray')) return
  hideTray(); trayFor = li.dataset.id
  const mine = chat.find(x => x.id === trayFor)?.rx || {}
  box.querySelector('.pp-log').insertAdjacentHTML('afterend', `<div class="pp-tray" role="group" aria-label="React">${REACTIONS.map(e => `<button type="button" data-a="react" data-e="${e}"${mine[e]?.includes(status.self) ? ' class="on"' : ''}>${e}</button>`).join('')}</div>`)
  placeTray(li, box.querySelector('.pp-tray'))
}
const overBubble = t => t.closest?.('.party-pop .pp-log li[data-id], .pp-tray')
document.addEventListener('mouseover', e => {
  if (!canHover()) return
  const li = e.target.closest?.('.party-pop .pp-log li[data-id]')
  if (li) showTray(li); else if (e.target.closest?.('.pp-tray')) clearTimeout(trayTimer)
})
document.addEventListener('mouseout', e => {
  if (canHover() && overBubble(e.target) && !overBubble(e.relatedTarget)) { clearTimeout(trayTimer); trayTimer = setTimeout(hideTray, 160) }
})
document.addEventListener('focusin', e => {
  const bub = e.target.closest?.('.party-pop .pp-log p')
  if (bub) showTray(bub.closest('li')); else if (!e.target.closest?.('.pp-tray')) hideTray()
})
document.addEventListener('pointerdown', e => { if (trayFor && !e.target.closest?.('.pp-tray, .pp-log p')) hideTray() })
document.addEventListener('scroll', e => {
  if (!e.target.classList?.contains('pp-log')) return
  if (performance.now() > glideUntil) stuck.set(e.target, nearEnd(e.target))
  if (!trayFor) return
  const li = liFor(trayFor); const el = document.querySelector('.pp-tray')
  if (li && el) placeTray(li, el); else hideTray()
}, true)

// A new message is added to the open log and the log glides down to it, so nothing else redraws or jumps.
function hear (msg) {
  const prev = chat[chat.length - 2]
  for (const log of document.querySelectorAll('.party-pop .pp-log')) {
    const near = stuck.get(log) !== false
    log.insertAdjacentHTML('beforeend', bubble(msg, prev, true))
    while (log.children.length > 100) log.firstChild.remove()
    if (near) glide(log)
  }
}

// The panel's markup and behaviour, for either place it lives: a popover on the page (ctx null) or one of the player's own menus.
function html (ctx) {
  const s = status
  const here = ctx && same(ctx.item, s.now?.item)
  const head = `<header class="pp-h"><h3>Watch party</h3><button class="icon-btn pp-x" data-a="close" aria-label="Close">${icon('close')}</button></header>`
  let body
  if (!s.active) {
    body = `<p class="pp-lead">Get a code to share, then watch anything together, episode after episode.</p>
      <form class="pp-start">${passField}
        <button class="btn btn-ink" data-autofocus>Start a party</button></form>
      <p class="pp-note">Friends need Dodobox too. Share the code with them.</p>
      <div class="pp-or"><span>or</span></div>
      <form class="pp-join"><label for="pp-code">Join with a code</label><div class="pp-row">${codeField}<button class="btn btn-ghost">Join</button></div>
        ${passField}</form>`
  } else {
    const n = s.now?.item
    const poster = n ? posterOf(n) : ''
    const now = n
      ? `<section class="pp-now"><span class="pp-label">Watching</span>
          <div class="pp-show"><span class="pp-poster" style="--h:${hue(n.title)}">${poster ? `<img alt="" src="${esc(sized(poster, 160))}">` : ''}</span>
          <div class="pp-cap"><b translate="no">${esc(n.title || '')}</b>${n.season != null ? `<span>S${n.season} E${n.episode}</span>` : ''}</div></div>
          ${here ? '' : '<button class="btn btn-ink sm" data-a="go" data-autofocus>Watch together</button>'}</section>`
      : '<p class="pp-note">Pick anything to watch and everyone follows.</p>'
    body = `<section class="pp-code"><span class="pp-label">Party code</span><div class="pp-codeline"><b translate="no">${esc(s.code)}</b><button class="icon-btn" data-a="copy" aria-label="Copy code">${icon('copy')}</button></div>${s.locked ? '<p class="pp-note">Friends also need the password.</p>' : ''}</section>
      <ul class="pp-members${s.members.length > 4 ? ' crowd' : ''}">${s.members.map(m => (s.members.length > 4
        ? `<li><button type="button" class="avatar${m.you ? ' you' : ''}" data-a="who" data-name="${esc(m.you ? 'You' : m.name)}" style="--c:${esc(m.color)}" aria-label="${esc(m.name)}${m.you ? ' (You)' : ''}">${esc((m.name || '?')[0].toUpperCase())}</button></li>`
        : `<li><span class="avatar" style="--c:${esc(m.color)}">${esc((m.name || '?')[0].toUpperCase())}</span><span class="pp-name" translate="no">${esc(m.name)}</span>${m.you ? '<small>You</small>' : ''}</li>`)).join('')}</ul>
      ${s.members.length < 2 ? '<p class="pp-note">Looking for your friends...</p>' : ''}
      ${now}
      ${chatHtml(s)}
      <button class="btn btn-quiet pp-leave" data-a="leave">Leave party</button>`
  }
  return head + body
}

// host: { close(), redraw() } for wherever the panel is drawn.
function behaviour (ctx, host) {
  return {
    html: () => html(ctx),
    // Redraws keep what is being typed, where it is focused and how far the messages are scrolled.
    render (el) {
      const log = el.querySelector('.pp-log'); const typing = el.querySelector('.pp-say input') === document.activeElement
      const atEnd = !log || stuck.get(log) !== false; const top = log?.scrollTop
      el.innerHTML = html(ctx); unread = 0; ctx?.button?.classList.remove('unread'); ctx?.alt?.classList.remove('unread'); chip?.classList.remove('unread')
      const now = el.querySelector('.pp-log')
      if (now) { stuck.set(now, atEnd); now.scrollTop = atEnd ? now.scrollHeight : top; pin.observe(now) }
      if (typing) { const f = el.querySelector('.pp-say input'); f.focus(); f.setSelectionRange(f.value.length, f.value.length) }
    },
    async submit (e) {
      e.preventDefault()
      if (e.target.classList.contains('pp-say')) {
        const text = emojify(draft.trim()); if (!text || status.phase !== 'live') return
        draft = ''; e.target.chat.value = ''; picking = false; e.target.querySelector('.pp-emoji').hidden = true
        try { await api('/api/party/send', { method: 'POST', body: { k: 'ch', text } }) } catch (err) { draft = text; e.target.chat.value = text; toast(err.message) }
        return
      }
      if (e.target.classList.contains('pp-start')) {
        // From the player it starts on what is playing; from anywhere else it is an empty room.
        try {
          take(await api('/api/party/start', { method: 'POST', body: { password: e.target.partykey.value, ...ctx && { item: ctx.item, hash: ctx.hash(), pos: ctx.v.currentTime, paused: ctx.v.paused } } }))
          seen = new Set(status.members.map(m => m.id)); listen(); paintChip(); host.redraw()
        } catch (err) { toast(err.message) }
        return
      }
      try { take(await api('/api/party/join', { method: 'POST', body: { code: e.target.code.value, password: e.target.partykey.value } })); seen = new Set(status.members.map(m => m.id)); listen(); paintChip(); host.redraw() } catch (err) { toast(err.message) }
    },
    async click (e) {
      const bubble = e.target.closest('.pp-log p')
      if (bubble && !e.target.closest('a, button')) return canHover() ? undefined : showTray(bubble.closest('li'))
      const btn = e.target.closest('[data-a]'); const a = btn?.dataset.a
      if (!a) return
      try {
        if (a === 'react') { const to = btn.closest('li')?.dataset.id ?? trayFor; hideTray(); await api('/api/party/send', { method: 'POST', body: { k: 'rx', to, e: btn.dataset.e } }) }
        if (a === 'emoji') { picking = !picking; const form = btn.closest('form'); form.querySelector('.pp-emoji').hidden = !picking; btn.setAttribute('aria-expanded', picking); if (picking) form.chat.blur(); else form.chat.focus() }
        if (a === 'pick') { const f = btn.closest('form').chat; f.setRangeText(btn.dataset.e, f.selectionStart, f.selectionEnd, 'end'); draft = f.value; f.focus() }
        if (a === 'embed') {
          const log = btn.closest('.pp-log'); const near = nearEnd(log); const l = parseLink(btn.dataset.src)
          revealed.add(l.href)
          const t = document.createElement('template'); t.innerHTML = pic(l); const a2 = t.content.firstChild
          a2.firstChild.onerror = () => { revealed.delete(l.href); a2.outerHTML = link(l) }
          btn.replaceWith(a2)
          if (near) glide(log)
        }
        if (a === 'close') host.close()
        if (a === 'leave') { await api('/api/party/leave', { method: 'POST' }); take({ active: false, members: [], now: null }); seen = null; es?.close(); es = null; paintChip(); host.redraw() }
        if (a === 'paste') {
          const f = btn.closest('.pp-pass').querySelector('input')
          f.removeAttribute('readonly'); f.focus()
          // The browser may ask first (once in Chrome, every time in Firefox and Safari); a refusal leaves the field focused so it can be pasted into by hand.
          try { fill(f, await navigator.clipboard.readText()) } catch { toast('The browser blocked pasting. Paste into the field yourself.') }
        }
        if (a === 'peek') {
          const f = btn.closest('.pp-pass').querySelector('input'); const show = MASK ? f.classList.contains('masked') : f.type === 'password'
          if (MASK) f.classList.toggle('masked', !show); else f.type = show ? 'text' : 'password'
          btn.setAttribute('aria-pressed', show); btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password'); btn.innerHTML = icon(show ? 'eye-off' : 'eye')
        }
        if (a === 'who') toast(btn.dataset.name)
        if (a === 'go') { host.close(); location.hash = href(status.now.item) }
        if (a === 'copy') { await navigator.clipboard?.writeText(status.code); toast('Code copied') }
      } catch (err) { toast(err.message) }
    }
  }
}

function draw () {
  if (!pop) return
  const keep = pop.querySelector('.pp-join input')?.value
  popPanel.render(pop)
  const code = pop.querySelector('.pp-join input')
  if (keep && code) code.value = keep
}

export function closePanel () { pop?.remove(); pop = null; popPanel = null }

// A popover on the page, from the profile menu or the chip.
export function openPanel (host) {
  if (pop) return closePanel()
  listen()
  unread = 0; paintChip()
  pop = document.createElement('div')
  pop.className = 'party-pop in-page'
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Watch party'); pop.dataset.modal = ''
  popPanel = behaviour(null, { close: closePanel, redraw: draw })
  host.append(pop)
  draw()
  const log = pop.querySelector('.pp-log'); if (log) log.scrollTop = log.scrollHeight
  pop.querySelector('[data-autofocus]')?.focus()
  const outside = e => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-party]')) { closePanel(); document.removeEventListener('pointerdown', outside, true) } }
  document.addEventListener('pointerdown', outside, true)
  pop.addEventListener('submit', e => popPanel?.submit(e))
  pop.addEventListener('click', e => popPanel?.click(e))
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closePanel() } })
}

// ---- the player ----
// ctx: { v, root, item: { type, id, season, episode, title }, hash: () => infoHash of what is playing, button, menu: { isParty, redraw, close } }
export function attachPlayer (ctx) {
  const { v, item } = ctx
  player = ctx
  if (status.active) listen()
  let armed = false; let leader = false; let first = true; const expect = { until: 0 }; const offs = []
  const here = () => status.active && same(status.now?.item, item)
  const post = (k, extra = {}) => api('/api/party/send', { method: 'POST', body: { k, pos: v.currentTime, ...extra } }).catch(() => {})
  const arm = () => { setTimeout(() => { armed = true }, 1500) }
  const expecting = k => { if (expect[k] && performance.now() < expect.until) { expect[k] = false; return true } return false }
  const want = k => { expect[k] = true; expect.until = performance.now() + 1500 }
  const seekTo = t => { if (Math.abs(v.currentTime - t) > 0.4) { expect.seekTo = t; want('seek'); v.currentTime = t } }

  // Put this video where the party is (when it joins, and when a heartbeat says it has drifted).
  const follow = (pos, paused, lag, tolerance) => {
    const target = paused ? pos : pos + lag
    if (Math.abs(v.currentTime - target) > tolerance) seekTo(target)
    if (paused && !v.paused) { want('pause'); v.pause() } else if (!paused && v.paused) { want('play'); v.play().catch(() => {}) }
  }

  const on = (t, f) => { v.addEventListener(t, f); offs.push(() => v.removeEventListener(t, f)) }
  on('playing', () => {
    if (first) {
      first = false; arm()
      if (!status.active) return
      if (here()) follow(nowPos(), status.now.paused, 0, 3)
      else {
        // Whoever presses play first fills an empty room, and it moves everyone else's invitation along.
        const source = /^[0-9a-f]{40}$/.test(ctx.hash() || '') ? { infoHash: ctx.hash() } : null
        api('/api/party/send', { method: 'POST', body: { k: 'ld', item, source } }).then(() => api('/api/party/send', { method: 'POST', body: { k: 'st', item, source, pos: v.currentTime, paused: v.paused } })).catch(() => {})
      }
    }
  })
  on('play', () => { if (armed && here() && !expecting('play')) { leader = true; post('pl') } })
  on('pause', () => { if (armed && here() && !v.ended && !expecting('pause')) { leader = true; post('pa') } })
  on('seeked', () => {
    if (!armed || !here()) return
    if (expect.seek && Math.abs(v.currentTime - expect.seekTo) < 2 && performance.now() < expect.until) { expect.seek = false; return }
    leader = true; post('sk')
  })
  const tick = setInterval(() => { if (armed && leader && here() && !v.paused) post('tk', { paused: false }) }, 5000)

  const sink = e => {
    if (e.type !== 'cmd' || !here()) return
    leader = false
    if (e.k === 'pl') follow(e.pos, false, LAG, 0.4)
    else if (e.k === 'pa') follow(e.pos, true, 0, 0.3)
    else if (e.k === 'sk') { seekTo(e.pos) } else if (e.k === 'tk') follow(e.pos, !!e.paused, LAG, DRIFT)
  }
  sinks.add(sink)
  const mark = () => { ctx.button?.classList.toggle('on', status.active); for (const b of [ctx.button, ctx.alt]) b?.classList.toggle('unread', unread > 0) }
  sinks.add(mark); mark()
  // A message that arrives while the panel is shut shows over the picture for a few seconds, which also works in full screen.
  const ping = e => {
    if (e.type !== 'chat' || e.msg.from.id === status.self || ctx.menu.isParty()) return
    let host = ctx.root.querySelector('.pp-pings')
    if (!host) { host = document.createElement('div'); host.className = 'pp-pings'; host.setAttribute('role', 'status'); ctx.root.append(host) }
    const el = document.createElement('p')
    el.className = e.msg.sys ? 'sys' : ''
    el.innerHTML = e.msg.sys ? esc(e.msg.text) : `<b style="--c:${esc(e.msg.from.color)}" translate="no">${esc(e.msg.from.name)}</b> ${rich(e.msg.text)}`
    host.append(el)
    const fade = p => { p.classList.add('out'); setTimeout(() => p.remove(), 320) }
    const cap = matchMedia('(max-width: 700px)').matches ? 2 : 3
    for (const old of [...host.children].filter(c => !c.classList.contains('out')).slice(0, -cap)) fade(old)
    setTimeout(() => fade(el), 6000)
  }
  sinks.add(ping)
  // The panel is one of the player's own menus: it draws and closes it like the speed or subtitle menu.
  const detach = () => { sinks.delete(sink); sinks.delete(mark); sinks.delete(ping); offs.forEach(f => f()); clearInterval(tick); if (player === ctx) player = null }
  detach.panel = behaviour(ctx, { close: ctx.menu.close, redraw: ctx.menu.redraw })
  return detach
}
