// Interface language: text is translated in place by exact English match (lang/strings.js); data such as titles (translate="no") is never touched.
import { store } from './util.js'

// Spanish, French, German and Turkish live in strings.js columns; the rest each have a file of rows in the same order.
export const EXTRA_LANGS = ['it', 'pt', 'ru', 'nl', 'pl', 'ja', 'ko', 'zh', 'ar', 'id', 'sv', 'hi', 'vi', 'el', 'he']
export const UI_LANGS = ['en', 'tr', 'es', 'fr', 'de', ...EXTRA_LANGS]
export const uiLangFor = code => (UI_LANGS.includes(code) ? code : 'en')
export const savedUiLang = () => store.get('ui') || uiLangFor((navigator.language || 'en').slice(0, 2))

let exact = new Map(); let patterns = []; let obs = null; let current = 'en'
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt']
const collapse = s => s.replace(/\s+/g, ' ').trim()

function lookup (text) {
  const key = collapse(text)
  if (!key) return null
  if (exact.has(key)) return exact.get(key)
  for (const [re, out] of patterns) { if (re.test(key)) return key.replace(re, out) }
  return null
}

export const tr = text => (current === 'en' ? text : lookup(text) ?? text)

function translateText (node) {
  const p = node.parentElement
  if (!p || p.closest('[translate="no"], script, style, textarea')) return
  const raw = node.nodeValue; const core = collapse(raw)
  const out = lookup(raw)
  if (out != null && out !== core) node.nodeValue = raw.replace(raw.trim(), out)
}

function translateTree (root) {
  if (current === 'en' || !root) return
  if (root.nodeType === 3) return translateText(root)
  if (root.nodeType !== 1 || root.closest?.('[translate="no"]')) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes = []
  while (walker.nextNode()) nodes.push(walker.currentNode)
  nodes.forEach(translateText)
  for (const el of [root, ...root.querySelectorAll('[aria-label], [placeholder], [title], [alt]')]) {
    if (el.closest?.('[translate="no"]')) continue
    for (const a of ATTRS) if (el.hasAttribute?.(a)) { const out = lookup(el.getAttribute(a)); if (out != null && out !== el.getAttribute(a)) el.setAttribute(a, out) }
  }
}

export async function initI18n (code) {
  code = uiLangFor(code)
  document.documentElement.lang = code
  document.documentElement.dir = code === 'ar' || code === 'he' ? 'rtl' : 'ltr'
  if (code === current && obs) return
  obs?.disconnect(); obs = null; current = code
  if (code === 'en') return
  const { ROWS, PATTERNS, COLUMNS } = await import('./lang/strings.js')
  const col = COLUMNS[code]
  const extra = col ? null : await import(`./lang/extra-${code}.js`)
  exact = new Map(ROWS.map((r, i) => [r[0], extra ? extra.rows[i] : r[col]]))
  patterns = PATTERNS.map(([re, outs], i) => [re, extra ? extra.patterns[i] : outs[col - 1]])
  translateTree(document.body)
  obs = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') m.addedNodes.forEach(translateTree)
      else if (m.type === 'characterData') translateText(m.target)
      else if (m.type === 'attributes') { const out = lookup(m.target.getAttribute(m.attributeName) || ''); if (out != null && !m.target.closest('[translate="no"]')) m.target.setAttribute(m.attributeName, out) }
    }
  })
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}
