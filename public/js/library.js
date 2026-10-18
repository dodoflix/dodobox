import { api, cget, LATER } from './api.js'
import { S, removeHistory } from './session.js'
import { $, esc, icon, bytes, poster, enc, mins, layered, hue } from './util.js'
import { calm } from './ambient.js'
import { dragScroll } from './drag.js'

const watchHref = c => `#/watch/${c.type}/${enc(c.id)}` + (c.season != null ? `/${c.season}/${c.episode}` : '')
const SE = i => (i.season != null ? `S${i.season} E${i.episode}` : '')

const histCard = h => `<div class="hist">${poster(h, { sub: h.finished ? 'Watched' : SE(h) || h.year })}<button class="x" data-hist="${esc(h.type)}/${esc(enc(h.id))}" aria-label="Remove ${esc(h.name)} from watch history">${icon('close')}</button></div>`
const rail = (title, items, id) => items.length ? `<section class="shelf" id="${id}"><div class="shelf-h"><h2>${esc(title)}</h2></div><div class="rail">${items.join('')}</div></section>` : ''

export async function library (root) {
  calm()
  const me = S.me
  const rated = v => Object.values(me.ratings || {}).filter(r => r.v === v).sort((a, b) => b.at - a.at)
  root.innerHTML = `<div class="view page">
    <div class="page-h"><h1>Library</h1></div>
    <div id="mine-shelves">
      ${rail('Continue watching', me.recent.map(r => poster({ ...r, rating: null }, { progress: r.pos / r.dur, sub: `${SE(r) ? SE(r) + ' · ' : ''}${mins(Math.max(60, r.dur - r.pos))} left` })), 'l-recent')}
      ${rail('My List', me.list.map(i => poster(i)), 'l-list')}
      ${rail('Loved', rated(2).map(i => poster(i)), 'l-loved')}
      ${rail('Liked', rated(1).map(i => poster(i)), 'l-liked')}
      ${rail('Watch history', (me.history || []).map(histCard), 'l-history')}
    </div>
    <h2 class="sec-h">Downloads</h2>
    <div class="group flush"><div class="meter narrow"><i id="used" style="width:0"></i></div><p class="dim" id="usedtxt"></p></div>
    <div class="list dls" id="dl"></div>
    <div id="mine"></div></div>`
  root.querySelectorAll('.rail').forEach(dragScroll)
  $('#l-history')?.addEventListener('click', async e => {
    const b = e.target.closest('[data-hist]'); if (!b) return
    const [type, id] = b.dataset.hist.split('/')
    const sec = b.closest('.shelf'); b.closest('.hist').remove()
    if (!sec.querySelector('.hist')) sec.remove()
    await removeHistory(type, decodeURIComponent(id))
  })
  let dead = false; let lastHtml = ''; let all = false
  const SHOWN = 6

  async function draw () {
    // Scoped to the page, so leaving it cancels a poll that is still on the wire.
    const get = path => api(path, { ref: { prio: LATER } })
    const [items, st, q] = await Promise.all([get('/api/library'), get('/api/storage'), get('/api/downloads')])
    if (dead) return false
    $('#used').style.width = Math.min(100, st.used / st.cap * 100) + '%'
    const usedText = `${bytes(st.used)} of ${bytes(st.cap)} used. Oldest unwatched downloads are removed automatically when it fills up. Downloads you start yourself are kept.`
    $('#usedtxt').textContent = usedText
    const row = (c, body, acts) => `<div class="item"><a class="th" href="${watchHref(c)}" data-art="${esc(layered(c.poster, 240))}" style="--h:${hue(c.title)}" aria-label="Play"><b class="num" aria-hidden="true">${esc((c.title || '')[0] || '')}</b></a>
      <div><span class="t"><span translate="no">${esc(c.title)}</span>${c.season != null ? ` · <span>S${c.season} E${c.episode}</span>` : ''}</span>${body}</div><div class="acts">${acts}</div></div>`
    const queued = q.queue.map(j => row({ ...j, title: j.title }, `<div class="d">${j.priority ? 'Next in line' : 'Waiting to download'}</div>`, `<button class="icon-btn ${j.priority ? 'on' : ''}" data-top="${esc(j.key)}" data-on="${j.priority ? 0 : 1}" aria-pressed="${!!j.priority}" aria-label="${j.priority ? 'Stop prioritizing' : 'Download this first'}" title="${j.priority ? 'Stop prioritizing' : 'Download this first'}">${icon('top')}</button><button class="icon-btn" data-q="${esc(j.key)}" aria-label="Remove from the queue">${icon('close')}</button>`))
    const failed = q.failed.map(j => row({ ...j, title: j.title }, '<div class="d err">Could not find a source for this one</div>', `<button class="btn btn-ghost sm" data-retry='${esc(JSON.stringify({ type: j.type, id: j.id, season: j.season, episode: j.episode }))}'>Try again</button><button class="icon-btn" data-q="${esc(j.key)}" aria-label="Dismiss">${icon('close')}</button>`))
    const own = items.map(s => {
      const c = s.ctx
      const live = s.phase === 'downloading' ? `${Math.round(s.progress * 100)}% · ${bytes(s.speed)}/s` : ''
      const state = s.phase === 'done' ? 'Ready to watch' : s.phase === 'error' ? esc(s.error) : s.phase === 'metadata' ? 'Getting started...' : s.phase === 'paused' ? { user: 'Paused', watching: 'Paused while you watch', priority: 'Waiting for the first in line' }[s.pausedReason] || 'Paused' : live
      const body = `<div class="d"><span>${s.priority && s.phase !== 'done' ? '<span class="first">First</span> · ' : ''}${state}</span>${s.length ? ' · ' + bytes(s.length) : ''}${s.pinned ? ' · <span>Saved</span>' : ''}</div>${s.phase === 'done' ? '' : `<div class="bar ${s.phase === 'paused' ? 'idle' : ''}"><i style="width:${s.progress * 100}%"></i></div>`}`
      const open = s.phase !== 'done' && s.phase !== 'error'
      const ctl = open ? `<button class="icon-btn ${s.priority ? 'on' : ''}" data-act="${s.priority ? 'unprioritize' : 'prioritize'}" data-h="${s.key}" aria-pressed="${s.priority}" aria-label="${s.priority ? 'Stop prioritizing' : 'Download this first'}" title="${s.priority ? 'Stop prioritizing' : 'Download this first'}">${icon('top')}</button><button class="icon-btn" data-act="${s.held ? 'resume' : 'pause'}" data-h="${s.key}" aria-label="${s.held ? 'Resume download' : 'Pause download'}" title="${s.held ? 'Resume download' : 'Pause download'}">${icon(s.held ? 'play' : 'pause')}</button>` : ''
      return row({ ...c, title: c.title }, body, `${ctl}${open ? '' : `<a class="icon-btn" href="${watchHref(c)}" aria-label="Play">${icon('play')}</a>`}<button class="icon-btn" data-del="${s.key}" aria-label="Delete">${icon('trash')}</button>`)
    })
    // Polled while open: only touch the page when something actually changed (re-rendering resets hover and costs frames).
    const rows = [...queued, ...failed, ...own]
    const shown = all ? rows : rows.slice(0, SHOWN)
    const more = rows.length > SHOWN ? `<button class="btn btn-quiet sm more" data-more>${all ? 'Show fewer' : `Show all ${rows.length}`}</button>` : ''
    const html = shown.join('') + more || `<div class="empty left"><div class="eico">${icon('down')}</div><h2>Nothing downloaded</h2>Use the download button on any title or episode to keep it here for later.</div>`
    if (html !== lastHtml) { lastHtml = html; $('#dl').innerHTML = html }
    return q.queue.length > 0 || items.some(s => s.phase === 'downloading' || s.phase === 'metadata' || (s.phase === 'paused' && s.pausedReason !== 'user'))
  }
  $('#dl').onclick = async e => {
    if (e.target.closest('[data-more]')) { all = !all; lastHtml = ''; return draw() }
    const del = e.target.closest('[data-del]')?.dataset.del
    const q = e.target.closest('[data-q]')?.dataset.q
    const retry = e.target.closest('[data-retry]')?.dataset.retry
    const act = e.target.closest('[data-act]'); const top = e.target.closest('[data-top]')
    if (act) { await api(`/api/library/${act.dataset.h}/${act.dataset.act}`, { method: 'POST' }).catch(() => {}); return draw() }
    if (top) { await api(`/api/downloads/${encodeURIComponent(top.dataset.top)}/${+top.dataset.on ? 'prioritize' : 'unprioritize'}`, { method: 'POST' }).catch(() => {}); return draw() }
    if (del) { await api(`/api/library/${del}`, { method: 'DELETE' }); draw() }
    if (q) { await api(`/api/downloads/${encodeURIComponent(q)}`, { method: 'DELETE' }); draw() }
    if (retry) { await api('/api/download', { method: 'POST', body: JSON.parse(retry) }); draw() }
  }
  // One poll at a time, the next one scheduled after the last finished: quickly while something downloads, rarely when nothing does,
  // and not at all in a hidden tab (it refreshes as soon as the tab is shown again).
  let t
  const loop = async moving => {
    if (dead) return
    clearTimeout(t)
    t = setTimeout(async () => { loop(await draw().catch(() => false)) }, document.hidden ? 60e3 : moving ? 4000 : 30e3)
  }
  const onShow = () => { if (!document.hidden && !dead) { clearTimeout(t); draw().then(loop, () => loop(false)) } }
  document.addEventListener('visibilitychange', onShow)
  loop(await draw())
  cget('/api/local', 30e3).then(local => {
    if (dead || !local.length) return
    const seen = new Set(); const uniq = local.filter(e => { const k = e.type + e.mid; return seen.has(k) ? false : (seen.add(k), true) })
    $('#mine').innerHTML = `<h2 class="sec-h">Your files</h2><div class="grid">${uniq.map(e => poster({ type: e.type, id: e.mid, name: e.name, poster: e.poster, year: e.year })).join('')}</div>`
  }).catch(() => {})
  return () => { dead = true; clearTimeout(t); document.removeEventListener('visibilitychange', onShow) }
}
