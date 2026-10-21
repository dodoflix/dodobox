import * as S from '../../src/sources.js'
import { race, rivalsOf } from '../../src/race.js'

// The shipped ranking and race. The speed probe reads what arrives in a fixed window, so a slow line is measured, not unknown.
export default {
  id: 'repo',
  lineMbps: line => line,
  rank: (list, ctx) => S.rank(list, ctx),
  rivalsOf,
  race
}
