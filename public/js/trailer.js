// Trailers: video-host embeds driven through the player API with Dodobox's own controls; the embed stays invisible until it is really playing so a blocked trailer never shows the host's error card.
import { $, esc, icon, clock, isTV, enc, slowLink } from './util.js'
import { cget } from './api.js'
import { volumeHTML, bindVolume } from './volume.js'
import { onBack } from './nav.js'
import { glow } from './ambient.js'

export const canTrailer = () => (matchMedia('(hover: hover) and (pointer: fine)').matches || isTV) && !slowLink() && navigator.onLine

const ORIGIN = 'https://www.youtube-nocookie.com'
const send = (frame, func, args = []) => frame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')

function embed (id, { muted }) {
  const frame = document.createElement('iframe')
  frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  frame.setAttribute('aria-hidden', 'true'); frame.tabIndex = -1
  frame.referrerPolicy = 'strict-origin-when-cross-origin'
  const q = new URLSearchParams({ autoplay: 1, mute: muted ? 1 : 0, controls: 0, playsinline: 1, rel: 0, vq: 'hd1080', modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0, cc_load_policy: 0, enablejsapi: 1, origin: location.origin })
  frame.src = `${ORIGIN}/embed/${id}?${q}`
  return frame
}

function listen (frame, cb) {
  const msg = e => {
    if (e.source !== frame.contentWindow) return
    let d; try { d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data } catch { return }
    if (d.event === 'onError') cb({ error: true })
    if (d.event === 'onReady' || d.event === 'initialDelivery') { send(frame, 'unloadModule', ['captions']); send(frame, 'unloadModule', ['cc']) }
    const i = d.info
    if (i && (i.playerState != null || i.currentTime != null || i.duration != null || i.volume != null)) cb({ time: i.currentTime, duration: i.duration, state: i.playerState, volume: i.volume, muted: i.muted })
  }
  addEventListener('message', msg)
  frame.addEventListener('load', () => frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*'))
  return () => removeEventListener('message', msg)
}

// The embed draws its own title bar, pause glyph and controls for the first moments of every start (and again after a
// pause or a loop), whatever the embed parameters say. The video is only shown once that has faded.
const CHROME_FIRST = 4000 // after the first start and after a loop
const CHROME_RESUME = 1300 // after a pause or buffering

// The embed picks the stream quality from the size of its player, and a small embed gets a small stream. The embed is laid
// out at a real 1080p (720p for small preview cards) and scaled down to the box, so it asks for HD.
export function mountTrailer (box, id, { onPlaying, onFail, width = 1920 } = {}) {
  const frame = embed(id, { muted: true })
  frame.className = 'trailer-frame'
  const W = width; const H = Math.round(width * 9 / 16)
  const fit = () => {
    const r = box.getBoundingClientRect(); if (!r.width) return
    frame.style.cssText = `width:${W}px;height:${H}px;transform:translate(-50%,-47%) scale(${(Math.max(r.width / W, r.height / H) * 1.32).toFixed(4)})`
  }
  const ro = new ResizeObserver(fit); ro.observe(box)
  let playing = false; let done = false; let reveal; let first = true; let last = -1; let restarted = false
  const stop = listen(frame, m => {
    if (m.error) return fail()
    if (m.state == null || m.state === last) return
    last = m.state
    clearTimeout(reveal)
    if (m.state === 1) {
      if (!playing) { playing = true; done = true; send(frame, 'unloadModule', ['captions']) }
      const wait = first || restarted ? CHROME_FIRST : CHROME_RESUME
      restarted = false
      reveal = setTimeout(() => { frame.classList.add('on'); if (first) { first = false; onPlaying?.() } }, wait)
    } else {
      frame.classList.remove('on')
      if (m.state === 0) { restarted = true; send(frame, 'seekTo', [0, true]); send(frame, 'playVideo') } // loop without the host's playlist chrome
    }
  })
  const fail = () => { if (!done) { done = true; destroy(); onFail?.() } }
  const timer = setTimeout(() => { if (!playing) fail() }, 8000)
  box.append(frame)
  fit()
  function destroy () { clearTimeout(timer); clearTimeout(reveal); stop(); ro.disconnect(); frame.remove() }
  return { frame, destroy, unmute: () => { send(frame, 'unMute'); send(frame, 'setVolume', [100]) }, mute: () => send(frame, 'mute'), get playing () { return playing } }
}

export async function watchTrailer (type, id) {
  const layer = $('#layer')
  layer.className = 'player'; layer.hidden = false
  document.documentElement.classList.add('lock')
  const m = await cget(`/api/meta/${type}/${enc(id)}`)
  glow(m.poster)
  layer.innerHTML = `<div class="pl paused ui veil" data-modal data-keys="own" id="tp">
    <div class="tp-stage"></div><div class="tp-cover" style="background-image:url('${esc(m.background || m.poster || '')}')"></div>
    <div class="pl-top"><button class="cbtn" id="back" aria-label="Back">${icon('left')}</button><div class="ttl"><b translate="no">${esc(m.name)}</b><span>Trailer</span></div></div>
    <div class="pl-center"><button id="big" aria-label="Play or pause">${icon('play')}</button></div>
    <div class="pl-bottom">
      <div class="scrub" id="scrub" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0"><div class="track"><div class="done"></div><div class="knob"></div><div class="tip">0:00</div></div></div>
      <div class="ctrls">
        <button class="cbtn" id="pp" aria-label="Play">${icon('play')}</button>
        <button class="cbtn hide-s" id="b10" aria-label="Back 10 seconds">${icon('back10')}</button>
        <button class="cbtn hide-s" id="f10" aria-label="Forward 10 seconds">${icon('fwd10')}</button>
        ${volumeHTML()}
        <span class="time" id="time">0:00</span><span class="sp"></span>
        <a class="btn btn-ink sm" id="watch" href="#/title/${type}/${enc(id)}" data-autofocus>${icon('play')}Play the ${type === 'movie' ? 'movie' : 'show'}</a>
        <button class="cbtn" id="fs" aria-label="Full screen">${icon('fs')}</button>
      </div></div>
    <div class="pl-load" id="load"><div class="bg" style="background-image:url('${esc(m.poster || '')}')"></div>
      <button class="cbtn pl-back" id="back2" aria-label="Back">${icon('left')}</button>
      <div class="msg"><h2 translate="no">${esc(m.name)}</h2><p id="l-line">Loading the trailer...</p><div class="hair"><i></i></div><div class="actions" id="l-act"></div></div></div>
  </div>`
  const root = $('#tp', layer)
  const stage = $('.tp-stage', root)
  const frame = embed(m.trailer, { muted: false })
  stage.append(frame)
  let st = { time: 0, duration: 0, state: -1, volume: 100, muted: false }; let dead = false; let idle; let dragging = false; let veilT; let firstPlay = true

  const fail = () => {
    $('#l-line', root).textContent = 'This trailer is not available right now.'
    $('#l-act', root).innerHTML = `<a class="btn btn-ink" href="#/title/${type}/${enc(id)}" data-autofocus>Back to the title</a>`
    $('.hair', root).hidden = true
  }
  const paint = () => {
    const d = st.duration || 0; const t = dragging ? scrub._t : st.time
    $('.done', scrub).style.width = d ? t / d * 100 + '%' : '0'
    $('.knob', scrub).style.left = d ? t / d * 100 + '%' : '0'
    $('#time', root).textContent = d ? `${clock(t)} / ${clock(d)}` : clock(t)
    scrub.setAttribute('aria-valuenow', Math.floor(t)); scrub.setAttribute('aria-valuemax', Math.floor(d))
  }
  const wake = () => { root.classList.add('ui'); clearTimeout(idle); idle = setTimeout(() => { if (st.state === 1) root.classList.remove('ui') }, isTV ? 4500 : 3200) }
  const update = bindVolume(root, {
    get: () => st.volume / 100,
    set: v => { send(frame, 'unMute'); send(frame, 'setVolume', [Math.round(v * 100)]); st.volume = v * 100; st.muted = false; update(v, false) },
    toggle: () => { st.muted ? send(frame, 'unMute') : send(frame, 'mute'); st.muted = !st.muted; update(st.volume / 100, st.muted) }
  })
  const stop = listen(frame, m => {
    if (dead) return
    if (m.error) return fail()
    if (m.time != null) st.time = m.time
    if (m.duration) st.duration = m.duration
    if (m.volume != null) st.volume = m.volume
    if (m.muted != null) st.muted = !!m.muted
    if (m.state != null && m.state !== st.state) {
      st.state = m.state
      const playing = m.state === 1
      root.classList.toggle('paused', !playing)
      clearTimeout(veilT)
      if (playing) veilT = setTimeout(() => root.classList.remove('veil'), firstPlay ? 4000 : 1300); else root.classList.add('veil')
      if (playing) firstPlay = false
      $('#pp', root).innerHTML = icon(playing ? 'pause' : 'play'); $('#big', root).innerHTML = icon(playing ? 'pause' : 'play')
      if (playing) { $('#load', root).hidden = true; send(frame, 'unloadModule', ['captions']); wake() } else root.classList.add('ui')
    }
    update(st.volume / 100, st.muted); paint()
  })
  const poll = setInterval(() => { if (!dead) frame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*') }, 1000)
  const timeout = setTimeout(() => { if (st.state < 0) fail() }, 9000)

  const toggle = () => (st.state === 1 ? send(frame, 'pauseVideo') : (st.state === 0 && send(frame, 'seekTo', [0, true]), send(frame, 'playVideo')))
  const seek = t => { send(frame, 'seekTo', [Math.max(0, Math.min(st.duration || t, t)), true]); st.time = t; paint(); wake() }
  const scrub = $('#scrub', root)
  const at = e => { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (st.duration || 0) }
  const tip = e => { const t = at(e); const el = $('.tip', scrub); el.textContent = clock(t); el.style.left = t / (st.duration || 1) * 100 + '%'; return t }
  scrub.addEventListener('pointermove', e => { const t = tip(e); if (dragging) { scrub._t = t; paint() } })
  scrub.addEventListener('pointerdown', e => { dragging = true; scrub.classList.add('drag'); scrub.setPointerCapture(e.pointerId); scrub._t = tip(e); paint() })
  scrub.addEventListener('pointerup', e => { if (!dragging) return; dragging = false; scrub.classList.remove('drag'); seek(at(e)) })
  scrub.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); seek(st.time - 10) } else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seek(st.time + 10) } })

  $('#pp', root).onclick = toggle; $('#big', root).onclick = toggle
  $('#b10', root).onclick = () => seek(st.time - 10); $('#f10', root).onclick = () => seek(st.time + 10)
  const goBack = () => (history.length > 1 ? history.back() : (location.hash = `#/title/${type}/${enc(id)}`))
  $('#back', root).onclick = goBack; $('#back2', root).onclick = goBack
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement
  const toggleFS = () => (fsEl() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : root.requestFullscreen?.().catch(() => {}))
  $('#fs', root).onclick = toggleFS
  stage.addEventListener('click', toggle)
  root.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') wake() }); root.addEventListener('focusin', wake)
  const onKey = e => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.matches?.('input')) return
    const k = e.key
    if (k === ' ' || k === 'k') { if (e.target.matches?.('a, button') && k === ' ') return; e.preventDefault(); toggle(); wake() }
    else if (k === 'ArrowLeft' && !isTV) { e.preventDefault(); seek(st.time - 10) } else if (k === 'ArrowRight' && !isTV) { e.preventDefault(); seek(st.time + 10) }
    else if (k === 'f') toggleFS()
    else if (k === 'm') $('.vm', root).click()
    else if (k === 'MediaPlayPause') toggle()
  }
  document.addEventListener('keydown', onKey)
  onBack.handler = () => { if (fsEl()) { document.exitFullscreen?.(); return true } return false }

  return () => {
    dead = true; stop(); clearInterval(poll); clearTimeout(timeout); clearTimeout(idle); clearTimeout(veilT)
    document.removeEventListener('keydown', onKey); onBack.handler = null
    if (fsEl()) document.exitFullscreen?.()
    document.documentElement.classList.remove('lock')
    layer.hidden = true; layer.innerHTML = ''; layer.className = ''
  }
}
