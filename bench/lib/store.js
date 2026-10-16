import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { CACHE, SNAP } from './net.js'

export const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback } }
export const writeJSON = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)) }

export const cacheFile = name => path.join(CACHE, name)
export const readSnapshot = name => JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(SNAP, name + '.json.gz'))))
export const writeSnapshot = (name, value) => { fs.mkdirSync(SNAP, { recursive: true }); fs.writeFileSync(path.join(SNAP, name + '.json.gz'), zlib.gzipSync(JSON.stringify(value), { level: 9 })) }

function need (file, hint) {
  const v = readJSON(file)
  if (!v) throw new Error(`${path.basename(file)} is missing: run \`npm run bench -- ${hint}\``)
  return v
}

// Sets: core (small, representative) and edge (hard titles, long runners, sequels, old shows).
export async function goldSet (set) {
  if (set === 'edge') return need(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'gold', 'edge.json'), 'resolve')
  return (await import('../gold/core.js')).GOLD
}
// ani.zip: per-episode AniDB, TVDB and absolute numbering for each anime entry, keyed by AniList id.
export const aniZip = () => need(cacheFile('anizip.json'), 'data')
// Fribb anime-lists: AniList to Kitsu / IMDb / TVDB / AniDB ids, offline.
export const fribb = () => { const list = need(cacheFile('fribb.json'), 'data'); return new Map(list.filter(x => x.anilist_id).map(x => [x.anilist_id, x])) }
export const sourcesRaw = set => need(cacheFile(`sources-${set}.json`), `sources --set ${set}`)
