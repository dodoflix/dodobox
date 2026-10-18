import { api, getProfile, getToken } from './api.js'
import { $, esc, icon } from './util.js'
import { pickProfile } from './session.js'
import { focusFirst } from './nav.js'
import { unlockProfile, lockProfile } from './pin.js'

const COLORS = ['#f2a65a', '#e5646e', '#6fb7e9', '#7ad3a0', '#b58cf0', '#f0d264']
const layer = () => $('#layer')

export function showPicker ({ dismissable = false } = {}) {
  return new Promise(resolve => {
    const root = layer()
    root.className = ''; root.hidden = false
    let manage = false

    const done = async id => { await pickProfile(id); root.hidden = true; root.innerHTML = ''; resolve(id) }
    // A locked profile asks for its PIN first, unless this browser already holds a session for it. Leaving a locked profile ends its session.
    const open = async p => {
      const prev = getProfile()
      if (p.locked && !getToken(p.id) && !(await unlockProfile(p))) return
      await done(p.id)
      if (prev && prev !== p.id) lockProfile(prev)
    }
    // Editing or deleting a locked profile needs its PIN too; the session made for it ends with the edit.
    const edit = async p => { if (p.locked && !getToken(p.id) && !(await unlockProfile(p))) return; form({ edit: p }) }
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
        else if (b.dataset.close !== undefined) { root.hidden = true; root.innerHTML = ''; resolve(null) }
        else if (b.dataset.id) { const p = profiles.find(x => x.id === b.dataset.id); manage ? edit(p) : open(p) }
      }
      focusFirst(root)
    }

    function form ({ first, edit } = {}) {
      let color = edit?.color || COLORS[Math.floor(Math.random() * COLORS.length)]
      root.innerHTML = `<div class="picker" data-modal>
        <h1>${first ? 'Who\'s watching?' : edit ? 'Edit profile' : 'New profile'}</h1>
        <form class="new-form">
          <span class="pf wide" style="--c:${color}"><span class="circle" id="prev">${esc((edit?.name || 'A')[0].toUpperCase())}</span></span>
          <input class="field" name="name" placeholder="Name" maxlength="24" autocomplete="off" value="${esc(edit?.name || '')}" data-autofocus required>
          <div class="swatches">${COLORS.map(c => `<button type="button" style="--c:${c}" data-c="${c}" class="${c === color ? 'on' : ''}" aria-label="Color ${c}"></button>`).join('')}</div>
          <div class="actions"><button class="btn btn-ink" type="submit">${edit ? 'Save' : first ? 'Start watching' : 'Create'}</button>
          ${edit ? '<button class="btn btn-danger" type="button" data-del>Delete</button>' : ''}
          ${first ? '' : '<button class="btn btn-quiet" type="button" data-back>Cancel</button>'}</div>
        </form></div>`
      const f = $('form', root)
      const prev = $('#prev', root)
      f.name.oninput = () => { prev.textContent = (f.name.value.trim()[0] || 'A').toUpperCase() }
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
      focusFirst(root)
      $('input', f).focus()
    }
    list()
  })
}
