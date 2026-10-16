// File choice inside multi-file torrents (offline, snapshots/packs).
// A task asks for episode N of a real pack; a picker answers with a file index or -1 (episode not in the pack).
//   --show n   print n tasks where the pickers disagree
import { readSnapshot } from '../lib/store.js'
import repo from '../candidates/pick-repo.js'
import { pickAnime } from '../candidates/pick.js'

const PICKERS = [repo, { id: 'pack-aware', pick: pickAnime }]
const base = n => n.split(/[\\/]/).pop()

export default async function pick (args) {
  const packs = readSnapshot('packs')
  const stats = Object.fromEntries(PICKERS.map(p => [p.id, { none: 0 }]))
  let tasks = 0; let agree = 0; const diff = []
  for (const p of packs) for (const [e, ep] of Object.entries(p.eps)) {
    const t = { episode: +e, tvdbSeason: ep.tvdbSeason, tvdbEpisode: ep.tvdbEpisode, abs: ep.abs }
    const picks = PICKERS.map(x => x.pick(p.files, t))
    tasks++
    picks.forEach((v, i) => { if (v < 0) stats[PICKERS[i].id].none++ })
    if (picks.every(v => v === picks[0])) agree++
    else diff.push({ pack: p.release.slice(0, 44), episode: e, abs: t.abs, ...Object.fromEntries(PICKERS.map((x, i) => [x.id, picks[i] >= 0 ? base(p.files[picks[i]].name).slice(0, 50) : '-'])) })
  }
  console.log(`${packs.length} packs, ${tasks} tasks, pickers agree on ${agree}`)
  console.table(Object.entries(stats).map(([id, s]) => ({ picker: id, 'no file': s.none, 'share with a file': Math.round(100 * (tasks - s.none) / tasks) + '%' })))
  const n = +args.show || 0
  if (n) console.table(diff.sort(() => 0).slice(0, n))
}
