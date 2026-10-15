// Subtitle files that come inside a torrent next to the video: "Show - 01.en.srt", "Subs/Show.S01E02/2_English.srt".
import { VIDEO_EXT, matchAnimeEpisode, matchSeriesEpisode } from './sources.js'

export const SUB_FILE = /\.(srt|ass|ssa|vtt)$/i
const MAX_BYTES = 5e6

// code (the 3-letter form the rest of the app uses): [names and codes that may appear in a file name]
const LANGS = {
  eng: ['english', 'eng'], tur: ['turkish', 'turkce', 'tur'], spa: ['spanish', 'espanol', 'castellano', 'latino', 'spa'], fre: ['french', 'francais', 'fre', 'fra'],
  ger: ['german', 'deutsch', 'ger', 'deu'], ita: ['italian', 'italiano', 'ita'], por: ['portuguese', 'portugues', 'por'], pob: ['brazilian', 'pob', 'ptbr'],
  rus: ['russian', 'rus'], ara: ['arabic', 'ara'], jpn: ['japanese', 'jpn', 'jap'], kor: ['korean', 'kor'], chi: ['chinese', 'chi', 'zho', 'chs', 'cht'],
  dut: ['dutch', 'nederlands', 'dut', 'nld'], pol: ['polish', 'polski', 'pol'], ind: ['indonesian', 'ind'], hin: ['hindi', 'hin'], vie: ['vietnamese', 'vie'],
  ell: ['greek', 'ell', 'gre'], heb: ['hebrew', 'heb'], swe: ['swedish', 'swe'], tha: ['thai', 'tha'], per: ['persian', 'farsi', 'per', 'fas'], rum: ['romanian', 'rum', 'ron'],
  cze: ['czech', 'cze', 'ces'], hun: ['hungarian', 'hun'], dan: ['danish', 'dan'], nor: ['norwegian', 'nor'], fin: ['finnish', 'fin'], ukr: ['ukrainian', 'ukr'],
  bul: ['bulgarian', 'bul'], hrv: ['croatian', 'hrv'], srp: ['serbian', 'srp'], may: ['malay', 'may', 'msa']
}
// Two letters are only trusted as the last part of the name (".en.srt", "[tr]"): elsewhere they are ordinary words.
const SHORT = { en: 'eng', tr: 'tur', es: 'spa', fr: 'fre', de: 'ger', it: 'ita', pt: 'por', ru: 'rus', ar: 'ara', ja: 'jpn', ko: 'kor', zh: 'chi', nl: 'dut', pl: 'pol', id: 'ind', hi: 'hin', vi: 'vie', el: 'ell', he: 'heb', sv: 'swe', th: 'tha', fa: 'per', ro: 'rum', cs: 'cze', hu: 'hun', da: 'dan', fi: 'fin', uk: 'ukr', bg: 'bul' }
const BY_WORD = new Map(Object.entries(LANGS).flatMap(([code, words]) => words.map(w => [w, code])))

const plain = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
const base = p => p.split(/[\\/]/).pop()
const stem = p => base(p).replace(/\.[^.]+$/, '')

// The language a file name or its folders name, or 'und'.
export function langOfName (path) {
  const parts = path.split(/[\\/]/)
  for (let n = parts.length - 1; n >= Math.max(0, parts.length - 2); n--) {
    const name = plain(n === parts.length - 1 ? stem(path) : parts[n])
    const tokens = name.split(/[^a-z]+/).filter(Boolean)
    for (let i = tokens.length - 1; i >= 0; i--) {
      if (tokens[i] === 'br' && tokens[i - 1] === 'pt') return 'pob'
      const code = BY_WORD.get(tokens[i]) || (i === tokens.length - 1 && n === parts.length - 1 ? SHORT[tokens[i]] : null)
      if (code) return code
    }
  }
  return 'und'
}

// The subtitle files that belong to the video at files[videoIdx] ({ name: path, length }), each as { i, name, lang, forced }.
export function sidecarsFor (files, videoIdx, { type, season, episode } = {}) {
  const video = files[videoIdx]
  if (!video) return []
  const vids = files.filter(f => VIDEO_EXT.test(f.name) && !/sample/i.test(f.name))
  const vstem = stem(video.name)
  const episodeMatch = s => (type === 'anime' ? matchAnimeEpisode(s, episode) && !/batch|complete/i.test(s) : matchSeriesEpisode(s, season, episode))
  const mine = (name) => {
    const s = stem(name)
    // "Show - 01.en.srt" for "Show - 01.mkv", but not "Show - 011.srt"
    if (s.startsWith(vstem) && !/^\d/.test(s.slice(vstem.length))) return true
    if (vids.length <= 1) return true
    if (type === 'movie' || episode == null) return false
    const parts = name.split(/[\\/]/)
    return episodeMatch(parts.pop()) || (parts.length > 1 && episodeMatch(parts.pop()))
  }
  return files.flatMap((f, i) => SUB_FILE.test(f.name) && f.length > 0 && f.length < MAX_BYTES && mine(f.name)
    ? [{ i, name: base(f.name), lang: langOfName(f.name), forced: /\bforced\b/i.test(f.name) }] : [])
}
