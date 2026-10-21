// Skip markers for the player: the intro, a recap and the ending (credits) of an episode, as { start, end } seconds.
// Per marker the first source that has one wins: the file's own chapters (exact for this file), then the community
// databases, AniSkip (anime, by MAL id) and IntroDB (series, by IMDb id), which record times against one release.
import { getJSON } from './http.js'
import { log } from './log.js'

const KINDS = ['intro', 'recap', 'outro']
const TTL = 6 * 3600e3
const NONE_TTL = 30 * 60e3
// AniSkip stores the length of the video each time was measured on. Releases of one episode differ by a few seconds
// (a longer cold open or preview); beyond this the times would land in the wrong scene.
export const LENGTH_TOLERANCE_S = 12
const cache = new Map()

const CHAPTER = [
  ['recap', /^(recap|previously|last time)\b/i],
  ['intro', /^(op|intro|introduction|title sequence|main titles?)\b|\bopening\b/i],
  ['outro', /^(ed|outro|closing)\b|\b(ending|credits?)\b/i]
]

// Chapter titles fansubs and releases use for the same things ("Opening", "OP", "Intro", "Ending", "Credits").
export function fromChapters (chapters = [], duration = 0) {
  const out = {}
  for (const c of chapters) {
    const kind = CHAPTER.find(([, re]) => re.test((c.title || '').trim()))?.[0]
    if (!kind || out[kind]) continue
    out[kind] = { start: c.start, end: kind === 'outro' && duration ? Math.min(c.end, duration) : c.end }
  }
  return out
}

// A marker that cannot be right is dropped: an intro belongs to the first half, an ending to the second.
export function sane (kind, s, duration) {
  if (!s || !(s.start >= 0) || !(s.end > s.start)) return false
  const len = s.end - s.start
  if (duration && s.start >= duration) return false
  if (kind === 'intro') return len >= 5 && len <= 300 && (!duration || s.start < duration * 0.5)
  if (kind === 'recap') return len >= 5 && len <= 300 && (!duration || s.start < duration * 0.5)
  return len >= 5 && (!duration || s.start > duration * 0.5)
}

async function aniskip (mal, episode, duration) {
  const r = await getJSON(`https://api.aniskip.com/v2/skip-times/${mal}/${episode}?types=op&types=ed&types=recap&episodeLength=${Math.round(duration) || 0}`)
  const out = {}
  for (const x of r?.results || []) {
    const kind = { op: 'intro', ed: 'outro', recap: 'recap' }[x.skipType]
    if (!kind || out[kind]) continue
    // Times recorded on a video of another length (another cut or broadcast) would land in the wrong place.
    if (duration && x.episodeLength && Math.abs(x.episodeLength - duration) > LENGTH_TOLERANCE_S) continue
    out[kind] = { start: x.interval.startTime, end: x.interval.endTime }
  }
  return out
}

async function introdb (imdb, season, episode) {
  const r = await getJSON(`https://api.introdb.app/segments?imdb_id=${imdb}&season=${season}&episode=${episode}`)
  const out = {}
  for (const [kind, key] of [['intro', 'intro'], ['recap', 'recap'], ['outro', 'outro']]) {
    if (r?.[key]) out[kind] = { start: r[key].start_sec, end: r[key].end_sec }
  }
  return out
}

const ask = (fn, ...a) => fn(...a).catch(e => { log.debug('skips', 'lookup failed', { source: fn.name, err: e }); return {} })

// item: { type, id, season, episode, mal }; chapters and duration come from the probe of the file in hand.
export async function skipsFor (item, { chapters = [], duration = 0 } = {}) {
  const own = fromChapters(chapters, duration)
  const key = `${item.type}:${item.id}:${item.season ?? ''}:${item.episode ?? ''}:${Math.round(duration / 3)}`
  let online = cache.get(key)
  if (!online || Date.now() > online.until) {
    const found = ['intro', 'outro'].every(k => sane(k, own[k], duration)) ? {} : item.type === 'anime' && item.mal && item.episode != null ? await ask(aniskip, item.mal, item.episode, duration)
      : item.type === 'series' && item.season != null ? await ask(introdb, item.id, item.season, item.episode) : {}
    online = { found, until: Date.now() + (Object.keys(found).length ? TTL : NONE_TTL) }
    cache.set(key, online)
    if (cache.size > 2000) cache.delete(cache.keys().next().value)
  }
  const out = {}
  for (const k of KINDS) {
    const pick = sane(k, own[k], duration) ? { ...own[k], from: 'chapters' } : sane(k, online.found[k], duration) ? { ...online.found[k], from: item.type === 'anime' ? 'aniskip' : 'introdb' } : null
    if (pick) out[k] = { ...pick, end: duration ? Math.min(pick.end, duration) : pick.end } // another cut of the episode can be shorter than the one a time was recorded on
  }
  return out
}
