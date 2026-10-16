// Rebuilds the committed fixtures the offline commands run on (snapshots/*.json.gz). Needs the network and `data` first.
//   corpus: releases returned by id-keyed lookups (IMDb:S:E, Kitsu, AniDB episode), so labels come from the services' own ids.
//   packs:  real multi-file anime torrents with their file lists.
import { req, pool, sleep } from '../lib/net.js'
import { aniZip, goldSet, writeSnapshot } from '../lib/store.js'

const BYTES = { KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1048576, GB: 1e9, GIB: 1073741824, TB: 1e12, TIB: 1099511627776 }
// The services rate-limit bursts; a failed lookup is retried with a growing pause instead of silently shrinking the fixture.
async function get (url) {
  for (let i = 1; ; i++) {
    const r = await req(url, { timeout: 15000 })
    if (r.ok || i === 4 || (r.status >= 400 && r.status < 500 && r.status !== 429)) return r
    await sleep(1500 * i)
  }
}
const streams = async path => {
  const r = await get(`https://torrentio.strem.fun/stream/${path}.json`)
  return (r.body?.streams || []).filter(s => s.infoHash).map(s => {
    const [t, meta = ''] = s.title.split('\n👤'); const sz = meta.match(/💾\s*([\d.]+)\s*(\w+)/)
    return { name: s.behaviorHints?.filename || t.split('\n')[0], release: t.split('\n')[0], hash: s.infoHash.toLowerCase(), seeders: parseInt(meta, 10) || 0, size: sz ? parseFloat(sz[1]) * BYTES[sz[2].toUpperCase()] : 0, fileIdx: s.fileIdx ?? null, src: 'torrentio' }
  })
}
const tosho = async query => {
  const r = await get(`https://animetosho.org/feed/json?${query}&order=seeders`)
  return (Array.isArray(r.body) ? r.body : []).filter(x => x.info_hash).map(x => ({ name: x.title, release: x.torrent_name || x.title, hash: x.info_hash, seeders: x.seeders || 0, size: x.total_size, files: x.num_files, src: 'tosho', id: x.id }))
}

async function corpus (gold, AZ) {
  const out = []; const jobs = []
  for (const g of gold) {
    if (g.kind === 'movie') jobs.push(async () => { for (const r of await streams(`movie/${g.imdb}`)) out.push({ ...r, target: { kind: 'movie', id: g.imdb, title: g.title, year: g.year } }) })
    else if (g.kind === 'series') {
      for (const d of [-1, 0, 1]) { const e = g.episode + d; if (e < 1) continue; jobs.push(async () => { for (const r of await streams(`series/${g.imdb}:${g.season}:${e}`)) out.push({ ...r, target: { kind: 'series', id: g.imdb, title: g.title, year: g.year, season: g.season, episode: e } }) }) }
    } else {
      const az = AZ[g.al]; if (!az) continue
      const titles = [...new Set([g.title, ...(g.alt || []), ...Object.entries(az.titles || {}).filter(([k]) => /^(en|x-jat)/.test(k)).map(([, v]) => v)])]
      if (g.movie) { jobs.push(async () => { for (const r of await tosho(`aid=${az.mappings.anidb_id}`)) out.push({ ...r, target: { kind: 'anime', id: 'al' + g.al, movie: true, titles, year: g.year } }) }); continue }
      for (const d of [-1, 0, 1]) {
        const e = g.ep + d; const ep = az.episodes?.[e]; if (!ep?.anidbEid) continue
        const target = { kind: 'anime', id: 'al' + g.al, titles, year: g.year, episode: e, tvdbSeason: ep.seasonNumber, tvdbEpisode: ep.episodeNumber, abs: ep.absoluteEpisodeNumber, entryTitle: g.title }
        jobs.push(async () => { for (const r of await tosho(`eid=${ep.anidbEid}`)) out.push({ ...r, target }) })
        if (az.mappings.imdb_id && ep.seasonNumber) jobs.push(async () => { for (const r of await streams(`series/${az.mappings.imdb_id}:${ep.seasonNumber}:${ep.episodeNumber}`)) out.push({ ...r, target }) })
      }
    }
  }
  // Torrentio answers 429 to bursts, so lookups run two at a time.
  await pool(jobs, 2, async j => { await j().catch(e => console.log('lookup failed:', e.message)); await sleep(250) })
  return out.map(({ id: _id, ...r }) => r)
}

async function packs (gold, AZ) {
  const out = []
  for (const g of gold.filter(g => g.kind === 'anime' && !g.movie)) {
    const az = AZ[g.al]; const aid = az?.mappings?.anidb_id; const seen = new Set()
    for (const q of ['batch', 'complete', '']) {
      const rows = (await tosho(`aid=${aid}${q ? '&q=' + q : ''}`)).filter(x => x.files >= 4 && x.files <= 300 && !seen.has(x.id))
      for (const x of rows.slice(0, 3)) {
        seen.add(x.id)
        await sleep(400)
        const d = await get(`https://animetosho.org/feed/json?show=torrent&id=${x.id}`)
        const files = (d.body?.files || []).map(f => ({ name: f.filename, length: f.size }))
        if (files.length < 4) continue
        const eps = {}; for (let e = 1; e <= Math.min(12, az.episodeCount); e++) { const ep = az.episodes?.[e]; if (ep) eps[e] = { tvdbSeason: ep.seasonNumber, tvdbEpisode: ep.episodeNumber, abs: ep.absoluteEpisodeNumber } }
        out.push({ title: g.title, release: x.name, hash: x.hash, eps, files })
      }
      if (seen.size >= 4) break
    }
  }
  return out
}

export default async function snapshots (args) {
  const gold = await goldSet('core'); const AZ = aniZip()
  if (args.only !== 'packs') { const c = await corpus(gold, AZ); writeSnapshot('corpus', c); console.log('corpus rows:', c.length) }
  if (args.only !== 'corpus') { const p = await packs(gold, AZ); writeSnapshot('packs', p); console.log('packs:', p.length, 'files:', p.reduce((a, x) => a + x.files.length, 0)) }
}
