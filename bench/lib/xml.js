// Just enough RSS reading for the Nyaa and TokyoTosho feeds.
export const xml = (s, tag) => (s.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) || [])[1] || ''
// &amp; goes last so that "&amp;lt;" ends as "&lt;", not "<".
export const unxml = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
