// Chat text niceties: :shortcodes: and emoticons become emoji, a small picker set, and links that are safe to show.
const NAMES = {
  smile: '🙂', grin: '😄', joy: '😂', lol: '😂', rofl: '🤣', wink: '😉', cool: '😎', love: '😍', kiss: '😘', thinking: '🤔', hmm: '🤔', shrug: '🤷',
  cry: '😢', sob: '😭', wow: '😮', scream: '😱', angry: '😠', sad: '🙁', sweat: '😅', sleepy: '😴', facepalm: '🤦', party: '🥳', skull: '💀', ghost: '👻',
  heart: '❤\uFE0F', fire: '🔥', '100': '💯', sparkles: '✨', tada: '🎉', eyes: '👀', pray: '🙏', clap: '👏', wave: '👋', ok: '👌', muscle: '💪',
  thumbsup: '👍', '+1': '👍', thumbsdown: '👎', '-1': '👎', popcorn: '🍿', clapper: '🎬', tv: '📺', moon: '🌙', pizza: '🍕'
}
const EMOTICONS = { ':)': '🙂', ':-)': '🙂', ':(': '🙁', ':-(': '🙁', ':D': '😄', ':-D': '😄', ';)': '😉', ';-)': '😉', ':P': '😛', ':p': '😛', ':O': '😮', ':o': '😮', ":'(": '😢', xD: '😆', XD: '😆', ':*': '😘', ':/': '😕', ':|': '😐', '<3': '❤\uFE0F' }
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const EMOTICON_RE = new RegExp(`(?<=^|\\s)(${Object.keys(EMOTICONS).sort((a, b) => b.length - a.length).map(escapeRe).join('|')})(?=\\s|$)`, 'g')

export const emojify = text => text.replace(/:([a-z0-9_+-]{1,16}):/g, (all, n) => NAMES[n] ?? all).replace(EMOTICON_RE, m => EMOTICONS[m])

// Must match REACTIONS in src/party.js.
export const REACTIONS = ['👍', '❤\uFE0F', '😂', '😮', '😢', '🔥']
export const PICKER = ['🍿', '🎬', '😂', '🤣', '😍', '🥹', '😮', '😱', '🤯', '😢', '😭', '😡', '🥳', '😎', '🤔', '🙄', '😬', '😴', '🫠', '💀', '👍', '👎', '👏', '🙌', '🙏', '💪', '👀', '🫶', '❤\uFE0F', '🔥', '✨', '💯', '🎉', '📺', '🌙', '🍕']

// A message of nothing but a few emoji is shown large, without a bubble.
export const onlyEmoji = text => /^(?:\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic}|\p{Emoji_Modifier})*\s*){1,6}$/u.test(text.trim())

const IMAGE = /\.(?:png|jpe?g|gif|webp|avif)$/i
// A link in a message: what to show and, for a picture, where it is. Only http(s) ever becomes a link.
export function parseLink (raw) {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const path = (u.pathname + u.search).replace(/^\/$/, '')
    return { href: u.href, host: u.host.replace(/^www\./, ''), path: path.length > 24 ? path.slice(0, 23) + '...' : path, image: IMAGE.test(u.pathname) }
  } catch { return null }
}
export const LINK = /https?:\/\/[^\s<>"']+/gi
// Trailing punctuation belongs to the sentence, not the link.
export function trimLink (s) {
  let t = s.replace(/[.,!?;:]+$/, '')
  while (t.endsWith(')') && t.split(')').length > t.split('(').length) t = t.slice(0, -1).replace(/[.,!?;:]+$/, '')
  return t
}
