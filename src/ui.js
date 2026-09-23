// 通用界面：对话框、提示、弹窗、精灵卡片
import { SPECIES } from './data/species.js'
import { TYPES } from './data/types.js'
import { statsOf } from './mon.js'
import { monSprite, trainerSprite } from './render/sprites.js'
import { escapeHtml } from './util.js'

export const $ = (id) => document.getElementById(id)

// —— NPC 对话框 ——
let dialogAdvance = null
export function dialogOpen() { return !$('dialog').hidden }
export function dialogKey() { dialogAdvance?.() }
$('dialog').addEventListener('click', () => dialogAdvance?.())

export async function say(lines, name = '') {
  const box = $('dialog')
  $('dialog-name').textContent = name
  box.hidden = false
  for (const line of lines) {
    const el = $('dialog-text')
    await new Promise((resolve) => {
      let i = 0, typing = true
      el.textContent = ''
      const tick = () => {
        if (!typing) return
        i += 1
        el.textContent = line.slice(0, i)
        if (i >= line.length) typing = false
        else setTimeout(tick, 22)
      }
      tick()
      dialogAdvance = () => {
        if (typing) { typing = false; el.textContent = line; return }
        resolve()
      }
    })
  }
  dialogAdvance = null
  box.hidden = true
}

// —— 提示 ——
export function toast(html, { tone = '', actions = [], timeout = 4200 } = {}) {
  const el = document.createElement('div')
  el.className = 'toast ' + tone
  el.innerHTML = html
  if (actions.length) {
    const row = document.createElement('div')
    row.className = 'row'
    for (const a of actions) {
      const b = document.createElement('button')
      b.className = 'btn small ' + (a.cls || '')
      b.textContent = a.label
      b.onclick = () => { el.remove(); a.onClick?.() }
      row.appendChild(b)
    }
    el.appendChild(row)
  }
  $('toasts').appendChild(el)
  if (timeout) setTimeout(() => el.remove(), timeout)
  return el
}

// —— 弹窗 ——
let onModalClose = null
export function modalOpen() { return !$('modal-wrap').hidden }
export function openModal(html, { onClose, dismissable = true } = {}) {
  const wrap = $('modal-wrap')
  $('modal').innerHTML = html
  wrap.hidden = false
  wrap.dataset.dismiss = dismissable ? '1' : ''
  onModalClose = onClose || null
  $('modal').querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => closeModal()))
  return $('modal')
}
export function closeModal(force = false) {
  const wrap = $('modal-wrap')
  if (wrap.hidden) return
  if (!force && !wrap.dataset.dismiss) return
  wrap.hidden = true
  const cb = onModalClose
  onModalClose = null
  cb?.()
}
$('modal-wrap').addEventListener('pointerdown', (e) => { if (e.target.id === 'modal-wrap') closeModal() })

export function confirmBox(title, text, yes = '确定', no = '取消') {
  return new Promise((resolve) => {
    const m = openModal(`<h2>${escapeHtml(title)}</h2><p>${text}</p><div class="actions"><button class="btn primary" id="cf-yes">${yes}</button><button class="btn" id="cf-no">${no}</button></div>`, { onClose: () => resolve(false) })
    m.querySelector('#cf-yes').onclick = () => { resolve(true); closeModal(true) }
    m.querySelector('#cf-no').onclick = () => closeModal(true)
  })
}

// —— 片段 ——
export const typeBadges = (sp) => SPECIES[sp].types.map((t) => `<span class="type" style="background:${TYPES[t].color}">${TYPES[t].name}</span>`).join(' ')

export function paintCanvases(root) {
  root.querySelectorAll('canvas[data-sp]').forEach((cv) => {
    const src = monSprite(cv.dataset.sp, { size: 64, shiny: cv.dataset.shiny === '1' })
    cv.width = 64; cv.height = 64
    const ctx = cv.getContext('2d')
    ctx.drawImage(src, 0, 0)
  })
  root.querySelectorAll('canvas[data-look]').forEach((cv) => {
    const look = JSON.parse(cv.dataset.look)
    cv.width = 18; cv.height = 22
    cv.getContext('2d').drawImage(trainerSprite(look, 'down', 0), 0, 0)
  })
}

export function monCard(m, { button = false, extra = '', idx } = {}) {
  const s = statsOf(m)
  const f = Math.max(0, m.hp / s.maxHp)
  const cls = f > 0.5 ? '' : f > 0.2 ? 'mid' : 'low'
  const tag = button ? 'button' : 'div'
  return `<${tag} class="moncard ${m.hp <= 0 ? 'fainted' : ''}" ${idx != null ? `data-idx="${idx}"` : ''}>
    <canvas data-sp="${m.sp}" data-shiny="${m.shiny ? 1 : 0}"></canvas>
    <div>
      <div class="nm">${m.shiny ? '<span class="shiny">✦</span>' : ''}${escapeHtml(m.nick || SPECIES[m.sp].name)} <span class="mono" style="font-size:12px">Lv.${m.lv}</span></div>
      <div class="meta">${typeBadges(m.sp)} <span class="mono">HP ${Math.max(0, m.hp)}/${s.maxHp}</span></div>
      <div class="hp"><i class="${cls}" style="width:${f * 100}%"></i></div>
    </div>
    <div>${extra}</div>
  </${tag}>`
}
