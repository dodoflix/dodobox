// Edge-case spec: what makes each title hard. `resolve` turns it into gold/edge.json; check the printed matches by eye.
// Movies: [title, year, category, { imdb?, alt? }]. Series: [title, year, season, episode, category].
// Anime: [AniList id or search text, episode, category].
export const MOVIES = [
  ['Dune', 1984, 'remake-same-title'], ['The Thing', 1982, 'remake-same-title'], ['The Thing', 2011, 'remake-same-title'], ['Halloween', 1978, 'remake-same-title'], ['Halloween', 2018, 'remake-same-title'],
  ['Joker', 2019, 'common-word'], ['Nosferatu', 1922, 'silent-old'], ['Nosferatu', 2024, 'remake-same-title'], ['Metropolis', 1927, 'silent-old'], ['2001: A Space Odyssey', 1968, 'digits-punct'],
  ['Se7en', 1995, 'digits-punct', { alt: ['Seven'] }], ['WALL-E', 2008, 'digits-punct', { imdb: 'tt0910970' }], ['(500) Days of Summer', 2009, 'digits-punct'], ['Her', 2013, 'common-word'], ['It', 2017, 'common-word'],
  ['Us', 2019, 'common-word'], ['Up', 2009, 'common-word'], ['Heat', 1995, 'common-word'], ['Oldboy', 2003, 'foreign'], ['Amélie', 2001, 'foreign', { alt: ['Amelie'] }],
  ["Pan's Labyrinth", 2006, 'foreign'], ['Seven Samurai', 1954, 'foreign-old'], ['Akira', 1988, 'anime-movie-in-imdb'], ['Spirited Away', 2001, 'anime-movie-in-imdb'], ['Evangelion: 3.0+1.0 Thrice Upon a Time', 2021, 'anime-movie-in-imdb'],
  ['Superman', 2025, 'very-new'], ['The Fantastic Four: First Steps', 2025, 'very-new'], ['Mickey 17', 2025, 'very-new'], ['Mission: Impossible - Dead Reckoning Part One', 2023, 'long-title'], ['The Lord of the Rings: The Fellowship of the Ring', 2001, 'long-title']
]
export const SERIES = [
  ['The Office', 2001, 2, 3, 'same-title-other-country'], ['Doctor Who', 2005, 1, 1, 'same-title-other-era'], ['Shameless', 2011, 3, 4, 'same-title-other-country'], ['Fargo', 2014, 1, 3, 'common-word'], ['The Flash', 2014, 3, 5, 'same-title-other-era'],
  ['Chernobyl', 2019, 1, 3, 'miniseries'], ['Lost', 2004, 4, 5, 'common-word'], ['Archer', 2009, 5, 2, 'common-word'], ['You', 2018, 2, 1, 'common-word'], ['The Simpsons', 1989, 10, 5, 'long-running'],
  ['South Park', 1997, 5, 8, 'long-running'], ['Friends', 1994, 5, 14, 'old'], ['Attack on Titan', 2013, 4, 5, 'anime-in-imdb'], ['One Piece', 2023, 1, 3, 'live-action-of-anime'], ['One Piece', 1999, 3, 10, 'anime-in-imdb-seasons'],
  ['Dragon Ball Z', 1989, 3, 10, 'anime-in-imdb'], ['Naruto: Shippuden', 2007, 5, 20, 'anime-in-imdb'], ['Arcane', 2021, 1, 4, 'animated-western'], ['Castlevania', 2017, 2, 3, 'animated-western'], ['Cyberpunk: Edgerunners', 2022, 1, 5, 'anime-in-imdb'],
  ['The Mandalorian', 2019, 2, 8, 'popular'], ['Succession', 2018, 4, 9, 'popular'], ['Lupin', 2021, 1, 3, 'foreign'], ['Narcos: Mexico', 2018, 2, 1, 'colon-title'], ['Sherlock', 2010, 2, 1, 'movie-length-eps'],
  ['Terriers', 2010, 1, 5, 'low-seed-cancelled'], ['Band of Brothers', 2001, 1, 2, 'miniseries'], ['Black Mirror', 2011, 3, 1, 'anthology'], ['Dark', 2017, 3, 8, 'foreign'], ['Severance', 2022, 2, 10, 'very-new']
]
// anime: [AniList id or search string, episode, category]. Ids marked with a number are known; strings are resolved.
export const ANIME = [
  [235, 1100, 'long-runner-abs'], [21, 1000, 'long-runner-abs'], [21, 1130, 'long-runner-abs'], [20, 150, 'long-runner-old'], [269, 200, 'long-runner-old'],
  [16498, 10, 'plain-s1'], [131681, 3, 'split-cour'], [113415, 12, 'plain-s1'], [11061, 50, 'old-remake-title'], [6, 10, 'old-batch-only'],
  [19, 20, 'old-batch-only'], [3786, null, 'movie'], [30, 5, 'old-batch-only'], [2904, 5, 'sequel-title-r2'], [121, 10, 'same-name-other-version'],
  [5114, 20, 'same-name-other-version'], [97938, 100, 'spinoff-long'], [97940, 100, 'long-runner-abs'], ['Overlord IV', 5, 'sequel-roman-numeral'], ['Dr. Stone: Stone Wars', 4, 'sequel-subtitle'],
  ['Haikyuu!! TO THE TOP', 6, 'punct-heavy'], ['Gintama', 100, 'long-runner-abs'], ['Berserk 1997', 10, 'old-batch-only'], ['Sword Art Online Alternative: Gun Gale Online', 3, 'spinoff-confusion'],
  ['Spy x Family Season 2', 3, 'sequel-season'], ['Oshi no Ko 2nd Season', 5, 'sequel-season'], ['Ore dake Level Up na Ken Season 2 -Arise from the Shadow-', 5, 'very-new-2025'], ['Dandadan 2nd Season', 3, 'very-new-2025'],
  ['Mushoku Tensei II Part 2', 4, 'split-cour'], ['Kaiju No. 8', 5, 'punct-heavy']
]
