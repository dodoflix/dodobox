// Subtitles that ask for a place ({\an8} and friends, as files converted from ASS do) are drawn there, on every screen shape.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { boot, newPage, shutdown, signIn, HOME, PLACED, TOGETHER } from './harness.js'

let base
before(async () => { ({ base } = await boot({ media: true })) })
after(shutdown)

const SCREENS = [
  ['4K TV', { width: 3840, height: 2160 }], ['1440p', { width: 2560, height: 1440 }], ['ultrawide', { width: 3440, height: 1440 }], ['1080p', { width: 1920, height: 1080 }],
  ['laptop', { width: 1366, height: 768 }], ['720p', { width: 1280, height: 720 }], ['4:3', { width: 1024, height: 768 }], ['square', { width: 800, height: 800 }],
  ['tablet portrait', { width: 820, height: 1180 }], ['tablet landscape', { width: 1180, height: 820 }],
  ['phone portrait', { width: 390, height: 844 }, true], ['phone landscape', { width: 844, height: 390 }, true], ['small phone', { width: 360, height: 640 }, true],
  ['smallest phone', { width: 320, height: 568 }, true], ['small phone landscape', { width: 568, height: 320 }, true]
]
const ZONES = ['top', 'mid', 'bot']

async function start (page, { tv = false } = {}) {
  await page.addInitScript(() => localStorage.setItem('autosync', 'false')) // a sidecar this short must stay where its file puts it
  await signIn(page, base, 'Ada')
  await page.goto(`${base}/${tv ? '?tv=1' : ''}#/title/movie/${HOME.id}`)
  await page.click('#play')
  await page.waitForFunction(() => { const v = document.querySelector('.pl video'); return v && v.currentTime > 1.5 && !v.paused }, null, { timeout: 60000 })
  await chooseFile(page)
  await closeMenu(page)
  await at(page, 1.3)
  await page.locator('.pl-subs .top', { hasText: 'Beside the file' }).waitFor() // the file is read before the first check
}
// On a phone the subtitle menu is behind the Settings button.
async function openSubs (page) {
  await page.evaluate(() => document.querySelector('.pl').classList.add('ui')) // the controls fade out when nothing moves
  if (await page.locator('#m-subs').isVisible()) await page.click('#m-subs')
  else { await page.click('#m-settings'); await page.click('[data-menu="subs"]') }
}
// A press on the picture (not on the menu, which can cover its middle) closes the menu.
const closeMenu = page => page.evaluate(() => document.querySelector('.pl video').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })))
async function chooseFile (page) {
  await openSubs(page)
  await page.locator('#menu .sm-langs button', { hasText: 'English' }).click()
  await page.locator('#menu .sm-files button', { hasText: 'en.srt' }).click()
}
const at = async (page, t) => {
  await page.evaluate(t => new Promise(resolve => { const v = document.querySelector('.pl video'); v.pause(); v.addEventListener('seeked', () => requestAnimationFrame(() => resolve()), { once: true }); v.currentTime = t }), t)
}
// Everything the checks need, measured in the page.
// Positions are relative to the player, which a scrollbar gutter can push off the window's edge.
const read = page => page.evaluate(() => {
  const root = document.querySelector('.pl')
  const o = root.getBoundingClientRect()
  const box = els => {
    const rs = els.map(e => e.getBoundingClientRect()).filter(r => r.width && r.height)
    return rs.length ? { l: Math.min(...rs.map(r => r.left)) - o.left, r: Math.max(...rs.map(r => r.right)) - o.left, t: Math.min(...rs.map(r => r.top)) - o.top, b: Math.max(...rs.map(r => r.bottom)) - o.top } : null
  }
  const v = box([root.querySelector('video')])
  const picH = Math.min(v.b - v.t, (v.r - v.l) * 9 / 16); const picW = picH * 16 / 9
  const zones = {}
  for (const z of ['top', 'mid', 'bot']) {
    const el = root.querySelector(`.pl-subs .${z}`)
    zones[z] = { text: el.innerText, side: el.dataset.a || '', box: box([...el.querySelectorAll('span')]), line: box([el]), italic: [...el.querySelectorAll('i')].map(i => [i.textContent, getComputedStyle(i).fontStyle]) }
  }
  const visible = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width && r.height && +s.opacity > 0.1 && s.visibility !== 'hidden' && s.display !== 'none' }
  const controls = [...root.querySelectorAll('.pl-top .ttl, .pl-top button, .pl-bottom button, .pl-bottom .time, .pl-bottom #scrub')].filter(visible).map(e => ({ n: e.id || e.className || e.tagName, ...box([e]) }))
  return {
    W: o.width, H: o.height, ui: root.classList.contains('ui'), controls, zones,
    pic: { l: (v.l + v.r - picW) / 2, r: (v.l + v.r + picW) / 2, t: (v.t + v.b - picH) / 2, b: (v.t + v.b + picH) / 2 }
  }
})
const near = (a, b, what, tol = 2) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${Math.round(a)} is not within ${tol} of ${Math.round(b)}`)
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b

// One zone holds the text, the others are empty, and the text is where its zone and side say, inside the picture.
function expectPlace (m, zone, side, text, label) {
  for (const z of ZONES) {
    if (z !== zone) assert.equal(m.zones[z].text, '', `${label}: ${z} should be empty`)
  }
  const got = m.zones[zone]
  assert.equal(got.text, text, `${label}: text`)
  assert.equal(got.side, side, `${label}: side`)
  const b = got.box
  assert.ok(b, `${label}: nothing drawn`)
  if (side === 'left') near(b.l, m.W * 0.05, `${label}: left edge`)
  else if (side === 'right') near(b.r, m.W * 0.95, `${label}: right edge`)
  else near((b.l + b.r) / 2, m.W / 2, `${label}: centre`, 4) // a wrapped line's trailing space can shift a line by half its width
  assert.ok(b.l >= -0.5 && b.r <= m.W + 0.5, `${label}: inside the width`)
  assert.ok(b.t >= m.pic.t - 1 && b.b <= m.pic.b + 1, `${label}: inside the picture (${Math.round(b.t)}-${Math.round(b.b)} of ${Math.round(m.pic.t)}-${Math.round(m.pic.b)})`)
  if (zone === 'top') assert.ok(b.t <= m.H / 2, `${label}: starts in the upper half`) // a small picture in a tall window straddles the middle, so only where it starts counts
  if (zone === 'mid') near((got.line.t + got.line.b) / 2, m.H / 2, `${label}: vertical middle`, m.H * 0.01) // a wrong place is hundreds of pixels off; fonts and rounding move a line by a few
  if (zone === 'bot') assert.ok(b.b >= m.H / 2, `${label}: ends in the lower half`)
  // The controls never sit on a subtitle.
  if (m.ui) for (const c of m.controls) assert.ok(!hit(b, c), `${label}: covered by ${c.n} while the controls are up`)
}

async function checkAll (page, label) {
  for (const ui of [true, false]) {
    await page.evaluate(ui => document.querySelector('.pl').classList.toggle('ui', ui), ui)
    for (const [s, , zone, side, text] of PLACED) {
      await at(page, s + 0.3)
      await page.evaluate(ui => document.querySelector('.pl').classList.toggle('ui', ui), ui)
      const m = await read(page)
      expectPlace(m, zone, side, text, `${label} ${ui ? 'with' : 'without'} controls, "${text.slice(0, 18)}"`)
    }
  }
}

for (const [name, viewport, mobile] of SCREENS) {
  test(`every kind of placed subtitle is drawn where it asks on a ${name} (${viewport.width}x${viewport.height})`, async () => {
    const { ctx, page, errors } = await newPage(base, { viewport, ...(mobile && { isMobile: true, hasTouch: true }) })
    try {
      await start(page)
      await checkAll(page, name)
      assert.deepEqual(errors, [])
    } finally { await ctx.close() }
  })
}

test('a TV draws placed subtitles in its bigger type inside the picture', async () => {
  const { ctx, page, errors } = await newPage(base, { viewport: { width: 1920, height: 1080 }, userAgent: 'Mozilla/5.0 (Linux; Android 11; BRAVIA 4K) DodoboxTV' })
  try {
    await start(page, { tv: true })
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('tv')), 'TV layout')
    await checkAll(page, 'TV')
    assert.deepEqual(errors, [])
  } finally { await ctx.close() }
})

test('the italic block is drawn slanted and a stray brace block is kept as text', async () => {
  const { ctx, page } = await newPage(base)
  try {
    await start(page)
    await at(page, 13.3)
    assert.deepEqual((await read(page)).zones.bot.italic, [['Slanted', 'italic']])
    await at(page, 14.3)
    const m = await read(page)
    assert.deepEqual(m.zones.bot.italic, [])
    assert.equal(m.zones.bot.text, '{whisper} keeps its braces')
  } finally { await ctx.close() }
})

test('between cues nothing is left on screen, and cues that share a second each take their own place', async () => {
  const { ctx, page } = await newPage(base)
  try {
    await start(page)
    for (const t of [0.4, 16.5, 19.95]) { await at(page, t); assert.ok(Object.values((await read(page)).zones).every(z => z.text === ''), `empty at ${t}s`) }
    for (const [s, cues] of TOGETHER) {
      await at(page, s + 0.3)
      const m = await read(page)
      const zones = [...new Set(cues.map(c => c[1]))]
      for (const z of ZONES) assert.equal(m.zones[z].text, cues.filter(c => c[1] === z).map(c => c[0].replace(/^\{[^}]*\}/, '')).join('\n'), `${s}s ${z}`)
      for (const z of zones) assert.ok(m.zones[z].box, `${s}s ${z} drawn`)
      if (zones.length > 1) assert.ok(!hit(m.zones.top.box, m.zones.bot.box), 'a sign above and speech below do not touch')
      if (s === 19) assert.equal(m.zones.mid.side, 'right', 'the last cue decides the side of a shared zone')
    }
  } finally { await ctx.close() }
})

test('turning subtitles off clears every place, and choosing the file again brings them back', async () => {
  const { ctx, page } = await newPage(base)
  try {
    await start(page)
    await at(page, 2.3)
    assert.equal((await read(page)).zones.top.text, 'Top left')
    await openSubs(page)
    await page.locator('#menu .sm-langs button', { hasText: 'Off' }).click()
    await closeMenu(page)
    await at(page, 2.3)
    assert.ok(Object.values((await read(page)).zones).every(z => z.text === ''), 'off')
    await chooseFile(page)
    await closeMenu(page)
    await at(page, 5.3)
    assert.equal((await read(page)).zones.mid.text, 'Middle')
  } finally { await ctx.close() }
})

test('bigger subtitle type keeps every placed cue inside the picture and off the controls', async () => {
  for (const [viewport, mobile] of [[{ width: 1280, height: 720 }], [{ width: 390, height: 844 }, true], [{ width: 568, height: 320 }, true]]) {
    const { ctx, page } = await newPage(base, { viewport, ...(mobile && { isMobile: true, hasTouch: true }) })
    try {
      await start(page)
      await openSubs(page)
      for (let i = 0; i < 4; i++) await page.click('[data-z="1"]')
      await closeMenu(page)
      await checkAll(page, `big type ${viewport.width}x${viewport.height}`)
    } finally { await ctx.close() }
  }
})

test('turning the screen while a subtitle is up moves it with the picture', async () => {
  const { ctx, page } = await newPage(base, { viewport: { width: 1280, height: 720 } })
  try {
    await start(page)
    for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1920, height: 1080 }, { width: 320, height: 568 }]) {
      await page.setViewportSize(vp)
      await page.waitForTimeout(400)
      await at(page, 3.3)
      const m = await read(page)
      expectPlace(m, 'top', 'right', 'Top right', `after resizing to ${vp.width}x${vp.height}`)
    }
  } finally { await ctx.close() }
})
