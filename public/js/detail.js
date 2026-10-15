import { cget, api, NOW, LATER } from './api.js'
import { S, progress, inList, toggleList, ratingOf, rate } from './session.js'
import { $, esc, icon, enc, mins, sized, fullWidth, hue, lowres, thumbW, known, canTrailer, slowLink, toast } from './util.js'
import { dragScroll } from './drag.js'
import { glow } from './ambient.js'

const watchHref = (t, id, s, e) => `#/watch/${t}/${enc(id)}` + (s != null ? `/${s}/${e}` : '')
const TYPE_LABEL = { movie: 'Movie', series: 'Series', anime: 'Anime' }

let detailCleanup = null
export async function title (root, type, id) {
  detailCleanup?.(); detailCleanup = null
  // From a card the title is already known: show it (and its backdrop, which the full page reuses) while the details come in.
  const k = known.get(`${type}:${id}`)
  root.innerHTML = k ? `<div class="view"><section class="d-hero"><div class="bg" style="--h:${hue(k.name)}"><i class="lq" style="background-image:url('${esc(lowres(sized(k.background || k.poster || '', 0)))}')"></i><img alt="" src="${esc(sized(k.background || k.poster || '', fullWidth()))}" onload="this.classList.add('in')"></div><div class="d-body"><h1 class="title" translate="no">${esc(k.name)}</h1><div class="meta"><span class="tag">${TYPE_LABEL[type]}</span>${k.year ? `<span>${k.year}</span>` : ''}${k.runtime ? `<span>${esc(k.runtime)}</span>` : ''}</div><p class="lede" translate="no">${esc(k.description || '')}</p><div class="actions"><div class="sk" style="height:3rem;width:11rem;border-radius:999px"></div></div></div></section></div>` :
    '<div class="view"><section class="d-hero"><div class="d-body d-skel"><div class="sk" style="height:5.5rem;width:80%"></div><div class="sk" style="height:1.1rem;width:55%"></div><div class="sk" style="height:.9rem"></div><div class="sk" style="height:.9rem;width:92%"></div><div class="sk" style="height:.9rem;width:70%"></div><div class="sk" style="height:2.9rem;width:11rem;border-radius:999px;margin-top:.6rem"></div></div></section></div>'
  const [m, local] = await Promise.all([cget(`/api/meta/${type}/${enc(id)}`, undefined, NOW), cget('/api/local', 60e3, LATER).catch(() => [])])
  glow(m.poster)
  const flat = type === 'movie' || m.movie
  const videos = m.videos || []
  const seasons = [...new Set(videos.map(v => v.season))]
  const rec = S.me.recent.find(r => r.type === type && r.id === id)
  const target = flat ? { season: m.movie ? 1 : null, episode: m.movie ? 1 : null } : rec ? { season: rec.season, episode: rec.episode } : videos[0]
  const mine = local.some(e => e.type === type && e.mid === id)
  let season = rec?.season ?? seasons[0]
  const inL = () => inList(type, id)
  const playLabel = rec ? (flat ? 'Resume' : `Resume S${rec.season} E${rec.episode}`) : flat ? 'Play' : 'Start watching'

  root.innerHTML = `<div class="view">
    <section class="d-hero">
      <div class="bg ${m.background ? '' : 'blur'}" style="--h:${hue(m.name)}"><i class="lq" style="background-image:url('${esc(lowres(sized(m.background || m.poster || '', 0)))}')"></i><img alt="" src="${esc(sized(m.background || m.poster || '', fullWidth()))}" onload="this.classList.add('in')"></div><div class="trailer-layer" id="dtr" aria-hidden="true"></div>
      <div class="d-body">
        <h1 class="title" translate="no">${esc(m.name)}</h1>
        <div class="meta"><span class="tag">${TYPE_LABEL[type]}</span>${m.year ? `<span>${m.year}</span>` : ''}${m.runtime ? `<span>${esc(m.runtime)}</span>` : ''}${m.rating ? `<span>${icon('star')}${m.rating.toFixed(1)}</span>` : ''}${m.status && m.status !== 'FINISHED' ? `<span>${esc(m.status.replace(/_/g, ' ').toLowerCase())}</span>` : ''}${mine ? '<span>On your server</span>' : ''}</div>
        <p class="lede" translate="no" id="lede" role="button" tabindex="0" aria-expanded="false" data-click>${esc(m.description || '')}</p>
        <div class="actions">
          <a class="btn btn-ink" id="play" data-autofocus href="${target ? watchHref(type, id, target.season, target.episode) : '#'}">${icon('play')}${playLabel}</a>
          ${m.trailer ? `<a class="btn btn-ghost" id="trailer" href="#/trailer/${type}/${enc(id)}">${icon('film')}Trailer</a>` : ''}<button class="btn btn-ghost" id="list">${inL() ? icon('check') + 'In My List' : icon('plus') + 'My List'}</button>
          ${flat ? `<button class="btn btn-ghost" id="dl" data-s="" data-e="">${icon('down')}Download</button>` : ''}
        </div>
        <div class="rate" role="group" aria-label="Rate this title">
          <button data-r="-1" class="flip" aria-label="Not for me" title="Not for me">${icon('thumb')}</button>
          <button data-r="1" aria-label="I like this" title="I like this">${icon('thumb')}</button>
          <button data-r="2" aria-label="Love this" title="Love this">${icon('heart')}</button>
        </div>
        <div class="facts">
          ${(m.genres || []).length ? `<div><b>Genres</b> ${m.genres.map(g => `<span>${esc(g)}</span>`).join(', ')}</div>` : ''}
          ${(m.cast || []).length ? `<div><b>Starring</b> ${m.cast.slice(0, 5).map(esc).join(', ')}</div>` : ''}
        </div>
      </div>
    </section>
    ${flat ? '' : `<h2 class="sec-h">Episodes</h2><div class="eps-bar">${seasons.length > 1 ? `<div class="tabs" id="seasons">${seasons.map(s => `<button class="chip ${s === season ? 'on' : ''}" data-s="${s}">Season ${s}</button>`).join('')}</div>` : '<span></span>'}<button class="btn btn-ghost sm" id="dlseason">${icon('down')}Download season</button></div><div class="eps" id="eps"></div>`}
  </div>`

  // Finding a source takes several searches on the server, so it is only started for a title that is looked at for a moment (Play then starts sooner).
  const warm = target && !slowLink() ? setTimeout(() => fetch(`/api/sources?${new URLSearchParams({ type, id, ...(target.season != null && { season: target.season, episode: target.episode }) })}`).catch(() => {}), 3000) : 0
  let dtr = null; let dwell
  const hero = $('.d-hero')
  if (m.trailer && canTrailer()) dwell = setTimeout(async () => { const { mountTrailer } = await import('./trailer.js'); dtr = mountTrailer($('#dtr'), m.trailer, { onPlaying: () => hero.classList.add('has-trailer'), onFail: () => { dtr = null } }) }, 1800)
  const stop = () => { clearTimeout(dwell); dtr?.destroy(); dtr = null }
  const io = new IntersectionObserver(es => { if (es[0].intersectionRatio < 0.3) { stop(); hero.classList.remove('has-trailer') } }, { threshold: [0, 0.3] })
  io.observe(hero)
  detailCleanup = () => { stop(); io.disconnect() }
  $('#lede').onclick = e => e.currentTarget.setAttribute('aria-expanded', e.currentTarget.classList.toggle('open'))
  $('#list').onclick = async e => {
    await toggleList({ type, id, name: m.name, poster: m.poster, year: m.year, rating: m.rating })
    e.currentTarget.innerHTML = inL() ? icon('check') + 'In My List' : icon('plus') + 'My List'
  }
  const paintRate = () => root.querySelectorAll('.rate button').forEach(b => b.classList.toggle('on', +b.dataset.r === ratingOf(type, id)))
  paintRate()
  $('.rate', root).onclick = async e => { const b = e.target.closest('[data-r]'); if (!b) return; await rate({ type, id, name: m.name, originalName: m.originalName, poster: m.poster, year: m.year, genres: m.genres }, +b.dataset.r); paintRate() }

  let dl = {}; let poll
  const dkey = (s, e) => (s == null || s === '' ? 'm' : `${s}:${e}`)
  async function refreshDl () {
    try {
      const [lib, q] = await Promise.all([api('/api/library'), api('/api/downloads')])
      dl = {}
      for (const r of lib) if (r.ctx.type === type && r.ctx.id === id && r.pinned) dl[dkey(r.ctx.season, r.ctx.episode)] = { phase: r.phase === 'done' ? 'done' : r.phase === 'error' ? 'error' : 'busy', progress: r.progress, key: r.key }
      for (const j of q.queue) if (j.type === type && j.id === id) dl[dkey(j.season, j.episode)] ??= { phase: 'queued' }
      for (const j of q.failed) if (j.type === type && j.id === id) dl[dkey(j.season, j.episode)] ??= { phase: 'failed' }
    } catch {}
    paintDl()
    const moving = Object.values(dl).some(x => x.phase === 'busy' || x.phase === 'queued')
    clearTimeout(poll); if (moving) poll = setTimeout(refreshDl, 3000)
  }
  function paintDl () {
    root.querySelectorAll('[data-e]').forEach(b => {
      const d = dl[dkey(b.dataset.s, b.dataset.e)]
      b.dataset.state = d?.phase || 'idle'
      const ico = d?.phase === 'done' ? icon('check') : d?.phase === 'queued' ? icon('clock') : d?.phase === 'busy' ? `<span class="pct">${Math.round((d.progress || 0) * 100)}%</span>` : icon('down')
      const label = d?.phase === 'done' ? 'Downloaded' : d?.phase === 'busy' ? 'Downloading' : d?.phase === 'queued' ? 'Waiting to download' : d?.phase === 'failed' ? 'Could not find a source. Tap to retry' : 'Download'
      b.setAttribute('aria-label', label); b.title = label
      if (b.id === 'dl') b.innerHTML = ico + (d?.phase === 'done' ? 'Downloaded' : d?.phase === 'busy' ? 'Downloading' : d?.phase === 'queued' ? 'Waiting' : 'Download')
      else b.innerHTML = ico
    })
    const sb = $('#dlseason', root)
    if (sb && !flat) {
      const eps = videos.filter(v => v.season === season)
      const done = eps.filter(v => dl[dkey(v.season, v.episode)]?.phase === 'done').length
      const busy = eps.filter(v => ['busy', 'queued'].includes(dl[dkey(v.season, v.episode)]?.phase)).length
      sb.innerHTML = icon(done === eps.length && eps.length ? 'check' : 'down') + (done === eps.length && eps.length ? 'Season downloaded' : busy ? `Downloading ${done}/${eps.length}` : 'Download season')
    }
  }
  async function download (body) {
    try {
      const r = await api('/api/download', { method: 'POST', body })
      toast(r.queued ? (r.total > 1 ? `Added ${r.queued} episodes to your downloads` : 'Added to your downloads') : 'Already downloaded or on its way')
    } catch (e) { toast(e.message) }
    refreshDl()
  }
  const onClick = e => {
    const b = e.target.closest('[data-e]')
    if (b) { e.preventDefault(); if (b.dataset.state === 'done' || b.dataset.state === 'busy' || b.dataset.state === 'queued') return location.hash = '#/library'; return download({ type, id, season: b.dataset.s, episode: b.dataset.e }) }
    if (e.target.closest('#dlseason')) download({ type, id, season, all: true })
  }
  root.addEventListener('click', onClick)
  refreshDl()
  detailCleanup = (prev => () => { prev(); clearTimeout(poll); clearTimeout(warm); root.removeEventListener('click', onClick) })(detailCleanup)
  if (flat) return detailCleanup

  const draw = () => {
    $('#eps').innerHTML = videos.filter(v => v.season === season).map(v => {
      const p = progress(type, id, v.season, v.episode); const r = p ? p[0] / p[1] : 0
      const future = v.released && new Date(v.released) > new Date()
      const d = v.released ? new Date(v.released).toLocaleDateString(document.documentElement.lang || undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''
      return `<div class="ep-row"><a class="ep" href="${watchHref(type, id, v.season, v.episode)}">
        <span class="n">${v.episode}</span>
        <span class="th" style="${m.background || m.poster ? `--art:url('${esc(sized(m.background || m.poster, thumbW()))}');` : ''}--h:${hue(m.name)}"><b class="num" aria-hidden="true">${v.episode}</b>${v.thumbnail ? `<img alt="" data-src="${esc(sized(v.thumbnail, thumbW()))}" onload="this.classList.add('in')" onerror="this.remove()">` : ''}${r > 0.02 ? `<span class="prog"><i style="width:${Math.min(100, r * 100)}%"></i></span>` : ''}<span class="go">${icon('play')}</span>${r > 0.93 ? `<span class="ok">${icon('check')}</span>` : ''}</span>
        <span><span class="t" translate="no">${esc(v.title)}</span><br><span class="d">${future ? 'Airs ' + d : d}${p && r < 0.95 ? ` · ${mins(Math.max(60, p[1] - p[0]))} left` : ''}</span></span>
</a><button class="dl" data-s="${v.season}" data-e="${v.episode}" aria-label="Download">${icon('down')}</button></div>`
    }).join('') || '<p class="dim">No episodes listed yet.</p>'
  }
  draw(); paintDl()
  dragScroll($('#seasons'))
  $('#seasons')?.addEventListener('click', e => {
    const b = e.target.closest('[data-s]'); if (!b) return
    season = +b.dataset.s; draw(); paintDl()
    $('#seasons').querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === b))
  })
  return detailCleanup
}
