// Downloads the reference data other commands read: Fribb anime id lists and ani.zip episode tables.
import fs from 'node:fs'
import { req, sleep, CACHE } from '../lib/net.js'
import { cacheFile, goldSet, readJSON, writeJSON } from '../lib/store.js'

export default async function data () {
  fs.mkdirSync(CACHE, { recursive: true })
  if (!fs.existsSync(cacheFile('fribb.json'))) {
    const r = await req('https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json', { timeout: 60000, as: 'text' })
    if (!r.ok) throw new Error(`fribb anime-list: ${r.status} ${r.err || ''}`)
    fs.writeFileSync(cacheFile('fribb.json'), r.text)
    console.log('fribb.json saved')
  }
  // ani.zip answers 429 after roughly 60 quick requests, so the fetch is spaced and resumable.
  const az = readJSON(cacheFile('anizip.json'), {})
  const ids = new Set()
  for (const set of ['core', 'edge']) for (const g of await goldSet(set).catch(() => [])) if (g.kind === 'anime') ids.add(g.al)
  for (const id of ids) {
    if (az[id]) continue
    const r = await req(`https://api.ani.zip/mappings?anilist_id=${id}`)
    if (r.ok) az[id] = r.body
    else console.log(`ani.zip ${id}: ${r.status}`)
    writeJSON(cacheFile('anizip.json'), az)
    await sleep(1300)
  }
  console.log(`anizip.json: ${Object.keys(az).length} entries`)
}
