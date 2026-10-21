import { similarity } from '../../src/subs.js'

// The score before signals were added: release similarity, log downloads, wanted language, forced.
const score = (s, release, langs) => similarity(release, s.rel) * 3 + Math.log10(s.dl + 1) + (langs.includes(s.lang) ? 2 : 0) - (s.forced ? 6 : 0)
export default { id: 'legacy', rank: (list, release, langs) => [...list].sort((a, b) => score(b, release, langs) - score(a, release, langs)) }
