// YIFY Subtitles: an extra source for movies, scraped from the public page (ZIP downloads, one .srt inside).
import zlib from 'node:zlib'
import { fetchRetry, once } from './http.js'

const BASE = 'https://yifysubtitles.ch'
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
export const yifyHeaders = { 'user-agent': UA, referer: BASE + '/' }

// Language names on the site to the ISO 639-2 codes used everywhere else.
const CODES = { english: 'eng', turkish: 'tur', spanish: 'spa', french: 'fre', german: 'ger', italian: 'ita', portuguese: 'por', 'brazilian portuguese': 'pob', russian: 'rus', arabic: 'ara', japanese: 'jpn', korean: 'kor', chinese: 'chi', 'chinese bg code': 'chi', dutch: 'dut', polish: 'pol', indonesian: 'ind', hindi: 'hin', vietnamese: 'vie', greek: 'ell', hebrew: 'heb', swedish: 'swe', danish: 'dan', finnish: 'fin', norwegian: 'nor', romanian: 'rum', hungarian: 'hun', czech: 'cze', bulgarian: 'bul', croatian: 'hrv', serbian: 'srp', ukrainian: 'ukr', thai: 'tha', 'farsi/persian': 'per', slovenian: 'slv', malay: 'may' }

const cache = new Map()
export function yifyList (imdb, langs) {
  const hit = cache.get(imdb)
  if (hit && Date.now() - hit.at < 24 * 3600e3) return Promise.resolve(pick(hit.rows, langs))
  return once('yify:' + imdb, async () => {
    const html = await (await fetchRetry(`${BASE}/movie-imdb/${imdb}`, { headers: yifyHeaders, timeout: 12000, tries: 2 })).text()
    const rows = []
    for (const m of html.matchAll(/<tr[^>]*data-id="\d+"[^>]*>([\s\S]*?)<\/tr>/g)) {
      const row = m[1]
      const lang = CODES[(row.match(/sub-lang">([^<]+)</)?.[1] || '').trim().toLowerCase()]
      const href = row.match(/href="\/subtitles\/([^"]+)"/)?.[1]
      if (!lang || !href) continue
      const rating = parseInt(row.match(/rating[^>]*>\s*(-?\d+)/)?.[1], 10) || 0
      const rel = [...row.matchAll(/<\/span>\s*([^<]{6,})</g)].map(x => x[1].trim()).find(x => /\w/.test(x)) || href
      rows.push({ lang, url: `${BASE}/subtitle/${href}.zip`, rel: rel.replace(/^subtitle\s*/i, ''), dl: Math.max(0, rating) * 20, via: 'yify' })
    }
    cache.set(imdb, { at: Date.now(), rows })
    return pick(rows, langs)
  })
}
const pick = (rows, langs) => rows.filter(r => langs.includes(r.lang))

// The first .srt (or .sub) inside a ZIP, without any dependency: read the central directory, inflate that entry.
export function unzipFirst (buf) {
  let e = buf.length - 22
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--
  if (e < 0) throw new Error('not a zip')
  let p = buf.readUInt32LE(e + 16)
  for (let n = buf.readUInt16LE(e + 10); n > 0; n--) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10); const csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28); const extra = buf.readUInt16LE(p + 30); const comment = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42); const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extra + comment
    if (!/\.(srt|sub|ass|ssa|vtt)$/i.test(name)) continue
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
    const data = buf.subarray(start, start + csize)
    return method === 0 ? data : zlib.inflateRawSync(data)
  }
  throw new Error('no subtitle in zip')
}
