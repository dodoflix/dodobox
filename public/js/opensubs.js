// Connecting a profile's own OpenSubtitles account, so its subtitle downloads go on after the shared daily limit is used up.
import { api } from './api.js'
import { $, esc } from './util.js'
import { focusFirst, onBack } from './nav.js'

export const accountStatus = () => api('/api/opensubtitles').catch(() => ({ user: null }))

// Asks for the login and checks it with OpenSubtitles. Resolves to the username, or null when cancelled.
export function connectAccount () {
  return new Promise(resolve => {
    const el = document.createElement('div')
    el.className = 'pin-layer'; el.dataset.modal = ''
    el.innerHTML = `<form class="pin-box acct-box" role="dialog" aria-modal="true" aria-label="Connect OpenSubtitles">
      <h2>Connect OpenSubtitles</h2>
      <p class="dim">OpenSubtitles limits subtitle downloads per day. Sign in with an opensubtitles.org account that has a VIP membership and your subtitle downloads keep working. Accounts without VIP cannot download this way. <a href="https://www.opensubtitles.org/en/support" target="_blank" rel="noreferrer">About VIP</a> · <a href="https://www.opensubtitles.org/en/newuser" target="_blank" rel="noreferrer">Create an account</a></p>
      <label>Username<input class="field" name="user" autocomplete="username" autocapitalize="none" spellcheck="false" required data-autofocus></label>
      <label>Password<input class="field" name="pass" type="password" autocomplete="current-password" required></label>
      <p class="pin-err" role="alert"></p>
      <div class="actions"><button class="btn btn-ink" type="submit">Connect</button><button class="btn btn-quiet" type="button" data-no>Cancel</button></div></form>`
    const err = $('.pin-err', el); const go = $('[type=submit]', el)
    const prevBack = onBack.handler
    const close = v => { onBack.handler = prevBack; el.remove(); resolve(v) }
    onBack.handler = () => { close(null); return true }
    el.onclick = e => { if (e.target.closest('[data-no]') || e.target === el) close(null) }
    el.oninput = () => { err.textContent = '' }
    el.onsubmit = async e => {
      e.preventDefault()
      if (go.disabled) return
      go.disabled = true; go.textContent = 'Checking...'
      try {
        const r = await api('/api/opensubtitles', { method: 'PUT', body: { user: e.target.user.value, pass: e.target.pass.value } })
        close(r.user)
      } catch (x) {
        err.textContent = x.message; e.target.pass.value = ''; e.target.pass.focus({ preventScroll: true })
        go.disabled = false; go.textContent = 'Connect'
      }
    }
    document.body.append(el)
    focusFirst(el)
  })
}

// The Settings row: what state the account is in and the button for it.
export const accountRow = s => `<div class="l"><b>OpenSubtitles account</b><span>${s.user
  ? (s.rejected ? `${esc(s.user)} could not sign in. Connect again.`
    : s.vipOnly ? `Signed in as ${esc(s.user)}, but this account is not a VIP member, so OpenSubtitles gives it no downloads and it is not being used. <a href="https://www.opensubtitles.org/en/support" target="_blank" rel="noreferrer">About VIP</a>`
      : s.limited ? `Signed in as ${esc(s.user)}. Its download limit is used up for today.`
        : `Signed in as ${esc(s.user)}. Used when the shared download limit is reached.`)
  : 'Not connected. A VIP account from opensubtitles.org keeps subtitles downloading when the shared daily limit is reached.'}</span></div>
  <div class="pin-actions"><button class="btn btn-ghost sm" data-os="connect">${s.user ? 'Change' : 'Connect'}</button>${s.user ? '<button class="btn btn-ghost sm" data-os="remove">Disconnect</button>' : ''}</div>`
