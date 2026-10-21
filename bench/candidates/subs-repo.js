import { scoreSub, WEIGHTS } from '../../src/subs.js'

// The shipped scorer; `w` overrides the weights for the grid search.
export default { id: 'repo', W: WEIGHTS, rank: (list, release, langs, w) => [...list].sort((a, b) => scoreSub(b, release, langs, w) - scoreSub(a, release, langs, w)) }
