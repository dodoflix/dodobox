// Profile PINs on the page: the keypad, opening a locked profile, and setting, changing or removing a PIN.
import { api, setToken, getToken } from './api.js'
import { $, esc, icon } from './util.js'
import { focusFirst, onBack } from './nav.js'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

// One question with a keypad (for a remote or a thumb) and a field for a keyboard. check(pin) may answer a message to show and keep the question open.
export function askPin ({ title, hint = '', submit = 'Continue', check } = {}) {
  return new Promise(resolve => {
    const el = document.createElement('div')
    el.className = 'pin-layer'; el.dataset.modal = ''
    el.innerHTML = `<form class="pin-box" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h2>${esc(title)}</h2>${hint ? `<p class="dim">${esc(hint)}</p>` : ''}
      <input class="pin-field" type="password" inputmode="numeric" autocomplete="off" maxlength="8" aria-label="PIN" data-autofocus>
      <p class="pin-err" role="alert"></p>
      <div class="pin-pad">${KEYS.map(k => `<button type="button" data-k="${k}">${k}</button>`).join('')}<button type="button" data-back aria-label="Delete the last digit">${icon('left')}</button><button type="button" data-k="0">0</button><button class="ok" type="submit" aria-label="${esc(submit)}">${icon('check')}</button></div>
      <div class="actions"><button class="btn btn-quiet" type="button" data-no>Cancel</button></div></form>`
    const field = $('.pin-field', el); const err = $('.pin-err', el)
    const prevBack = onBack.handler
    const close = v => { onBack.handler = prevBack; el.remove(); resolve(v) }
    onBack.handler = () => { close(null); return true }
    let busy = false
    const clean = () => { field.value = field.value.replace(/\D/g, '').slice(0, 8) }
    field.oninput = () => { clean(); err.textContent = '' }
    el.onclick = e => {
      const b = e.target.closest('button'); if (!b) return
      if (b.dataset.k) { field.value = (field.value + b.dataset.k).slice(0, 8); err.textContent = '' }
      else if (b.dataset.back !== undefined) field.value = field.value.slice(0, -1)
      else if (b.dataset.no !== undefined) close(null)
      if (!b.closest('.pin-pad') || b.type !== 'submit') field.focus({ preventScroll: true })
    }
    el.onsubmit = async e => {
      e.preventDefault()
      if (busy) return
      if (field.value.length < 4) { err.textContent = 'A PIN is 4 to 8 digits'; return }
      busy = true
      const pin = field.value
      const msg = check ? await check(pin) : null
      busy = false
      if (!msg) return close(pin)
      err.textContent = msg; field.value = ''; el.querySelector('.pin-box').classList.remove('shake'); void el.offsetWidth; el.querySelector('.pin-box').classList.add('shake'); field.focus({ preventScroll: true })
    }
    document.body.append(el)
    focusFirst(el)
    field.focus({ preventScroll: true })
  })
}

// Opens a locked profile: asks until the PIN is right. True when it is open, false when the question was cancelled.
export async function unlockProfile (p) {
  const pin = await askPin({
    title: `${p.name}'s PIN`, hint: 'Enter the PIN to open this profile.', submit: 'Unlock',
    check: async value => { try { setToken(p.id, (await api(`/api/profiles/${p.id}/unlock`, { method: 'POST', body: { pin: value } })).token); return null } catch (e) { return e.message } }
  })
  return !!pin
}

// Ends the session of a profile that is being left, so the next person to pick it is asked.
export async function lockProfile (id) {
  const token = getToken(id)
  setToken(id, '')
  if (token) await api(`/api/profiles/${id}/lock`, { method: 'POST', headers: { 'x-token': token } }).catch(() => {})
}

// A new PIN, asked twice. Null when cancelled.
export async function chooseNewPin (title = 'Choose a PIN') {
  const first = await askPin({ title, hint: '4 to 8 digits. Anyone using Dodobox is asked for it before opening this profile.', submit: 'Next' })
  if (!first) return null
  return await askPin({ title: 'Repeat the PIN', submit: 'Set PIN', check: v => (v === first ? null : 'The two PINs are not the same') })
}

// Sets, changes or removes the PIN of the profile in use; the current PIN is asked first when there is one. True when something changed.
export async function changePin (me, { remove = false } = {}) {
  let current
  if (me.hasPin) {
    current = await askPin({ title: remove ? 'Remove the PIN' : 'Change the PIN', hint: 'Enter the current PIN.', submit: remove ? 'Remove' : 'Next', check: async v => { try { const { token } = await api('/api/profiles/' + me.id + '/unlock', { method: 'POST', body: { pin: v } }); if (token) await api('/api/profiles/' + me.id + '/lock', { method: 'POST', headers: { 'x-token': token } }).catch(() => {}); return null } catch (e) { return e.message } } })
    if (!current) return false
  }
  const pin = remove ? '' : await chooseNewPin()
  if (pin === null) return false
  const r = await api('/api/me/pin', { method: 'PUT', body: { pin, current } })
  setToken(me.id, r.token)
  me.hasPin = !!pin
  return true
}
