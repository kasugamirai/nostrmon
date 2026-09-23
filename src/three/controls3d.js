// 3D 版触屏操控：左下虚拟摇杆 + 右下 A（互动 / 翻页 / 跳过战斗文字）与 B（按住奔跑）
import './controls3d.css'
import { dialogOpen, dialogKey } from '../ui.js'

const DEAD = 0.12

export function setupControls3D(game) {
  if (typeof matchMedia !== 'function' || !matchMedia('(pointer: coarse)').matches) return
  const root = document.getElementById('touch3d')
  if (!root || root.dataset.ready) return
  root.dataset.ready = '1'
  document.getElementById('app')?.classList.add('touch3d-on')

  root.innerHTML = `
    <div class="t3-stick" aria-hidden="true">
      <div class="t3-base">
        <i class="t3-arrow up"></i><i class="t3-arrow down"></i><i class="t3-arrow left"></i><i class="t3-arrow right"></i>
        <div class="t3-dir"></div>
        <div class="t3-knob"></div>
      </div>
    </div>
    <div class="t3-ab">
      <button type="button" class="t3-btn t3-b" aria-label="按住奔跑"><b>B</b><small>奔跑</small></button>
      <button type="button" class="t3-btn t3-a" aria-label="互动"><b>A</b><small>互动</small></button>
    </div>`

  const zone = root.querySelector('.t3-stick')
  const base = root.querySelector('.t3-base')
  const knob = root.querySelector('.t3-knob')
  const dirEl = root.querySelector('.t3-dir')
  const btnA = root.querySelector('.t3-a')
  const btnB = root.querySelector('.t3-b')

  const world = () => game.world
  const buzz = () => { try { navigator.vibrate?.(8) } catch {} }

  // —— 摇杆 ——
  let stickId = null, cx = 0, cy = 0, travel = 40, jx = 0, jy = 0

  const send = (x, y) => {
    if (x === jx && y === jy) return
    jx = x; jy = y
    world()?.setJoystick?.(x, y)
  }

  const moveKnob = (px, py) => {
    let dx = px - cx, dy = py - cy
    const d = Math.hypot(dx, dy)
    if (d > travel) { dx *= travel / d; dy *= travel / d }
    knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`
    const mag = Math.min(1, d / travel)
    if (mag < DEAD) {
      dirEl.style.opacity = '0'
      send(0, 0)
      return
    }
    const s = (mag - DEAD) / (1 - DEAD)
    const nx = dx / (d || 1), ny = dy / (d || 1)
    dirEl.style.opacity = String(0.35 + 0.65 * s)
    dirEl.style.transform = `rotate(${Math.atan2(nx, -ny).toFixed(3)}rad)`
    // 屏幕向上 = 前进（y+）
    send(+(nx * s).toFixed(3), +(-ny * s).toFixed(3))
  }

  const endStick = () => {
    if (stickId !== null && zone.hasPointerCapture?.(stickId)) zone.releasePointerCapture(stickId)
    stickId = null
    zone.classList.remove('on')
    knob.style.transform = ''
    dirEl.style.opacity = '0'
    send(0, 0)
  }

  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (stickId !== null) return
    stickId = e.pointerId
    zone.setPointerCapture?.(e.pointerId)
    const r = base.getBoundingClientRect()
    cx = r.left + r.width / 2
    cy = r.top + r.height / 2
    travel = Math.max(24, r.width / 2 - knob.offsetWidth * 0.3)
    zone.classList.add('on')
    moveKnob(e.clientX, e.clientY)
  })
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickId) return
    e.preventDefault()
    moveKnob(e.clientX, e.clientY)
  })
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zone.addEventListener(ev, (e) => { if (e.pointerId === stickId) endStick() })
  }

  // —— A：对话翻页 / 战斗跳过文字 / 互动 ——
  const press = (btn, e) => {
    e.preventDefault()
    btn.setPointerCapture?.(e.pointerId)
    btn.classList.add('on')
    buzz()
  }
  const unpress = (btn) => btn.classList.remove('on')

  btnA.addEventListener('pointerdown', (e) => {
    press(btnA, e)
    if (dialogOpen()) dialogKey()
    else if (game.battleUI?.open) game.battleUI.skip?.()
    else world()?.interact?.()
  })
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btnA.addEventListener(ev, () => unpress(btnA))

  // —— B：按住奔跑 ——
  const setRun = (on) => { const w = world(); if (w) w.running = on }
  btnB.addEventListener('pointerdown', (e) => { press(btnB, e); setRun(true) })
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    btnB.addEventListener(ev, () => { if (btnB.classList.contains('on')) setRun(false); unpress(btnB) })
  }

  const resetAll = () => {
    endStick()
    if (btnB.classList.contains('on')) setRun(false)
    unpress(btnA)
    unpress(btnB)
  }

  // 长按不弹菜单、不选中文字；按钮区域内禁止滚动 / 缩放
  for (const el of [zone, btnA, btnB]) {
    el.addEventListener('contextmenu', (e) => e.preventDefault())
    el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
    el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false })
  }
  // iOS Safari 的双指缩放手势
  document.addEventListener('gesturestart', (e) => e.preventDefault())

  // —— 战斗 / 弹窗时隐藏；对话时摇杆变暗 ——
  const battle = document.getElementById('battle')
  const modal = document.getElementById('modal-wrap')
  const dialog = document.getElementById('dialog')
  const sync = () => {
    const hide = (battle && !battle.hidden) || (modal && !modal.hidden)
    if (hide && !root.classList.contains('t3-hide')) resetAll()
    root.classList.toggle('t3-hide', !!hide)
    const talk = !!dialog && !dialog.hidden
    if (talk && stickId !== null) endStick()
    root.classList.toggle('t3-talk', talk)
    document.getElementById('app')?.classList.toggle('t3-talking', talk)
  }
  const mo = new MutationObserver(sync)
  for (const el of [battle, modal, dialog]) if (el) mo.observe(el, { attributes: true, attributeFilter: ['hidden'] })
  sync()

  addEventListener('blur', resetAll)
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetAll() })
}
