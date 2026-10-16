import { tok, lead } from './tokenizer.js'

const SEASONY = /(\d+(st|nd|rd|th) season|season \d+|part \d+|cour \d+|final season|the final season|\bs\d+\b|\(\d{4}\))/gi
const base = t => lead(tok(t.replace(SEASONY, ' ')))

// Title equality used to wrap third-party parsers, which only return a parsed title.
export const sameTitle = (parsed, target) => {
  const all = target.titles || [target.title]
  const p = lead(tok(parsed)).join(' '); const pb = base(parsed).join(' ')
  return all.some(t => { const full = lead(tok(t)).join(' '); const b = base(t).join(' '); return full === p || full === pb || b === p || b === pb })
}
