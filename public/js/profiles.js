import { api, getProfile, getToken, setToken } from './api.js'
import { $, esc, icon, store } from './util.js'
import { pickProfile } from './session.js'
import { focusFirst, onBack } from './nav.js'
import { unlockProfile, lockProfile } from './pin.js'
import { upgradeSelects } from './dropdown.js'
import { LANGUAGES } from './onboarding.js'
import { initI18n, savedUiLang, uiLangFor } from './i18n.js'

const COLORS = ['#f2a65a', '#e5646e', '#6fb7e9', '#7ad3a0', '#b58cf0', '#f0d264']
const layer = () => $('#layer')

export function showPicker ({ dismissable = false } = {}) {
  return new Promise(resolve => {
    const root = layer()
    root.className = ''; root.hidden = false
    let manage = false

    const prevBack = onBack.handler
    const close = v => { if (onBack.handler === back) onBack.handler = prevBack; root.hidden = true; root.innerHTML = ''; resolve(v) }
    // Back (Escape, the remote) is the Cancel button of the view when it has one; a picker that must be answered swallows it.
    const back = onBack.handler = () => { root.querySelector('[data-back], [data-close]')?.click(); return true }
    const done = async id => { await pickProfile(id); close(id) }
    // A locked profile asks for its PIN first, unless this browser holds a session the server still knows (one kept across a server restart is dead).
    const unlocked = async p => {
      if (!p.locked) return true
      if (getToken(p.id)) {
        try { await api('/api/me', { headers: { 'x-profile': p.id, 'x-token': getToken(p.id) } }); return true } catch { setToken(p.id, '') }
      }
      return unlockProfile(p)
    }
    // Leaving a locked profile ends its session.
    const open = async p => {
      const prev = getProfile()
      if (!(await unlocked(p))) return
      await done(p.id)
      if (prev && prev !== p.id) lockProfile(prev)
    }
    // Editing or deleting a locked profile needs its PIN too; the session made for it ends with the edit.
    const edit = async p => { if (!(await unlocked(p))) return; form({ edit: p }) }
    const finishEdit = async p => { if (p?.locked && p.id !== getProfile()) await lockProfile(p.id) }

    async function list () {
      const profiles = await api('/api/profiles')
      if (!profiles.length) return form({ first: true })
      root.innerHTML = `<div class="picker" data-modal>
        <h1>${manage ? 'Manage profiles' : 'Who\'s watching?'}</h1>
        <div class="avatars">
          ${profiles.map(p => `<button class="pf" data-id="${p.id}" style="--c:${p.color}"><span class="circle">${esc(p.name[0].toUpperCase())}${p.locked ? `<span class="lockmark" title="Locked with a PIN">${icon('lock')}</span>` : ''}${manage ? `<span class="edit">${icon('edit')}</span>` : ''}</span><span translate="no">${esc(p.name)}</span></button>`).join('')}
          ${profiles.length < 6 ? `<button class="pf" data-add><span class="circle add">${icon('plus')}</span>Add profile</button>` : ''}
        </div>
        <div class="actions"><button class="btn btn-ghost" data-manage>${manage ? 'Done' : 'Manage profiles'}</button>${dismissable ? '<button class="btn btn-quiet" data-close>Cancel</button>' : ''}</div>
      </div>`
      root.onclick = e => {
        const b = e.target.closest('button'); if (!b) return
        if (b.dataset.add !== undefined) form({})
        else if (b.dataset.manage !== undefined) { manage = !manage; list() }
        else if (b.dataset.close !== undefined) close(null)
        else if (b.dataset.id) { const p = profiles.find(x => x.id === b.dataset.id); manage ? edit(p) : open(p) }
      }
      focusFirst(root)
    }

    // keep: what was typed and picked before the form was drawn again in another language.
    function form ({ first, edit, keep } = {}) {
      const name = edit?.name || keep?.name || ''
      let color = edit?.color || keep?.color || COLORS[Math.floor(Math.random() * COLORS.length)]
      root.innerHTML = `<div class="picker" data-modal>
        <h1>${first ? 'Who\'s watching?' : edit ? 'Edit profile' : 'New profile'}</h1>
        <form class="new-form">
          ${first ? `<select class="field" id="pf-lang" aria-label="App language">${LANGUAGES.map(([c, , n]) => `<option value="${c}" ${c === savedUiLang() ? 'selected' : ''}>${n}</option>`).join('')}</select>` : ''}
          <span class="pf wide" style="--c:${color}"><span class="circle" id="prev">${esc((name || 'A')[0].toUpperCase())}</span></span>
          <input class="field" name="name" placeholder="Name" maxlength="24" autocomplete="off" value="${esc(name)}" data-autofocus required>
          <div class="swatches">${COLORS.map(c => `<button type="button" style="--c:${c}" data-c="${c}" class="${c === color ? 'on' : ''}" aria-label="Color ${c}"></button>`).join('')}</div>
          <div class="actions"><button class="btn btn-ink" type="submit">${edit ? 'Save' : first ? 'Start watching' : 'Create'}</button>
          ${edit ? '<button class="btn btn-danger" type="button" data-del>Delete</button>' : ''}
          ${first ? '' : '<button class="btn btn-quiet" type="button" data-back>Cancel</button>'}</div>
        </form></div>`
      const f = $('form', root)
      const prev = $('#prev', root)
      f.name.oninput = () => { prev.textContent = (f.name.value.trim()[0] || 'A').toUpperCase() }
      // The first screen is already in the language picked here; onboarding starts with it.
      f.onchange = async e => {
        if (e.target.id !== 'pf-lang') return
        store.set('ui', uiLangFor(e.target.value))
        await initI18n(e.target.value)
        form({ first, keep: { name: f.name.value, color } })
        $('.dd-btn', root).focus()
      }
      f.onclick = async e => {
        const b = e.target.closest('button'); if (!b) return
        if (b.dataset.c) { color = b.dataset.c; prev.parentElement.style.setProperty('--c', color); f.querySelectorAll('.swatches button').forEach(x => x.classList.toggle('on', x === b)) }
        else if (b.dataset.back !== undefined) { finishEdit(edit); list() }
        else if (b.dataset.del !== undefined) {
          if (b.dataset.sure) { await api(`/api/profiles/${edit.id}`, { method: 'DELETE', headers: { 'x-token': getToken(edit.id) } }); manage = false; list() } else { b.dataset.sure = 1; b.textContent = 'Tap again to delete' }
        }
      }
      f.onsubmit = async e => {
        e.preventDefault()
        const name = f.name.value.trim(); if (!name) return
        if (edit) { await api(`/api/profiles/${edit.id}`, { method: 'PATCH', body: { name, color }, headers: { 'x-token': getToken(edit.id) } }); await finishEdit(edit); manage = false; list() } else {
          const p = await api('/api/profiles', { method: 'POST', body: { name, color } })
          done(p.id)
        }
      }
      upgradeSelects(root)
      focusFirst(root)
      $('input', f).focus()
    }
    list()
  })
}
