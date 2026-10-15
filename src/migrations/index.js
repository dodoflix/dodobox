// Every change to how Dodobox stores its data is one file here, named with the version it produces (002-..., 003-...) and listed below in order.
// Files are never edited or removed once released: an install that skipped releases runs each missing one in turn.
//
// A migration is { name, up({ dir, read, write, drop }) } and must be safe to run twice and cope with missing files:
//   read(name)           the parsed JSON file, or undefined if it is missing or unreadable
//   write(name, value)   replaces the file in one step (never half-written)
//   drop(name)           deletes a file or folder (for caches, which rebuild themselves)
import baseline from './001-baseline.js'

export const MIGRATIONS = [
  baseline
]
