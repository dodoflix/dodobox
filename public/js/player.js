import { api, cget, getProfile } from './api.js'
import { S, progress, recordProgress } from './session.js'
import { nowPlaying, pingPresence } from './presence.js'
import { mapTime, offsetAt, classify } from './syncmap.js'
import { $, EP_PAGE, esc, icon, enc, clock, bytes, store, sleep, toast, isTV, isSafari, lowres, sized, thumbW, hue } from './util.js'
import { glow } from './ambient.js'
import { onBack } from './nav.js'
import { dragScroll } from './drag.js'
import { loadCast, castTo } from './cast.js'
import { LANGUAGES, langOf } from './onboarding.js'
import { volumeHTML, bindVolume } from './volume.js'
import { bandwidth, saveData, displayPx, measure as measureBandwidth } from './bandwidth.js'

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]
const QUALITIES = [['auto', 'Auto'], ['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p, data saver']]
// Language names come in the interface language; 'Unknown language' is translated by the page translator.
const LANG = (() => { try { const n = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'language' }); return c => !c || c === 'und' ? 'Unknown language' : c === 'pob' ? n.of('pt-BR') : n.of(c) } catch { return c => c } })()
const watchHref = (t, id, s, e) => `#/watch/${t}/${enc(id)}` + (s != null ? `/${s}/${e}` : '')

// Subtitle files carry their own styling: bold, underline, fonts, colours. Built-in (ASS) tracks use it freely and external
// files hardly at all, so honouring it made the two look like different fonts. Only italics (emphasis) is kept.
function cueHTML (text) {
  return text.split(/(<\/?i>)/i).map((p, k) => k % 2 ? p : esc(p.replace(/<[^>]*>/g, ''))).join('')
}

// The player library is big and only needed to play: it is fetched here, not with the page.
const loadHls = () => window.Hls ? Promise.resolve() : new Promise(resolve => { const s = document.createElement('script'); s.src = '/vendor/hls.js'; s.onload = s.onerror = resolve; document.head.append(s) })

export async function watch (type, id, season, episode) {
  const hlsReady = loadHls()
  const layer = $('#layer')
  layer.className = 'player'; layer.hidden = false
  document.documentElement.classList.add('lock')
  const m = await cget(`/api/meta/${type}/${enc(id)}`)
  const flat = type === 'movie' || m.movie
  season = flat ? (m.movie ? 1 : null) : +season || 1
  episode = flat ? (m.movie ? 1 : null) : +episode || 1
  const vids = m.videos || []
  const at = vids.findIndex(v => v.season === season && v.episode === episode)
  const ep = vids[at]
  const next = flat ? null : vids[at + 1]
  const epTitle = !flat && ep?.title && !/^Episode \d+$/.test(ep.title) ? ep.title : ''
  // For the cast receiver and the media session, which show plain text; the title bar builds its own so the episode code translates.
  const label = flat ? '' : `S${season} E${episode}${epTitle ? ' · ' + epTitle : ''}`
  glow(m.poster)

  layer.innerHTML = `
  <div class="pl paused ui" data-modal data-keys="own">
    <video playsinline preload="auto"></video>
    <div class="pl-subs" aria-hidden="true"></div>
    <div class="pl-fx l"></div><div class="pl-fx r"></div>
    <div class="pl-spin" hidden></div>
    <div class="pl-top"><button class="cbtn" id="back" aria-label="Back">${icon('left')}</button>
      <div class="ttl"><b translate="no">${esc(m.name)}</b>${flat ? '' : `<span><span>S${season} E${episode}</span>${epTitle ? ` · <span translate="no">${esc(epTitle)}</span>` : ''}</span>`}</div></div>
    <div class="pl-center"><button id="big" aria-label="Play or pause">${icon('play')}</button></div>
    <div class="pl-bottom">
      <div class="scrub" id="scrub" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0"><div class="track"><div class="buf"></div><div class="done"></div><div class="knob"></div><div class="tip">0:00</div></div></div>
      <div class="ctrls">
        <button class="cbtn" id="pp" aria-label="Play">${icon('play')}</button>
        <button class="cbtn hide-s" id="b10" aria-label="Back 10 seconds">${icon('back10')}</button>
        <button class="cbtn hide-s" id="f10" aria-label="Forward 10 seconds">${icon('fwd10')}</button>
        ${volumeHTML()}
        <span class="time" id="time">0:00</span>
        <span class="sp"></span>
        ${next ? `<button class="cbtn" id="nxt" aria-label="Next episode">${icon('next')}</button>` : ''}
        ${flat || vids.length < 2 ? '' : `<button class="cbtn" id="m-eps" aria-label="Episodes">${icon('list')}</button>`}
        <button class="cbtn only-s" id="m-settings" aria-label="Settings">${icon('gear')}</button>
        <button class="cbtn" id="m-party" aria-label="Watch party">${icon('party')}</button>
        <button class="cbtn hide-s" id="m-speed" aria-label="Speed">${icon('speed')}</button>
        <button class="cbtn" id="m-audio" aria-label="Audio" hidden>${icon('audio')}</button>
        <button class="cbtn" id="m-subs" aria-label="Subtitles">${icon('cc')}</button>
        <button class="cbtn" id="m-quality" aria-label="Quality and speed">${icon('quality')}</button>
        <button class="cbtn hide-s" id="pip" aria-label="Picture in picture" hidden>${icon('pip')}</button>
        <button class="cbtn" id="cast" aria-label="Cast to TV" hidden>${icon('cast')}</button>
        <button class="cbtn" id="airplay" aria-label="AirPlay" hidden>${icon('airplay')}</button>
        <button class="cbtn" id="fs" aria-label="Full screen">${icon('fs')}</button>
      </div>
    </div>
    <button class="pl-slow" id="slow" hidden>Slow connection. Try another version</button>
    <div class="pl-stats" id="stats" hidden></div>
    <div class="pl-menu" id="menu" hidden></div>
    <div class="pl-next" id="up" hidden></div>
    <div class="pl-cast" id="casting" hidden></div>
    <div class="pl-load" id="load"><div class="bg" style="background-image:url('${esc(lowres(m.poster) || m.poster || '')}')"></div>
      <button class="cbtn pl-back" id="back2" aria-label="Back">${icon('left')}</button>
      <div class="msg"><h2 id="l-title" translate="no">${esc(m.name)}</h2><p id="l-line">Getting ready...</p><div class="hair"><i id="l-bar"></i></div><div class="actions" id="l-act"></div></div></div>
    <input type="file" id="subfile" accept=".srt,.vtt,.ass,.ssa,.sub" hidden>
  </div>`

  const root = $('.pl', layer); const v = $('video', root)
  const subsEl = $('.pl-subs', root); const menu = $('#menu', root)
  let dead = false; let hash; let st; let info; let mode = 'direct'; let hls
  const titleKey = `title:${getProfile()}:${type}:${id}`
  const P = store.get(titleKey, {})
  const keep = (k, val) => { P[k] = val; store.set(titleKey, P) }
  let audio = 0; let quality = P.quality || S.me.settings.quality || 'auto'; let autoH = null
  let subs = []; let subSel = null; let delay = 0; let subsDone = false
  let startAt = (progress(type, id, season, episode) || [0, 1])
  startAt = startAt[0] / startAt[1] < 0.95 && startAt[0] > 10 ? startAt[0] : 0
  const timers = []; const tried = new Set()
  let castCtl = null; let detachParty = null; let partyPanel = null

  let picH = 0
  const applySize = () => root.style.setProperty('--sub', `${(isTV ? 33.6 : picH ? Math.min(28, Math.max(13, picH * 0.06)) : innerWidth < 700 ? 16 : 28) * (P.size ?? store.get('subsize', 1))}px`)
  applySize()
  if (P.speed) v.defaultPlaybackRate = v.playbackRate = P.speed

  const setLoad = ({ title, line, pct, actions } = {}) => {
    $('#load', root).hidden = false
    if (title) $('#l-title', root).textContent = title
    if (line != null) $('#l-line', root).textContent = line
    const bar = $('#l-bar', root)
    bar.classList.toggle('det', pct != null)
    bar.style.transform = pct != null ? `scaleX(${Math.max(0.04, pct)})` : ''
    if (actions !== undefined) $('#l-act', root).innerHTML = actions
  }
  const defaultAudio = () => info.audio?.find(a => a.default)?.i ?? 0
  const tag3 = c => ({ deu: 'ger', fra: 'fre', zho: 'chi', nld: 'dut', gre: 'ell' })[c] || c
  const isDub = a => /dub|commentary|descriptive/i.test(a.title || '')
  const origLang = m.originalLanguage || (type === 'anime' ? 'jpn' : null)
  const bestAudio = () => {
    const all = info.audio || []; const plain = all.filter(a => !isDub(a))
    const orig = all.filter(a => origLang && tag3(a.lang) === origLang)
    return (orig.find(a => !isDub(a)) || orig[0] || plain.find(a => a.default) || plain[0] || all.find(a => a.default) || all[0])?.i ?? 0
  }
  const pickAudio = () => {
    const saved = P.audio && info.audio?.find(a => a.lang === P.audio.lang && (a.title || '') === P.audio.title)
    return saved ? saved.i : bestAudio()
  }
  const hideLoad = () => { $('#load', root).hidden = true }
  const showSlowLink = () => { if (!$('#another', root) && !$('#retry', root)) $('#l-act', root).innerHTML = '<button class="slow-link" id="another">Try another version</button>' }
  const fail = (title, line) => setLoad({ title, line, actions: '<button class="btn btn-ink" id="retry" data-autofocus>Try again</button><a class="btn btn-ghost" href="#/title/' + type + '/' + enc(id) + '">Go back</a>' })

  const fx = (side, text) => { const el = $(`.pl-fx.${side}`, root); el.textContent = text; el.classList.remove('go'); void el.offsetWidth; el.classList.add('go') }
  const seekBy = d => { if (!v.duration) return; v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + d)); fx(d > 0 ? 'r' : 'l', (d > 0 ? '+' : '') + d + 's'); wake() }

  let idleT; let ui = true
  const setUI = on => { ui = on; root.classList.toggle('ui', on); root.dataset.keys = isTV && on ? '' : 'own' }
  function wake () {
    setUI(true); clearTimeout(idleT)
    idleT = setTimeout(() => { if (!v.paused && menu.hidden && !root.matches(':hover .pl-bottom:hover')) { setUI(false); document.activeElement?.blur?.() } }, isTV ? 4500 : 3200)
  }
  root.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') wake() })
  root.addEventListener('focusin', wake)

  const sync = () => {
    const p = v.paused
    root.classList.toggle('paused', p)
    $('#pp', root).innerHTML = icon(p ? 'play' : 'pause'); $('#pp', root).setAttribute('aria-label', p ? 'Play' : 'Pause')
    $('#big', root).innerHTML = icon(p ? 'play' : 'pause')
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = p ? 'paused' : 'playing'
  }
  v.addEventListener('play', () => { sync(); pingPresence() }); v.addEventListener('pause', () => { sync(); save(); wake(); pingPresence() }); v.addEventListener('seeked', pingPresence)
  v.addEventListener('playing', () => { clearTimeout(wd); clearTimeout(slowT); $('#slow', root).hidden = true; hideLoad(); $('.pl-spin', root).hidden = true; sync(); wake(); wakeLock() })
  let spinT
  let slowT
  v.addEventListener('waiting', () => { clearTimeout(spinT); spinT = setTimeout(() => { $('.pl-spin', root).hidden = false }, 450); clearTimeout(slowT); slowT = setTimeout(() => { if (!v.paused && v.readyState < 3 && info) $('#slow', root).hidden = false }, 9000) })
  v.addEventListener('canplay', () => { clearTimeout(spinT); clearTimeout(slowT); $('.pl-spin', root).hidden = true; $('#slow', root).hidden = true })
  v.addEventListener('seeked', () => { clearTimeout(spinT); $('.pl-spin', root).hidden = true })
  v.volume = store.get('vol', 1); v.muted = store.get('muted', false)
  const updateVol = bindVolume(root, { get: () => v.volume, set: x => { v.muted = false; v.volume = x }, toggle: () => { v.muted = !v.muted } })
  v.addEventListener('volumechange', () => { updateVol(v.volume, v.muted); store.set('vol', v.volume); store.set('muted', v.muted) })
  updateVol(v.volume, v.muted)

  const scrub = $('#scrub', root)
  let dragging = false
  function paintTime () {
    const d = v.duration || 0; const t = dragging ? scrub._t : v.currentTime
    $('.done', scrub).style.width = d ? t / d * 100 + '%' : '0'
    $('.knob', scrub).style.left = d ? t / d * 100 + '%' : '0'
    let b = 0; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) > b) b = v.buffered.end(i)
    $('.buf', scrub).style.width = d ? b / d * 100 + '%' : '0'
    $('#time', root).textContent = d ? `${clock(t)} / ${clock(d)}` : clock(t)
    scrub.setAttribute('aria-valuenow', Math.floor(t)); scrub.setAttribute('aria-valuemax', Math.floor(d)); scrub.setAttribute('aria-valuetext', clock(t))
  }
  v.addEventListener('timeupdate', () => { paintTime(); upNextCheck() })
  v.addEventListener('progress', paintTime); v.addEventListener('durationchange', paintTime)
  const at2 = e => { const r = scrub.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (v.duration || 0) }
  const tip = e => { const t = at2(e); const el = $('.tip', scrub); el.textContent = clock(t); el.style.left = t / (v.duration || 1) * 100 + '%'; return t }
  scrub.addEventListener('pointermove', e => { const t = tip(e); if (dragging) { scrub._t = t; paintTime() } })
  scrub.addEventListener('pointerdown', e => { dragging = true; scrub.classList.add('drag'); scrub.setPointerCapture(e.pointerId); scrub._t = tip(e); paintTime() })
  scrub.addEventListener('pointerup', e => { if (!dragging) return; dragging = false; scrub.classList.remove('drag'); v.currentTime = at2(e); wake() })
  scrub.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); seekBy(-10) } else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seekBy(10) }
  })

  const toggle = () => { if (castCtl) return castCtl.toggle(); v.paused ? v.play().catch(() => {}) : v.pause() }
  $('#pp', root).onclick = toggle; $('#big', root).onclick = toggle
  $('#b10', root).onclick = () => seekBy(-10); $('#f10', root).onclick = () => seekBy(10)
  const leave = () => { location.replace(`#/title/${type}/${enc(id)}`) }
  $('#back', root).onclick = leave; $('#back2', root).onclick = leave
  $('#nxt', root)?.addEventListener('click', () => go(next))
  const go = n => { save(); location.replace(watchHref(type, id, n.season, n.episode)) }

  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement
  const toggleFS = () => {
    const rf = root.requestFullscreen || root.webkitRequestFullscreen
    if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); screen.orientation?.unlock?.() } else if (rf) Promise.resolve(rf.call(root)).then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {})
    else if (v.webkitEnterFullscreen) {
      // iPhone only shows the video itself in full screen, so nothing of ours (the chat included) can be on top of it: in a party it asks first.
      const enter = () => v.webkitEnterFullscreen()
      if (detachParty) import('./party.js').then(p => (p.active() ? toast('Chat is hidden in full screen on iPhone', { key: 'fs', ms: 7000, action: { label: 'Full screen', run: enter } }) : enter())).catch(enter)
      else enter()
    }
  }
  $('#fs', root).onclick = toggleFS
  // The layout changes with the screen (a phone turned sideways to watch), so a menu left open from the other layout is closed instead of left half-drawn.
  const fsChange = () => { $('#fs', root).innerHTML = icon(fsEl() ? 'exitfs' : 'fs'); closeMenu() }
  document.addEventListener('fullscreenchange', fsChange); document.addEventListener('webkitfullscreenchange', fsChange)
  const narrow = matchMedia('(max-width: 700px)'); narrow.addEventListener('change', () => closeMenu())
  if (document.pictureInPictureEnabled && !isTV) { $('#pip', root).hidden = false; $('#pip', root).onclick = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : v.requestPictureInPicture()).catch(() => {}) }
  if (window.WebKitPlaybackTargetAvailabilityEvent) {
    v.addEventListener('webkitplaybacktargetavailabilitychanged', e => { $('#airplay', root).hidden = e.availability !== 'available' })
    $('#airplay', root).onclick = () => v.webkitShowPlaybackTargetPicker()
  }

  let lastTap = { t: 0, x: 0 }; let clickT
  root.addEventListener('pointerup', e => {
    if (e.target !== v && !e.target.classList.contains('pl-subs')) return
    if (e.pointerType === 'mouse') {
      clearTimeout(clickT)
      if (e.detail === 2) return toggleFS()
      clickT = setTimeout(toggle, 230)
    } else {
      const side = e.clientX < innerWidth / 3 ? -1 : e.clientX > innerWidth * 2 / 3 ? 1 : 0
      if (Date.now() - lastTap.t < 320 && side && side === lastTap.side) { clearTimeout(clickT); seekBy(10 * side); lastTap = { t: 0 } } else {
        lastTap = { t: Date.now(), side }
        clickT = setTimeout(() => { ui ? setUI(false) : wake() }, 320)
      }
    }
  })

  // Playback stats for advanced users and bug reports: what is playing, how it is decoded, what the buffer and the download are doing.
  let statsOn = store.get('stats', false)
  const statsEl = $('#stats', root)
  const buffered = () => { const t = v.currentTime; for (let i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= t + 0.1 && t <= v.buffered.end(i)) return v.buffered.end(i) - t; return 0 }
  const statsRows = () => {
    const q = v.getVideoPlaybackQuality?.(); const lvl = hls?.levels?.[hls.currentLevel]
    const mbps = info?.duration && st?.length ? (st.length * 8 / info.duration / 1e6).toFixed(1) + ' Mbps' : '-'
    return [
      ['File', st?.name || '-'],
      ['Playing as', mode === 'direct' ? 'Direct play' : `Converted, ${engines[engineAt] === 'hlsjs' ? 'hls.js' : engines[engineAt] || '-'}`],
      ['Video', info ? `${info.vcodec || '?'} ${info.width || '?'}x${info.height || '?'}` : '-'],
      ['Audio', info ? `${info.acodec || '?'}, track ${audio + 1} of ${info.audio?.length || 1}` : '-'],
      ['Decoded', v.videoWidth ? `${v.videoWidth}x${v.videoHeight}` : '-'],
      ['Shown in', `${v.clientWidth}x${v.clientHeight} at ${devicePixelRatio || 1}x`],
      ['Quality', `${quality === 'auto' ? 'Auto' : quality + 'p'}${cap() ? `, capped at ${cap()}p` : ''}${lvl?.bitrate ? `, ${(lvl.bitrate / 1e6).toFixed(1)} Mbps` : ''}`],
      ['Frames', q ? `${q.droppedVideoFrames} dropped of ${q.totalVideoFrames}` : '-'],
      ['Buffer', `${buffered().toFixed(1)} s ahead`],
      ['Position', `${clock(v.currentTime)} of ${clock(v.duration || info?.duration || 0)}${v.playbackRate !== 1 ? ` at ${v.playbackRate}x` : ''}`],
      ['Element', `ready ${v.readyState}, network ${v.networkState}${v.error ? `, error ${v.error.code}` : ''}`],
      ['Source rate', mbps],
      ['Your link', `${bandwidth() || '?'} Mbps measured${hls?.bandwidthEstimate ? `, ${(hls.bandwidthEstimate / 1e6).toFixed(1)} Mbps seen` : ''}`],
      ['Release', st?.ctx?.release || '-'],
      ['Found on', st?.ctx?.provider ? `${st.ctx.provider}, ${st.ctx.seeders ?? '?'} seeders when found` : '-'],
      ...st?.torrent?.name && st.torrent.name !== st.ctx?.release ? [['Torrent', st.torrent.name]] : [],
      ['Info hash', hash || '-'],
      ['Contents', st?.torrent ? `${st.torrent.files} file${st.torrent.files === 1 ? '' : 's'}, ${bytes(st.torrent.size)}, file ${st.fileIdx ?? '?'}, pieces of ${bytes(st.torrent.pieceLength || 0)}` : '-'],
      ['Swarm', st ? `${st.peers ?? 0} peers, ${bytes(st.torrent?.uploadSpeed || 0)}/s up` : '-'],
      ['Shared', st?.torrent ? `${bytes(st.torrent.uploaded || 0)} up, ratio ${(st.torrent.ratio || 0).toFixed(2)}` : '-'],
      ['Download', st ? `${st.phase}${st.pausedReason ? ` (${st.pausedReason})` : ''}, ${Math.round((st.progress || 0) * 100)}%, ${bytes(st.speed || 0)}/s, ${st.peers ?? 0} peers` : '-'],
      ['Received', st ? `${bytes(st.downloaded || 0)} of ${bytes(st.length || 0)}` : '-']
    ]
  }
  function drawStats () {
    statsEl.hidden = !statsOn
    if (!statsOn) return
    statsEl.innerHTML = `<div class="st-h"><h4>Playback stats</h4><button class="icon-btn" data-copy aria-label="Copy stats">${icon('copy')}</button><button class="icon-btn" data-close aria-label="Close stats">${icon('close')}</button></div>
      <dl>${statsRows().map(([k, x]) => `<dt>${k}</dt><dd>${esc(x)}</dd>`).join('')}</dl>`
  }
  const toggleStats = () => { statsOn = !statsOn; store.set('stats', statsOn); drawStats(); if (menuKind) drawMenu() }
  statsEl.onclick = e => {
    if (e.target.closest('[data-close]')) toggleStats()
    if (e.target.closest('[data-copy]')) navigator.clipboard?.writeText(statsRows().map(([k, x]) => `${k}: ${x}`).join('\n') + `\nBrowser: ${navigator.userAgent}`).then(() => toast('Stats copied'), () => toast('Could not copy'))
  }

  let menuKind = null
  const closeMenu = () => { menu.hidden = true; menuKind = null; wake() }
  const row = (label, { on, extra = '', data = '', disabled } = {}) => `<button ${data} class="${on ? 'on' : ''}" ${disabled ? 'disabled' : ''}><span>${label}</span>${on ? icon('check') : extra}</button>`
  function drawMenu () {
    if (!menuKind) return
    let h = ''
    if (menuKind === 'speed') h = '<h4>Speed</h4>' + SPEEDS.map(s => row(s === 1 ? 'Normal' : s + '×', { on: v.playbackRate === s, data: `data-speed="${s}"` })).join('')
    if (menuKind === 'quality') h = '<h4>Quality</h4>' + QUALITIES.filter(([q]) => q === 'auto' || +q <= (info?.tier || 2160) || q === quality).map(([q, n]) => row(n, { on: quality === q, data: `data-q="${q}"`, extra: q === 'auto' && autoH ? `<small>${autoH}p for your connection</small>` : '' })).join('') +
      '<hr><h4>Speed</h4>' + SPEEDS.map(sp => row(sp === 1 ? 'Normal' : sp + '×', { on: v.playbackRate === sp, data: `data-speed="${sp}"` })).join('') +
      '<hr>' + row('Try another version', { data: 'data-another' }) + row('Playback stats', { on: statsOn, data: 'data-stats' })
    // On a phone the audio, subtitles, quality, speed and party buttons are one Settings button that lists them.
    if (menuKind === 'settings') {
      const q = QUALITIES.find(x => x[0] === quality)
      h = '<h4>Settings</h4>' + [
        ['subs', 'Subtitles', subSel ? subSel.label : 'Off'],
        info?.audio?.length > 1 ? ['audio', 'Audio', LANG(info.audio.find(a => a.i === audio)?.lang || 'und')] : null,
        ['quality', 'Quality and speed', `${q ? q[1] : quality}${v.playbackRate !== 1 ? ` · ${v.playbackRate}×` : ''}`],
        partyPanel ? ['party', 'Watch party', ''] : null
      ].filter(Boolean).map(([k, n, x]) => row(n, { data: `data-menu="${k}"`, extra: `${x ? `<small>${esc(x)}</small>` : ''}${icon('right')}` })).join('') + row('Try another version', { data: 'data-another' }) + row('Playback stats', { on: statsOn, data: 'data-stats' })
    }
    if (menuKind === 'audio') h = '<h4>Audio</h4>' + info.audio.map(a => row(esc(LANG(a.lang || 'und')) + (a.title ? ` · ${esc(a.title)}` : '') + (a.i === bestAudio() ? '<small class="hint">Default</small>' : ''), { on: a.i === audio, data: `data-a="${a.i}"`, extra: `<small>${esc(a.codec)}</small>` })).join('')
    if (menuKind === 'subs') return drawSubsMenu()
    if (menuKind === 'eps') return drawEpsMenu()
    if (menuKind === 'party') { menu.className = 'party-pop in-player'; partyPanel.render(menu); return }
    menu.className = 'pl-menu'
    menu.innerHTML = h
  }
  let epSeason = season; let epPage = 0
  // The range holding the episode being played opens first, as on the title page.
  const pageOf = s => (s === season ? Math.max(0, Math.floor(vids.filter(x => x.season === s).findIndex(x => x.episode === episode) / EP_PAGE)) : 0)
  function drawEpsMenu () {
    const seasons = [...new Set(vids.map(x => x.season))].sort((a, b) => a - b)
    const keep = menu.scrollTop
    const list = vids.filter(x => x.season === epSeason)
    const pages = Math.ceil(list.length / EP_PAGE)
    if (epPage >= pages) epPage = 0
    menu.className = 'pl-menu ep-menu'
    menu.innerHTML = `${seasons.length > 1 ? `<div class="tabs">${seasons.map(n => `<button class="chip ${n === epSeason ? 'on' : ''}" data-es="${n}">${n ? 'Season ' + n : 'Specials'}</button>`).join('')}</div>` : ''}
      ${pages > 1 ? `<div class="tabs ranges">${Array.from({ length: pages }, (_, k) => `<button class="chip ${k === epPage ? 'on' : ''}" data-ep="${k}">${list[k * EP_PAGE].episode}-${list[Math.min(list.length, (k + 1) * EP_PAGE) - 1].episode}</button>`).join('')}</div>` : ''}
      <div class="eps">${list.slice(epPage * EP_PAGE, (epPage + 1) * EP_PAGE).map(x => {
        const p = progress(type, id, x.season, x.episode); const r = p ? p[0] / p[1] : 0
        const cur = x.season === season && x.episode === episode
        const d = x.released ? new Date(x.released).toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
        return `<a class="ep ${cur ? 'cur' : ''}" href="${watchHref(type, id, x.season, x.episode)}" data-ee="${x.season}/${x.episode}">
          <span class="n">${x.episode}</span>
          <span class="th" ${m.background || m.poster ? `data-art="url('${esc(sized(m.background || m.poster, thumbW()))}')"` : ''} style="--h:${hue(m.name)}"><b class="num" aria-hidden="true">${x.episode}</b>${x.thumbnail ? `<img alt="" data-src="${esc(sized(x.thumbnail, thumbW()))}" onload="this.classList.add('in')" onerror="this.remove()">` : ''}${r > 0.02 ? `<span class="prog"><i style="width:${Math.min(100, r * 100)}%"></i></span>` : ''}<span class="go">${icon('play')}</span>${r > 0.93 ? `<span class="ok">${icon('check')}</span>` : ''}</span>
          <span><span class="t" translate="no">${esc(x.title)}</span><br><span class="d">${cur ? 'Playing now' : d}</span></span></a>`
      }).join('')}</div>`
    menu.scrollTop = keep
    // The strips scroll like the others: dragged with a mouse, with arrows, and opened on the chip in use.
    for (const t of menu.querySelectorAll('.tabs')) {
      dragScroll(t)
      const on = t.querySelector('.on')
      if (on) t.scrollLeft += on.getBoundingClientRect().left - t.getBoundingClientRect().left - (t.clientWidth - on.offsetWidth) / 2
    }
  }
  function drawSubsMenu () {
    const sgn = x => { const r = Math.round(x * 10) / 10; return r === 0 ? '0.0' : (r > 0 ? '+' : '') + r.toFixed(1) }
    const autoNow = syncRes && autoOn() && subSel && !subSel.embedded ? mapTime(syncRes, v.currentTime) - v.currentTime : 0
    const groups = new Map()
    for (const x of subs) { const k = x.lang || '_file'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x) }
    const pref = S.me.settings.sublang
    const order = [...groups.keys()].sort((a, b) => (b === pref) - (a === pref) || (b === 'eng') - (a === 'eng') || (a === '_file') - (b === '_file') || LANG(a).localeCompare(LANG(b)))
    smLang ??= subSel ? (subSel.lang || '_file') : 'off'
    const files = smLang !== 'off' ? groups.get(smLang) || [] : []
    // The search is over and nothing real (not a machine translation) exists in the viewer's language.
    const missing = subsDone && pref && pref !== 'off' && !subs.some(x => x.lang === pref && !x.translated && !x.pending && !x.forced)
    const name = k => (k === '_file' ? 'From file' : LANG(k))
    const keep = ['.sm-langs', '.sm-files'].map(q => menu.querySelector(q)?.scrollTop || 0)
    menu.className = 'pl-menu sm-menu'
    menu.innerHTML = `<div class="sm-body">
      <div class="sm-langs" role="listbox" aria-label="Language">
        <button role="option" data-l="off" class="${smLang === 'off' ? 'on' : ''}"><span>Off</span>${smLang === 'off' ? icon('check') : ''}</button>
        ${order.map(k => `<button role="option" data-l="${k}" class="${smLang === k ? 'on' : ''}"><span>${esc(name(k))}</span><small>${groups.get(k).length}</small></button>`).join('') || '<div class="adj"><span class="dim">No subtitles found online</span></div>'}
      </div>
      <div class="sm-files" role="listbox" aria-label="Subtitle file">
        ${files.map(x => `<button role="option" data-s="${subs.indexOf(x)}" class="${subSel === x ? 'on' : ''}" ${embeddedOk(x) && !x.pending ? '' : 'disabled'}><span>${esc(x.label)}<small class="hint">${esc(x.status || x.hint || '')}${x.partial ? ' · partial' : ''}</small></span>${subSel === x ? icon('check') : !embeddedOk(x) ? '<small>after more download</small>' : x.best ? '<small>best match</small>' : ''}</button>`).join('') || (smLang === 'off' ? '<div class="adj"><span class="dim">Subtitles are off</span></div>' : '')}
      </div></div>
      <div class="sm-foot">
        ${missing ? `<div class="adj"><span class="dim">No ${esc(name(pref))} subtitles found</span></div>` : ''}
        <button data-s="upload"><span>Load from file...</span></button>
        ${subSel && !subSel.embedded ? `<div class="adj"><span>Auto sync <small class="dim">${!autoOn() ? '' : syncState === 'checking' ? 'Syncing...' : syncState === 'waiting' ? 'Needs more download' : syncState === 'insync' ? 'In sync' : syncState === 'synced' ? 'Synced' : ''}</small></span><button class="switch" role="switch" data-as aria-checked="${autoOn()}" aria-label="Auto sync"></button></div>` : ''}
        <div class="adj"><span><span>Timing</span> ${sgn(autoNow + delay)}s${autoNow || (syncRes && autoOn()) ? `<small class="dim"><span>Auto</span> ${sgn(autoNow)}s · <span>Manual</span> ${sgn(delay)}s</small>` : ''}</span><div><button class="btn btn-ghost sm" data-d="-0.5">−0.5</button><button class="btn btn-ghost sm" data-d="0.5">+0.5</button></div></div>
        <div class="adj"><span>Size</span><div><button class="btn btn-ghost sm" data-z="-1">A−</button><button class="btn btn-ghost sm" data-z="1">A+</button></div></div>
      </div>`
    ;['.sm-langs', '.sm-files'].forEach((q, i) => { menu.querySelector(q).scrollTop = keep[i] })
  }
  const open = k => { if (menuKind === k) return closeMenu(); menuKind = k; epSeason = season; epPage = pageOf(season); menu.hidden = false; drawMenu(); wake(); (k === 'eps' && menu.querySelector('.ep.cur') || menu.querySelector('[data-autofocus]') || menu.querySelector('button:not(:disabled), .ep'))?.focus() }
  $('#m-speed', root).onclick = () => open('speed'); $('#m-quality', root).onclick = () => open('quality'); $('#m-settings', root).onclick = () => open('settings')
  $('#m-eps', root)?.addEventListener('click', () => open('eps'))
  $('#m-audio', root).onclick = () => open('audio'); $('#m-subs', root).onclick = () => open('subs')
  $('#m-party', root).onclick = () => { if (partyPanel) open('party') }
  root.addEventListener('pointerdown', e => { if (!menu.hidden && !e.target.closest('#menu, .ctrls .cbtn')) closeMenu() })
  menu.addEventListener('submit', e => { if (menuKind === 'party') partyPanel.submit(e) })
  menu.onclick = async e => {
    if (menuKind === 'party') return partyPanel.click(e)
    const a = e.target.closest('a[data-ee]')
    if (a) { e.preventDefault(); const [s2, e2] = a.dataset.ee.split('/').map(Number); if (s2 !== season || e2 !== episode) go({ season: s2, episode: e2 }); return closeMenu() }
    const b = e.target.closest('button'); if (!b || b.disabled) return
    const d = b.dataset
    if (d.menu) return open(d.menu)
    if (d.stats != null) return toggleStats()
    if (d.another != null) { closeMenu(); if (!hash) return; toast('Looking for another version...'); tried.add(hash); startAt = v.currentTime; return start() }
    if (d.speed) { v.defaultPlaybackRate = v.playbackRate = +d.speed; keep('speed', +d.speed); closeMenu() }
    if (d.q) { quality = d.q; keep('quality', quality); closeMenu(); startAt = v.currentTime; if (info) { chooseMode(); attach() } }
    if (d.a) { audio = +d.a; const t = info.audio.find(x => x.i === audio); keep('audio', { lang: t?.lang || null, title: t?.title || '' }); closeMenu(); startAt = v.currentTime; chooseMode(); attach() }
    if (d.es != null) { epSeason = +d.es; epPage = pageOf(epSeason); menu.scrollTop = 0; drawMenu(); return }
    if (d.ep != null) { epPage = +d.ep; menu.scrollTop = 0; drawMenu(); return }
    if (d.d) { delay += +d.d; rememberDelay(); renderCue(); drawMenu() }
    if (b.hasAttribute('data-as')) { const on = !autoOn(); store.set('autosync', on); keep('autosync', on); if (on) runSync(subSel); else { syncState = ''; syncGen++; clearTimeout(syncTimer); clearTimeout(probeTimer); applyCues() } drawMenu() }
    if (d.z) { const z = Math.max(0.6, Math.min(2.2, +((P.size ?? store.get('subsize', 1)) + 0.15 * +d.z).toFixed(2))); store.set('subsize', z); keep('size', z); applySize() }
    if (d.l) {
      if (d.l === 'off') { showSub(null) } else {
        smLang = d.l; drawMenu()
      }
    }
    if (d.s === 'upload') { $('#subfile', root).click() } else if (d.s != null) showSub(subs[+d.s])
  }
  $('#subfile', root).onchange = async e => {
    const f = e.target.files[0]; if (!f) return
    try {
      const r = await fetch('/api/sub/convert', { method: 'POST', body: await f.arrayBuffer() })
      if (!r.ok) throw new Error('unreadable')
      const entry = { lang: null, label: f.name, hint: 'From your device', src: URL.createObjectURL(await r.blob()) }
      subs.push(entry); showSub(entry)
    } catch { toast('That subtitle file could not be read.') }
    e.target.value = ''
  }

  let cues = []; let subGen = 0; let refreshT; let raf = 0; let lastDraw = 0; let smLang = null
  const toSec = t => { const p = t.replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1] }
  function parseVtt (text) {
    const out = []
    for (const block of text.replace(/\r/g, '').split(/\n{2,}/)) {
      const lines = block.split('\n'); const k = lines.findIndex(l => l.includes('-->'))
      if (k < 0 || /^(NOTE|STYLE|REGION)/.test(lines[0])) continue
      const m = lines[k].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/); if (!m) continue
      const t = lines.slice(k + 1).join('\n').trim()
      if (t) out.push({ s: toSec(m[1]), e: toSec(m[2]), t })
    }
    return out.sort((a, b) => a.s - b.s)
  }
  function renderCue () {
    const t = v.currentTime - delay
    let lo = 0; let hi = cues.length
    while (lo < hi) { const mid = (lo + hi) >> 1; cues[mid].s <= t ? (lo = mid + 1) : (hi = mid) }
    const active = []
    for (let k = lo - 1; k >= 0 && k > lo - 8; k--) if (cues[k].e > t && cues[k].t) active.unshift(cues[k].t)
    const lines = active.join('\n')
    if (lines !== subsEl._last) { subsEl._last = lines; subsEl.innerHTML = lines ? lines.split('\n').map(l => `<span>${cueHTML(l)}</span>`).join('<br>') : '' }
  }
  const loop = now => { if (now - lastDraw > 90) { lastDraw = now; renderCue() } raf = v.paused ? 0 : requestAnimationFrame(loop) }
  v.addEventListener('playing', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(loop) })
  v.addEventListener('seeked', renderCue)

  let baseCues = []; let syncRes = null; let syncGen = 0; let syncTimer; let syncState = ''
  const autoOn = () => P.autosync ?? store.get('autosync', true)
  const applyCues = () => { cues = syncRes && autoOn() ? baseCues.map(c => ({ ...c, s: mapTime(syncRes, c.s), e: mapTime(syncRes, c.e) })) : baseCues; subsEl._last = null; renderCue() }
  async function runSync (entry, attempt = 0) {
    clearTimeout(syncTimer)
    const gen = ++syncGen
    if (!entry || entry.embedded || entry.src.startsWith('blob:') || !autoOn() || !info || !st) { syncState = ''; return }
    syncState = 'checking'; if (menuKind === 'subs') drawMenu()
    let r = null
    try { r = await api(`/api/sub/sync?${new URLSearchParams({ hash, file: st.fileIdx, src: entry.src })}`) } catch { /* retried below */ }
    if (gen !== syncGen || dead) return
    if (!r || r.pending) { syncState = 'waiting'; if (attempt < 60) syncTimer = setTimeout(() => runSync(entry, attempt + 1), 12000) } else if (r.anchors && r.confidence >= 0.35) {
      syncRes = r; candidate = null; syncState = Math.abs(r.anchors[0].d) < 0.15 && r.ratio === 1 && r.model === 'constant' ? 'insync' : 'synced'; applyCues(); scheduleProbe()
      if (r.partial && attempt < 40) syncTimer = setTimeout(() => runSync(entry, attempt + 1), 90000)
    } else { syncState = ''; if (r.none && r.partial && attempt < 40) syncTimer = setTimeout(() => runSync(entry, attempt + 1), 90000) }
    if (menuKind === 'subs') drawMenu()
  }

  const PROBE_MS = 75000
  let probeTimer; let candidate = null
  function scheduleProbe () { clearTimeout(probeTimer); probeTimer = setTimeout(probeSync, PROBE_MS) }
  async function probeSync () {
    scheduleProbe()
    if (!syncRes || !autoOn() || !subSel || subSel.embedded || v.paused || document.hidden || castCtl || dead) return
    const gen = syncGen; const t = v.currentTime
    const expected = offsetAt(syncRes.anchors, syncRes.model, t * syncRes.ratio)
    let r
    try { r = await api(`/api/sub/sync?${new URLSearchParams({ hash, file: st.fileIdx, src: subSel.src, at: t, ratio: syncRes.ratio, expected })}`) } catch { return }
    if (gen !== syncGen || dead || !r?.probe) return
    const p = r.probe
    let found = [p]
    if (Math.abs(p.d - expected) >= 0.3) {
      if (!(candidate && Math.abs(candidate.d - p.d) < 0.4)) { candidate = p; return }
      found = [candidate, p]
    }
    candidate = null
    const pts = [...(syncRes.points || syncRes.anchors).filter(q => !found.some(f => Math.abs(q.t - f.t) < 90)), ...found]
    const c = classify(pts, syncRes.ratio)
    syncRes = { ...syncRes, model: c.model, anchors: c.anchors, points: pts }
    syncState = Math.abs(mapTime(syncRes, t) - t) < 0.15 && syncRes.ratio === 1 ? 'insync' : 'synced'
    applyCues(); if (menuKind === 'subs') drawMenu()
  }

  async function loadEntry (entry, auto, again) {
    const gen = ++subGen
    clearTimeout(refreshT)
    const ctl = loadCtl = new AbortController()
    if (entry.embedded) { entry.status = 'Reading subtitles...'; drawMenu() }
    let watch
    if (entry.translated && !again) {
      const show = t => { entry.status = t; if (menuKind === 'subs') drawMenu() }
      show('Translating...')
      watch = setInterval(async () => {
        const p = await api(`/api/sub/translate/status?${new URLSearchParams(entry.translated)}`).catch(() => null)
        if (p && p.stage !== 'idle') show(`${p.stage === 'model' ? 'Preparing the language...' : 'Translating...'} ${Math.round(p.pct * 100)}%`)
      }, 700)
    }
    try {
      const r = await fetch(entry.src + (entry.translated && entry.src.includes('&hq=1') ? `&at=${Math.floor(v.currentTime || 0)}` : ''), { signal: ctl.signal }).finally(() => { clearInterval(watch); if (entry.status && !again) { entry.status = ''; if (menuKind === 'subs') drawMenu() } })
      if (r.status === 409) { if (gen === subGen && subSel === entry) { entry.status = 'Waiting for more of the download...'; drawMenu(); refreshT = setTimeout(() => loadEntry(entry, auto), 25000) } return toast('Built-in subtitles will be ready after a little more of the download.') }
      if (!r.ok) throw new Error('subtitle ' + r.status)
      const covered = r.headers.get('x-covered')
      const text = await r.text()
      if (gen !== subGen) return
      const better = r.headers.get('x-hq-done')
      if (better != null && +better < 1) {
        const prep = r.headers.get('x-hq-prep')
        entry.status = prep != null ? `Preparing the language... ${Math.round(prep * 100)}%` : `Improving quality... ${Math.round(better * 100)}%`
        refreshT = setTimeout(() => subSel === entry && loadEntry(entry, auto, true), prep != null ? 5000 : 20000)
      } else if (better != null) entry.status = ''
      entry.retried = false
      baseCues = parseVtt(text); applyCues(); drawMenu()
      if (!syncRes && syncState !== 'checking') runSync(entry)
      const dur = v.duration || info?.duration || 0; const last = cues.length ? cues.at(-1).e : 0
      if (entry.embedded) entry.status = covered && covered !== 'full' ? `Available up to ${clock(+covered)}, more as it downloads` : ''
      if (entry.embedded && covered && covered !== 'full') { drawMenu(); refreshT = setTimeout(() => subSel === entry && loadEntry(entry, auto), 45000); return }
      // Files covering only a few foreign-language lines look "broken": prefer a fuller one in the same language.
      if (dur > 900 && (cues.length < 40 || last < dur * 0.45)) {
        entry.partial = true
        const alt = subs.find(x => x !== entry && x.lang === entry.lang && !x.partial && !x.forced && embeddedOk(x))
        if (alt && auto !== 'tried') return showSub(alt, { auto: 'tried' })
        const eng = subs.find(x => x.lang === 'eng' && x !== entry && !x.forced && embeddedOk(x))
        toast('This subtitle only covers part of the video.', eng ? { action: { label: 'Use English', run: () => showSub(eng) }, ms: 9000 } : { ms: 6000 })
      }
    } catch (e) {
      if (gen === subGen && e.name !== 'AbortError') {
        // A provider's file can fail once and load on the next try; that is retried quietly before the viewer is told.
        if (!entry.embedded && !entry.retried) { entry.retried = true; setTimeout(() => gen === subGen && subSel === entry && loadEntry(entry, auto), 1500); return }
        toast('This subtitle could not be loaded.'); if (entry.embedded) { entry.status = ''; drawMenu() } } }
  }
  const embeddedOk = s => !s.embedded || st.phase === 'done' || (st.length && info?.duration && (st.readable ?? st.downloaded) / st.length * info.duration * 0.85 > 60)

  const epKey = `${season}/${episode}`
  const remember = entry => keep('sub', entry ? { lang: entry.lang, label: entry.label, tr: entry.translated?.to || null, delays: P.sub?.delays } : { off: true, delays: P.sub?.delays })
  const savedDelay = entry => { const r = P.sub?.delays?.[epKey]; return r && r.l === entry.label ? r.d : 0 }
  const rememberDelay = () => { if (P.sub && subSel) keep('sub', { ...P.sub, delays: { ...P.sub.delays, [epKey]: { l: subSel.label, d: delay } } }) }
  let loadCtl
  function stopTranslating (keep) {
    loadCtl?.abort(); loadCtl = null
    if (subSel?.translated && subSel !== keep) api('/api/sub/translate/stop', { method: 'POST', body: subSel.translated }).catch(() => {})
  }
  function showSub (entry, { auto } = {}) {
    stopTranslating(entry)
    if (!auto) remember(entry)
    subSel = entry; if (entry) entry.autoPicked = !!auto; delay = entry ? savedDelay(entry) : 0; cues = []; baseCues = []; syncRes = null; candidate = null; syncState = ''; syncGen++; clearTimeout(syncTimer); clearTimeout(probeTimer); subsEl.innerHTML = ''; subsEl._last = null; subGen++
    clearTimeout(refreshT)
    smLang = entry ? (entry.lang || '_file') : 'off'
    if (!entry) { drawMenu(); return syncNative() }
    drawMenu()
    loadEntry(entry, auto)
    syncNative()
  }
  const autoSub = final => {
    const sv = P.sub
    if (sv?.off) return
    if (sv) {
      const pool = subs.filter(s => embeddedOk(s) && !s.pending && !s.forced && (sv.tr ? s.translated?.to === sv.tr : s.lang === sv.lang && !s.translated))
      const hit = pool.find(s => s.label === sv.label) || (sv.tr ? null : pool.find(s => !s.manualOnly))
      if (hit) { if (hit !== subSel && (!subSel || subSel.autoPicked)) showSub(hit, { auto: true }); return }
      if (!final) return
    }
    const want = S.me.settings.sublang
    if (!want || want === 'off' || subSel) return
    const hit = subs.find(s => s.lang === want && !s.forced && !s.manualOnly && embeddedOk(s)) || subs.find(s => s.lang === want && !s.manualOnly && embeddedOk(s))
    if (hit) showSub(hit, { auto: true })
  }
  const translationTargets = () => [...LANGUAGES.filter(l => l[0] !== 'en'), ...(S.me.settings.sublang === 'pob' ? [['pt', 'pob']] : [])]
  const loadSubs = async () => {
    // Tracks inside the video, and subtitle files that came in the same download: both match this release's timing.
    const embedded = [...(info.subs || []).map(s => ({ lang: s.lang, label: `${LANG(s.lang || 'und')}${s.title ? ' · ' + s.title : ''}`, hint: 'Built in', embedded: true, src: `/api/sub/embedded/${hash}/${st.fileIdx}/${s.i}` })),
      ...(info.sidecar || []).map(s => ({ lang: s.lang, label: LANG(s.lang), hint: s.name.slice(0, 42), forced: s.forced, embedded: true, src: `/api/sub/file/${hash}/${s.i}` }))]
    const targets = translationTargets()
    const supported = await cget('/api/translate/langs').catch(() => [])
    const soon = targets.filter(([c2]) => supported.includes(c2)).map(([, c3]) => ({ lang: c3, label: 'Auto-translated', hint: 'Getting started...', pending: true, manualOnly: true, src: '' }))
    subs = [...embedded, ...soon]; autoSub(); drawMenu()
    const want = S.me.settings.sublang !== 'off' ? S.me.settings.sublang : langOf(S.me.settings.lang)[1]
    const langs = [...new Set([want, langOf(S.me.settings.lang)[1], 'eng'])].join(',')
    const qs = new URLSearchParams({ type, id, langs, release: st.name || '', ...(season != null && { season, episode }) })
    const ask = () => api(`/api/subs?${qs}`)
    let raw = []
    for (let i = 0; i < 3 && !raw.length; i++) { if (i) await new Promise(r => setTimeout(r, 3000 * i)); raw = await ask().catch(() => []) }
    // Entries already shown keep their identity (the picked one stays picked) when a fuller list arrives.
    const apply = list => {
      const known = new Map(subs.filter(x => x.src).map(x => [x.src, x]))
      const own = x => known.get(x.src) || x
      const ext = list.map(s => ({ lang: s.lang, label: LANG(s.lang) + (s.label.match(/ #\d+$/)?.[0] || ''), hint: s.hint, best: s.best, forced: s.forced, src: `/api/sub?url=${enc(s.url)}${s.enc ? '&enc=' + enc(s.enc) : ''}` })).map(own)
      subs = [...embedded, ...ext]
      const base = subs.find(x => x.lang === 'eng' && !x.forced && !x.pending && embeddedOk(x))
      if (base) for (const [c2, c3] of targets) if (supported.includes(c2)) subs.push(own({ lang: c3, label: 'Auto-translated', hint: 'Translated from English', src: `/api/sub/translate?src=${enc(base.src)}&to=${c2}${S.me.settings.bestTranslation ? '&hq=1' : ''}`, translated: { src: base.src, to: c2 }, manualOnly: true }))
    }
    apply(raw)
    subsDone = !raw.some(s => s.partial)
    autoSub(subsDone); drawMenu()
    // The server answers with its fast providers first (flagged partial) and keeps looking; the fuller list is picked up here.
    for (let i = 0; i < 8 && !subsDone && !dead; i++) {
      await new Promise(r => setTimeout(r, 4000))
      const more = await ask().catch(() => null)
      if (!more || dead) continue
      raw = more; apply(raw); subsDone = !raw.some(s => s.partial)
      autoSub(subsDone); drawMenu()
    }
    subsDone = true
  }

  const cap = () => (quality !== 'auto' ? +quality : autoH)
  const hq = () => (cap() ? `&h=${cap()}` : '')
  function chooseMode () {
    autoH = null
    if (quality === 'auto') {
      const b = bandwidth(); const bitrate = info.duration ? st.length * 8 / info.duration / 1e6 : 0
      if (b && bitrate > b * 0.75) autoH = b >= 15 ? 1080 : b >= 7 ? 720 : 480
      if (saveData()) autoH = Math.min(autoH || 720, 720)
    }
    const needScale = cap() && (!info.height || cap() < info.height)
    mode = needScale || !info.direct || audio !== defaultAudio() ? 'hls' : 'direct'
  }
  // Safari plays HLS natively; if that fails, or hls.js fails elsewhere, the other engine gets one try before giving up.
  await hlsReady
  const nativeOk = !!v.canPlayType('application/vnd.apple.mpegurl')
  let engines = [...(isSafari && nativeOk ? ['native'] : []), ...(window.Hls?.isSupported() ? ['hlsjs'] : []), ...(!isSafari && nativeOk ? ['native'] : [])]
  let engineAt = 0
  // Safari hands the stream to AirPlay by URL, so page-drawn subtitles never reach a TV: the stream carries a WebVTT rendition, switched on only while casting or full screen.
  let attachedKey = 'none'
  const isLive = () => !!(v.webkitCurrentPlaybackTargetIsWireless || v.webkitDisplayingFullscreen)
  const prefLang = () => (S.me.settings.sublang && S.me.settings.sublang !== 'off' ? S.me.settings.sublang : '')
  const needExplicit = () => !!subSel && (subSel.embedded || !subSel.autoPicked || !subSel.lang)
  const desiredKey = live => {
    const base = prefLang() ? 'sl:' + prefLang() : 'none'
    if (!live || !subSel) return base
    return needExplicit() ? 'sub:' + subSel.src : 'sl:' + subSel.lang
  }
  const subQuery = key => {
    if (key.startsWith('sl:')) return `&sl=${key.slice(3)}&sn=${enc(LANG(key.slice(3)))}&t=${type}&mid=${enc(id)}&s=${season ?? ''}&e=${episode ?? ''}`
    if (key.startsWith('sub:')) return `&sub=${enc(key.slice(4))}&sl=${subSel?.lang || ''}&sn=${enc(subSel?.label || 'Subtitles')}`
    return ''
  }
  function applyNativeTracks () {
    const show = isLive() && !!subSel && attachedKey !== 'none'
    for (const tt of v.textTracks || []) if (tt.kind === 'subtitles' || tt.kind === 'captions') tt.mode = show ? 'showing' : 'disabled'
    subsEl.hidden = show
  }
  function syncNative () {
    if (engines[engineAt] === 'native' && info && st && isLive()) {
      const key = desiredKey(true)
      if (key !== 'none' && (key !== attachedKey || mode === 'direct')) { mode = 'hls'; startAt = v.currentTime; attach() }
    }
    applyNativeTracks()
  }
  v.addEventListener('webkitcurrentplaybacktargetiswirelesschanged', syncNative)
  v.addEventListener('webkitbeginfullscreen', syncNative)
  v.addEventListener('webkitendfullscreen', syncNative)
  v.addEventListener('loadedmetadata', () => { applyNativeTracks(); placeSubs() })
  v.textTracks?.addEventListener?.('addtrack', applyNativeTracks)
  function placeSubs () {
    const W = v.clientWidth; const H = v.clientHeight
    if (!v.videoWidth || !W || !H) return
    picH = Math.min(H, W * v.videoHeight / v.videoWidth)
    subsEl.style.setProperty('--sub-gap', `${Math.max(0, (H - picH) / 2)}px`)
    applySize()
  }
  const subRO = new ResizeObserver(placeSubs); subRO.observe(v)
  // iOS reports the picture size late for HLS; the video fires `resize` when it knows, and the page can rotate.
  for (const ev of ['resize', 'playing', 'loadeddata']) v.addEventListener(ev, placeSubs)
  const onRotate = () => setTimeout(placeSubs, 300)
  addEventListener('orientationchange', onRotate)
  const nextEngine = () => (engineAt + 1 < engines.length ? (engineAt++, true) : false)
  function attach () {
    hls?.destroy(); hls = null
    const t = startAt; startAt = 0
    v.addEventListener('loadedmetadata', () => { if (t > 5) v.currentTime = t }, { once: true })
    if (mode === 'direct') v.src = `/raw/${hash}/${st.fileIdx}`
    else {
      attachedKey = desiredKey(isLive())
      const url = `/hls/${hash}/${st.fileIdx}/index.m3u8?a=${audio}${hq()}${subQuery(attachedKey)}`
      if (engines[engineAt] !== 'hlsjs') v.src = url
      else {
        hls = new Hls({ maxBufferLength: 40, backBufferLength: 30, manifestLoadingMaxRetry: 3, fragLoadingMaxRetry: 5, levelLoadingMaxRetry: 3 })
        let netTries = 0
        hls.on(Hls.Events.ERROR, (_, d) => {
          if (!d.fatal) return
          if (d.type === Hls.ErrorTypes.NETWORK_ERROR && netTries++ < 4) hls.startLoad()
          else if (d.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else if (nextEngine()) { startAt = v.currentTime; attach() }
          else fail('Playback stopped', 'Something went wrong while streaming. Try again.')
        })
        hls.loadSource(url); hls.attachMedia(v)
      }
    }
    v.playbackRate = v.playbackRate || 1
    v.play().catch(() => { hideLoad(); wake() })
    arm(20000)
  }

  // Nothing playing 20 s after attaching: a direct file the browser stalls on goes through the converter,
  // a slow converted stream offers another version instead of an endless spinner.
  let wd
  function arm (ms) {
    clearTimeout(wd)
    wd = setTimeout(() => {
      if (dead || !info || $('#load', root).hidden || $('#retry', root)) return
      if (mode === 'direct') { mode = 'hls'; startAt = Math.max(startAt, v.currentTime); attach(); return }
      showSlowLink()
    }, ms)
  }
  v.addEventListener('error', () => {
    if (dead || !info) return
    if (mode === 'direct') { mode = 'hls'; startAt = v.currentTime; toast('Switching to a compatible stream...'); attach() } else if (!hls) { if (nextEngine()) { startAt = v.currentTime; attach() } else fail('Can\'t play this one', 'The video could not be decoded on this device.') }
  })

  let runId = 0
  const aborted = Object.assign(new Error('superseded'), { abort: true })
  async function ready (my) {
    const t0 = Date.now(); let lastBytes = 0; let lastAt = Date.now(); let probing = null; let probeAt = 0
    while (!dead) {
      if (my !== runId) throw aborted
      st = await api(`/api/status/${hash}`)
      if (st.phase === 'error') throw Object.assign(new Error(st.error), { stall: true })
      if (st.fileIdx != null && !probing) { probeAt = Date.now(); probing = api(`/api/info/${hash}`).then(r => ({ r }), e => ({ e })) }
      if (probing) {
        const done = await Promise.race([probing, sleep(600).then(() => null)])
        if (done?.r) { info = done.r; return }
        if (done?.e) throw Object.assign(done.e, { stall: true })
      }
      // A swarm that only trickles keeps bytes arriving forever, so progress is judged over a window: 300 kB in 15 s, or the version is given up.
      if (Date.now() - lastAt > 15000 && st.phase !== 'metadata') { if (st.downloaded - lastBytes < 300e3) throw Object.assign(new Error('stalled'), { stall: true }); lastBytes = st.downloaded; lastAt = Date.now() }
      const waited = (Date.now() - t0) / 1000
      if (st.phase === 'metadata' && waited > 20) throw Object.assign(new Error('stalled'), { stall: true })
      if (probing && Date.now() - probeAt > 18000) showSlowLink()
      if (probing && Date.now() - probeAt > 120000) throw Object.assign(new Error('probe timeout'), { stall: true })
      const need = Math.min(st.length || 3e6, 3e6)
      setLoad({
        line: st.phase === 'metadata' ? (waited < 8 ? 'Finding a source...' : 'Connecting...') : st.downloaded > 0 ? `Buffering · ${bytes(st.speed)}/s` : 'Starting the stream...',
        pct: st.phase === 'metadata' || !st.downloaded ? null : Math.min(1, st.downloaded / need)
      })
      if (!probing) await sleep(600)
    }
  }

  async function start (forced) {
    if (dead) return
    const my = ++runId
    try {
      hls?.destroy(); v.removeAttribute('src'); v.load(); info = null; subSel = null; subs = []
      setLoad({ title: m.name, line: 'Finding the best version...', pct: null, actions: '' })
      const began = Date.now()
      for (let attempt = 0; attempt < 5 && !dead; attempt++) {
        st = await api('/api/play', { method: 'POST', body: { type, id, season, episode, infoHash: forced, exclude: [...tried], prefer: quality, display: displayPx() } })
        hash = st.hash; forced = undefined
        try {
          await ready(my)
          if (dead) return
          break
        } catch (e) {
          if (e.abort) return
          if (!e.stall) throw e
          tried.add(hash); info = null
          setLoad({ line: 'That version is slow. Trying another...', pct: null, actions: '' })
          // Versions nobody is sharing take a while to give up on one by one: after 90 s the title is called unavailable.
          if (attempt === 4 || Date.now() - began > 90000) throw new Error('No version of this title is available right now.', { cause: e })
        }
      }
      if (dead || !info) return
      audio = pickAudio(); chooseMode()
      $('#m-audio', root).hidden = !(info.audio?.length > 1)
      setLoad({ line: 'Getting ready...', pct: null })
      attach()
      loadSubs()
    } catch (e) {
      if (!dead && !e.abort && my === runId) fail('We couldn\'t start this', e.status === 404 ? 'Nothing is available for this title right now. Try again later.' : e.message)
    }
  }
  // Buffering for a long time in the middle of a film heals itself: the same stream is attached again, and a download that is not
  // delivering gives way to another version.
  let stuck = 0; let reattached = false; let seen = -1
  timers.push(setInterval(() => {
    if (!info || dead || castCtl || document.hidden || v.paused || v.seeking || v.readyState >= 3) { stuck = 0; return }
    if (st.downloaded !== seen) { seen = st.downloaded; stuck = 0; return } // still arriving: just slow
    if ((stuck += 2.5) < 40) return
    stuck = 0
    startAt = v.currentTime
    if (st.phase === 'done' && !reattached) { reattached = true; attach(); return }
    tried.add(hash); start()
  }, 2500))
  timers.push(setInterval(async () => {
    // Nothing more to learn once the file is complete, and nothing worth asking for in a hidden tab.
    if (!hash || !info || dead || st.phase === 'done' || document.hidden) return
    try {
      const was = st.phase; const unlocked = subs.filter(s => s.embedded && embeddedOk(s)).length
      st = await api(`/api/status/${hash}?file=${st.fileIdx}`)
      if (was !== 'done' && st.phase === 'done') { if (subSel?.embedded) loadEntry(subSel); drawMenu(); autoSub() } else if (subs.filter(s => s.embedded && embeddedOk(s)).length !== unlocked) { drawMenu(); autoSub() }
    } catch {}
  }, 2500))
  $('#slow', root).onclick = () => { $('#slow', root).hidden = true; tried.add(hash); startAt = v.currentTime; start() }
  root.addEventListener('click', e => {
    if (e.target.closest('#retry')) { tried.clear(); start() }
    if (e.target.closest('#another')) { tried.add(hash); $('#slow', root).hidden = true; start() }
  })

  nowPlaying(() => v.duration > 0 && !castCtl ? { state: v.paused ? 'paused' : 'playing', name: m.originalName || m.name, poster: m.poster, season, episode, pos: v.currentTime, dur: v.duration } : { state: 'browsing' })
  let lastSave = 0
  function save () {
    if (!v.duration || !isFinite(v.duration) || v.currentTime < 5 || castCtl) return
    lastSave = Date.now()
    recordProgress({ type, id, name: m.originalName || m.name, poster: m.poster, season, episode, pos: Math.floor(v.currentTime), dur: Math.floor(v.duration) })
  }
  timers.push(setInterval(() => { if (!v.paused && Date.now() - lastSave > 9000) save() }, 3000))
  timers.push(setInterval(drawStats, 1000))
  drawStats()
  let prefetched = false; let upShown = false; let upT
  function upNextCheck () {
    if (!next || !v.duration) return
    if (!prefetched && v.currentTime / v.duration > 0.5) { prefetched = true; api('/api/play', { method: 'POST', body: { type, id, season: next.season, episode: next.episode } }).catch(() => {}) }
    if (!upShown && v.duration - v.currentTime < 28 && v.currentTime > 60) showUp()
  }
  function showUp () {
    upShown = true
    const box = $('#up', root); box.hidden = false
    const auto = S.me.settings.autoNext !== false
    box.innerHTML = `<b>Up next</b><div>${esc(next.title)}<div class="dim small">Season ${next.season} · Episode ${next.episode}</div></div>
      ${auto ? '<div class="hair"><i style="--t:' + Math.max(4, Math.min(8, v.duration - v.currentTime)) + 's"></i></div>' : ''}
      <div class="actions flush"><button class="btn btn-ink sm" id="upgo" data-autofocus>${icon('play')}Play now</button><button class="btn btn-quiet sm" id="upx">Not now</button></div>`
    $('#upgo', root).onclick = () => go(next); $('#upx', root).onclick = () => { box.hidden = true; clearTimeout(upT); upShown = 'dismissed' }
    if (auto) upT = setTimeout(() => { if (!dead && !$('#up', root).hidden) go(next) }, Math.max(4, Math.min(8, v.duration - v.currentTime)) * 1000)
  }
  v.addEventListener('ended', () => { save(); if (next && upShown !== 'dismissed' && S.me.settings.autoNext !== false) go(next); else if (next) { if (!upShown) showUp() } else leave() })
  v.addEventListener('seeking', () => { if (upShown === true && v.duration - v.currentTime > 40) { $('#up', root).hidden = true; clearTimeout(upT); upShown = false } })

  const onKey = e => {
    if (e.target.matches?.('input[type=text], input:not([type])') || e.ctrlKey || e.metaKey || e.altKey) return
    const own = !isTV || !ui
    const k = e.key
    if (k === 'MediaPlayPause' || k === 'MediaPlay' || k === 'MediaPause') { e.preventDefault(); return toggle() }
    if (k === 'MediaTrackNext' && next) return go(next)
    if (k === 'MediaRewind') return seekBy(-10)
    if (k === 'MediaFastForward') return seekBy(10)
    if (e.target.closest?.('#menu') && k !== 'Escape') return
    if (own && (k === 'ArrowLeft' || k === 'ArrowRight')) { e.preventDefault(); seekBy(k === 'ArrowRight' ? 10 : -10); return }
    if (own && (k === 'ArrowUp' || k === 'ArrowDown')) {
      e.preventDefault()
      if (isTV) { wake(); return }
      v.muted = false; v.volume = Math.max(0, Math.min(1, v.volume + (k === 'ArrowUp' ? 0.05 : -0.05))); wake(); return
    }
    if (k === ' ' || k === 'k') { if (e.target.matches?.('button, a, [role=slider]') && k === ' ' && ui && e.target.id !== 'scrub') return; e.preventDefault(); toggle(); wake() }
    else if (k === 'Enter' && isTV && !ui) { e.preventDefault(); toggle(); wake() }
    else if (k === 'j') seekBy(-10)
    else if (k === 'l') seekBy(10)
    else if (k === 'f') toggleFS()
    else if (k === 'm') v.muted = !v.muted
    else if (k === 'c') { subSel ? showSub(null) : subs.length && showSub(subs.find(s => !s.embedded || st.phase === 'done')) }
    else if (k === 'i') toggleStats()
    else if (k === 'n' && next) go(next)
    else if (/^[0-9]$/.test(k) && v.duration) { v.currentTime = v.duration * +k / 10; wake() }
  }
  document.addEventListener('keydown', onKey)
  const backHandler = onBack.handler = () => {
    if (!menu.hidden) { closeMenu(); return true }
    if (fsEl()) { document.exitFullscreen?.(); return true }
    if (isTV && ui && !v.paused) { setUI(false); return true }
    leave(); return true
  }

  loadCast().then(ok => { if (ok && !dead) $('#cast', root).hidden = false })
  $('#cast', root).onclick = async () => {
    if (!info) return toast('Start the video first, then cast.')
    try {
      const srv = await cget('/api/server', 60e3)
      const base = /^(localhost|127\.|\[::1\])/.test(location.hostname) ? srv.urls[0] : location.origin
      if (!base) return toast('Connect this computer to your home network to cast.')
      const direct = mode === 'direct'
      const url = base + (direct ? `/raw/${hash}/${st.fileIdx}` : `/hls/${hash}/${st.fileIdx}/index.m3u8?a=${audio}${hq()}`)
      const at = v.currentTime
      castCtl = await castTo({ url, contentType: direct ? 'video/mp4' : 'application/x-mpegURL', title: m.name, subtitle: label, image: m.poster ? base + m.poster : undefined, startAt: at })
      v.pause()
      const box = $('#casting', root); box.hidden = false
      const draw = p => { box.innerHTML = `<h2>${esc(m.name)}</h2><p class="dim">Playing on ${esc(castCtl.device)} · ${clock(p?.currentTime ?? at)}</p><div class="actions"><button class="btn btn-ink" id="ctp">${icon(p?.isPaused ? 'play' : 'pause')}${p?.isPaused ? 'Play' : 'Pause'}</button><button class="btn btn-ghost" id="cstop">Stop casting</button></div>` }
      draw()
      castCtl.on(p => { if (!p.isConnected) { stopCast(p.currentTime) } else draw(p) })
      box.onclick = e => { if (e.target.closest('#ctp')) castCtl.toggle(); if (e.target.closest('#cstop')) stopCast(castCtl.stop()) }
    } catch (e) { castCtl = null; if (e && e !== 'cancel' && e.code !== 'cancel') toast('Could not start casting.') }
  }
  function stopCast (t) { castCtl = null; $('#casting', root).hidden = true; if (t > 5) v.currentTime = t; v.play().catch(() => {}) }

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: m.name, artist: label || 'Dodobox', artwork: m.poster ? [{ src: m.poster, sizes: '512x768' }] : [] })
    for (const [a, f] of [['play', () => v.play()], ['pause', () => v.pause()], ['seekbackward', () => seekBy(-10)], ['seekforward', () => seekBy(10)], ['nexttrack', next ? () => go(next) : null]]) { try { navigator.mediaSession.setActionHandler(a, f) } catch {} }
  }
  let lock
  const wakeLock = async () => { try { lock = await navigator.wakeLock?.request('screen') } catch {} }
  const onVisible = () => { if (!document.hidden && !v.paused) wakeLock() }
  document.addEventListener('visibilitychange', onVisible)
  addEventListener('pagehide', save)

  const cleanup = () => {
    dead = true; nowPlaying(null); detachParty?.(); save(); if (hash && st?.fileIdx != null) navigator.sendBeacon?.(`/api/release/${hash}/${st.fileIdx}`); clearTimeout(refreshT); stopTranslating(); clearTimeout(wd); clearTimeout(syncTimer); clearTimeout(probeTimer); hls?.destroy(); timers.forEach(clearInterval); clearTimeout(idleT); clearTimeout(upT); clearTimeout(clickT)
    document.removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', fsChange); document.removeEventListener('webkitfullscreenchange', fsChange); removeEventListener('pagehide', save)
    document.removeEventListener('visibilitychange', onVisible); removeEventListener('orientationchange', onRotate); subRO.disconnect()
    if (onBack.handler === backHandler) onBack.handler = null
    try { lock?.release() } catch {}
    try { if ('mediaSession' in navigator) navigator.mediaSession.metadata = null } catch {}
    v.removeAttribute('src'); v.load()
    if (fsEl()) document.exitFullscreen?.()
    // A player that was left before it finished loading is cleaned up after the next one has already taken the layer.
    if (layer.contains(root)) { layer.hidden = true; layer.innerHTML = ''; layer.className = ''; document.documentElement.classList.remove('lock') }
  }
  measureBandwidth()
  sync(); wake()
  // A watch party the page is in puts this title where the others are, on the version they chose.
  let forced
  try {
    const party = await import('./party.js')
    await party.ready()
    const here = { type, id, season: flat ? null : season, episode: flat ? null : episode, title: m.name }
    detachParty = party.attachPlayer({ v, root, item: here, hash: () => hash, button: $('#m-party', root), alt: $('#m-settings', root), menu: { isParty: () => menuKind === 'party', redraw: drawMenu, close: closeMenu } })
    partyPanel = detachParty.panel
    forced = party.sourceFor(here)
    if (party.onThis(here)) startAt = party.nowPos()
  } catch { $('#m-party', root).hidden = true }
  start(forced)
  return cleanup
}
