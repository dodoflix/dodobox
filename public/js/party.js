// Watch party, the page's side: a panel to start, join and leave, and the player's playback kept in step with the other members.
// The server (src/party.js) talks to them; this page hears about it over /api/party/events and answers with /api/party/send.
import { esc, enc, toast, icon, hue, sized } from './util.js'
import { api, cget } from './api.js'

const LAG = 0.25 // seconds a command is old by the time it arrives
const DRIFT = 1.5 // seconds apart before a heartbeat moves the video
const href = i => `#/watch/${i.type}/${enc(i.id)}` + (i.season != null ? `/${i.season}/${i.episode}` : '')
const same = (a, b) => !!a && !!b && a.type === b.type && a.id === b.id && (a.season ?? null) === (b.season ?? null) && (a.episode ?? null) === (b.episode ?? null)

let status = { active: false, members: [], now: null }; let statusAt = Date.now()
let es = null; let player = null; let pop = null; let popCtx = null; let seen = null
const sinks = new Set()

const take = s => { status = s; statusAt = Date.now() }
// Where the show is now, counting the time since the server last said.
export const nowPos = () => (status.now ? status.now.pos + (status.now.paused ? 0 : (Date.now() - statusAt) / 1000) : 0)

function onEvent (e) {
  const was = status.now?.item
  if (e.type === 'status') {
    const ids = new Set(e.members.map(m => m.id))
    if (seen && e.active) {
      for (const m of e.members) if (!seen.has(m.id) && !m.you) toast(`${m.name} joined the party`)
    }
    seen = e.active ? ids : null
    take(e)
    if (!e.active && es) { es.close(); es = null }
  } else if (e.type === 'left') toast(`${e.from.name} left the party`)
  else if (e.type === 'state' || e.type === 'load') { take({ ...status, now: { item: e.item, source: e.source, pos: e.pos ?? 0, paused: e.type === 'load' ? true : e.paused } }) } else if (e.type === 'cmd' && status.now) take({ ...status, now: { ...status.now, pos: e.pos, paused: e.k === 'pa' || (e.k === 'tk' && e.paused) } })
  if (e.type === 'load') {
    const line = `${e.from.name} is watching ${e.item.title || ''}`.trim()
    // Someone moving on to the next episode of what you are watching together takes you along; anything else is an invitation.
    if (player && same(player.item, was) && player.item.type === e.item.type && player.item.id === e.item.id && !same(player.item, e.item)) { toast(line); location.replace(href(e.item)) } else if (!(player && same(player.item, e.item))) toast(line, { ms: 12000, action: { label: 'Join', run: () => { location.hash = href(e.item) } } })
  }
  for (const f of sinks) f(e)
  paintChip()
  if (pop) draw()
}

function listen () {
  if (es) return
  es = new EventSource('/api/party/events')
  es.onmessage = m => { try { onEvent(JSON.parse(m.data)) } catch {} }
}

const loaded = api('/api/party').then(s => { take(s); seen = s.active ? new Set(s.members.map(m => m.id)) : null; if (s.active) listen() }).catch(() => {})
export const ready = () => loaded

// A small pill by the profile button while in a party: who is here, and a way back to the panel.
let chip = null
function paintChip () {
  if (!chip) return
  chip.hidden = !status.active
  chip.innerHTML = `${icon('party')}<b>${status.members.length}</b>`
  chip.classList.toggle('live', status.members.length > 1)
}
export async function initParty () {
  await loaded
  const me = document.getElementById('me-btn')
  if (!me || chip) return
  chip = document.createElement('button')
  chip.className = 'party-chip'; chip.dataset.party = ''; chip.setAttribute('aria-label', 'Watch party'); chip.hidden = true
  chip.onclick = () => openPanel(document.body, null)
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

function draw () {
  const s = status; const ctx = popCtx
  const here = ctx && same(ctx.item, s.now?.item)
  const keep = pop.querySelector('input')?.value
  const head = `<header class="pp-h"><span class="pp-ico">${icon('party')}</span><h3>Watch party</h3>${s.active ? `<span class="pp-count">${s.members.length}</span>` : ''}<button class="icon-btn pp-x" data-a="close" aria-label="Close">${icon('close')}</button></header>`
  let body
  if (!s.active) {
    body = `<section class="pp-start"><p>Get a code to share, then watch anything together, episode after episode.</p><button class="btn btn-ink" data-a="start">Start a party</button><p class="pp-note">Friends need Dodobox too. Share the code with them.</p></section>
      <div class="pp-or"><span>or</span></div>
      <form class="pp-join"><label class="pp-l" for="pp-code">Join with a code</label><div class="pp-row"><input id="pp-code" class="field" name="code" placeholder="XXXX-XXXX-XXXX-XXXX" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24"><button class="btn btn-ghost">Join</button></div></form>`
  } else {
    const n = s.now?.item
    const poster = n ? posterOf(n) : ''
    const now = n
      ? `<div class="pp-now"><span class="pp-poster" style="--h:${hue(n.title)}">${poster ? `<img alt="" src="${esc(sized(poster, 160))}">` : ''}</span>
          <div class="pp-meta"><span class="pp-l">Watching</span><b translate="no">${esc(n.title || '')}</b>${n.season != null ? `<span>S${n.season} E${n.episode}</span>` : ''}</div>
          ${here ? '' : '<button class="btn btn-ink sm" data-a="go">Watch together</button>'}</div>`
      : '<p class="pp-note">Pick anything to watch and everyone follows.</p>'
    body = `<section class="pp-code"><span class="pp-l">Party code</span><div class="pp-codebox"><b translate="no">${esc(s.code)}</b><button class="icon-btn" data-a="copy" aria-label="Copy code">${icon('copy')}</button></div></section>
      <ul class="pp-members">${s.members.map(m => `<li><span class="avatar" style="--c:${esc(m.color)}">${esc((m.name || '?')[0].toUpperCase())}</span><span translate="no">${esc(m.name)}</span>${m.you ? '<small>You</small>' : ''}</li>`).join('')}</ul>
      ${s.members.length < 2 ? '<p class="pp-note">Looking for your friends...</p>' : ''}
      ${now}
      <button class="btn btn-ghost pp-leave" data-a="leave">Leave party</button>`
  }
  pop.innerHTML = head + body
  if (keep) pop.querySelector('input').value = keep
}

export function closePanel () { pop?.remove(); pop = null; popCtx = null }

// host: where the panel lives (the player element, so it shows in full screen, or the page); ctx: the player's title, or null.
export function openPanel (host, ctx) {
  if (pop) return closePanel()
  listen()
  pop = document.createElement('div')
  pop.className = `party-pop ${host === document.body ? 'in-page' : 'in-player'}`
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Watch party'); pop.dataset.modal = ''
  popCtx = ctx
  host.append(pop)
  draw()
  const outside = e => { if (pop && !pop.contains(e.target) && !e.target.closest('[data-party], #m-party')) { closePanel(); document.removeEventListener('pointerdown', outside, true) } }
  document.addEventListener('pointerdown', outside, true)
  pop.addEventListener('submit', async e => {
    e.preventDefault()
    try { take(await api('/api/party/join', { method: 'POST', body: { code: pop.querySelector('input').value } })); seen = new Set(status.members.map(m => m.id)); listen(); paintChip(); draw() } catch (err) { toast(err.message) }
  })
  pop.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a
    if (!a) return
    try {
      if (a === 'close') closePanel()
      if (a === 'start') {
        // From the player it starts on what is playing; from anywhere else it is an empty room.
        take(await api('/api/party/start', { method: 'POST', body: ctx ? { item: ctx.item, hash: ctx.hash(), pos: ctx.v.currentTime, paused: ctx.v.paused } : {} }))
        seen = new Set(status.members.map(m => m.id)); listen(); paintChip(); draw()
      }
      if (a === 'leave') { await api('/api/party/leave', { method: 'POST' }); take({ active: false, members: [], now: null }); seen = null; es?.close(); es = null; paintChip(); draw() }
      if (a === 'go') { closePanel(); location.hash = href(status.now.item) }
      if (a === 'copy') { await navigator.clipboard?.writeText(status.code); toast('Code copied') }
    } catch (err) { toast(err.message) }
  })
}

// ---- the player ----
// ctx: { v, root, item: { type, id, season, episode, title }, hash: () => infoHash of what is playing, button }
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
  const mark = () => ctx.button?.classList.toggle('on', status.active)
  sinks.add(mark); mark()
  if (ctx.button) ctx.button.onclick = () => openPanel(ctx.root, ctx)
  return () => { sinks.delete(sink); sinks.delete(mark); offs.forEach(f => f()); clearInterval(tick); closePanel(); if (player === ctx) player = null }
}
