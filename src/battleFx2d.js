// 2D 战斗特效：在 #b-scene 上叠一层画布，按招式属性播放投射物、粒子、闪电、刀光等动画。
// 所有“等到命中”的 Promise 都按墙钟时间结算，不依赖 requestAnimationFrame（后台标签页里也不会卡住回合）。
import { sleep } from './util.js'

const TAU = Math.PI * 2
const rnd = (a, b) => a + Math.random() * (b - a)
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const ease = {
  out: (t) => 1 - (1 - t) * (1 - t),
  in: (t) => t * t,
  io: (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  lin: (t) => t,
}
const reduced = () => matchMedia?.('(prefers-reduced-motion: reduce)').matches

// 每种属性的 [亮色, 主色, 暗色]
export const FX_COLORS = {
  normal: ['#ffffff', '#f1ead2', '#b8ae94'],
  fire: ['#fff3a8', '#ff8a1f', '#e0341c'],
  water: ['#e6f7ff', '#5fb4ff', '#1f63c9'],
  grass: ['#e9ffb8', '#7bd24a', '#2f8a35'],
  electric: ['#fffbd1', '#ffe033', '#f0a800'],
  ice: ['#ffffff', '#a8ecff', '#4fb8dc'],
  rock: ['#efe0bd', '#b89a6a', '#6f5a3c'],
  ground: ['#f3dca3', '#c9954e', '#7a5028'],
  flying: ['#ffffff', '#dfe7ff', '#9fb2ff'],
  bug: ['#f4ffc2', '#b6d93a', '#6c8f12'],
  ghost: ['#f0dcff', '#9d6ae8', '#4b2a8a'],
  psychic: ['#ffe3f1', '#ff6fb0', '#c43a7f'],
  dragon: ['#e4dcff', '#8a6cff', '#4630c9'],
}
const CONTACT = new Set(['normal', 'bug', 'flying', 'ground', 'rock'])

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

const glowCache = new Map()
function glowSprite(color) {
  let c = glowCache.get(color)
  if (c) return c
  c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grd.addColorStop(0, rgba(color, 1))
  grd.addColorStop(0.35, rgba(color, 0.6))
  grd.addColorStop(1, rgba(color, 0))
  g.fillStyle = grd
  g.fillRect(0, 0, 64, 64)
  glowCache.set(color, c)
  return c
}

export class Fx2D {
  constructor(host) {
    this.host = host
    this.cv = document.createElement('canvas')
    this.cv.className = 'b-fx2d'
    host.appendChild(this.cv)
    this.ctx = this.cv.getContext('2d')
    this.parts = []
    this.items = []
    this.running = false
    this.frame = this.frame.bind(this)
    this.resize()
    new ResizeObserver(() => this.resize()).observe(host)
  }

  resize() {
    const r = this.host.getBoundingClientRect()
    this.dpr = Math.min(2, devicePixelRatio || 1)
    this.w = r.width
    this.h = r.height
    this.cv.width = Math.max(1, Math.round(r.width * this.dpr))
    this.cv.height = Math.max(1, Math.round(r.height * this.dpr))
  }

  // 元素在舞台里的中心点（fy 控制竖直位置，0.55 ≈ 身体中部）
  at(el, fy = 0.55) {
    const hr = this.host.getBoundingClientRect(), r = el.getBoundingClientRect()
    return { x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height * fy, r: Math.max(20, Math.min(r.width, r.height) * 0.42) }
  }

  start() {
    if (this.running) return
    this.running = true
    this.last = performance.now()
    requestAnimationFrame(this.frame)
  }

  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    const ctx = this.ctx
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    ctx.clearRect(0, 0, this.w, this.h)
    const P = this.parts
    let j = 0
    for (let i = 0; i < P.length; i++) {
      const p = P[i]
      p.t += dt
      if (p.t >= p.life) continue
      const k = 1 - p.drag * dt
      p.vx *= k; p.vy *= k
      p.vy += p.ay * dt
      p.x += p.vx * dt; p.y += p.vy * dt
      p.rot += p.vr * dt
      this.drawPart(ctx, p)
      P[j++] = p
    }
    P.length = j
    const T = performance.now()
    this.items = this.items.filter((it) => {
      const k = Math.min(1, (T - it.t0) / it.ms)
      ctx.save()
      it.draw(ctx, k, T)
      ctx.restore()
      return k < 1
    })
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    if (P.length || this.items.length) requestAnimationFrame(this.frame)
    else { this.running = false; ctx.clearRect(0, 0, this.w, this.h) }
  }

  clear() {
    this.parts.length = 0
    this.items.length = 0
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
    this.ctx.clearRect(0, 0, this.cv.width, this.cv.height)
  }

  // —— 粒子 ——
  p(o) {
    this.parts.push({ t: 0, vx: 0, vy: 0, ay: 0, drag: 0, rot: rnd(0, TAU), vr: 0, alpha: 1, add: true, size1: null, shape: 'glow', ...o })
    this.start()
  }

  item(ms, draw) {
    this.items.push({ t0: performance.now(), ms, draw })
    this.start()
  }

  drawPart(ctx, p) {
    const k = p.t / p.life
    const s = p.size1 == null ? p.size : p.size + (p.size1 - p.size) * k
    const a = p.alpha * (k < 0.15 && p.fadeIn ? k / 0.15 : 1 - k * k)
    ctx.globalCompositeOperation = p.add ? 'lighter' : 'source-over'
    ctx.globalAlpha = Math.max(0, a)
    const { x, y } = p
    switch (p.shape) {
      case 'glow': ctx.drawImage(glowSprite(p.color), x - s, y - s, s * 2, s * 2); break
      case 'dot': ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); break
      case 'smoke': ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fill(); break
      case 'spark': {
        ctx.strokeStyle = p.color; ctx.lineWidth = s; ctx.lineCap = 'round'
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - p.vx * 0.05, y - p.vy * 0.05); ctx.stroke(); break
      }
      case 'bubble':
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1.5, s * 0.18)
        ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.stroke()
        ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(x - s * 0.35, y - s * 0.35, s * 0.22, 0, TAU); ctx.fill(); break
      case 'ring':
        ctx.strokeStyle = p.color; ctx.lineWidth = Math.max(1.5, (p.width || 4) * (1 - k))
        ctx.beginPath(); ctx.ellipse(x, y, s, s * (p.flat || 1), 0, 0, TAU); ctx.stroke(); break
      default: {
        ctx.translate(x, y); ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.strokeStyle = p.edge || 'rgba(28,26,46,.55)'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        if (p.shape === 'leaf') { ctx.ellipse(0, 0, s, s * 0.45, 0, 0, TAU); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke() }
        else if (p.shape === 'shard') { ctx.moveTo(0, -s * 1.4); ctx.lineTo(s * 0.5, 0); ctx.lineTo(0, s * 1.4); ctx.lineTo(-s * 0.5, 0); ctx.closePath(); ctx.fill(); ctx.stroke() }
        else if (p.shape === 'rock') { for (let i = 0; i < 7; i++) { const a2 = (i / 7) * TAU, rr = s * (0.75 + ((i * 37) % 10) / 30); ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) } ctx.closePath(); ctx.fill(); ctx.stroke() }
        else if (p.shape === 'star') { for (let i = 0; i < 8; i++) { const rr = i % 2 ? s * 0.35 : s; const a2 = (i / 8) * TAU; ctx.lineTo(Math.cos(a2) * rr, Math.sin(a2) * rr) } ctx.closePath(); ctx.fill() }
        else if (p.shape === 'feather') { ctx.ellipse(0, 0, s, s * 0.3, 0, 0, TAU); ctx.fill(); ctx.stroke() }
        else if (p.shape === 'arrow') { const d = p.dir || -1; ctx.rotate(-p.rot); ctx.moveTo(0, s * d); ctx.lineTo(s * 0.8, 0); ctx.lineTo(s * 0.3, 0); ctx.lineTo(s * 0.3, -s * d); ctx.lineTo(-s * 0.3, -s * d); ctx.lineTo(-s * 0.3, 0); ctx.lineTo(-s * 0.8, 0); ctx.closePath(); ctx.fill(); ctx.stroke() }
        else if (p.shape === 'plus') { ctx.rotate(-p.rot); ctx.rect(-s * 0.25, -s, s * 0.5, s * 2); ctx.rect(-s, -s * 0.25, s * 2, s * 0.5); ctx.fill() }
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
      }
    }
  }

  burst(c, colors, n, { speed = 260, size = 6, life = 0.55, shape = 'glow', grav = 0, drag = 2.5, add = true, spread = TAU, dir = 0, size1 = 0 } = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread, v = speed * rnd(0.35, 1)
      this.p({ x: c.x + rnd(-6, 6), y: c.y + rnd(-6, 6), vx: Math.cos(a) * v, vy: Math.sin(a) * v, ay: grav, drag, life: life * rnd(0.7, 1.2), size: size * rnd(0.7, 1.3), size1, color: pick(colors), shape, add, vr: rnd(-8, 8) })
    }
  }

  star(c, color, size, ms = 260) {
    this.item(ms, (ctx, k) => {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = 1 - k
      ctx.translate(c.x, c.y)
      ctx.rotate(k * 0.6)
      const s = size * (0.4 + ease.out(k) * 0.8)
      ctx.fillStyle = color
      ctx.beginPath()
      for (let i = 0; i < 8; i++) { const r = i % 2 ? s * 0.22 : s; const a = (i / 8) * TAU; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) }
      ctx.closePath(); ctx.fill()
      ctx.drawImage(glowSprite(color), -s, -s, s * 2, s * 2)
    })
  }

  ring(c, color, r0, r1, ms = 450, width = 6, flat = 1) {
    this.item(ms, (ctx, k) => {
      ctx.globalAlpha = 1 - k
      ctx.strokeStyle = color
      ctx.lineWidth = width * (1 - k * 0.7)
      ctx.beginPath(); ctx.ellipse(c.x, c.y, r0 + (r1 - r0) * ease.out(k), (r0 + (r1 - r0) * ease.out(k)) * flat, 0, 0, TAU); ctx.stroke()
    })
  }

  flash(color, alpha = 0.5, ms = 220) {
    if (reduced()) return
    this.item(ms, (ctx, k) => { ctx.globalAlpha = alpha * (1 - k); ctx.fillStyle = color; ctx.fillRect(0, 0, this.w, this.h) })
  }

  // 沿直线/弧线飞行的发光弹，拖尾粒子；按墙钟时间在到达时 resolve
  bolt(a, b, { ms = 420, arc = 0, wobble = 0, core = '#ffffff', halo = '#ffaa33', size = 18, trail = null, rate = 70, trailShape = 'glow', trailSize = 7 } = {}) {
    const nx = -(b.y - a.y), ny = b.x - a.x
    const len = Math.hypot(nx, ny) || 1
    let acc = 0, lastT = performance.now()
    this.item(ms, (ctx, k, T) => {
      const e = ease.io(k)
      const off = Math.sin(k * Math.PI) * arc + Math.sin(k * 18) * wobble
      const x = a.x + (b.x - a.x) * e + (nx / len) * off, y = a.y + (b.y - a.y) * e + (ny / len) * off
      acc += ((T - lastT) / 1000) * rate
      lastT = T
      while (trail && acc >= 1) {
        acc--
        this.p({ x: x + rnd(-4, 4), y: y + rnd(-4, 4), vx: rnd(-30, 30), vy: rnd(-40, 20), life: rnd(0.25, 0.5), size: trailSize * rnd(0.6, 1.2), color: pick(trail), shape: trailShape, drag: 2 })
      }
      ctx.globalCompositeOperation = 'lighter'
      ctx.drawImage(glowSprite(halo), x - size * 1.8, y - size * 1.8, size * 3.6, size * 3.6)
      ctx.drawImage(glowSprite(core), x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6)
    })
    return sleep(ms)
  }

  // 持续喷射（水枪/喷火/龙息）：ms 内从 a 向 b 连续发射粒子
  stream(a, b, { ms = 520, rate = 110, colors, size = 9, size1 = 16, shape = 'glow', spread = 0.16, travel = 0.3, swirl = 0, add = true } = {}) {
    const dx = b.x - a.x, dy = b.y - a.y
    const dist = Math.hypot(dx, dy), ang = Math.atan2(dy, dx)
    const v = dist / travel
    let acc = 0, lastT = performance.now()
    this.item(ms, (ctx, k, T) => {
      acc += ((T - lastT) / 1000) * rate
      lastT = T
      while (acc >= 1) {
        acc--
        const an = ang + rnd(-spread, spread)
        const sw = swirl ? Math.sin(T / 60) * swirl : 0
        this.p({ x: a.x, y: a.y, vx: Math.cos(an) * v - Math.sin(an) * sw, vy: Math.sin(an) * v + Math.cos(an) * sw, life: travel * rnd(0.95, 1.15), size, size1, color: pick(colors), shape, add, drag: 0.4 })
      }
    })
    return sleep(ms + travel * 700)
  }

  // 锯齿闪电：每 45ms 重新生成折线
  lightning(from, to, ms = 380, width = 5) {
    let pts = [], lastGen = 0
    const gen = () => {
      pts = [from]
      const n = 9
      for (let i = 1; i < n; i++) {
        const t = i / n
        pts.push({ x: from.x + (to.x - from.x) * t + rnd(-22, 22), y: from.y + (to.y - from.y) * t + rnd(-10, 10) })
      }
      pts.push(to)
    }
    this.item(ms, (ctx, k, T) => {
      if (T - lastGen > 45) { gen(); lastGen = T }
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = k < 0.8 ? 1 : (1 - k) / 0.2
      for (const [w, c] of [[width * 3.2, 'rgba(255,224,51,.35)'], [width, '#ffe033'], [width * 0.4, '#ffffff']]) {
        ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round'
        ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke()
      }
    })
  }

  // 月牙刀光：从 a 飞向 b
  crescent(a, b, color, { ms = 320, size = 40, side = 1 } = {}) {
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    this.item(ms, (ctx, k) => {
      const e = ease.in(k)
      const x = a.x + (b.x - a.x) * e, y = a.y + (b.y - a.y) * e
      ctx.globalCompositeOperation = 'lighter'
      ctx.translate(x, y); ctx.rotate(ang + side * 0.3)
      ctx.strokeStyle = color; ctx.lineCap = 'round'
      for (const [w, al] of [[9, 0.35], [4, 1]]) {
        ctx.globalAlpha = al; ctx.lineWidth = w
        ctx.beginPath(); ctx.arc(-size * 0.3, 0, size, -1.1, 1.1); ctx.stroke()
      }
    })
    return sleep(ms)
  }

  // 抓痕 / 撕咬：目标身上划过几道刀痕
  claws(c, color, n = 3, ms = 300) {
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * c.r * 0.35
      this.item(ms, (ctx, k) => {
        const e = ease.out(Math.min(1, k * 1.6))
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = 1 - Math.max(0, k - 0.5) * 2
        ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.lineCap = 'round'
        const x0 = c.x - c.r * 0.6 + off, y0 = c.y - c.r * 0.7, x1 = c.x + c.r * 0.4 + off, y1 = c.y + c.r * 0.6
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0 + (x1 - x0) * e, y0 + (y1 - y0) * e); ctx.stroke()
      })
    }
  }

  jaws(c, color, ms = 360) {
    this.item(ms, (ctx, k) => {
      const close = ease.in(Math.min(1, k * 1.8))
      ctx.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4
      ctx.fillStyle = color; ctx.strokeStyle = '#1c1a2e'; ctx.lineWidth = 2
      for (const s of [-1, 1]) {
        const y = c.y + s * c.r * (0.9 - close * 0.75)
        ctx.beginPath()
        ctx.moveTo(c.x - c.r * 0.8, y)
        for (let i = 0; i <= 4; i++) ctx.lineTo(c.x - c.r * 0.8 + i * c.r * 0.4, y + (i % 2 ? 0 : -s * c.r * 0.28) * -1)
        ctx.lineTo(c.x + c.r * 0.8, y - s * c.r * 0.35); ctx.lineTo(c.x - c.r * 0.8, y - s * c.r * 0.35)
        ctx.closePath(); ctx.fill(); ctx.stroke()
      }
    })
    return sleep(ms * 0.6)
  }

  // 藤鞭：贝塞尔曲线从攻击方伸到目标再收回
  whip(a, b, color, ms = 420) {
    const cx = (a.x + b.x) / 2, cy = Math.min(a.y, b.y) - 80
    this.item(ms, (ctx, k) => {
      const reach = k < 0.6 ? ease.out(k / 0.6) : 1 - ease.in((k - 0.6) / 0.4) * 0.6
      ctx.strokeStyle = color; ctx.lineWidth = 7; ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i <= 20; i++) {
        const t = (i / 20) * reach
        const x = (1 - t) ** 2 * a.x + 2 * (1 - t) * t * cx + t * t * b.x
        const y = (1 - t) ** 2 * a.y + 2 * (1 - t) * t * cy + t * t * b.y + Math.sin(t * 12 + k * 10) * 4
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)
      }
      ctx.stroke()
    })
    return sleep(ms * 0.6)
  }

  text(c, html, cls) {
    const el = document.createElement('div')
    el.className = 'dmg-num ' + (cls || '')
    el.innerHTML = html
    el.style.left = c.x + 'px'
    el.style.top = c.y - c.r * 0.7 + 'px'
    this.host.appendChild(el)
    setTimeout(() => el.remove(), 1100)
  }

  shake(big = false) {
    if (reduced()) return
    this.host.classList.remove('shake', 'shake-big')
    void this.host.offsetWidth
    this.host.classList.add(big ? 'shake-big' : 'shake')
    setTimeout(() => this.host.classList.remove('shake', 'shake-big'), 450)
  }

  // —— 招式动画：返回的 Promise 在命中那一刻结算 ——
  async attack(type, id, A, D, power) {
    const C = FX_COLORS[type] || FX_COLORS.normal
    const s = 0.75 + power / 110
    switch (type) {
      case 'fire':
        if (id === 'flamethrower') return this.stream(A, D, { ms: 560, rate: 130, colors: C, size: 10, size1: 26, travel: 0.32 })
        if (id === 'flamewheel') { this.ring(A, C[1], A.r * 0.6, A.r * 1.3, 360, 8); await sleep(200) }
        return this.bolt(A, D, { ms: 440, arc: -40, core: C[0], halo: C[1], size: 20 * s, trail: C, rate: 90 })
      case 'water':
        if (id === 'bubble') {
          for (let i = 0; i < 7; i++) {
            const t = i * 70
            setTimeout(() => this.bolt(A, { x: D.x + rnd(-D.r * 0.5, D.r * 0.5), y: D.y + rnd(-D.r * 0.5, D.r * 0.4) }, { ms: 520, wobble: 10, core: '#ffffff', halo: C[1], size: 9 }), t)
            setTimeout(() => this.p({ x: A.x, y: A.y, vx: (D.x - A.x) * 1.8, vy: (D.y - A.y) * 1.8 + rnd(-30, 30), life: 0.55, size: rnd(7, 12), color: C[1], shape: 'bubble', add: false }), t)
          }
          return sleep(620)
        }
        return this.stream(A, D, { ms: 460, rate: 150, colors: C, size: 7 * s, size1: 11 * s, travel: 0.26, spread: 0.08 })
      case 'grass':
        if (id === 'vine') return this.whip(A, D, C[2], 460)
        if (id === 'absorb' || id === 'synthesis') return this.bolt(A, D, { ms: 380, core: C[0], halo: C[1], size: 14, trail: C, rate: 60 })
        {
          const n = id === 'leafstorm' ? 16 : 8
          for (let i = 0; i < n; i++) {
            setTimeout(() => {
              const t = rnd(0.35, 0.5), tx = D.x + rnd(-D.r * 0.5, D.r * 0.5), ty = D.y + rnd(-D.r * 0.5, D.r * 0.5)
              this.p({ x: A.x + rnd(-10, 10), y: A.y + rnd(-10, 10), vx: (tx - A.x) / t, vy: (ty - A.y) / t - 120, ay: 240 / t, life: t, size: rnd(7, 11), color: pick([C[1], C[2]]), shape: 'leaf', add: false, vr: rnd(14, 22) })
            }, i * (id === 'leafstorm' ? 35 : 55))
          }
          return sleep(n * (id === 'leafstorm' ? 35 : 55) + 380)
        }
      case 'electric':
        if (id === 'spark') { this.burst(A, C, 16, { speed: 180, size: 3, shape: 'spark', life: 0.35 }); await sleep(180) }
        this.lightning({ x: D.x + rnd(-30, 30), y: -10 }, { x: D.x, y: D.y }, id === 'thunderbolt' ? 460 : 320, id === 'thunderbolt' ? 7 : 5)
        this.flash('#fffbd1', id === 'thunderbolt' ? 0.55 : 0.35, 200)
        return sleep(140)
      case 'ice':
        if (id === 'icebeam') {
          this.item(420, (ctx, k) => {
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3
            const len = ease.out(Math.min(1, k * 2.2))
            for (const [w, c] of [[16, 'rgba(127,220,240,.45)'], [7, C[1]], [3, '#ffffff']]) {
              ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'
              ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(A.x + (D.x - A.x) * len, A.y + (D.y - A.y) * len); ctx.stroke()
            }
          })
          await sleep(200)
          this.burst(D, C, 14, { speed: 160, size: 5, shape: 'shard', add: false, life: 0.5 })
          return sleep(120)
        }
        if (id === 'icefang') { await this.jaws(D, '#dff7ff'); return }
        for (let i = 0; i < 7; i++) {
          setTimeout(() => {
            const t = 0.32, tx = D.x + rnd(-D.r * 0.4, D.r * 0.4), ty = D.y + rnd(-D.r * 0.4, D.r * 0.4)
            const ang = Math.atan2(ty - A.y, tx - A.x)
            this.p({ x: A.x, y: A.y, vx: (tx - A.x) / t, vy: (ty - A.y) / t, life: t, size: rnd(6, 9), color: pick([C[0], C[1]]), shape: 'shard', add: false, rot: ang + Math.PI / 2, vr: 0 })
          }, i * 45)
        }
        return sleep(7 * 45 + 300)
      case 'rock':
        for (let i = 0; i < (id === 'rockslide' ? 6 : 3); i++) {
          setTimeout(() => {
            const x = D.x + rnd(-D.r * 0.8, D.r * 0.8)
            this.p({ x, y: -20, vx: rnd(-20, 20), vy: 500, ay: 900, life: (D.y + 20) / 700, size: rnd(10, 17), color: pick([C[1], C[2]]), shape: 'rock', add: false, vr: rnd(-6, 6) })
          }, i * 90)
        }
        return sleep((id === 'rockslide' ? 5 : 2) * 90 + 380)
      case 'ground':
        if (id === 'dig') {
          await sleep(200)
          this.burst({ x: D.x, y: D.y + D.r * 0.8 }, [C[1], C[2]], 18, { speed: 300, size: 7, shape: 'rock', add: false, grav: 700, dir: -Math.PI / 2, spread: 1.6, life: 0.8 })
          this.shake(true)
          return sleep(120)
        }
        for (let i = 0; i < 4; i++) setTimeout(() => this.bolt(A, { x: D.x + rnd(-20, 20), y: D.y + rnd(-20, 20) }, { ms: 380, arc: -70, core: C[1], halo: C[2], size: 13, trail: [C[2]], rate: 40, trailShape: 'dot', trailSize: 3 }), i * 70)
        return sleep(3 * 70 + 380)
      case 'flying':
        if (id === 'peck') { this.claws(D, '#ffffff', 2, 220); return sleep(120) }
        this.crescent(A, D, '#ffffff', { size: 42, side: 1 })
        await sleep(110)
        return this.crescent(A, D, '#dfe7ff', { size: 36, side: -1 })
      case 'bug':
        if (id === 'bugbite') return this.jaws(D, '#e6ff8a')
        {
          const n = 26
          for (let i = 0; i < n; i++) {
            setTimeout(() => {
              const t = 0.45, a0 = rnd(0, TAU)
              this.p({ x: A.x + Math.cos(a0) * 30, y: A.y + Math.sin(a0) * 30, vx: (D.x - A.x) / t + Math.cos(a0 + 1.6) * 160, vy: (D.y - A.y) / t + Math.sin(a0 + 1.6) * 160, life: t, size: rnd(3, 6), color: pick(['#ffffff', C[0], C[1]]), shape: 'glow', drag: 1.5 })
            }, i * 14)
          }
          return sleep(n * 14 + 380)
        }
      case 'ghost':
        if (id === 'lick') { this.ring(D, '#ff8fcf', D.r * 0.3, D.r * 1.1, 320, 10, 0.5); return sleep(120) }
        return this.bolt(A, D, { ms: 560, wobble: 16, arc: 30, core: C[0], halo: C[2], size: 22 * s, trail: [C[1], C[2], '#2a1a4a'], rate: 90 })
      case 'psychic':
        if (id === 'psybeam') {
          for (let i = 0; i < 6; i++) setTimeout(() => this.bolt(A, D, { ms: 360, core: pick(['#ffe3f1', '#fff6a0', '#c9f0ff']), halo: C[1], size: 13 }), i * 55)
          return sleep(5 * 55 + 360)
        }
        for (let i = 0; i < 3; i++) setTimeout(() => this.ring(D, C[1], D.r * 1.6, D.r * 0.2, 380, 7, 0.55), i * 110)
        return sleep(380)
      case 'dragon':
        if (id === 'dragonpulse') {
          for (let i = 0; i < 4; i++) setTimeout(() => this.ring(A, C[1], A.r * 0.3, A.r * 1.4, 300, 6), i * 70)
          await sleep(220)
          return this.bolt(A, D, { ms: 420, core: C[0], halo: C[1], size: 26, trail: C, rate: 110 })
        }
        return this.stream(A, D, { ms: 540, rate: 120, colors: C, size: 9, size1: 22, travel: 0.34, swirl: 140 })
      default: // normal
        if (id === 'scratch') { this.claws(D, '#ffffff', 3, 300); return sleep(140) }
        if (id === 'quick') {
          for (let i = 0; i < 8; i++) this.p({ x: A.x - 60 + rnd(-10, 10), y: A.y + rnd(-A.r, A.r), vx: (D.x - A.x) * 3, vy: (D.y - A.y) * 3, life: 0.2, size: 3, color: '#ffffff', shape: 'spark' })
        }
        return sleep(160)
    }
  }

  // 命中：属性粒子 + 冲击星 + 伤害数字；暴击/效果绝佳时震屏
  impact(type, D, e) {
    const C = FX_COLORS[type] || FX_COLORS.normal
    const big = e.crit || e.eff > 1
    const n = 12 + (e.crit ? 10 : 0) + (e.eff > 1 ? 8 : 0)
    this.star(D, C[0], D.r * (big ? 1.15 : 0.8))
    switch (type) {
      case 'fire': this.burst(D, C, n, { speed: 260, size: 9, size1: 2, life: 0.6 }); this.burst(D, ['rgba(60,40,40,.45)'], 5, { speed: 60, size: 12, size1: 26, shape: 'smoke', add: false, grav: -60, life: 0.8 }); break
      case 'water': this.burst(D, C, n, { speed: 300, size: 5, shape: 'dot', grav: 700, life: 0.7, add: false, dir: -Math.PI / 2, spread: 2.6 }); break
      case 'grass': this.burst(D, [C[1], C[2]], n, { speed: 240, size: 7, shape: 'leaf', add: false, grav: 240, life: 0.7 }); break
      case 'electric': this.burst(D, C, n + 6, { speed: 380, size: 3, shape: 'spark', life: 0.35 }); break
      case 'ice': this.burst(D, C, n, { speed: 240, size: 6, shape: 'shard', add: false, life: 0.6 }); this.burst(D, ['rgba(220,245,255,.6)'], 6, { speed: 50, size: 14, size1: 28, shape: 'smoke', add: false, life: 0.8 }); break
      case 'rock': case 'ground': this.burst(D, [C[1], C[2]], n, { speed: 280, size: 6, shape: 'rock', add: false, grav: 800, life: 0.75, dir: -Math.PI / 2, spread: 2.4 }); this.burst({ x: D.x, y: D.y + D.r * 0.6 }, ['rgba(200,180,140,.55)'], 7, { speed: 90, size: 12, size1: 30, shape: 'smoke', add: false, life: 0.9 }); break
      case 'flying': this.burst(D, ['#ffffff', '#eef2ff'], 10, { speed: 200, size: 7, shape: 'feather', add: false, grav: 120, drag: 2.8, life: 0.9 }); break
      case 'ghost': this.burst(D, [C[1], C[2]], n, { speed: 160, size: 10, size1: 20, life: 0.8, grav: -80 }); break
      case 'psychic': this.ring(D, C[0], D.r * 0.2, D.r * 1.5, 420, 8); this.burst(D, C, n, { speed: 220, size: 6 }); break
      case 'dragon': this.burst(D, C, n, { speed: 300, size: 8, size1: 2, life: 0.6 }); break
      default: this.burst(D, ['#ffffff', '#fff6d6'], n, { speed: 300, size: 5, shape: 'star', add: false, life: 0.5 })
    }
    if (big) this.shake(e.crit && e.eff > 1)
    const cls = e.crit ? 'crit' : e.eff > 1 ? 'super' : e.eff < 1 ? 'weak' : ''
    const tag = e.crit ? '<small>会心一击</small>' : e.eff > 1 ? '<small>效果绝佳</small>' : e.eff < 1 ? '<small>效果不好</small>' : ''
    this.text(D, `-${e.dmg}${tag}`, cls)
  }

  // 变化招式的“施法”部分（能力升降箭头由 stat 事件另行播放）
  async status(id, A, D) {
    switch (id) {
      case 'growl':
        for (let i = 0; i < 3; i++) setTimeout(() => this.crescent(A, D, '#ffe8a8', { ms: 360, size: 26 + i * 6, side: 0 }), i * 110)
        return sleep(560)
      case 'leer':
        this.star({ x: A.x - A.r * 0.25, y: A.y - A.r * 0.35 }, '#ff5a5f', A.r * 0.5, 300)
        this.star({ x: A.x + A.r * 0.25, y: A.y - A.r * 0.35 }, '#ff5a5f', A.r * 0.5, 300)
        return sleep(380)
      case 'harden':
        this.item(420, (ctx, k) => {
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.sin(k * Math.PI)
          const x = A.x - A.r + k * A.r * 2
          const g = ctx.createLinearGradient(x - 20, 0, x + 20, 0)
          g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(255,255,255,0)')
          ctx.fillStyle = g; ctx.fillRect(x - 20, A.y - A.r, 40, A.r * 2)
        })
        return sleep(420)
      case 'agility':
        for (let i = 0; i < 18; i++) setTimeout(() => this.p({ x: A.x + rnd(-A.r, A.r), y: A.y + A.r, vx: 0, vy: -rnd(500, 700), life: 0.3, size: 3, color: '#dfe7ff', shape: 'spark' }), i * 20)
        return sleep(460)
      case 'growth':
      case 'synthesis':
        this.burst({ x: A.x, y: A.y + A.r * 0.6 }, id === 'growth' ? ['#b6f07a', '#7bd24a'] : ['#fff6a0', '#ffe066'], 20, { speed: 90, size: 8, size1: 2, life: 0.9, grav: -200, dir: -Math.PI / 2, spread: 1.2 })
        return sleep(450)
      default:
        this.ring(A, '#ffffff', A.r * 0.3, A.r * 1.3, 380)
        return sleep(380)
    }
  }

  statArrows(c, up) {
    const colors = up ? ['#ff8a3d', '#ffd23f', '#ff5a5f'] : ['#5fb4ff', '#8e9cff', '#3a86ff']
    for (let i = 0; i < 9; i++) {
      setTimeout(() => this.p({ x: c.x + rnd(-c.r, c.r), y: c.y + (up ? c.r * 0.8 : -c.r * 0.8), vx: 0, vy: up ? -rnd(90, 150) : rnd(90, 150), life: 0.8, size: rnd(7, 11), color: pick(colors), shape: 'arrow', dir: up ? -1 : 1, add: false, vr: 0, rot: 0, edge: '#1c1a2e' }), i * 55)
    }
    this.ring({ x: c.x, y: c.y + c.r * 0.9 }, up ? '#ffb347' : '#5fb4ff', c.r * 0.4, c.r * 1.3, 600, 5, 0.3)
    return sleep(700)
  }

  heal(c) {
    for (let i = 0; i < 14; i++) {
      setTimeout(() => this.p({ x: c.x + rnd(-c.r, c.r), y: c.y + c.r * rnd(0.2, 0.9), vx: rnd(-10, 10), vy: -rnd(60, 120), life: 0.9, size: rnd(5, 9), color: pick(['#7dff9a', '#c8ffb0', '#ffffff']), shape: i % 3 ? 'glow' : 'plus', add: i % 3 !== 0, fadeIn: true }), i * 40)
    }
  }

  enter(c, shiny) {
    this.ring(c, '#ffffff', c.r * 0.2, c.r * 1.5, 420, 8)
    this.burst(c, ['#ffffff', '#fff6d6', '#bfe9ff'], 16, { speed: 220, size: 6 })
    if (shiny) setTimeout(() => this.burst(c, ['#ffd23f', '#fff6a0'], 12, { speed: 160, size: 7, shape: 'star', add: false, life: 0.8 }), 250)
  }

  recall(c, toMe) {
    this.item(380, (ctx, k) => {
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = Math.sin(k * Math.PI)
      ctx.strokeStyle = '#ff5a5f'; ctx.lineWidth = 10; ctx.lineCap = 'round'
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(toMe ? -20 : this.w + 20, toMe ? this.h + 20 : -20); ctx.stroke()
    })
    this.burst(c, ['#ff5a5f', '#ffb3b5'], 10, { speed: 140, size: 6 })
  }

  faint(c) {
    this.burst({ x: c.x, y: c.y + c.r * 0.5 }, ['rgba(120,110,130,.55)', 'rgba(170,160,180,.5)'], 10, { speed: 80, size: 14, size1: 30, shape: 'smoke', add: false, grav: -40, life: 1 })
  }

  caught(c) {
    this.burst(c, ['#ffd23f', '#fff6a0', '#ffffff'], 20, { speed: 260, size: 8, shape: 'star', add: false, life: 0.9, grav: 200 })
    this.ring(c, '#ffd23f', 6, 70, 500, 6)
  }

  escaped(c) {
    this.star(c, '#ffffff', 60, 300)
    this.burst(c, ['#ffffff', '#ffe3f1'], 18, { speed: 320, size: 6 })
  }

  miss(c) {
    this.text(c, 'MISS', 'miss')
  }
}

export const isContact = (type) => CONTACT.has(type)
