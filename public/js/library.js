import { api, cget } from './api.js'
import { S } from './session.js'
import { $, esc, icon, bytes, poster, enc, mins } from './util.js'
import { calm } from './ambient.js'
import { dragScroll } from './drag.js'

const watchHref = c => `#/watch/${c.type}/${enc(c.id)}` + (c.season != null ? `/${c.season}/${c.episode}` : '')
const SE = i => (i.season != null ? `S${i.season} E${i.episode}` : '')

const rail = (title, items, id) => items.length ? `<section class="shelf" id="${id}"><div class="shelf-h"><h2>${esc(title)}</h2></div><div class="rail">${items.join('')}</div></section>` : ''

// Everything the viewer has done on Dodobox in one place: what they are watching, what they want, how they rated things,
// what they have watched, and what is stored on the server.
export async function library (root) {
  calm()
  const me = S.me
  const rated = v => Object.values(me.ratings || {}).filter(r => r.v === v).sort((a, b) => b.at - a.at)
  root.innerHTML = `<div class="view page">
    <div class="page-h"><h1>Library</h1></div>
    <div id="mine-shelves">
      ${rail('Continue watching', me.recent.map(r => poster({ ...r, rating: null }, { href: watchHref(r), progress: r.pos / r.dur, sub: `${SE(r) ? SE(r) + ' · ' : ''}${mins(Math.max(60, r.dur - r.pos))} left` })), 'l-recent')}
      ${rail('My List', me.list.map(i => poster(i)), 'l-list')}
      ${rail('Loved', rated(2).map(i => poster(i)), 'l-loved')}
      ${rail('Liked', rated(1).map(i => poster(i)), 'l-liked')}
      ${rail('Watch history', (me.history || []).map(h => poster(h, { sub: h.finished ? 'Watched' : SE(h) || h.year })), 'l-history')}
    </div>
    <h2 class="sec-h">Downloads</h2>
    <div class="group" style="margin:0;max-width:none;padding:0 var(--pad)"><div class="meter" style="max-width:36rem"><i id="used" style="width:0"></i></div><p class="dim" id="usedtxt" style="margin:.5rem 0 0"></p></div>
    <div class="list" id="dl"></div>
    <div id="mine"></div></div>`
  root.querySelectorAll('.rail').forEach(dragScroll)
  let dead = false; let lastHtml = ''

  async function draw () {
    const [items, st, q] = await Promise.all([api('/api/library'), api('/api/storage'), api('/api/downloads')])
    if (dead) return
    $('#used').style.width = Math.min(100, st.used / st.cap * 100) + '%'
    const usedText = `${bytes(st.used)} of ${bytes(st.cap)} used. Oldest unwatched downloads are removed automatically when it fills up. Downloads you start yourself are kept.`
    $('#usedtxt').textContent = usedText
    const label = c => (c.season != null ? `${c.title} · S${c.season} E${c.episode}` : c.title)
    const row = (c, body, acts) => `<div class="item"><a class="th" href="${watchHref(c)}" style="background-image:url('${esc(c.poster || '')}')" aria-label="Play"></a>
      <div><span class="t" translate="no">${esc(label(c))}</span>${body}</div><div class="acts">${acts}</div></div>`
    const queued = q.queue.map(j => row({ ...j, title: j.title }, '<div class="d">Waiting to download</div>', `<button class="btn btn-quiet sm" data-q="${esc(j.key)}" aria-label="Remove from the queue">${icon('close')}</button>`))
    const failed = q.failed.map(j => row({ ...j, title: j.title }, '<div class="d err">Could not find a source for this one</div>', `<button class="btn btn-ghost sm" data-retry='${esc(JSON.stringify({ type: j.type, id: j.id, season: j.season, episode: j.episode }))}'>Try again</button><button class="btn btn-quiet sm" data-q="${esc(j.key)}" aria-label="Dismiss">${icon('close')}</button>`))
    const own = items.map(s => {
      const c = s.ctx
      const state = s.phase === 'done' ? 'Ready to watch' : s.phase === 'error' ? esc(s.error) : s.phase === 'metadata' ? 'Getting started...' : s.phase === 'paused' ? (s.pausedReason === 'watching' ? 'Paused while you watch' : 'Paused') : `${Math.round(s.progress * 100)}% · ${bytes(s.speed)}/s`
      const body = `<div class="name">${esc(s.name || c.release || s.hash)}</div><div class="d">${state}${s.length ? ' · ' + bytes(s.length) : ''}${s.pinned ? ' · Saved' : ''}</div>${s.phase === 'done' ? '' : `<div class="bar"><i style="width:${s.progress * 100}%"></i></div>`}`
      return row({ ...c, title: c.title }, body, `<a class="btn btn-ghost sm" href="${watchHref(c)}">${icon('play')}Play</a><button class="btn btn-quiet sm" data-del="${s.key}" aria-label="Delete">${icon('trash')}</button>`)
    })
    // Polled while open: only touch the page when something actually changed (re-rendering resets hover and costs frames).
    const html = [...queued, ...failed, ...own].join('') || `<div class="empty" style="padding:2rem 0;text-align:left;margin:0"><div class="eico" style="margin-left:0">${icon('down')}</div><h2>Nothing downloaded</h2>Use the download button on any title or episode to keep it here for later.</div>`
    if (html !== lastHtml) { lastHtml = html; $('#dl').innerHTML = html }
  }
  $('#dl').onclick = async e => {
    const del = e.target.closest('[data-del]')?.dataset.del
    const q = e.target.closest('[data-q]')?.dataset.q
    const retry = e.target.closest('[data-retry]')?.dataset.retry
    if (del) { await api(`/api/library/${del}`, { method: 'DELETE' }); draw() }
    if (q) { await api(`/api/downloads/${encodeURIComponent(q)}`, { method: 'DELETE' }); draw() }
    if (retry) { await api('/api/download', { method: 'POST', body: JSON.parse(retry) }); draw() }
  }
  await draw()
  const t = setInterval(() => draw().catch(() => {}), 4000)
  cget('/api/local', 30e3).then(local => {
    if (dead || !local.length) return
    const seen = new Set(); const uniq = local.filter(e => { const k = e.type + e.mid; return seen.has(k) ? false : (seen.add(k), true) })
    $('#mine').innerHTML = `<h2 class="sec-h">Your files</h2><div class="grid">${uniq.map(e => poster({ type: e.type, id: e.mid, name: e.name, poster: e.poster, year: e.year })).join('')}</div>`
  }).catch(() => {})
  return () => { dead = true; clearInterval(t) }
}
