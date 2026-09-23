// 大地图：移动、碰撞、镜头、渲染（本地玩家 + 远端玩家 + NPC + 跟随精灵 + 稀有精灵）
import { MAPS, tileAt } from './data/maps.js'
import { prerenderMap, TILE } from './render/tiles.js'
import { trainerSprite, monSprite, INK } from './render/sprites.js'
import { SPECIES } from './data/species.js'

export const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
const WALK = 4.6, RUN = 8.5

const mover = (x, y) => ({ x, y, fx: x, fy: y, t: 1 })
const lerpPos = (m) => [m.fx + (m.x - m.fx) * m.t, m.fy + (m.y - m.fy) * m.t]

export class World {
  constructor(game, canvas) {
    this.g = game
    this.cv = canvas
    this.ctx = canvas.getContext('2d')
    this.layers = new Map()
    this.held = []
    this.running = false
    this.path = null
    this.remotes = new Map()
    this.p = { ...mover(0, 0), dir: 'down', step: 0 }
    this.fol = mover(0, 0)
    this.bumpAt = 0
    this.time = 0
    this.map = null
    this.resize()
    addEventListener('resize', () => this.resize())
    addEventListener('keydown', (e) => this.onKeyDown(e))
    addEventListener('keyup', (e) => this.onKeyUp(e))
    addEventListener('blur', () => { this.held = []; this.running = false })
    canvas.addEventListener('pointerdown', (e) => this.onPointer(e))
    let last = performance.now()
    const loop = (t) => {
      const dt = Math.max(0, Math.min(0.05, (t - last) / 1000))
      last = t
      this.time += dt
      try {
        if (this.map) { this.update(dt); this.render() }
      } catch (e) { console.error(e) }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  resize() {
    const dpr = Math.min(3, devicePixelRatio || 1)
    const w = innerWidth, h = innerHeight
    this.dpr = dpr
    this.vw = w; this.vh = h
    this.cv.width = Math.round(w * dpr)
    this.cv.height = Math.round(h * dpr)
    this.Z = Math.max(2, Math.min(4, Math.floor(Math.min(w / (TILE * 20), h / (TILE * 13)))))
  }

  loadMap(id, x, y, dir = 'down') {
    this.map = MAPS[id]
    if (!this.layers.has(id)) this.layers.set(id, prerenderMap(this.map))
    Object.assign(this.p, mover(x, y), { dir })
    this.fol = mover(x, y)
    this.remotes.clear()
    this.path = null
  }

  // —— 输入 ——
  onKeyDown(e) {
    if (this.g.captureKey(e)) return
    const d = KEYMAP[e.code]
    if (d) {
      e.preventDefault()
      this.path = null
      if (!this.held.includes(d)) this.held.push(d)
    } else if (e.key === 'Shift') this.running = true
    else if (e.code === 'Space' || e.code === 'KeyZ') { e.preventDefault(); this.interact() }
  }
  onKeyUp(e) {
    const d = KEYMAP[e.code]
    if (d) this.held = this.held.filter((k) => k !== d)
    if (e.key === 'Shift') this.running = false
  }
  press(d, down) {
    if (down) { this.path = null; if (!this.held.includes(d)) this.held.push(d) } else this.held = this.held.filter((k) => k !== d)
  }

  screenToTile(cx, cy) {
    const r = this.cv.getBoundingClientRect()
    const wx = (cx - r.left) / this.Z + this.camX
    const wy = (cy - r.top) / this.Z + this.camY
    return [wx / TILE, wy / TILE]
  }

  onPointer(e) {
    if (!this.map || this.g.isBusy()) return
    const [tx, ty] = this.screenToTile(e.clientX, e.clientY)
    // 先看是否点中了其他玩家（精灵图比格子高，向上多判定一格）
    for (const r of this.remotes.values()) {
      const [px, py] = lerpPos(r)
      if (tx >= px - 0.1 && tx <= px + 1.1 && ty >= py - 0.6 && ty <= py + 1.05) { this.g.openPlayer(r.state); return }
    }
    const gx = Math.floor(tx), gy = Math.floor(ty)
    const npc = this.map.npcs.find((n) => n.x === gx && (n.y === gy || n.y === gy + 1))
    if (npc) {
      if (Math.abs(npc.x - this.p.x) + Math.abs(npc.y - this.p.y) === 1) { this.face(npc.x, npc.y); this.g.talkNpc(npc); return }
      if (tileAt(this.map, npc.x, npc.y + 1) === 'C') {
        // 柜台后面的 NPC：走到柜台前，面朝柜台说话
        if (this.p.x === npc.x && this.p.y === npc.y + 2) { this.face(npc.x, npc.y + 1); this.interact(); return }
        this.walkTo(npc.x, npc.y + 2, false)
        if (this.path) this.path.then = [npc.x, npc.y + 1]
        return
      }
      this.walkTo(npc.x, npc.y, true)
      return
    }
    const b = this.map.buildings.find((b) => gx >= b.x && gx < b.x + b.w && gy >= b.y && gy < b.y + b.h)
    if (b) { this.walkTo(b.door[0], b.door[1], true); return }
    const sign = this.map.signs[`${gx},${gy}`]
    if (sign) { this.walkTo(gx, gy, true); return }
    this.walkTo(gx, gy, false)
  }

  face(x, y) {
    const dx = x - this.p.x, dy = y - this.p.y
    this.p.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up'
    this.sendPresence()
  }

  // BFS 寻路；adjacent=true 时走到目标旁边并在到达后交互
  walkTo(gx, gy, adjacent) {
    const m = this.map
    const goal = (x, y) => (adjacent ? Math.abs(x - gx) + Math.abs(y - gy) === 1 : x === gx && y === gy)
    if (!adjacent && this.blocked(gx, gy)) return
    const start = [this.p.x, this.p.y]
    const prev = new Map([[start.join(), null]])
    const q = [start]
    let found = null
    while (q.length && prev.size < 1500) {
      const [x, y] = q.shift()
      if (goal(x, y)) { found = [x, y]; break }
      for (const [d, [dx, dy]] of Object.entries(DIRS)) {
        const nx = x + dx, ny = y + dy, k = nx + ',' + ny
        if (prev.has(k) || nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || this.blocked(nx, ny)) continue
        prev.set(k, [x, y, d])
        q.push([nx, ny])
      }
    }
    if (!found) return
    const steps = []
    let cur = found
    while (true) {
      const pr = prev.get(cur.join())
      if (!pr) break
      steps.unshift(pr[2])
      cur = [pr[0], pr[1]]
    }
    this.path = { steps, then: adjacent ? [gx, gy] : null }
  }

  blocked(x, y) {
    const m = this.map
    if (x < 0 || y < 0 || x >= m.w || y >= m.h) return true
    if (m.solid[y * m.w + x]) return true
    return m.npcs.some((n) => n.x === x && n.y === y)
  }

  // —— 更新 ——
  update(dt) {
    const p = this.p
    const speed = (this.running ? RUN : WALK) * (this.g.isRiding?.() ? 1.75 : 1)
    if (p.t < 1) {
      p.t = Math.min(1, p.t + dt * speed)
      if (p.t >= 1) this.arrive()
    }
    if (this.fol.t < 1) this.fol.t = Math.min(1, this.fol.t + dt * speed)
    if (p.t >= 1 && !this.g.isBusy()) {
      let dir = this.held[this.held.length - 1]
      if (!dir && this.path) {
        dir = this.path.steps.shift()
        if (!dir) {
          const then = this.path.then
          this.path = null
          if (then) { this.face(then[0], then[1]); this.interact() }
        }
      }
      if (dir) this.step(dir)
    }
    this.updateRemotes(dt)
  }

  step(dir) {
    const p = this.p
    const [dx, dy] = DIRS[dir]
    const nx = p.x + dx, ny = p.y + dy
    if (p.dir !== dir) { p.dir = dir; this.sendPresence() }
    if (this.blocked(nx, ny)) {
      this.path = null
      if (performance.now() - this.bumpAt > 300) {
        this.bumpAt = performance.now()
        const b = this.map.buildings.find((b) => b.door[0] === nx && b.door[1] === ny)
        if (b) { this.held = []; this.g.enterBuilding(b) }
      }
      return
    }
    Object.assign(this.fol, { fx: this.fol.x, fy: this.fol.y, x: p.x, y: p.y, t: 0 })
    Object.assign(p, { fx: p.x, fy: p.y, x: nx, y: ny, t: 0 })
    p.step++
    this.sendPresence()
  }

  arrive() {
    const p = this.p, m = this.map
    const w = m.warps.find((w) => p.x >= w.x && p.x < w.x + w.w && p.y >= w.y && p.y < w.y + w.h)
    if (w) { this.g.warp(w.to, w.tx + (p.x - w.x), w.ty + (p.y - w.y), w.dir); return }
    this.g.onArrive(p.x, p.y, tileAt(m, p.x, p.y))
  }

  interact() {
    if (this.g.isBusy()) return
    const p = this.p
    const [dx, dy] = DIRS[p.dir]
    const x = p.x + dx, y = p.y + dy
    // 隔着柜台也能和店员/护士说话
    const reach = tileAt(this.map, x, y) === 'C' ? [x + dx, y + dy] : [x, y]
    const npc = this.map.npcs.find((n) => (n.x === x && n.y === y) || (n.x === reach[0] && n.y === reach[1]))
    if (npc) return this.g.talkNpc(npc)
    const sign = this.map.signs[`${x},${y}`]
    if (sign) return this.g.say([sign])
    const b = this.map.buildings.find((b) => b.door[0] === x && b.door[1] === y)
    if (b) return this.g.enterBuilding(b)
    for (const r of this.remotes.values()) if (r.x === x && r.y === y) return this.g.openPlayer(r.state)
    const sp = this.g.spawnAt(this.map.id, x, y)
    if (sp) return this.g.engageSpawn(sp)
  }

  sendPresence() {
    const p = this.p
    this.g.net?.setPresence({ map: this.map.id, x: p.x, y: p.y, dir: p.dir })
  }

  updateRemotes(dt) {
    const seen = new Set()
    for (const s of this.g.net?.players() || []) {
      if (s.map !== this.map.id) continue
      seen.add(s.cid)
      let r = this.remotes.get(s.cid)
      if (!r) {
        r = { ...mover(s.x, s.y), step: 0, fol: mover(s.x, s.y) }
        this.remotes.set(s.cid, r)
      }
      r.state = s
      if (r.x !== s.x || r.y !== s.y) {
        const [cx, cy] = lerpPos(r)
        const dist = Math.abs(s.x - cx) + Math.abs(s.y - cy)
        if (dist > 3) { Object.assign(r, mover(s.x, s.y)); r.fol = mover(s.x, s.y) }
        else {
          Object.assign(r.fol, { fx: r.fol.x, fy: r.fol.y, x: r.x, y: r.y, t: 0 })
          Object.assign(r, { fx: cx, fy: cy, x: s.x, y: s.y, t: 0 })
          r.step++
        }
      }
      const spd = RUN * 0.95
      if (r.t < 1) r.t = Math.min(1, r.t + dt * spd)
      if (r.fol.t < 1) r.fol.t = Math.min(1, r.fol.t + dt * spd)
    }
    for (const k of this.remotes.keys()) if (!seen.has(k)) this.remotes.delete(k)
  }

  // —— 渲染 ——
  render() {
    const { ctx, map, Z, dpr } = this
    const p = this.p
    const [ppx, ppy] = lerpPos(p)
    const vwW = this.vw / Z, vwH = this.vh / Z
    const mw = map.w * TILE, mh = map.h * TILE
    let camX = ppx * TILE + 8 - vwW / 2, camY = ppy * TILE + 8 - vwH / 2
    camX = mw <= vwW ? (mw - vwW) / 2 : Math.max(0, Math.min(mw - vwW, camX))
    camY = mh <= vwH ? (mh - vwH) / 2 : Math.max(0, Math.min(mh - vwH, camY))
    const S = Z * dpr
    camX = Math.round(camX * S) / S
    camY = Math.round(camY * S) / S
    this.camX = camX; this.camY = camY

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = map.bg
    ctx.fillRect(0, 0, this.cv.width, this.cv.height)
    ctx.setTransform(S, 0, 0, S, -camX * S, -camY * S)
    ctx.imageSmoothingEnabled = false
    const frame = Math.abs(Math.floor(this.time / 0.6)) % 2
    ctx.drawImage(this.layers.get(map.id)[frame], 0, 0)

    const ents = []
    const t = this.time
    // 稀有精灵
    for (const s of this.g.spawnsOn(map.id)) {
      ents.push({ y: s.y, draw: () => {
        const bob = Math.round(Math.sin(t * 4 + s.x) * 1.5)
        const pulse = 0.5 + 0.5 * Math.sin(t * 5)
        ctx.fillStyle = `rgba(255, 214, 90, ${0.35 + pulse * 0.35})`
        ctx.beginPath(); ctx.ellipse(s.x * 16 + 8, s.y * 16 + 14, 9 + pulse * 2, 3.5, 0, 0, Math.PI * 2); ctx.fill()
        ctx.drawImage(monSprite(s.sp, { size: 24, shiny: s.shiny }), s.x * 16 - 4, s.y * 16 - 9 + bob)
        for (let k = 0; k < 3; k++) {
          const a = t * 2 + k * 2.1
          ctx.fillStyle = k % 2 ? '#fff6c9' : '#ffd23f'
          ctx.fillRect(Math.round(s.x * 16 + 8 + Math.cos(a) * 11), Math.round(s.y * 16 - 2 + Math.sin(a * 1.3) * 7), 1, 1)
        }
      } })
    }
    for (const n of map.npcs) ents.push({ y: n.y, draw: () => ctx.drawImage(trainerSprite(n.look, n.dir, 0), n.x * 16 - 1, n.y * 16 - 7) })
    const pushTrainer = (mv, look, dir, lead, mount) => {
      const [x, y] = lerpPos(mv)
      const walking = mv.t < 1
      const fr = walking ? (mv.t < 0.5 ? (mv.step % 2 ? 1 : 2) : 0) : 0
      if (mount && SPECIES[mount] && !this.map.interior) {
        // 骑乘：坐骑在下，骑手只画上半身坐在背上；不带跟随精灵
        ents.push({ y, draw: () => {
          const X = Math.round(x * 16), Y = Math.round(y * 16)
          const bob = walking ? -Math.round(Math.abs(Math.sin(mv.t * Math.PI)) * 2) : Math.round(Math.sin(this.time * 3))
          const flip = dir === 'right'
          ctx.save()
          if (flip) { ctx.translate(X * 2 + 16, 0); ctx.scale(-1, 1) }
          ctx.drawImage(monSprite(mount, { size: 36, back: dir === 'up' }), X - 10, Y - 19 + bob)
          ctx.restore()
          ctx.drawImage(trainerSprite(look, dir, 0), 0, 0, 18, 15, X + (flip ? -2 : 2), Y - 19 + bob, 18, 15)
          this.grassOver(x, y)
        } })
        return
      }
      if (lead && SPECIES[lead.sp]) {
        const [fx, fy] = lerpPos(mv.fol)
        ents.push({ y: fy - 0.01, draw: () => {
          const hop = mv.fol.t < 1 ? Math.round(Math.sin(mv.fol.t * Math.PI) * 2) : 0
          ctx.drawImage(monSprite(lead.sp, { size: 24, shiny: lead.shiny }), Math.round(fx * 16) - 4, Math.round(fy * 16) - 9 - hop)
          this.grassOver(fx, fy)
        } })
      }
      ents.push({ y, draw: () => {
        ctx.drawImage(trainerSprite(look, dir, fr), Math.round(x * 16) - 1, Math.round(y * 16) - 7)
        this.grassOver(x, y)
      } })
    }
    for (const r of this.remotes.values()) {
      r.fol.step = r.step
      pushTrainer(r, r.state.look || {}, r.state.dir || 'down', r.state.lead, r.state.mount)
    }
    this.fol.step = p.step
    pushTrainer(Object.assign(p, { fol: this.fol }), this.g.save.look, p.dir, this.g.leadInfo(), this.g.isRiding?.() ? this.g.save.mount : null)
    ents.sort((a, b) => a.y - b.y)
    for (const e of ents) e.draw()

    // 森林的黑暗光照
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    if (map.dark) {
      const sx = (ppx * TILE + 8 - camX) * Z, sy = (ppy * TILE + 4 - camY) * Z
      const g = ctx.createRadialGradient(sx, sy, 20 * Z, sx, sy, 95 * Z)
      g.addColorStop(0, 'rgba(6,14,22,0)')
      g.addColorStop(1, 'rgba(6,14,22,0.74)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, this.vw, this.vh)
    }
    this.renderLabels(ppx, ppy)
  }

  grassOver(x, y) {
    const tx = Math.round(x), ty = Math.round(y)
    if (tileAt(this.map, tx, ty) !== ',' || Math.abs(x - tx) > 0.3 || Math.abs(y - ty) > 0.3) return
    const ctx = this.ctx
    const X = Math.round(x * 16), Y = Math.round(y * 16)
    const dark = this.map.dark
    ctx.fillStyle = dark ? '#3f7d3a' : '#5fae4b'
    ctx.fillRect(X + 1, Y + 11, 14, 5)
    ctx.fillStyle = dark ? '#2c5e2a' : '#3f8a3a'
    for (let i = 0; i < 5; i++) ctx.fillRect(X + 1 + i * 3, Y + 9 + (i % 2), 1, 5)
  }

  toScreen(wx, wy) { return [(wx - this.camX) * this.Z, (wy - this.camY) * this.Z] }

  renderLabels(ppx, ppy) {
    const ctx = this.ctx, Z = this.Z
    const now = Date.now()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    // 建筑招牌
    ctx.font = `600 ${Math.max(11, Z * 3.4)}px "Noto Sans SC", sans-serif`
    for (const b of this.map.buildings) {
      const [sx, sy] = this.toScreen(b.x * 16 + b.w * 8, b.y * 16 - 3)
      if (sx < -80 || sx > this.vw + 80 || sy < -20 || sy > this.vh + 20) continue
      pill(ctx, sx, sy, b.label, 'rgba(28,26,46,.78)', '#fff')
    }
    // 训练家 NPC 的“！”
    for (const n of this.map.npcs) {
      if (!n.trainer || this.g.save.beaten?.[n.id]) continue
      const [sx, sy] = this.toScreen(n.x * 16 + 8, n.y * 16 - 12 + Math.sin(this.time * 5) * 1.5)
      ctx.font = `800 ${Z * 4}px "Silkscreen", monospace`
      ctx.fillStyle = '#ffc43d'; ctx.strokeStyle = INK; ctx.lineWidth = 3
      ctx.strokeText('!', sx, sy); ctx.fillText('!', sx, sy)
    }
    // 稀有精灵名
    ctx.font = `700 ${Math.max(11, Z * 3)}px "Noto Sans SC", sans-serif`
    for (const s of this.g.spawnsOn(this.map.id)) {
      const [sx, sy] = this.toScreen(s.x * 16 + 8, s.y * 16 - 14)
      pill(ctx, sx, sy, `${s.shiny ? '✦ ' : ''}${SPECIES[s.sp].name} Lv.${s.lv}`, 'rgba(255,196,61,.95)', INK)
    }
    // 玩家名、聊天气泡、表情
    const labelFor = (x, y, name, pk, cid, isMe, verified, riding) => {
      const [sx, sy] = this.toScreen(x * 16 + 8, y * 16 - 13 - (riding ? 12 : 0))
      ctx.font = `600 ${Math.max(11, Z * 3)}px "Noto Sans SC", sans-serif`
      pill(ctx, sx, sy, (verified ? '✓ ' : '') + name, isMe ? 'rgba(255,196,61,.95)' : 'rgba(28,26,46,.8)', isMe ? INK : '#fff')
      const em = this.g.emotes.get(cid)
      let top = sy - Z * 5
      if (em && now - em.t < 2500) {
        ctx.font = `${Z * 6}px sans-serif`
        ctx.fillText(em.e, sx, top - Z * 2)
        top -= Z * 7
      }
      const b = this.g.bubbles.get(pk)
      if (b && now - b.t < 7000 && b.map === this.map.id) bubble(ctx, sx, top, b.text, Z)
    }
    for (const r of this.remotes.values()) {
      const [x, y] = lerpPos(r)
      labelFor(x, y, r.state.name || '训练家', r.state.pk, r.state.cid, false, this.g.net.isVerified(r.state), !!r.state.mount && !this.map.interior)
    }
    labelFor(ppx, ppy, this.g.save.name, this.g.signer.pubkey, this.g.net?.cid, true, true, this.g.isRiding?.())
  }
}

function pill(ctx, x, y, text, bg, fg) {
  const w = ctx.measureText(text).width + 10
  const h = parseInt(ctx.font.match(/(\d+)px/)[1]) + 6
  ctx.fillStyle = bg
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2)
  ctx.fill()
  ctx.fillStyle = fg
  ctx.fillText(text, x, y + 0.5)
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function bubble(ctx, x, bottom, text, Z) {
  const fs = Math.max(12, Z * 3.4)
  ctx.font = `500 ${fs}px "Noto Sans SC", sans-serif`
  const maxW = 200
  const lines = []
  let cur = ''
  for (const ch of text) {
    if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; if (lines.length === 2) break } else cur += ch
  }
  if (lines.length < 2 && cur) lines.push(cur)
  else if (lines.length === 2 && cur) lines[1] = lines[1].slice(0, -1) + '…'
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16
  const lh = fs + 4
  const h = lines.length * lh + 10
  const y = bottom - h - 6
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = INK
  ctx.lineWidth = 2
  roundRect(ctx, x - w / 2, y, w, h, 8)
  ctx.fill(); ctx.stroke()
  ctx.beginPath(); ctx.moveTo(x - 5, y + h - 1); ctx.lineTo(x, y + h + 6); ctx.lineTo(x + 5, y + h - 1); ctx.closePath()
  ctx.fill()
  ctx.beginPath(); ctx.moveTo(x - 5, y + h); ctx.lineTo(x, y + h + 6); ctx.lineTo(x + 5, y + h); ctx.stroke()
  ctx.fillStyle = INK
  lines.forEach((l, i) => ctx.fillText(l, x, y + 5 + lh / 2 + i * lh))
}
