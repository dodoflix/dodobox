import * as S from '../../src/sources.js'

// Baseline: the repo's current score() ordering.
export default { id: 'repo', rank: (list, ctx) => S.rank(list, ctx) }
