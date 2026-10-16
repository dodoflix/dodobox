// Release matchers on the corpus snapshot (offline).
//   --matchers repo,tokenizer,...   --dump <matcher>:<kind> (write misses and false positives to .cache/)
// recall: share of releases the id-keyed services returned for the exact target that the matcher accepts.
// FP neighbor: accepts a single-episode release for the adjacent episode. FP other: accepts another show's release.
import { readSnapshot, cacheFile, writeJSON } from '../lib/store.js'
import { isExtra } from '../candidates/tokenizer.js'
import repo from '../candidates/match-repo.js'
import tokenizer from '../candidates/tokenizer.js'
import ctrl from '../candidates/match-ctrl.js'
import ptt from '../candidates/match-ptt.js'
import anitomy from '../candidates/match-anitomy.js'

const ALL = [repo, tokenizer, ctrl, ptt, anitomy].filter(Boolean)
const NOISE = /\b(henshu|mini anime|marumaru|ppoi|cap\.\d+|temporada)\b/i // recaps and dubs the services file under the episode
const tkey = t => `${t.id}|${t.season ?? t.tvdbSeason ?? ''}|${t.episode ?? ''}`
function rng (seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 } }

export default async function match (args) {
  const corpus = readSnapshot('corpus').filter(r => r.seeders >= 1 && !isExtra(r.name) && !NOISE.test(r.name))
  const seen = new Set(); const pos = []
  for (const r of corpus) { const k = r.hash + tkey(r.target); if (!seen.has(k)) { seen.add(k); pos.push(r) } }
  const targets = new Map(); for (const r of corpus) targets.set(tkey(r.target), r.target)
  const isSingle = r => r.src === 'tosho' ? r.files === 1 : true
  const rand = rng(7); const near = []; const other = []
  for (const r of pos) {
    if (!isSingle(r)) continue
    for (const t of targets.values()) {
      if (tkey(t) === tkey(r.target) || t.kind !== r.target.kind) continue
      if (t.id === r.target.id && t.kind !== 'movie') { if (Math.abs(t.episode - r.target.episode) <= 1 && (t.tvdbSeason ?? t.season) === (r.target.tvdbSeason ?? r.target.season)) near.push([r, t]) }
      else if (rand() < 0.02) other.push([r, t])
    }
  }
  console.log(`positives ${pos.length}, neighbor-episode negatives ${near.length}, other-show negatives ${other.length}`)
  const want = args.matchers?.split(',')
  const out = []
  for (const m of ALL.filter(m => !want || want.includes(m.id))) {
    await m.prepare?.(corpus)
    for (const kind of ['movie', 'series', 'anime']) {
      if (m.kinds && !m.kinds.includes(kind)) continue
      const P = pos.filter(r => r.target.kind === kind); const A = near.filter(([r]) => r.target.kind === kind); const B = other.filter(([r]) => r.target.kind === kind)
      const t0 = performance.now(); const safe = (r, t) => { try { return !!m.match(r, t) } catch { return false } }
      const miss = P.filter(r => !safe(r, r.target)); const fa = A.filter(([r, t]) => safe(r, t)); const fb = B.filter(([r, t]) => safe(r, t))
      const us = (performance.now() - t0) * 1000 / (P.length + A.length + B.length)
      out.push({ matcher: m.id, kind, recall: Math.round(100 * (P.length - miss.length) / P.length) + '%', 'FP neighbor': A.length ? (100 * fa.length / A.length).toFixed(1) + '%' : '-', 'FP other': B.length ? (100 * fb.length / B.length).toFixed(1) + '%' : '-', 'us/call': us.toFixed(1) })
      if (args.dump === `${m.id}:${kind}`) {
        writeJSON(cacheFile('match-misses.json'), miss.slice(0, 400).map(r => ({ name: r.name, release: r.release, target: r.target.entryTitle || r.target.title, episode: r.target.episode })))
        writeJSON(cacheFile('match-false-positives.json'), [...fa, ...fb].slice(0, 300).map(([r, t]) => ({ name: r.name, labeledEpisode: r.target.episode, testedEpisode: t.episode, target: t.entryTitle || t.title })))
        console.log('wrote .cache/match-misses.json and .cache/match-false-positives.json')
      }
    }
  }
  console.table(out)
}
