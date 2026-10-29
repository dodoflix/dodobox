// Subtitle files are sometimes filed under the wrong language, and English is the usual culprit: its small words give it away.
const WORDS = new Set(['the', 'you', 'and', 'that', 'this', 'with', 'have', 'what', 'your', 'they', 'would', 'there', 'from', 'not', 'are', 'but', 'just', 'here', 'about', "don't", "it's", "i'm"])

export function looksEnglish (texts) {
  let words = 0; let hits = 0
  for (const t of texts) for (const w of t.toLowerCase().match(/[a-z']+/g) || []) { words++; if (WORDS.has(w)) hits++ }
  return words >= 150 && hits / words > 0.1
}
