// 3D 室内：把室内地图（w 木地板 / k 瓷砖、W 墙、各种家具与装饰）搭成卡通"娃娃屋"剖面。
// 与 buildTerrain 相同的接口：{ group, labelAnchors, lights, update(t, playerPos), dispose() }。
// 参考外观：src/render/tiles.js 的 drawTile / drawDecor。1 单位 = 1 格，地面 y = 0。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { tileAt } from '../data/maps.js'
import { toonMat, addOutline, disposeTree, shade } from './materials.js'

const BACK_H = 2.25 // 后墙高度
const SIDE_H = 1.15 // 侧墙高度（低一些，免得挡住镜头）
const FRONT_H = 0.34 // 前沿矮墙
const WALL_TOP = '#3b3552'
const INK = '#1c1a2e'

// 与 2D 图块相同的坐标哈希 → [0, 1)
const h3 = (x, y, s) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---------- 几何合批（顶点色）----------
const _c = new THREE.Color()
const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3()
function trs(x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz)
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz))
}
class Batch {
  constructor() { this.parts = [] }
  add(geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    const cnt = g.attributes.position.count
    const col = new Float32Array(cnt * 3)
    _c.set(color)
    for (let i = 0; i < cnt; i++) { col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    g.applyMatrix4(m)
    this.parts.push(g)
  }
  build() {
    if (!this.parts.length) return null
    const g = this.parts.length === 1 ? this.parts[0] : mergeGeometries(this.parts, false)
    if (g !== this.parts[0]) for (const p of this.parts) p.dispose()
    this.parts = []
    return g
  }
}

// 构建期共享的单位图元
function primitives() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    cone: new THREE.CylinderGeometry(0.3, 0.5, 1, 14),
    sph: new THREE.SphereGeometry(1, 12, 8),
    plane: new THREE.PlaneGeometry(1, 1),
  }
}

// 画图助手：box 用最小/最大角点，其余用中心 + 尺寸
function painter(P) {
  return {
    box(B, x0, y0, z0, x1, y1, z1, c) { B.add(P.box, c, trs((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0))) },
    cyl(B, x, y0, z, r, h, c, rx = 0, rz = 0) { B.add(P.cyl, c, trs(x, y0 + h / 2, z, r * 2, h, r * 2, rx, 0, rz)) },
    cylAt(B, x, y, z, r, h, c, rx = 0, ry = 0, rz = 0) { B.add(P.cyl, c, trs(x, y, z, r * 2, h, r * 2, rx, ry, rz)) },
    cone(B, x, y0, z, r, h, c) { B.add(P.cone, c, trs(x, y0 + h / 2, z, r * 2, h, r * 2)) },
    sph(B, x, y, z, rx, ry, rz, c) { B.add(P.sph, c, trs(x, y, z, rx, ry ?? rx, rz ?? rx)) },
    // 立在南面（朝 +Z）的平面贴片
    quadZ(B, x0, y0, x1, y1, z, c) { B.add(P.plane, c, trs((x0 + x1) / 2, (y0 + y1) / 2, z, x1 - x0, y1 - y0, 1)) },
    // 朝上的平面贴片
    quadY(B, x0, z0, x1, z1, y, c) { B.add(P.plane, c, trs((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, z1 - z0, 1, -Math.PI / 2)) },
  }
}

// 家具顶面高度（桌面装饰摆放用）
const TOP_H = { t: 0.66, C: 0.97, h: 1.86, K: 0.94, E: 0.74, D: 1.2, F: 1.76, c: 0.44, v: 0.5, A: 1.86 }

export function buildInterior(map) {
  const W = map.w, H = map.h
  const th = map.theme || {}
  const wall = th.wall || '#f3e6c8', stripe = th.stripe || '#e8d6ad', trim = th.trim || '#8a5a2b'
  const darkWood = th.floor === 'dark'
  const tiles = map.floor === 'k'
  const t = (x, y) => tileAt(map, x, y)
  const decorAt = new Map((map.decor || []).map((d) => [d.x + ',' + d.y, d]))

  const group = new THREE.Group()
  group.name = 'interior'
  const P = primitives()
  const D = painter(P)
  const solid = new Batch() // 描边、投影
  const flat = new Batch() // 地面、墙面贴片：不描边、只接收阴影
  const lit = new Batch() // 自发光（屏幕、灯罩、窗玻璃……）
  const anim = [] // update 回调
  const lights = []

  const addMesh = (geo, material, { cast = false, receive = true, outline = 0, name } = {}) => {
    if (!geo) return null
    const m = new THREE.Mesh(geo, material)
    m.castShadow = cast
    m.receiveShadow = receive
    if (name) m.name = name
    if (outline) addOutline(m, outline)
    m.matrixAutoUpdate = false
    m.updateMatrix()
    group.add(m)
    return m
  }
  const basicMat = (opts = {}) => {
    const m = new THREE.MeshBasicMaterial({ vertexColors: true, ...opts })
    m.userData.unique = true
    return m
  }
  const uniqueToon = (color, opts = {}) => toonMat(color, { ...opts, unique: true })

  // ---------- 地板 ----------
  const fx0 = 1, fx1 = W - 1, fz0 = 2, fz1 = H
  // 底座（前沿可见的厚度）
  D.box(flat, 0, -0.35, 0, W, -0.004, H + 0.28, '#2a2438')
  for (let y = 2; y < H; y++) {
    for (let x = 1; x < W - 1; x++) {
      if (tiles) {
        // 2×2 棋盘瓷砖 + 灰缝
        D.quadY(flat, x, y, x + 1, y + 1, 0, '#cfd7e3')
        for (let k = 0; k < 4; k++) {
          const ox = (k & 1) * 0.5, oz = (k >> 1) * 0.5
          const alt = ((x + y) % 2 === 1) && (k === 0 || k === 3)
          D.quadY(flat, x + ox + 0.02, y + oz + 0.02, x + ox + 0.49, y + oz + 0.49, 0.001, alt ? '#dfe6ef' : '#e9eef5')
        }
      } else {
        // 沿 X 方向的木板，每格 4 条，色调随机
        const base = darkWood ? '#9a6a44' : '#c9925a', line = darkWood ? '#7a4f2a' : '#b07a47'
        D.quadY(flat, x, y, x + 1, y + 1, 0, line)
        for (let k = 0; k < 4; k++) {
          const j = (h3(x, y, k) - 0.5) * 0.12
          D.quadY(flat, x, y + k * 0.25 + 0.012, x + 1, y + k * 0.25 + 0.238, 0.001, shade(base, j))
          // 木板接缝
          const sx = x + 0.1 + h3(x, y, k + 7) * 0.8
          D.quadY(flat, sx, y + k * 0.25 + 0.012, sx + 0.018, y + k * 0.25 + 0.238, 0.002, line)
        }
      }
    }
  }
  // 地毯：连成一块，边缘金色
  const isRug = (x, y) => t(x, y) === 'R'
  for (let y = 2; y < H; y++) for (let x = 1; x < W - 1; x++) {
    if (!isRug(x, y)) continue
    const l = isRug(x - 1, y), r = isRug(x + 1, y), u = isRug(x, y - 1), d = isRug(x, y + 1)
    const x0 = x + (l ? 0 : 0.04), x1 = x + 1 - (r ? 0 : 0.04), z0 = y + (u ? 0 : 0.04), z1 = y + 1 - (d ? 0 : 0.04)
    D.box(flat, x0, 0, z0, x1, 0.022, z1, '#c0504d')
    const b = 0.13
    D.quadY(flat, x0 + (l ? 0 : b), z0 + (u ? 0 : b), x1 - (r ? 0 : b), z1 - (d ? 0 : b), 0.023, '#d8665f')
    if (!u) D.quadY(flat, x0, z0, x1, z0 + 0.08, 0.024, '#f2c14e')
    if (!d) D.quadY(flat, x0, z1 - 0.08, x1, z1, 0.024, '#f2c14e')
    if (!l) D.quadY(flat, x0, z0, x0 + 0.08, z1, 0.024, '#f2c14e')
    if (!r) D.quadY(flat, x1 - 0.08, z0, x1, z1, 0.024, '#f2c14e')
    for (let k = 0; k < 3; k++) D.quadY(flat, x + 0.2 + k * 0.25, y + 0.44, x + 0.32 + k * 0.25, y + 0.56, 0.025, '#f2c14e')
  }

  // ---------- 墙 ----------
  // 后墙（y = 0..1 两行），墙面朝 +Z 位于 z = 2
  D.box(solid, 0, 0, 0, W, BACK_H, 2, WALL_TOP)
  D.quadZ(flat, 1, 0.3, W - 1, BACK_H - 0.1, 2.002, wall)
  for (let x = 1; x < W - 1; x++) for (let k = 0; k < 2; k++) D.quadZ(flat, x + 0.22 + k * 0.5, 0.3, x + 0.28 + k * 0.5, BACK_H - 0.16, 2.004, stripe)
  D.quadZ(flat, 1, BACK_H - 0.16, W - 1, BACK_H - 0.1, 2.005, shade(stripe, -0.08))
  D.quadZ(flat, 1, BACK_H - 0.1, W - 1, BACK_H, 2.003, '#57507a')
  D.box(solid, 1, 0, 2, W - 1, 0.3, 2.06, trim)
  D.box(solid, 1, 0.3, 2, W - 1, 0.33, 2.075, shade(trim, 0.25))
  // 侧墙：顶面暗色，内侧贴墙纸
  for (const [x0, x1, fx, dir] of [[0, 1, 1.002, 1], [W - 1, W, W - 1.002, -1]]) {
    D.box(solid, x0, 0, 2, x1, SIDE_H, H + 0.28, WALL_TOP)
    const face = (a, b, y0, y1, c, off = 0) => B_side(flat, fx + dir * off, a, b, y0, y1, c, dir)
    face(2, H + 0.28, 0.3, SIDE_H - 0.08, wall)
    face(2, H + 0.28, SIDE_H - 0.08, SIDE_H, '#57507a')
    const tx = dir > 0 ? x1 : x0
    D.box(solid, Math.min(tx, tx + dir * 0.06), 0, 2, Math.max(tx, tx + dir * 0.06), 0.3, H + 0.28, trim)
  }
  // 前沿矮墙（出口地垫处留门洞）
  const mat = []
  for (let x = 0; x < W; x++) if (t(x, H - 1) === 'x') mat.push(x)
  const gap0 = mat.length ? Math.min(...mat) : -1, gap1 = mat.length ? Math.max(...mat) + 1 : -1
  const front = (a, b) => { if (b > a) D.box(solid, a, 0, H, b, FRONT_H, H + 0.28, WALL_TOP) }
  if (gap0 >= 0) { front(1, gap0); front(gap1, W - 1) } else front(1, W - 1)
  if (gap0 >= 0) {
    // 门框 + 门外的日光
    D.box(solid, gap0 - 0.08, 0, H, gap0, 0.9, H + 0.28, trim)
    D.box(solid, gap1, 0, H, gap1 + 0.08, 0.9, H + 0.28, trim)
    D.quadY(lit, gap0, H, gap1, H + 0.45, 0.002, '#fff3cf')
  }

  // 墙上的窗户（与 2D 一致：x % 4 === 2 且没有装饰）
  const wallZ = 2.01
  const windowAt = (x, curtain) => {
    const cx = x + 0.5
    D.box(solid, cx - 0.33, 0.98, wallZ, cx + 0.33, 1.62, wallZ + 0.06, '#5a4632')
    D.quadZ(lit, cx - 0.27, 1.04, cx + 0.27, 1.56, wallZ + 0.062, '#9fdcff')
    D.quadZ(lit, cx - 0.27, 1.44, cx + 0.27, 1.56, wallZ + 0.064, '#d7f3ff')
    D.box(solid, cx - 0.025, 1.04, wallZ + 0.04, cx + 0.025, 1.56, wallZ + 0.08, '#5a4632')
    D.box(solid, cx - 0.36, 0.94, wallZ, cx + 0.36, 0.99, wallZ + 0.12, '#6b4a30') // 窗台
    if (curtain) {
      D.cylAt(solid, cx, 1.7, wallZ + 0.1, 0.022, 0.92, '#6b4424', 0, 0, Math.PI / 2)
      for (const s of [-1, 1]) {
        D.box(solid, cx + s * 0.44 - 0.1, 0.86, wallZ + 0.07, cx + s * 0.44 + 0.1, 1.7, wallZ + 0.15, '#e05c6e')
        D.box(solid, cx + s * 0.44 - 0.1, 0.86, wallZ + 0.15, cx + s * 0.44 - 0.04, 1.7, wallZ + 0.16, '#b8404f')
      }
    }
  }
  for (let x = 1; x < W - 1; x++) if (x % 4 === 2 && !decorAt.has(x + ',1')) windowAt(x, false)

  // ---------- 家具 ----------
  const legs = (B, x0, z0, x1, z1, h, c, r = 0.04) => {
    for (const [lx, lz] of [[x0 + r, z0 + r], [x1 - r, z0 + r], [x0 + r, z1 - r], [x1 - r, z1 - r]]) D.box(B, lx - r, 0, lz - r, lx + r, h, lz + r, c)
  }
  const near = (x, y, set) => [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([dx, dy]) => set.includes(t(x + dx, y + dy)))

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = t(x, y), cx = x + 0.5, cz = y + 0.5
    switch (c) {
      case 'C': { // 柜台：相邻柜台连成一整条
        const l = t(x - 1, y) === 'C', r = t(x + 1, y) === 'C'
        const x0 = x + (l ? 0 : 0.04), x1 = x + 1 - (r ? 0 : 0.04)
        D.box(solid, x0, 0, y + 0.14, x1, 0.9, y + 0.86, '#b07a47')
        D.box(solid, x0 - (l ? 0 : 0.04), 0.9, y + 0.08, x1 + (r ? 0 : 0.04), 0.97, y + 0.92, '#e8d2a8')
        D.box(solid, x + 0.18, 0.2, y + 0.86, x + 0.82, 0.62, y + 0.875, '#9a6a3a')
        D.box(solid, x0, 0, y + 0.86, x1, 0.06, y + 0.88, '#6b4424')
        break
      }
      case 'b': { // 床：竖向两格，上格是床头
        if (t(x, y + 1) !== 'b' || t(x, y - 1) === 'b') break
        D.box(solid, x + 0.06, 0, y + 0.02, x + 0.94, 0.3, y + 1.96, '#8a5a2b')
        D.box(solid, x + 0.04, 0, y + 0.0, x + 0.96, 0.82, y + 0.12, '#6b4424')
        D.box(solid, x + 0.1, 0.3, y + 0.12, x + 0.9, 0.44, y + 1.9, '#ffffff')
        D.box(solid, x + 0.2, 0.44, y + 0.2, x + 0.8, 0.54, y + 0.6, '#eef3fb')
        D.box(solid, x + 0.08, 0.3, y + 0.78, x + 0.92, 0.5, y + 1.94, '#5b8def')
        D.box(solid, x + 0.08, 0.5, y + 0.78, x + 0.92, 0.52, y + 0.94, '#ffffff')
        D.box(solid, x + 0.06, 0, y + 1.9, x + 0.94, 0.46, y + 1.98, '#6b4424')
        break
      }
      case 't': { // 桌子：相邻桌面连成一张
        const l = t(x - 1, y) === 't', r = t(x + 1, y) === 't'
        const x0 = x + (l ? 0 : 0.06), x1 = x + 1 - (r ? 0 : 0.06)
        D.box(solid, x0, 0.58, y + 0.12, x1, 0.66, y + 0.88, '#b07a47')
        D.quadY(solid, x0 + 0.02, y + 0.14, x1 - 0.02, y + 0.3, 0.661, '#d09a63')
        if (!l) { D.box(solid, x0 + 0.03, 0, y + 0.16, x0 + 0.1, 0.58, y + 0.23, '#6b4424'); D.box(solid, x0 + 0.03, 0, y + 0.77, x0 + 0.1, 0.58, y + 0.84, '#6b4424') }
        if (!r) { D.box(solid, x1 - 0.1, 0, y + 0.16, x1 - 0.03, 0.58, y + 0.23, '#6b4424'); D.box(solid, x1 - 0.1, 0, y + 0.77, x1 - 0.03, 0.58, y + 0.84, '#6b4424') }
        break
      }
      case 'c': { // 椅子 / 长凳：面向相邻的桌子，否则面朝 +Z
        const n = near(x, y, ['t', 'E'])
        const ry = n ? Math.atan2(n[0], n[1]) : 0
        const g = new Batch()
        D.box(g, -0.3, 0.36, -0.28, 0.3, 0.44, 0.3, '#c47b45')
        D.box(g, -0.3, 0.44, -0.34, 0.3, 0.92, -0.26, '#a8663a')
        legs(g, -0.28, -0.3, 0.28, 0.28, 0.36, '#6b4424', 0.035)
        const geo = g.build()
        geo.applyMatrix4(trs(cx, 0, cz, 1, 1, 1, 0, ry, 0))
        solid.parts.push(geo)
        break
      }
      case 'h': { // 书架：贴后墙，前面开口
        const wood = '#7a4f2a'
        D.box(solid, x + 0.05, 0, y + 0.0, x + 0.12, 1.86, y + 0.5, wood)
        D.box(solid, x + 0.88, 0, y + 0.0, x + 0.95, 1.86, y + 0.5, wood)
        D.box(solid, x + 0.05, 1.8, y + 0.0, x + 0.95, 1.86, y + 0.52, wood)
        D.box(solid, x + 0.05, 0, y + 0.0, x + 0.95, 0.1, y + 0.5, wood)
        D.box(solid, x + 0.12, 0.1, y + 0.0, x + 0.88, 1.8, y + 0.06, '#5e3a1d')
        const books = ['#e84a5f', '#3a86ff', '#2ec4b6', '#ffc43d', '#8e5cf7', '#f4f4f4']
        for (let row = 0; row < 3; row++) {
          const by = 0.1 + row * 0.57
          if (row) D.box(solid, x + 0.12, by - 0.04, y + 0.06, x + 0.88, by, y + 0.5, wood)
          let bx = x + 0.14
          for (let k = 0; ; k++) {
            const bw = 0.07 + h3(x, row, k) * 0.05, bh = 0.3 + h3(k, row, x + 3) * 0.16
            if (bx + bw > x + 0.86) break
            D.box(solid, bx, by, y + 0.1, bx + bw, by + bh, y + 0.44, books[(k + row + x) % books.length])
            bx += bw + 0.01
          }
        }
        break
      }
      case 'D': { // 商店货架：两面摆货
        D.box(solid, x + 0.02, 0, y + 0.14, x + 0.98, 0.14, y + 0.86, '#7b8794')
        D.box(solid, x + 0.44, 0, y + 0.3, x + 0.56, 1.16, y + 0.7, '#9aa5b1')
        const cols = ['#ef476f', '#1fb5a3', '#ffc43d', '#3a86ff', '#8e5cf7']
        for (const [sy, k0] of [[0.14, 0], [0.62, 2]]) {
          D.box(solid, x + 0.02, sy + 0.44, y + 0.14, x + 0.98, sy + 0.48, y + 0.86, '#c3ccd6')
          for (let k = 0; k < 3; k++) {
            const col = cols[(k + x + k0) % cols.length]
            const gx = x + 0.1 + k * 0.3
            D.box(solid, gx, sy, y + 0.62, gx + 0.2, sy + 0.26 + (k % 2) * 0.08, y + 0.82, col)
            D.box(solid, gx, sy, y + 0.18, gx + 0.2, sy + 0.3 - (k % 2) * 0.08, y + 0.38, cols[(k + x + k0 + 1) % cols.length])
          }
        }
        D.box(solid, x + 0.02, 1.16, y + 0.14, x + 0.98, 1.2, y + 0.86, '#c3ccd6')
        break
      }
      case 'P': { // 盆栽
        D.cone(solid, cx, 0, cz, 0.2, 0.36, '#c96b3b')
        D.cyl(solid, cx, 0.32, cz, 0.21, 0.06, '#e08a5a')
        D.sph(solid, cx, 0.6, cz, 0.26, 0.24, 0.26, '#3f8f46')
        D.sph(solid, cx - 0.12, 0.74, cz + 0.05, 0.16, 0.15, 0.16, '#66be62')
        D.sph(solid, cx + 0.1, 0.8, cz - 0.04, 0.14, 0.13, 0.14, '#4fa94c')
        break
      }
      case 'M': { // 治疗机
        D.box(solid, x + 0.08, 0, y + 0.1, x + 0.92, 0.92, y + 0.82, '#e9eef5')
        D.box(solid, x + 0.06, 0.92, y + 0.08, x + 0.94, 1.02, y + 0.84, '#ef476f')
        D.box(solid, x + 0.12, 0.2, y + 0.82, x + 0.88, 0.7, y + 0.84, '#b9c3cf')
        D.box(solid, x + 0.08, 0, y + 0.82, x + 0.92, 0.06, y + 0.86, '#b9c3cf')
        const orbs = new Batch()
        for (let k = 0; k < 6; k++) D.sph(orbs, x + 0.25 + (k % 3) * 0.25, 1.08, y + 0.3 + Math.floor(k / 3) * 0.28, 0.075, 0.075, 0.075, '#ffffff')
        const m = uniqueToon('#6fd3f5', { emissive: '#3fb7e8' })
        addMesh(orbs.build(), m, { name: 'healOrbs' })
        const phase = x * 1.7
        anim.push((tt) => { const k = 0.5 + 0.5 * Math.sin(tt * 3.1 + phase); m.emissive.setRGB(0.12 + 0.35 * k, 0.45 + 0.35 * k, 0.72 + 0.25 * k) })
        break
      }
      case 'v': { // 电视柜 + 电视
        D.box(solid, x + 0.06, 0, y + 0.18, x + 0.94, 0.46, y + 0.72, '#6b4424')
        D.box(solid, x + 0.12, 0.08, y + 0.721, x + 0.48, 0.38, y + 0.73, '#8a5a2b')
        D.box(solid, x + 0.52, 0.08, y + 0.721, x + 0.88, 0.38, y + 0.73, '#8a5a2b')
        D.box(solid, x + 0.1, 0.5, y + 0.36, x + 0.9, 1.06, y + 0.46, INK)
        D.box(solid, x + 0.42, 0.46, y + 0.38, x + 0.58, 0.5, y + 0.5, '#555')
        const scr = new Batch()
        D.quadZ(scr, x + 0.15, 0.55, x + 0.85, 1.01, y + 0.462, '#ffffff')
        const m = basicMat({ vertexColors: true, color: '#3a6ea5' })
        addMesh(scr.build(), m, { name: 'tv' })
        anim.push((tt) => { const f = Math.floor(tt * 1.6) % 2; m.color.set(f ? '#3a6ea5' : '#2f5f93') })
        D.quadZ(lit, x + 0.2, 0.86, x + 0.44, 0.96, y + 0.463, '#8fc3ff')
        break
      }
      case 'F': { // 冰箱 / 冷饮柜
        const cooler = tiles
        if (cooler) {
          // 冷饮柜：前面敞开，里面亮着灯
          D.box(solid, x + 0.1, 0, y + 0.08, x + 0.9, 1.74, y + 0.5, '#e9eef5')
          D.box(solid, x + 0.1, 0, y + 0.5, x + 0.16, 1.74, y + 0.8, '#e9eef5')
          D.box(solid, x + 0.84, 0, y + 0.5, x + 0.9, 1.74, y + 0.8, '#e9eef5')
          D.box(solid, x + 0.16, 0, y + 0.5, x + 0.84, 0.12, y + 0.8, '#e9eef5')
          D.box(solid, x + 0.08, 1.62, y + 0.06, x + 0.92, 1.76, y + 0.82, '#ffffff')
          D.quadZ(lit, x + 0.16, 0.12, x + 0.84, 1.62, y + 0.502, '#dff5ff')
          const cs = ['#ef476f', '#1fb5a3', '#ffc43d', '#3a86ff', '#ef476f', '#8e5cf7']
          for (let k = 0; k < 6; k++) {
            const bx = x + 0.22 + (k % 3) * 0.2, by = k < 3 ? 0.98 : 0.16
            if (k % 3 === 0) D.box(solid, x + 0.16, by - 0.04, y + 0.5, x + 0.84, by, y + 0.78, '#9fb3c8')
            D.cyl(solid, bx + 0.06, by, y + 0.66, 0.06, 0.38, cs[k])
            D.cyl(solid, bx + 0.06, by + 0.38, y + 0.66, 0.03, 0.08, '#ffffff')
          }
        } else {
          D.box(solid, x + 0.1, 0, y + 0.08, x + 0.9, 1.74, y + 0.8, '#e9eef5')
          D.box(solid, x + 0.08, 1.7, y + 0.06, x + 0.92, 1.76, y + 0.82, '#ffffff')
          D.box(solid, x + 0.1, 1.05, y + 0.8, x + 0.9, 1.08, y + 0.82, '#c3ccd6')
          D.box(solid, x + 0.74, 1.2, y + 0.8, x + 0.78, 1.5, y + 0.86, '#9aa5b1')
          D.box(solid, x + 0.74, 0.55, y + 0.8, x + 0.78, 0.95, y + 0.86, '#9aa5b1')
          D.box(solid, x + 0.22, 0.7, y + 0.801, x + 0.42, 0.84, y + 0.81, '#ffc43d')
        }
        break
      }
      case 'K': { // 厨房台面：偶数格灶台，奇数格水槽
        D.box(solid, x, 0, y + 0.1, x + 1, 0.88, y + 0.82, '#d8c3a5')
        D.box(solid, x - 0.005, 0.88, y + 0.08, x + 1.005, 0.94, y + 0.86, '#eef1f4')
        D.box(solid, x + 0.06, 0.1, y + 0.82, x + 0.47, 0.78, y + 0.835, '#c2a57e')
        D.box(solid, x + 0.53, 0.1, y + 0.82, x + 0.94, 0.78, y + 0.835, '#c2a57e')
        D.box(solid, x + 0.4, 0.44, y + 0.835, x + 0.44, 0.54, y + 0.86, '#6b4424')
        D.box(solid, x + 0.56, 0.44, y + 0.835, x + 0.6, 0.54, y + 0.86, '#6b4424')
        if (x % 2 === 0) {
          D.cyl(solid, x + 0.3, 0.94, y + 0.46, 0.13, 0.02, '#3b3552')
          D.cyl(lit, x + 0.7, 0.94, y + 0.46, 0.13, 0.022, '#ef6f3b')
          D.box(solid, x + 0.1, 0.94, y + 0.12, x + 0.9, 1.0, y + 0.2, '#9aa5b1')
        } else {
          D.box(solid, x + 0.18, 0.9, y + 0.2, x + 0.82, 0.945, y + 0.72, '#9aa5b1')
          D.quadY(lit, x + 0.22, y + 0.24, x + 0.78, y + 0.68, 0.946, '#7cc6ef')
          D.cyl(solid, x + 0.5, 0.94, y + 0.16, 0.03, 0.3, '#7b8794')
          D.cylAt(solid, x + 0.5, 1.24, y + 0.24, 0.025, 0.18, '#7b8794', Math.PI / 2)
        }
        break
      }
      case 'L': { // 落地灯：灯罩发光 + 暖色点光
        D.cyl(solid, cx, 0, cz, 0.18, 0.05, '#5e3a1d')
        D.cyl(solid, cx, 0.05, cz, 0.025, 1.3, '#5e3a1d')
        D.cone(lit, cx, 1.28, cz, 0.24, 0.32, '#ffe7a8')
        D.cyl(lit, cx, 1.26, cz, 0.245, 0.03, '#f2c14e')
        lights.push({ x: cx, y: 1.35, z: cz, color: '#ffc27a', intensity: 3.2, distance: 6.5 })
        break
      }
      case 'O': { // 沙发：相邻格连成一张
        const sc = th.sofa || '#5b8def'
        const l = t(x - 1, y) === 'O', r = t(x + 1, y) === 'O', u = t(x, y - 1) === 'O', d = t(x, y + 1) === 'O'
        const vertical = u || d
        const g = new Batch()
        if (!vertical) {
          D.box(g, l ? -0.5 : -0.44, 0.08, -0.3, r ? 0.5 : 0.44, 0.42, 0.34, sc)
          D.box(g, l ? -0.5 : -0.44, 0.42, -0.38, r ? 0.5 : 0.44, 0.9, -0.14, shade(sc, -0.25))
          D.box(g, l ? -0.5 : -0.4, 0.42, -0.14, r ? 0.5 : 0.4, 0.47, 0.3, shade(sc, 0.15))
          if (!l) D.box(g, -0.48, 0.08, -0.36, -0.34, 0.62, 0.36, shade(sc, -0.35))
          if (!r) D.box(g, 0.34, 0.08, -0.36, 0.48, 0.62, 0.36, shade(sc, -0.35))
          D.box(g, l ? -0.5 : -0.44, 0, -0.34, r ? 0.5 : 0.44, 0.08, 0.34, '#5e3a1d')
        } else {
          // 竖放：靠背朝最近的侧墙
          const s = x + 0.5 > W / 2 ? 1 : -1
          const zA = u ? -0.5 : -0.44, zB = d ? 0.5 : 0.44
          D.box(g, -s * 0.34, 0.08, zA, s * 0.3, 0.42, zB, sc)
          D.box(g, s * 0.14, 0.42, zA, s * 0.38, 0.9, zB, shade(sc, -0.25))
          D.box(g, -s * 0.3, 0.42, u ? -0.5 : -0.4, s * 0.14, 0.47, d ? 0.5 : 0.4, shade(sc, 0.15))
          if (!u) D.box(g, -0.36, 0.08, -0.48, 0.36, 0.62, -0.34, shade(sc, -0.35))
          if (!d) D.box(g, -0.36, 0.08, 0.34, 0.36, 0.62, 0.48, shade(sc, -0.35))
          D.box(g, -0.34, 0, zA, 0.34, 0.08, zB, '#5e3a1d')
        }
        const geo = g.build()
        geo.applyMatrix4(trs(cx, 0, cz, 1, 1, 1))
        solid.parts.push(geo)
        break
      }
      case 'A': { // 衣柜
        D.box(solid, x + 0.06, 0, y + 0.12, x + 0.94, 1.86, y + 0.74, '#8a5a2b')
        D.box(solid, x + 0.1, 0.1, y + 0.74, x + 0.49, 1.78, y + 0.76, '#a8703d')
        D.box(solid, x + 0.51, 0.1, y + 0.74, x + 0.9, 1.78, y + 0.76, '#a8703d')
        D.box(solid, x + 0.42, 0.86, y + 0.76, x + 0.46, 1.0, y + 0.8, '#ffc43d')
        D.box(solid, x + 0.54, 0.86, y + 0.76, x + 0.58, 1.0, y + 0.8, '#ffc43d')
        D.box(solid, x + 0.04, 1.84, y + 0.1, x + 0.96, 1.9, y + 0.76, '#5e3a1d')
        break
      }
      case 'E': { // 书桌 + 电脑
        D.box(solid, x + 0.04, 0.66, y + 0.14, x + 0.96, 0.74, y + 0.86, '#a8703d')
        D.box(solid, x + 0.08, 0, y + 0.18, x + 0.16, 0.66, y + 0.82, '#6b4424')
        D.box(solid, x + 0.84, 0, y + 0.18, x + 0.92, 0.66, y + 0.82, '#6b4424')
        D.box(solid, x + 0.2, 0.74, y + 0.3, x + 0.8, 1.2, y + 0.36, INK)
        D.box(solid, x + 0.46, 0.74, y + 0.36, x + 0.54, 0.8, y + 0.44, '#3b3552')
        D.box(solid, x + 0.28, 0.74, y + 0.56, x + 0.72, 0.76, y + 0.72, '#e9eef5')
        const scr = new Batch()
        D.quadZ(scr, x + 0.24, 0.78, x + 0.76, 1.16, y + 0.362, '#ffffff')
        const m = basicMat({ vertexColors: true, color: '#4fb6e8' })
        addMesh(scr.build(), m, { name: 'monitor' })
        anim.push((tt) => { m.color.set(Math.floor(tt * 0.7) % 2 ? '#5fd1a0' : '#4fb6e8') })
        break
      }
      case 'G': { // 壁炉：砖砌、黑色炉膛、跳动的火焰 + 暖光
        const brick = '#8f5b4a'
        D.box(solid, x + 0.02, 0, y, x + 0.98, 1.36, y + 0.25, brick)
        D.box(solid, x + 0.02, 0, y + 0.25, x + 0.22, 1.36, y + 0.6, brick)
        D.box(solid, x + 0.78, 0, y + 0.25, x + 0.98, 1.36, y + 0.6, brick)
        D.box(solid, x + 0.22, 0.72, y + 0.25, x + 0.78, 1.36, y + 0.6, brick)
        for (let k = 0; k < 4; k++) D.box(solid, x + 0.02, 0.28 + k * 0.28, y + 0.6, x + 0.98, 0.3 + k * 0.28, y + 0.605, '#6f4336')
        D.box(solid, x - 0.06, 1.36, y, x + 1.06, 1.44, y + 0.7, '#5e3a1d')
        D.quadZ(flat, x + 0.22, 0, x + 0.78, 0.72, y + 0.252, '#2a1a14')
        D.quadY(flat, x + 0.22, y + 0.25, x + 0.78, y + 0.6, 0.003, '#2a1a14')
        D.box(solid, x + 0.14, 0, y + 0.6, x + 0.86, 0.04, y + 0.78, '#5e3a1d')
        D.box(solid, x + 0.3, 0.0, y + 0.36, x + 0.7, 0.07, y + 0.48, '#6b4424')
        const fire = new THREE.Group()
        fire.position.set(cx, 0.05, y + 0.42)
        const cols = ['#ff8c42', '#ffd23f', '#ff6b3d']
        const flames = []
        for (let k = 0; k < 3; k++) {
          const m = new THREE.Mesh(new THREE.ConeGeometry(0.1 + (k === 1 ? 0.02 : 0), 0.34, 8).translate(0, 0.17, 0), basicMat({ vertexColors: false, color: cols[k] }))
          m.position.set((k - 1) * 0.1, 0, (k === 1 ? 0.04 : 0))
          fire.add(m)
          flames.push(m)
        }
        group.add(fire)
        const ph = x * 2.3
        anim.push((tt) => {
          for (let k = 0; k < flames.length; k++) {
            const f = flames[k]
            f.scale.set(1, 0.75 + 0.35 * Math.abs(Math.sin(tt * (7 + k * 1.7) + ph + k)), 1)
            f.rotation.z = Math.sin(tt * (5 + k) + k) * 0.12
          }
        })
        lights.push({ x: cx, y: 0.6, z: y + 1.0, color: '#ff9a4a', intensity: 3, distance: 5, flicker: true })
        break
      }
      case 'Q': { // 鱼缸
        D.box(solid, x + 0.06, 0, y + 0.2, x + 0.94, 0.5, y + 0.74, '#5e3a1d')
        D.box(solid, x + 0.08, 0.5, y + 0.22, x + 0.92, 0.56, y + 0.72, '#e0c479')
        // 顶框（四条细边）
        D.box(solid, x + 0.06, 1.12, y + 0.2, x + 0.94, 1.16, y + 0.25, '#57507a')
        D.box(solid, x + 0.06, 1.12, y + 0.69, x + 0.94, 1.16, y + 0.74, '#57507a')
        D.box(solid, x + 0.06, 1.12, y + 0.25, x + 0.11, 1.16, y + 0.69, '#57507a')
        D.box(solid, x + 0.89, 1.12, y + 0.25, x + 0.94, 1.16, y + 0.69, '#57507a')
        D.cyl(solid, x + 0.22, 0.56, y + 0.4, 0.03, 0.34, '#3f8f46')
        D.cyl(solid, x + 0.78, 0.56, y + 0.5, 0.03, 0.44, '#3f8f46')
        const glass = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.58, 0.52), uniqueToon('#6ec3ee', { transparent: true, opacity: 0.38 }))
        glass.position.set(cx, 0.84, y + 0.47)
        glass.renderOrder = 2
        glass.castShadow = false
        glass.receiveShadow = false
        group.add(glass)
        const fish = []
        for (const [col, sp, fy] of [['#ff8a3d', 0.9, 0.78], ['#ffd23f', 1.3, 0.95]]) {
          const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6).scale(1.6, 1, 0.7), toonMat(col))
          const tail = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.06, 4).rotateZ(Math.PI / 2).translate(-0.1, 0, 0), toonMat(col))
          f.add(tail)
          f.position.set(cx, fy, y + 0.47)
          group.add(f)
          fish.push({ f, sp, fy })
        }
        anim.push((tt) => {
          for (let k = 0; k < fish.length; k++) {
            const o = fish[k], s = Math.sin(tt * o.sp + k * 2)
            o.f.position.x = cx + s * 0.3
            o.f.position.y = o.fy + Math.sin(tt * 2.3 + k) * 0.03
            o.f.scale.x = Math.cos(tt * o.sp + k * 2) >= 0 ? 1 : -1
          }
        })
        break
      }
      case 'x': { // 出口地垫
        D.box(flat, x + 0.08, 0, y + 0.14, x + 0.92, 0.03, y + 0.9, '#6b4424')
        D.quadY(flat, x + 0.14, y + 0.2, x + 0.86, y + 0.84, 0.031, '#8a5a2b')
        for (let k = 0; k < 3; k++) D.quadY(flat, x + 0.2, y + 0.3 + k * 0.2, x + 0.8, y + 0.36 + k * 0.2, 0.032, '#b07a47')
        break
      }
    }
  }

  // ---------- 装饰 ----------
  for (const d of map.decor || []) {
    const cx = d.x + 0.5
    if (d.y === 1) wallDecor(d, cx)
    else tableDecor(d, cx, d.y + 0.5, TOP_H[t(d.x, d.y)] ?? 0)
  }

  function wallDecor(d, cx) {
    const z = wallZ
    switch (d.k) {
      case 'window': windowAt(d.x, false); break
      case 'curtain': windowAt(d.x, true); break
      case 'painting': case 'worldmap': {
        D.box(solid, cx - 0.36, 0.98, z, cx + 0.36, 1.56, z + 0.05, '#8a5a2b')
        if (d.k === 'painting') {
          D.quadZ(flat, cx - 0.3, 1.04, cx + 0.3, 1.5, z + 0.052, '#9fdcff')
          D.quadZ(flat, cx - 0.3, 1.04, cx + 0.3, 1.2, z + 0.054, '#6fb857')
          D.quadZ(flat, cx - 0.18, 1.18, cx + 0.08, 1.26, z + 0.056, '#4f9c42')
          D.cylAt(flat, cx + 0.18, 1.38, z + 0.056, 0.05, 0.004, '#ffd23f', Math.PI / 2)
        } else {
          D.quadZ(flat, cx - 0.3, 1.04, cx + 0.3, 1.5, z + 0.052, '#f0dcae')
          D.quadZ(flat, cx - 0.24, 1.26, cx - 0.02, 1.44, z + 0.054, '#8ccf6a')
          D.quadZ(flat, cx + 0.06, 1.14, cx + 0.24, 1.36, z + 0.054, '#8ccf6a')
          D.quadZ(flat, cx - 0.06, 1.08, cx + 0.12, 1.18, z + 0.054, '#4aa3de')
          D.quadZ(flat, cx - 0.16, 1.32, cx - 0.1, 1.38, z + 0.056, '#ef476f')
        }
        break
      }
      case 'clock': {
        D.cylAt(solid, cx, 1.34, z + 0.04, 0.26, 0.08, INK, Math.PI / 2)
        D.cylAt(flat, cx, 1.34, z + 0.082, 0.21, 0.004, '#ffffff', Math.PI / 2)
        const hands = []
        for (const [len, col, w] of [[0.13, INK, 0.028], [0.18, '#ef476f', 0.018]]) {
          const g = new THREE.BoxGeometry(w, len, 0.01).translate(0, len / 2, 0)
          const m = new THREE.Mesh(g, toonMat(col))
          m.position.set(cx, 1.34, z + 0.09)
          group.add(m)
          hands.push(m)
        }
        anim.push(() => {
          const now = new Date()
          const mins = now.getMinutes() + now.getSeconds() / 60
          hands[0].rotation.z = -((now.getHours() % 12) + mins / 60) / 12 * Math.PI * 2
          hands[1].rotation.z = -mins / 60 * Math.PI * 2
        })
        break
      }
      case 'poster': {
        D.box(solid, cx - 0.3, 0.96, z, cx + 0.3, 1.6, z + 0.02, '#ffffff')
        D.quadZ(flat, cx - 0.3, 1.48, cx + 0.3, 1.6, z + 0.022, '#ef476f')
        D.cylAt(flat, cx, 1.18, z + 0.022, 0.16, 0.003, '#ffc43d', Math.PI / 2)
        D.quadZ(flat, cx - 0.08, 1.2, cx - 0.04, 1.26, z + 0.025, INK)
        D.quadZ(flat, cx + 0.04, 1.2, cx + 0.08, 1.26, z + 0.025, INK)
        break
      }
      case 'calendar': {
        D.box(solid, cx - 0.24, 0.94, z, cx + 0.24, 1.56, z + 0.02, '#ffffff')
        D.quadZ(flat, cx - 0.24, 1.4, cx + 0.24, 1.56, z + 0.022, '#ef476f')
        for (let k = 0; k < 9; k++) D.quadZ(flat, cx - 0.16 + (k % 3) * 0.13, 1.28 - Math.floor(k / 3) * 0.1, cx - 0.1 + (k % 3) * 0.13, 1.32 - Math.floor(k / 3) * 0.1, z + 0.024, '#57507a')
        D.cylAt(solid, cx, 1.6, z + 0.03, 0.025, 0.03, '#57507a', Math.PI / 2)
        break
      }
      case 'certificate': {
        D.box(solid, cx - 0.32, 1.0, z, cx + 0.32, 1.54, z + 0.04, '#c9a24a')
        D.quadZ(flat, cx - 0.26, 1.06, cx + 0.26, 1.48, z + 0.042, '#fff6d6')
        D.quadZ(flat, cx - 0.18, 1.36, cx + 0.18, 1.39, z + 0.044, '#b8a58a')
        D.quadZ(flat, cx - 0.18, 1.26, cx + 0.12, 1.29, z + 0.044, '#b8a58a')
        D.cylAt(flat, cx + 0.14, 1.14, z + 0.045, 0.05, 0.003, '#ef476f', Math.PI / 2)
        break
      }
      case 'shelfWall': {
        D.box(solid, cx - 0.44, 1.06, z, cx + 0.44, 1.12, z + 0.28, '#8a5a2b')
        D.box(solid, cx - 0.4, 0.96, z, cx - 0.34, 1.06, z + 0.2, '#6b4424')
        D.box(solid, cx + 0.34, 0.96, z, cx + 0.4, 1.06, z + 0.2, '#6b4424')
        D.box(solid, cx - 0.36, 1.12, z + 0.06, cx - 0.18, 1.36, z + 0.22, '#ef476f')
        D.cyl(solid, cx - 0.02, 1.12, z + 0.14, 0.08, 0.16, '#ffffff')
        D.box(solid, cx + 0.12, 1.12, z + 0.08, cx + 0.2, 1.42, z + 0.2, '#1fb5a3')
        D.sph(solid, cx + 0.32, 1.19, z + 0.14, 0.07, 0.07, 0.07, '#ffc43d')
        break
      }
    }
  }

  function tableDecor(d, cx, cz, y) {
    switch (d.k) {
      case 'vase':
        D.cyl(solid, cx, y, cz, 0.08, 0.2, '#3a86ff')
        D.cyl(solid, cx, y + 0.2, cz, 0.05, 0.05, '#3a86ff')
        for (const [dx, dz, c] of [[-0.07, 0, '#ff6b8b'], [0.07, 0.02, '#ffd23f'], [0, -0.05, '#ffffff']]) {
          D.cyl(solid, cx + dx * 0.6, y + 0.24, cz + dz * 0.6, 0.008, 0.14, '#4f9c42')
          D.sph(solid, cx + dx, y + 0.4, cz + dz, 0.045, 0.045, 0.045, c)
        }
        break
      case 'teaset':
        D.sph(solid, cx - 0.06, y + 0.1, cz, 0.11, 0.09, 0.11, '#ffffff')
        D.cyl(solid, cx - 0.06, y + 0.18, cz, 0.05, 0.04, '#e05c6e')
        D.cylAt(solid, cx + 0.07, y + 0.12, cz, 0.018, 0.12, '#ffffff', 0, 0, -1.0)
        D.cyl(solid, cx + 0.2, y, cz + 0.12, 0.045, 0.06, '#ffffff')
        D.cyl(solid, cx - 0.22, y, cz + 0.14, 0.045, 0.06, '#ffffff')
        break
      case 'bread':
        D.box(solid, cx - 0.22, y, cz - 0.14, cx + 0.22, y + 0.03, cz + 0.14, '#a8703d')
        D.sph(solid, cx - 0.08, y + 0.07, cz, 0.13, 0.06, 0.08, '#e9a23b')
        D.sph(solid, cx + 0.1, y + 0.07, cz + 0.02, 0.1, 0.055, 0.07, '#d98f2b')
        break
      case 'books':
        D.box(solid, cx - 0.16, y, cz - 0.1, cx + 0.16, y + 0.05, cz + 0.12, '#3a86ff')
        D.box(solid, cx - 0.14, y + 0.05, cz - 0.08, cx + 0.14, y + 0.1, cz + 0.1, '#ef476f')
        D.box(solid, cx - 0.12, y + 0.1, cz - 0.1, cx + 0.12, y + 0.15, cz + 0.08, '#1fb5a3')
        break
      case 'trophy':
        D.box(solid, cx - 0.1, y, cz - 0.08, cx + 0.1, y + 0.06, cz + 0.08, '#8a5a2b')
        D.cyl(solid, cx, y + 0.06, cz, 0.025, 0.08, '#e0a82e')
        D.cone(solid, cx, y + 0.14, cz, 0.08, 0.14, '#ffc43d')
        for (const s of [-1, 1]) D.sph(solid, cx + s * 0.1, y + 0.22, cz, 0.03, 0.045, 0.02, '#ffc43d')
        break
      case 'register':
        D.box(solid, cx - 0.15, y, cz - 0.12, cx + 0.15, y + 0.16, cz + 0.12, '#57507a')
        D.box(solid, cx - 0.1, y + 0.16, cz - 0.1, cx + 0.1, y + 0.26, cz - 0.04, '#57507a')
        D.quadZ(lit, cx - 0.08, y + 0.18, cx + 0.08, y + 0.24, cz - 0.039, '#9fe8ff')
        D.quadY(solid, cx - 0.12, cz - 0.02, cx + 0.12, cz + 0.1, y + 0.161, '#c3ccd6')
        break
      case 'bell':
        D.cyl(solid, cx, y, cz, 0.08, 0.02, '#e0a82e')
        D.sph(solid, cx, y + 0.02, cz, 0.06, 0.07, 0.06, '#ffc43d')
        D.sph(solid, cx, y + 0.1, cz, 0.015, 0.015, 0.015, '#e0a82e')
        break
      case 'flowerpot':
        D.cone(solid, cx, y, cz, 0.07, 0.1, '#c96b3b')
        D.sph(solid, cx, y + 0.14, cz, 0.07, 0.05, 0.07, '#4f9c42')
        D.sph(solid, cx, y + 0.19, cz, 0.04, 0.03, 0.04, '#ff8fab')
        D.sph(solid, cx, y + 0.215, cz, 0.015, 0.012, 0.015, '#ffd23f')
        break
      case 'lamp':
        D.cyl(solid, cx, y, cz, 0.07, 0.02, '#5e3a1d')
        D.cyl(solid, cx, y + 0.02, cz, 0.015, 0.18, '#5e3a1d')
        D.cone(lit, cx, y + 0.18, cz, 0.1, 0.1, '#ffe7a8')
        break
    }
  }

  // ---------- 合批出网格 ----------
  const vc = toonMat(0xffffff, { vertexColors: true })
  addMesh(flat.build(), vc, { receive: true, name: 'room' })
  addMesh(solid.build(), vc, { cast: true, receive: true, outline: 0.016, name: 'furniture' })
  addMesh(lit.build(), basicMat(), { receive: false, name: 'glow' })
  for (const k in P) P[k].dispose()

  return {
    group,
    labelAnchors: [],
    lights,
    interior: true,
    update(tt) { for (let i = 0; i < anim.length; i++) anim[i](tt) },
    dispose() {
      disposeTree(group)
      group.removeFromParent()
      group.clear()
    },
  }
}

// 侧墙内侧的墙纸贴片（竖直、朝 ±X）
const _plane = new THREE.PlaneGeometry(1, 1)
function B_side(B, x, z0, z1, y0, y1, c, dir) {
  B.add(_plane, c, trs(x, (y0 + y1) / 2, (z0 + z1) / 2, z1 - z0, y1 - y0, 1, 0, dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0))
}
