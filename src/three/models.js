// 3D 模型：精灵 / 训练家 / 捕捉球。全部由基础几何体程序化拼装（卡通着色 + 描边），
// 造型逐项对照 2D 立绘 src/render/sprites.js（100 单位画布，x 向右、y 向下）。
// 每个 (物种, 闪光) 只构建一次模板：静态部件按枢轴合并成顶点色网格，之后的实例只做 clone，共享几何体与材质。
import * as THREE from 'three'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { SPECIES } from '../data/species.js'
import { SKIN, HAIR, SHIRT, PANTS, HATC } from '../render/sprites.js'
import { toonMat, addOutline, disposeTree, hueRotate, shade } from './materials.js'

const PI = Math.PI
const TAU = PI * 2
const INK = '#1c1a2e'
const WHITE = '#ffffff'
const OL_MON = 0.018
const OL_TRAINER = 0.014
const OL_BALL = 0.007
const V2 = THREE.Vector2
const V3 = THREE.Vector3
const AX_X = new V3(1, 0, 0)
const AX_Y = new V3(0, 1, 0)
const AX_Z = new V3(0, 0, 1)
const EMPTY = {}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const smooth = (k) => k * k * (3 - 2 * k)
const easeOut = (k) => 1 - (1 - k) * (1 - k) * (1 - k)

// —— 几何体小工具（模板构建期使用，允许分配） ——

function ell(a, b, c, ws = 18, hs = 12) {
  const g = new THREE.SphereGeometry(1, ws, hs)
  g.scale(a, b, c)
  return g
}

// 焊接接缝后重算法线：变形后的球 / 车削体不会出现接缝亮线
function smoothGeo(g) {
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  const m = mergeVertices(g)
  g.dispose()
  m.computeVertexNormals()
  return m
}

// 两端收尖的椭球（叶片、羽毛、鳍），长轴为 y
function pod(a, b, c, pinch = 0.85, ws = 14, hs = 10) {
  const g = new THREE.SphereGeometry(1, ws, hs)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    const k = 1 - pinch + pinch * Math.sqrt(Math.max(0, 1 - y * y))
    p.setXYZ(i, p.getX(i) * k * a, y * b, p.getZ(i) * k * c)
  }
  return smoothGeo(g)
}

// 水滴（火焰），原点在最胖处附近，尖端朝 +y
function drop(R, H, seg = 16) {
  const pts = []
  for (let i = 0; i <= 12; i++) {
    const u = i / 12
    pts.push(new V2(Math.max(0.001, R * Math.sin(PI * Math.pow(u, 0.62))), u * H - H * 0.35))
  }
  return smoothGeo(new THREE.LatheGeometry(pts, seg))
}

// 幽灵：上半球 + 向下收拢、尾尖向后卷的雾状下摆
function ghostGeo(r, rz) {
  const pts = [], L = 36
  for (let i = 12; i >= 1; i--) {
    const u = i / 12
    pts.push(new V2(Math.max(0.001, r * Math.pow(1 - Math.pow(u, 1.6), 1.15)), -u * L))
  }
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * (PI / 2)
    pts.push(new V2(Math.max(0.001, r * Math.cos(a)), r * Math.sin(a)))
  }
  const g = new THREE.LatheGeometry(pts, 28)
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i)
    let z = (p.getZ(i) * rz) / r
    if (y < 0) {
      const u = -y / L
      z -= 16 * u * u
      p.setY(i, y + 5 * u * u * u)
    }
    p.setZ(i, z)
  }
  return smoothGeo(g)
}

// 平面多边形挤出成薄片（闪电尾、鱼鳍、龙翼膜），厚度方向居中于 z = 0
function slab(pts, depth, bevel = 0.6) {
  const shape = new THREE.Shape(pts.map(([x, y]) => new V2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 4,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

// 圆弧线（嘴、闭眼）：弧线最低点位于原点，便于贴到表面上
function arcLine(R, tube, len = 0.6 * PI) {
  const g = new THREE.TorusGeometry(R, tube, 6, 18, len)
  g.rotateZ(-PI / 2 - len / 2)
  g.translate(0, R, 0)
  return g
}

function node(parent, name, p, r) {
  const g = new THREE.Group()
  if (name) g.name = name
  if (p) g.position.set(p[0], p[1], p[2])
  if (r) g.rotation.set(r[0], r[1], r[2], r[3] || 'XYZ')
  parent.add(g)
  return g
}

// o: { p: [x,y,z] | Vector3, r: [x,y,z,order?], q, mat, ol = true, noShadow }
// 传入 mat 的部件保留自己的材质（自发光 / 透明），其余合并为顶点色
function part(parent, geo, color, o = EMPTY) {
  const m = new THREE.Mesh(geo, o.mat || toonMat(color))
  if (o.p) Array.isArray(o.p) ? m.position.set(o.p[0], o.p[1], o.p[2]) : m.position.copy(o.p)
  if (o.q) m.quaternion.copy(o.q)
  else if (o.r) m.rotation.set(o.r[0], o.r[1], o.r[2], o.r[3] || 'XYZ')
  m.userData.ol = o.ol !== false
  if (o.mat) m.userData.keep = true
  if (o.noShadow) m.userData.noShadow = true
  parent.add(m)
  return m
}

// 两点之间的胶囊（骨、腿、触角）
function rod(parent, a, b, r, color, o = EMPTY) {
  const A = new V3(a[0], a[1], a[2]), Bp = new V3(b[0], b[1], b[2])
  const d = Bp.clone().sub(A), len = d.length()
  const q = new THREE.Quaternion().setFromUnitVectors(AX_Y, d.normalize())
  return part(parent, new THREE.CapsuleGeometry(r, len, 3, 8), color, { ...o, p: A.add(Bp).multiplyScalar(0.5), q })
}

// 椭球表面上的点：S = { c: 中心, r: 半径 }，(dx, dy) 为相对中心的偏移；返回位置、法线、使 +Z 朝外的旋转
function surf(S, dx, dy, back = false) {
  const [a, b, c] = S.r
  const k = Math.max(0.03, 1 - (dx / a) ** 2 - (dy / b) ** 2)
  const z = (back ? -c : c) * Math.sqrt(k)
  const n = new V3(dx / (a * a), dy / (b * b), z / (c * c)).normalize()
  return { p: new V3(S.c[0] + dx, S.c[1] + dy, S.c[2] + z), n, q: new THREE.Quaternion().setFromUnitVectors(AX_Z, n) }
}
const along = (s, d) => s.p.clone().addScaledVector(s.n, d)
const spin = (q, ax, ang) => q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(ax, ang))

// —— 合并：同一枢轴下的静态部件 → 顶点色网格（描边 / 不描边各一份），自有材质的按材质合并 ——

const _col = new THREE.Color()
function bake(m, vc) {
  let g = m.geometry.clone()
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
  g.morphAttributes = {}
  g.clearGroups()
  if (!g.index) {
    const i = mergeVertices(g)
    g.dispose()
    g = i
  }
  m.updateMatrix()
  g.applyMatrix4(m.matrix)
  if (vc) {
    const n = g.attributes.position.count, arr = new Float32Array(n * 3)
    _col.copy(m.material.color)
    for (let i = 0; i < n; i++) { arr[i * 3] = _col.r; arr[i * 3 + 1] = _col.g; arr[i * 3 + 2] = _col.b }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  }
  return g
}

function mergeTree(root) {
  const vcMat = toonMat(WHITE, { vertexColors: true })
  const groups = []
  root.traverse((o) => { if (!o.isMesh) groups.push(o) })
  for (const grp of groups) {
    const buckets = new Map()
    for (const c of grp.children) {
      if (!c.isMesh) continue
      const own = !!c.userData.keep
      const key = (own ? c.material.uuid : 'vc') + (c.userData.ol ? '|o' : '|n') + (c.userData.noShadow ? '|s' : '')
      let b = buckets.get(key)
      if (!b) buckets.set(key, (b = { own, ol: c.userData.ol, noShadow: !!c.userData.noShadow, mat: own ? c.material : vcMat, list: [] }))
      b.list.push(c)
    }
    for (const b of buckets.values()) {
      const geos = b.list.map((m) => bake(m, !b.own))
      const geo = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
      if (!geo) throw new Error('models: mergeGeometries failed')
      if (geos.length > 1) for (const x of geos) x.dispose()
      const m = new THREE.Mesh(geo, b.mat)
      m.userData.ol = b.ol
      if (b.noShadow) m.userData.noShadow = true
      for (const old of b.list) { grp.remove(old); old.geometry.dispose() }
      grp.add(m)
    }
  }
}

function finalize(root, thickness) {
  const meshes = []
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) meshes.push(o) })
  for (const m of meshes) {
    m.geometry.userData.shared = true
    m.castShadow = !m.userData.noShadow
    if (m.userData.ol) addOutline(m, thickness)
  }
}

// 从模板克隆一份实例（共享几何体）；flash 时每份实例拿私有材质副本
function instantiate(tpl, flash) {
  const inner = tpl.clone(true)
  const nodes = {}
  const mats = new Map(), flashList = []
  inner.traverse((o) => {
    if (o.name && !o.userData.isOutline) nodes[o.name] = o
    if (flash && o.isMesh && !o.userData.isOutline) {
      let m = mats.get(o.material)
      if (!m) {
        m = o.material.clone()
        m.userData.unique = true
        mats.set(o.material, m)
        flashList.push(m, m.emissive.clone())
      }
      o.material = m
    }
  })
  return { inner, nodes, flashList }
}

const _flash = new THREE.Color()
function flashFn(list) {
  if (!list.length) return () => {}
  return (amount = 0, color = 0xffffff) => {
    const k = clamp01(amount)
    _flash.set(color)
    for (let i = 0; i < list.length; i += 2) list[i].emissive.copy(list[i + 1]).lerp(_flash, k)
  }
}

// —— 精灵 ——
// 2D 布局换算到 3D（单位仍是立绘单位：X = x − 50，Y = 90 − y，Z 朝前），构建完成后统一归一到高度 1。
// body / head: [x, y, z, rx, ry, rz]；feet: [x, y, z]；belly: [x, y, 宽, 高]
const LAYOUT = {
  round: { body: [0, 30, 0, 28, 27, 25], faceY: 34, fw: 11, feet: [[-13, 4, 11], [13, 4, 11]], belly: [0, 21, 17, 14] },
  oval: { body: [0, 19, -7, 17, 14, 22], head: [0, 44, 7, 21, 19, 18], faceY: 42, fw: 10, feet: [[-10, 4, 7], [10, 4, 7], [-10, 4, -20], [10, 4, -20]], belly: [0, 17, 12, 9] },
  long: { body: [0, 20, -11, 15, 14, 28], head: [0, 46, 10, 19, 17, 16], faceY: 44, fw: 8, feet: [[-9, 4, 7], [9, 4, 7], [-9, 4, -28], [9, 4, -28]], belly: [0, 17, 11, 8] },
  wide: { body: [0, 26, 0, 33, 23, 26], faceY: 32, fw: 13, feet: [[-21, 4, 10], [21, 4, 10]], belly: [0, 18, 21, 13] },
  pear: { body: [0, 21, 0, 25, 21, 22], head: [0, 42, 3, 19, 18, 17], faceY: 38, fw: 9, feet: [[-12, 2, 8], [12, 2, 8]], belly: [0, 16, 15, 12] },
  tall: { body: [0, 24, 0, 17, 22, 15], head: [0, 54, 2, 17, 15, 15], faceY: 53, fw: 8, feet: [[-8, 2, 5], [8, 2, 5]], belly: [0, 22, 10, 14] },
  ghost: { body: [0, 43, 0, 25, 25, 23], faceY: 45, fw: 10, feet: [], ghost: true },
  fish: { body: [0, 34, 0, 17, 21, 30], faceY: 38, fw: 10, feet: [], belly: 'fish', fish: true },
  bird: { body: [0, 30, 0, 25, 25, 23], faceY: 39, fw: 10, feet: [[-8, 3, 8], [8, 3, 8]], belly: [0, 22, 15, 14], beak: true },
}

function makeEye(parent, S, dx, dy, s, L, c3, k) {
  const at = surf(S, dx, dy)
  const g = node(parent, s < 0 ? 'eyeL' : 'eyeR')
  g.position.copy(at.p)
  g.quaternion.copy(at.q)
  let a = 3.3 * k, b = 4.3 * k, c = a * 0.5, oy = 0
  const z0 = () => -c * 0.3
  const front = (x, y) => z0() + c * Math.sqrt(Math.max(0, 1 - (x / a) ** 2 - ((y - oy) / b) ** 2))
  const orb = () => part(g, ell(a, b, c, 16, 12), INK, { p: [0, oy, z0()], ol: false })
  const hl = (x, y, r) => part(g, ell(r, r, r * 0.6, 10, 8), WHITE, { p: [x, y, front(x, y) + r * 0.05], ol: false })
  switch (L.eyes) {
    case 'big':
      a = 4.6 * k; b = 5.6 * k; c = a * 0.5
      orb(); hl(-1.5 * k, 2 * k, 1.9 * k); hl(1.5 * k, -2.2 * k, 0.9 * k)
      break
    case 'sleepy':
      part(g, arcLine(3.8 * k, 0.85 * k, 0.7 * PI), INK, { p: [0, -1.6 * k, 0.5], ol: false })
      break
    case 'fierce':
      a = 3.4 * k; b = 3.9 * k; c = a * 0.5; oy = -1 * k
      orb(); hl(-1 * k, 0.2 * k, 1.2 * k)
      break
    case 'glow': {
      a = 4.6 * k; b = 5.8 * k; c = a * 0.55
      const pupil = L.c3 === '#ffe27a' ? '#5a3fc0' : c3
      part(g, ell(a, b, c, 18, 12), null, { mat: toonMat('#fff6cf', { emissive: '#8a8260' }), p: [0, 0, z0()], ol: false })
      const pa = 2.2 * k, pb = 3.2 * k
      part(g, ell(pa, pb, pa * 0.5, 14, 10), null, { mat: toonMat(pupil, { emissive: shade(pupil, -0.4) }), p: [0, -1 * k, front(0, -1 * k) - pa * 0.3], ol: false })
      hl(-1.6 * k, 2.4 * k, 1 * k)
      break
    }
    default:
      orb(); hl(-1 * k, 1.5 * k, 1.3 * k)
  }
  if (L.eyes === 'fierce') {
    const bs = surf(S, dx + s * 0.75 * k, dy + 5.4 * k)
    const bg = new THREE.CapsuleGeometry(1.25 * k, 8 * k, 3, 8)
    bg.rotateZ(PI / 2)
    part(parent, bg, INK, { p: along(bs, 0.7), q: spin(bs.q, AX_Z, s * 0.31), ol: false })
  }
  return g
}

function creatureTemplate(sp, shiny) {
  const L = (SPECIES[sp] || SPECIES.flamefox).look
  const hr = (c) => (shiny ? hueRotate(c, 150) : c)
  const c1 = hr(L.c1), c2 = hr(L.c2), c3 = hr(L.c3), d1 = shade(c1, -0.22)
  const has = (k) => !!L.extra?.includes(k)
  const B = LAYOUT[L.body] || LAYOUT.round
  const [bx, by, bz, brx, bry, brz] = B.body
  const two = !!B.head
  const [hx, hy, hz, hrx, hry, hrz] = B.head || B.body
  // tail: 摆尾时绕 (x, y, z) 轴的最大角度；ears: 耳朵摆动系数；wing / arm: 动画种类
  const info = { ghost: !!B.ghost, two, sleepy: L.eyes === 'sleepy', ears: 1, tail: [0, 0, 0], wing: '', arm: '', halfW: 0.4 }

  const root = new THREE.Group()
  root.name = 'norm'
  const body = node(root, 'body')
  const head = node(root, 'head', [hx, hy, hz])
  const BS = { c: [bx, by, bz], r: [brx, bry, brz] }
  const HS = { c: [0, 0, 0], r: [hrx, hry, hrz] }
  const faceDy = B.faceY - hy, fw = B.fw
  const EK = 1.15

  // —— 身体 ——
  if (B.ghost) {
    part(head, ghostGeo(brx, brz), c1)
    info.arm = 'ghost'
    for (const s of [-1, 1]) {
      const piv = node(root, s < 0 ? 'armL' : 'armR', [bx + s * (brx - 5), by - 6, bz + 3])
      part(piv, pod(4, 8.5, 4, 0.5), c1, { p: [s * 5, -2.5, 0], r: [0, 0, s * 1.15] })
    }
  } else if (two) {
    part(body, ell(brx, bry, brz, 28, 18), c1, { p: [bx, by, bz] })
    part(head, ell(hrx, hry, hrz, 30, 20), c1)
    if (Math.abs(hz - bz) > 5) part(body, ell(brx * 0.62, (hy - by) * 0.5, brx * 0.62, 16, 12), c1, { p: [0, (by + hy) / 2, (bz + brz * 0.5 + hz) / 2] })
  } else part(head, ell(brx, bry, brz, 32, 22), c1)

  if (B.belly === 'fish') part(body, ell(brx * 0.72, 9, brz * 0.8, 20, 12), c2, { p: [bx, by - bry + 8.2, bz + 3], ol: false })
  else if (B.belly) {
    const [x, y, a, b] = B.belly, c = Math.max(4, brz * 0.3)
    const s = surf(BS, x - bx, y - by)
    part(body, ell(a, b, c, 22, 14), c2, { p: [x, y, s.p.z + 0.8 - c], ol: false })
  }

  const clawGeo = new THREE.ConeGeometry(1.5, 4.5, 6).rotateX(PI / 2)
  for (const [x, y, z] of B.feet) {
    part(body, ell(7, 5, 8.5, 14, 10), d1, { p: [x, y, z] })
    if (has('claws')) for (const s of [-1, 1]) part(body, clawGeo, WHITE, { p: [x + s * 2.6, y - 1, z + 8], r: [0.35, 0, 0], ol: false })
  }

  // —— 脸 ——
  const eyeAt = []
  if (L.ears === 'frog') {
    for (const s of [-1, 1]) {
      const c = [s * hrx * 0.48, hry * 0.78, hrz * 0.3]
      part(head, ell(10, 9, 9, 18, 12), c1, { p: c })
      eyeAt.push([{ c, r: [10, 9, 9] }, 0, 1, s])
    }
  } else for (const s of [-1, 1]) eyeAt.push([HS, s * fw, faceDy, s])
  for (const [S, dx, dy, s] of eyeAt) makeEye(head, S, dx, dy, s, L, c3, EK)

  let mouth
  if (B.beak) {
    const s = surf(HS, 0, faceDy - 6)
    const g = new THREE.ConeGeometry(4.8, 10, 14)
    g.rotateX(PI / 2)
    g.scale(1, 0.75, 1)
    g.translate(0, 0, 3)
    part(head, g, c3, { p: along(s, -1.5), q: spin(s.q, AX_X, 0.2) })
    mouth = along(s, 8)
  } else {
    if (L.ears === 'frog') {
      const s = surf(HS, 0, faceDy - 9)
      part(head, arcLine(8, 0.8), INK, { p: along(s, 0.5), q: s.q, ol: false })
      mouth = s.p
    } else if (L.eyes === 'fierce') {
      const s = surf(HS, 0, faceDy - 8)
      const g = new THREE.CapsuleGeometry(0.75, 6, 3, 6)
      g.rotateZ(PI / 2)
      part(head, g, INK, { p: along(s, 0.4), q: s.q, ol: false })
      mouth = s.p
    } else {
      const s = surf(HS, 0, faceDy - (has('nose') ? 11 : 8))
      part(head, arcLine(3, 0.7), INK, { p: along(s, 0.45), q: s.q, ol: false })
      mouth = s.p
    }
    if (L.eyes === 'fierce') {
      const s = surf(HS, 2, faceDy - 9.6)
      const g = new THREE.ConeGeometry(1.3, 3.6, 6)
      g.rotateX(PI)
      part(head, g, WHITE, { p: along(s, 0.6), q: s.q, ol: false })
    }
  }
  node(head, 'mouth', [mouth.x, mouth.y, mouth.z])

  if (has('cheeks')) {
    const cheek = L.cheek ? hr(L.cheek) : '#ff9aa2'
    for (const s of [-1, 1]) {
      const at = surf(HS, s * fw * 1.55, faceDy - 7)
      part(head, ell(4.6, 3.4, 1.4, 14, 10), cheek, { p: along(at, -0.2), q: at.q, ol: false })
    }
  }
  if (has('nose')) {
    const s = surf(HS, 0, faceDy - 5)
    part(head, ell(4.5, 3.3, 3.2, 14, 10), c3, { p: along(s, -0.6), q: s.q })
  }
  if (has('tongue')) {
    const s = surf(HS, 2, faceDy - 11)
    part(head, ell(3.5, 4.5, 2, 12, 10), c3, { p: along(s, 0.2), q: spin(s.q, AX_X, -0.35), ol: false })
  }
  if (has('bubble')) {
    const s = surf(HS, fw * 2.1, faceDy - 12)
    const grp = node(head, 'bubbles', along(s, 5).toArray())
    const glass = toonMat('#bfe8ff', { transparent: true, opacity: 0.6 })
    part(grp, ell(5, 5, 5, 16, 12), null, { mat: glass, noShadow: true, ol: false })
    part(grp, ell(1.6, 1.6, 1, 8, 6), WHITE, { p: [-1.7, 1.8, 4.3], ol: false, noShadow: true })
    part(grp, ell(3, 3, 3, 12, 10), null, { mat: glass, p: [fw * 0.6, 9, -1], noShadow: true, ol: false })
    part(grp, ell(1, 1, 0.7, 8, 6), WHITE, { p: [fw * 0.6 - 1, 10.2, 1.6], ol: false, noShadow: true })
  }

  // —— 头部装饰 ——
  const earPiv = (s, p) => node(head, s < 0 ? 'earL' : 'earR', p)
  const aimGroup = (parent, from, to) => {
    const d = to.clone().sub(from), len = d.length()
    const o = node(parent)
    o.quaternion.setFromUnitVectors(AX_Y, d.normalize())
    return [o, len]
  }
  switch (L.ears) {
    case 'fox': case 'cat': case 'pointy': {
      const tipK = { fox: 1.6, cat: 1.35, pointy: 1.9 }[L.ears]
      const w = Math.hypot(hrx * 0.73, hry * 0.5)
      const inner = L.ears === 'fox' ? c2 : L.ears === 'cat' ? c3 : null
      for (const s of [-1, 1]) {
        const base = new V3(s * hrx * 0.6, hry * 0.52, -hrz * 0.12)
        const tip = new V3(s * hrx * 0.84, hry * tipK, -hrz * 0.22)
        const [o, len] = aimGroup(earPiv(s, base.toArray()), base.clone().sub(base), tip.clone().sub(base))
        const r = w * 0.48
        const g = new THREE.ConeGeometry(r, len * 1.3, 18, 1)
        g.translate(0, len * 0.35, 0)
        g.scale(1, 1, 0.5)
        part(o, g, c1)
        if (inner) {
          const gi = new THREE.ConeGeometry(r * 0.55, len * 0.8, 14, 1)
          gi.translate(0, len * 0.38, 0)
          gi.scale(1, 1, 0.3)
          part(o, gi, inner, { p: [0, 0, r * 0.2], ol: false })
        }
        if (L.ears === 'pointy') {
          const gt = new THREE.ConeGeometry(r * 0.5, len * 0.5, 18, 1)
          gt.translate(0, len * 0.75, 0)
          gt.scale(1.04, 1, 0.54)
          part(o, gt, c3)
        }
      }
      break
    }
    case 'bunny':
      for (const s of [-1, 1]) {
        const o = node(earPiv(s, [s * hrx * 0.4, hry * 0.78, -hrz * 0.1]), '', null, [0, 0, -s * 0.22])
        part(o, ell(6.5, 17, 5, 16, 14), c1, { p: [0, 13, 0] })
        part(o, ell(3, 12, 1.6, 12, 10), c3, { p: [0, 13.5, 4], ol: false })
      }
      break
    case 'round':
      for (const s of [-1, 1]) {
        const o = node(earPiv(s, [s * hrx * 0.7, hry * 0.76, -hrz * 0.08]), '', null, [0, s * 0.3, -s * 0.35])
        part(o, ell(7.5, 7.5, 4.5, 16, 12), c1)
        part(o, ell(4, 4, 1.5, 12, 8), c3, { p: [0, 0, 3.7], ol: false })
      }
      break
    case 'antenna':
      for (const s of [-1, 1]) {
        const base = new V3(s * 6, hry - 4, 0), tip = new V3(s * 13, hry + 13, -3)
        const [o, len] = aimGroup(earPiv(s, base.toArray()), new V3(), tip.clone().sub(base))
        part(o, new THREE.CylinderGeometry(1.1, 1.4, len, 6).translate(0, len / 2, 0), d1, { ol: false })
        part(o, ell(4.2, 4.2, 4.2, 14, 10), c3, { p: [0, len + 1.5, 0] })
      }
      break
    case 'horns':
      info.ears = 0
      for (const s of [-1, 1]) {
        const base = new V3(s * 8, hry - 6, -2), tip = new V3(s * 18, hry + 16, -5)
        const [o, len] = aimGroup(earPiv(s, base.toArray()), new V3(), tip.clone().sub(base))
        part(o, new THREE.ConeGeometry(4.4, len * 1.25, 14, 1).translate(0, len * 0.375, 0), c3)
      }
      break
    case 'leaf': {
      info.ears = 0.6
      const piv = node(head, 'earL', [0, hry - 3, 0])
      part(piv, new THREE.CylinderGeometry(1.3, 1.6, 11, 6).translate(0, 5.5, 0), c3, { ol: false })
      const leaf = () => pod(1.8, 8, 4.5, 0.9).rotateZ(PI / 2)
      part(piv, leaf(), c3, { p: [-7, 11, 0], r: [0, 0, 0.5] })
      part(piv, leaf(), shade(c3, 0.2), { p: [7, 12, 0], r: [0, 0, -0.5] })
      break
    }
    case 'bush': {
      info.ears = 0.3
      const piv = node(head, 'earL', [0, hry - 4, -2])
      part(piv, ell(8, 7, 7.5), c3, { p: [-11, 1, 0] })
      part(piv, ell(8, 7, 7.5), c3, { p: [11, 1, 0] })
      part(piv, ell(10, 8, 9), shade(c3, 0.15), { p: [0, 7, 0] })
      part(piv, ell(8, 7, 7), shade(c3, -0.08), { p: [0, 3, -9] })
      break
    }
    case 'tuft': {
      info.ears = 0.7
      const piv = node(head, 'earL', [0, hry - 2, -1])
      part(piv, pod(3, 8, 3), d1, { p: [-5, 5, 0], r: [0, 0, 0.4] })
      part(piv, pod(3, 9, 3), d1, { p: [1, 7, -1] })
      part(piv, pod(3, 8, 3), d1, { p: [7, 5, 0], r: [0, 0, -0.4] })
      break
    }
  }
  if (L.ears === 'fin' || has('crest')) {
    // 形状在 (后移量, 高度) 平面内画，再转到头顶的 YZ 平面
    const g = slab([[-7, -6], [2, 15], [14, 6], [10, -6]], 2.2, 0.7)
    g.rotateY(PI / 2)
    part(head, g, c3, { p: [0, hry, -2] })
  }
  if (has('crystal')) {
    const ice = toonMat(c3, { emissive: shade(c3, -0.55) })
    const oct = (a, b) => new THREE.OctahedronGeometry(1, 0).scale(a, b, a)
    part(head, oct(4.5, 8), null, { mat: ice, p: [0, hry + 2, -1] })
    part(head, oct(2.6, 5), null, { mat: ice, p: [-5.5, hry - 1, -2], r: [0, 0, 0.5] })
    part(head, oct(2.6, 5), null, { mat: ice, p: [5.5, hry - 1, -2], r: [0, 0, -0.5] })
  }
  if (has('cap')) {
    const R = hrx * 1.7, Hc = hry * 1.05, y0 = hry - 12, zc = -1
    const pts = [new V2(R * 0.82, -2.4), new V2(R * 0.97, -1.6)]
    for (let i = 0; i <= 14; i++) {
      const a = (i / 14) * (PI / 2)
      pts.push(new V2(Math.max(0.001, R * Math.cos(a)), Hc * Math.sin(a)))
    }
    const dome = smoothGeo(new THREE.LatheGeometry(pts, 32))
    dome.scale(1, 1, 0.94)
    part(head, dome, c3, { p: [0, y0, zc] })
    part(head, new THREE.CylinderGeometry(R * 0.84, R * 0.3, 4, 28, 1, true).scale(1, 1, 0.94), shade(c2, -0.06), { p: [0, y0 - 4.2, zc], ol: false })
    const CS = { c: [0, y0, zc], r: [R, Hc, R * 0.94] }
    const spots = [[-12, 10, 0, 4], [9, 13, 0, 5], [20, 4, 0, 3], [-22, 3, 0, 2.5], [0, 18.5, 0, 3.5], [12, 9, 1, 4.5], [-10, 13, 1, 4], [-20, 5, 1, 3], [22, 6, 1, 3]]
    for (const [dx, dy, back, r] of spots) {
      const s = surf(CS, dx * (R / 32), dy * (Hc / 19), !!back)
      part(head, ell(r * 1.1, r, 1.2, 12, 8), WHITE, { p: along(s, 0.2), q: s.q, ol: false })
    }
  }
  if (has('mane')) {
    for (let i = 0; i < 10; i++) {
      const phi = (i / 10) * TAU
      const back = (1 - Math.cos(phi)) / 2
      part(head, ell(8, 6.5, 6, 14, 10), c3, {
        p: [Math.sin(phi) * hrx * 0.86, -hry * 1.05 + hry * 0.3 * back, Math.cos(phi) * hrz * 0.72],
        r: [0, phi, 0],
      })
    }
    for (const s of [-1, 1]) part(head, ell(7, 6, 6, 14, 10), c3, { p: [s * hrx, -3, -2], r: [0, 0, -s * 0.4] })
  }

  // —— 背部 / 附加 ——
  if (has('shell')) {
    const c = [bx, by + 2, bz - brz * 0.15], R = [brx * 1.05, bry * 0.97, brz]
    const dome = new THREE.SphereGeometry(1, 30, 14, 0, TAU, 0, PI / 2)
    dome.rotateX(-PI / 2)
    dome.scale(R[0], R[1], R[2])
    part(body, dome, c3, { p: c })
    part(body, new THREE.TorusGeometry(1, 0.055, 6, 40).scale(R[0], R[1], 26), shade(c3, -0.25), { p: c })
    const plate = shade(c3, 0.18), mn = Math.min(R[0], R[1])
    const hex = (th, ph, r) => {
      const d = new V3(Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph), -Math.cos(th))
      const n = new V3(d.x / R[0], d.y / R[1], d.z / R[2]).normalize()
      const p = new V3(c[0] + R[0] * d.x, c[1] + R[1] * d.y, c[2] + R[2] * d.z).addScaledVector(n, 0.2)
      part(body, new THREE.CylinderGeometry(r, r, 2.4, 6), plate, { p, q: new THREE.Quaternion().setFromUnitVectors(AX_Y, n) })
    }
    hex(0, 0, mn * 0.3)
    for (let i = 0; i < 6; i++) hex(0.95, (i * PI) / 3 + PI / 6, mn * 0.2)
  }
  if (has('beetle')) {
    const c = [bx, by + 3, bz - brz * 0.12], R = [brx * 1.03, bry * 0.93, brz * 0.98]
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(1, 16, 14, s > 0 ? PI / 2 : -PI / 2, PI, 0, PI / 2)
      g.rotateX(-PI / 2)
      g.scale(R[0], R[1], R[2])
      part(body, g, c3, { p: [c[0] + s * 0.9, c[1], c[2]], r: [0, s * 0.05, 0] })
    }
    for (const k of [-1, 0, 1]) for (const s of [-1, 1]) {
      rod(body, [s * brx * 0.72, by - 11, bz + k * 8], [s * (brx + 4), by - 21, bz + k * 11], 1.3, INK, { ol: false })
    }
  }
  if (has('rocky')) {
    const spots = [[-12, 10, 0, 5], [14, -6, 0, 6], [-4, -15, 0, 4], [15, 10, 1, 6], [-16, -2, 1, 5], [4, 20, 1, 5], [-19, 13, 0, 3.5]]
    for (const [dx, dy, back, r] of spots) {
      const s = surf(BS, dx, dy, !!back)
      part(body, new THREE.DodecahedronGeometry(1, 0).scale(r, r * 0.8, r * 0.6), c3, { p: along(s, -r * 0.1), q: spin(s.q, AX_Z, dx * 0.1) })
    }
  }
  if (has('arms')) {
    info.arm = 'rock'
    for (const s of [-1, 1]) {
      const piv = node(root, s < 0 ? 'armL' : 'armR', [bx + s * (brx - 3), by + 2, bz + 3])
      part(piv, new THREE.DodecahedronGeometry(1, 1).scale(9, 8, 8.5), shade(c1, -0.15), { p: [s * 6, -7, 0] })
    }
  }
  if (has('stripes')) {
    for (const k of [-1, 0, 1]) {
      if (B.fish) {
        const z = k * 11, sc = Math.sqrt(1 - (z / brz) ** 2)
        part(body, ell(brx * sc + 1.2, bry * sc + 1.2, 7, 26, 12), c3, { p: [bx, by, bz + z], ol: false })
      } else {
        const s = surf(BS, k * 11, 0)
        part(body, ell(3.2, bry * 0.85, 2, 10, 14), c3, { p: along(s, -0.8), q: s.q, ol: false })
      }
    }
  }
  if (B.fish) {
    info.wing = 'fin'
    for (const s of [-1, 1]) {
      const piv = node(root, s < 0 ? 'wingL' : 'wingR', [bx + s * brx * 0.85, by - 6, bz + 6])
      part(piv, pod(1.4, 6.5, 4.2, 0.6), c3, { p: [s * 4, -3, -1], r: [0, 0, s * 1.1] })
    }
  }
  if (has('wings')) {
    info.wing = 'bird'
    for (const s of [-1, 1]) {
      const o = node(node(root, s < 0 ? 'wingL' : 'wingR', [bx + s * brx * 0.78, by + 9, bz - 2]), '', null, [0, 0, s * 0.45])
      part(o, pod(4, 15, 9.5, 0.5), d1, { p: [0, -11, 0] })
    }
  }
  if (has('moth')) {
    info.wing = 'moth'
    const dk = shade(c1, -0.15)
    for (const s of [-1, 1]) {
      const o = node(node(root, s < 0 ? 'wingL' : 'wingR', [bx + s * 4, by + 4, bz - brz * 0.55]), '', null, [0, s * 0.08, 0])
      part(o, ell(23, 17, 1.4, 26, 14), c2, { p: [s * 21, 12, 0], r: [0, 0, -s * 0.5] })
      part(o, ell(15, 11, 1.4, 20, 12), c2, { p: [s * 15, -12, -1.2], r: [0, 0, s * 0.4] })
      for (const z of [1, -1]) {
        part(o, ell(19, 13, 1.1, 22, 12), c1, { p: [s * 21, 12, z * 0.8], r: [0, 0, -s * 0.5], ol: false })
        part(o, ell(11, 8, 1.1, 18, 10), dk, { p: [s * 15, -12, -1.2 + z * 0.8], r: [0, 0, s * 0.4], ol: false })
        part(o, ell(5.5, 5.5, 1, 14, 8), c3, { p: [s * 25, 14, z * 1.6], ol: false })
      }
    }
  }
  if (has('dragonwings')) {
    info.wing = 'dragon'
    for (const s of [-1, 1]) {
      const o = node(node(root, s < 0 ? 'wingL' : 'wingR', [bx + s * 6, by + 12, bz - brz * 0.55]), '', null, [0, s * 0.45, 0])
      part(o, slab([[0, 0], [36, 24], [30, 0], [38, -12], [6, -18]].map(([x, y]) => [s * x, y]), 1.2, 0.5), d1)
      rod(o, [0, 0, 1], [s * 36, 24, 1], 1.8, c1)
      rod(o, [s * 4, -1, 0.8], [s * 30, 0, 0.8], 1, c1, { ol: false })
      rod(o, [s * 4, -2, 0.8], [s * 38, -12, 0.8], 1, c1, { ol: false })
      const cl = new THREE.ConeGeometry(1.8, 5, 8)
      part(o, cl, c3, { p: [s * 37.5, 27, 1], r: [0, 0, -s * 0.6] })
    }
  }

  // —— 尾巴 ——
  const tr = [bx + brx * 0.35, by - bry * 0.1, bz - brz * 0.82]
  switch (L.tail) {
    case 'flame': {
      info.tail = [0.08, 0.3, 0.3]
      const o = node(node(root, 'tail', tr), '', null, [0, 0.55, 0])
      part(o, pod(6.5, 13, 6, 0.3), c1, { p: [4, 8, 0], r: [0, 0, -0.35] })
      const f = node(o, 'flame', [8.5, 17, 0])
      part(f, drop(10, 30), null, { mat: toonMat(c3, { emissive: shade(c3, -0.45) }), p: [1.5, 9, 0], r: [0, 0, -0.25] })
      const core = toonMat('#fff6c9', { emissive: '#ffe98a' })
      for (const z of [4.6, -4.6]) part(f, drop(4.6, 14), null, { mat: core, p: [3.4, 16, z], r: [0, 0, -0.25], ol: false })
      break
    }
    case 'bolt': {
      info.tail = [0, 0.3, 0.3]
      const o = node(node(root, 'tail', tr), '', null, [0, 0.45, 0])
      part(o, slab([[-2, -2], [14, 10], [8, 14], [22, 32], [19, 16], [26, 14], [6, -6]], 3.2, 0.7), c3, { p: [0, -2, 0] })
      break
    }
    case 'puff':
      info.tail = [0, 0.3, 0.3]
      part(node(root, 'tail', [bx, by - bry * 0.3, bz - brz * 0.93]), ell(8, 8, 8, 16, 12), c2)
      break
    case 'curl': {
      info.tail = [0, 0.3, 0.3]
      const o = node(node(root, 'tail', tr), '', null, [0, 0.7, 0])
      const g = new THREE.TorusGeometry(10, 3, 8, 30, 1.3 * PI)
      g.rotateZ(0.2 * PI)
      part(o, g, c1, { p: [6, 10, 0] })
      part(o, ell(3.6, 3.6, 3.6, 12, 10), c3, { p: [6 + 10 * Math.cos(0.2 * PI), 10 + 10 * Math.sin(0.2 * PI), 0] })
      break
    }
    case 'feather': {
      info.tail = [0.25, 0.35, 0]
      const t = node(root, 'tail', [bx, by - 2, bz - brz * 0.85])
      for (const k of [-1, 0, 1]) {
        const m = part(t, pod(5.5, 13, 2, 0.8), k ? d1 : c1, { r: [-0.8, k * 0.5, 0, 'YXZ'] })
        m.position.set(0, 11, 0).applyEuler(m.rotation)
      }
      break
    }
    case 'fish': {
      info.tail = [0, 0.45, 0]
      const g = slab([[-5, 4], [18, 20], [13, 0], [18, -18], [-5, -5]], 2.4, 0.7)
      g.rotateY(PI / 2)
      part(node(root, 'tail', [bx, by + 1, bz - brz + 4]), g, c3)
      break
    }
  }

  // —— 合并、归一化（高度 1，脚底 y = 0，身体居中），再加描边 ——
  mergeTree(root)
  root.updateMatrixWorld(true)
  const bub = root.getObjectByName('bubbles'), bubParent = bub?.parent
  if (bub) bubParent.remove(bub)
  const full = new THREE.Box3().setFromObject(root, true)
  const core = new THREE.Box3().setFromObject(body, true).union(new THREE.Box3().setFromObject(head, true))
  if (bub) bubParent.add(bub)
  const s = 1 / (full.max.y - full.min.y)
  const cx = (core.min.x + core.max.x) / 2, cz = (core.min.z + core.max.z) / 2
  const geos = new Set()
  root.traverse((o) => {
    if (o === root) return
    o.position.multiplyScalar(s)
    if (o.isMesh) geos.add(o.geometry)
  })
  for (const g of geos) g.scale(s, s, s)
  root.position.set(-cx * s, -full.min.y * s, -cz * s)
  finalize(root, OL_MON)
  info.halfW = ((core.max.x - core.min.x) / 2) * s
  const radius = Math.max(core.max.x - core.min.x, core.max.z - core.min.z) * 0.5 * s
  return { root, info, radius }
}

function creatureAnimator(motion, n, info, ph) {
  const { head, eyeL, eyeR, earL, earR, tail, flame, wingL, wingR, armL, armR, bubbles } = n
  const bubY = bubbles ? bubbles.position.y : 0
  const blinkP = 2.6 + ph * 2.2, blinkO = ph * 11.3
  const [tX, tY, tZ] = info.tail
  const earK = info.ears, wing = info.wing, arm = info.arm
  return function animate(t = 0, st = EMPTY) {
    st = st || EMPTY
    const act = st.action || 'idle'
    const a = st.actionT == null ? 0 : clamp01(st.actionT)
    const speed = st.moving ? (st.speed == null ? 0.5 : clamp01(st.speed)) : 0
    let px = 0, py = 0, pz = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1
    let calm = 1, open = 1, earX = 0, earZ = 0.05 * Math.sin(t * 2.1 + ph * 9)
    let wagAmp = 0.6, wagF = 3.1, boost = 0, fire = 0, armSw = 0, armUp = 0, flapF = 1
    let headX = 0.035 * Math.sin(t * 1.3 + ph * 5), headZ = 0.05 * Math.sin(t * 0.85 + ph * 3)
    const bt = (t + blinkO) % blinkP
    if (bt < 0.16) open = Math.abs(Math.cos((bt / 0.16) * PI))
    const et = (t + ph * 17) % 4.1
    if (et < 0.32) earZ += 0.22 * Math.sin((et / 0.32) * TAU)

    if (speed > 0) {
      const f = t * (8 + 7 * speed) + ph * 3
      const s1 = Math.sin(f), h = Math.abs(s1)
      if (info.ghost) { rx += 0.1 + 0.08 * speed; py += 0.02 * h }
      else {
        py += h * (0.045 + 0.07 * speed)
        const land = 1 - h, q = land * land * land * (0.07 + 0.05 * speed)
        sy -= q; sx += q * 0.7; sz += q * 0.7
        rx += 0.06 + 0.06 * speed
        rz += 0.06 * s1
      }
      wagAmp = 1; wagF = 9 + 4 * speed; armSw = 0.5 * s1; flapF = 2 + 2 * speed
      headX -= 0.04 * speed
    }

    switch (act) {
      case 'attack': {
        let fw, lean
        if (a < 0.28) { const k = smooth(a / 0.28); fw = -0.09 * k; lean = -0.2 * k }
        else if (a < 0.46) { const k = easeOut((a - 0.28) / 0.18); fw = -0.09 + 0.47 * k; lean = -0.2 + 0.52 * k }
        else { const k = smooth((a - 0.46) / 0.54); fw = 0.38 * (1 - k); lean = 0.32 * (1 - k) }
        const strike = fw > 0 ? fw / 0.38 : 0, crouch = fw < 0 ? -fw / 0.09 : 0
        pz += fw; rx += lean; py += strike * 0.06
        sz += strike * 0.12; sy -= strike * 0.05 + crouch * 0.05; sx += crouch * 0.03
        earX -= 0.45 * strike + 0.2 * crouch
        boost = strike; fire = 0.4 * strike; armUp = 1.3 * strike; wagAmp = 1.2; wagF = 8
        headX += lean * 0.3
        break
      }
      case 'hurt': {
        const k = a < 0.18 ? easeOut(a / 0.18) : 1 - smooth((a - 0.18) / 0.82)
        pz -= 0.2 * k; rx -= 0.32 * k; px += Math.sin(a * 55) * 0.045 * (1 - a)
        sy -= 0.07 * k; sx += 0.05 * k; sz += 0.05 * k
        open = Math.min(open, 1 - 0.88 * k)
        earX -= 0.5 * k; wagAmp = 0.2; headX -= 0.2 * k; armUp = -0.4 * k
        break
      }
      case 'happy': {
        const u = (a - 0.14) / 0.72
        const h = u > 0 && u < 1 ? 4 * u * (1 - u) : 0
        const e = a < 0.14 ? Math.sin((a / 0.14) * PI) : a > 0.86 ? Math.sin(((a - 0.86) / 0.14) * PI) : 0
        py += 0.3 * h
        sy += 0.1 * h - 0.14 * e; sx += 0.08 * e - 0.04 * h; sz += 0.08 * e - 0.04 * h
        earZ += 0.3 * h; wagAmp = 1.6; wagF = 12; boost = h; fire = 0.25 * h; armUp = 0.6 * h
        open = Math.min(open, 1 - 0.6 * h)
        break
      }
      case 'faint': {
        const e = a < 0.55 ? (a / 0.55) ** 2 : 1 + 0.08 * Math.sin(((a - 0.55) / 0.45) * TAU) * (1 - (a - 0.55) / 0.45)
        const ec = Math.min(1, e), ang = 1.4 * e
        rz += ang
        sx *= 1 - 0.2 * ec
        py += info.halfW * (1 - 0.2 * ec) * Math.sin(Math.min(ang, PI / 2))
        calm = 1 - ec
        open = Math.min(open, 1 - 0.92 * Math.min(1, a * 2.5))
        earX -= 0.6 * ec; wagAmp *= 1 - ec; fire = -0.5 * ec; flapF *= 1 - ec; armSw *= 1 - ec
        headX *= 1 - ec; headZ *= 1 - ec
        break
      }
    }

    const br = Math.sin(t * 2.3 + ph * 20) * calm
    sy += 0.028 * br; sx -= 0.014 * br; sz -= 0.014 * br
    if (info.ghost) py += (0.07 + 0.035 * Math.sin(t * 1.7 + ph * 5)) * calm
    motion.position.set(px, py, pz)
    motion.rotation.set(rx, 0, rz)
    motion.scale.set(sx, sy, sz)

    if (!info.sleepy) {
      const e = Math.max(0.08, open)
      if (eyeL) eyeL.scale.y = e
      if (eyeR) eyeR.scale.y = e
    }
    if (earL) earL.rotation.set(earX * earK, 0, earZ * earK)
    if (earR) earR.rotation.set(earX * earK, 0, -earZ * earK)
    if (info.two && head) head.rotation.set(headX, 0, headZ)
    if (tail) {
      const w = wagAmp * Math.sin(t * wagF + ph * 7)
      tail.rotation.set(tX * w, tY * w, tZ * w)
    }
    if (flame) {
      const fl = 0.06 * Math.sin(t * 13 + ph * 9)
      flame.scale.set(1 + fl + fire * 0.3, 1 + 0.1 * Math.sin(t * 9.7 + ph * 4) + fire, 1 + fl + fire * 0.3)
    }
    if (bubbles) {
      bubbles.position.y = bubY + 0.025 * Math.sin(t * 2.2 + ph * 6)
      bubbles.scale.setScalar(1 + 0.05 * Math.sin(t * 3.1 + ph))
    }
    if (wingL && wing) {
      let w
      if (wing === 'bird') {
        const ft = (t + ph * 5) % 3.9
        w = speed > 0 ? 0.3 + 0.5 * Math.abs(Math.sin(t * 16)) : ft < 0.7 ? 0.45 * Math.abs(Math.sin((ft / 0.7) * PI * 3)) : 0.05
        w = Math.max(w * Math.min(1, flapF), boost * (0.5 + 0.9 * Math.abs(Math.sin(t * 20))))
        wingL.rotation.set(0, 0, -w)
        wingR.rotation.set(0, 0, w)
      } else {
        const moth = wing === 'moth'
        const osc = 0.5 + 0.5 * Math.sin(t * (moth ? 3.2 : 2.2) * Math.max(1, flapF) + ph * 6)
        if (wing === 'fin') w = 0.3 * Math.sin(t * 6 * Math.max(1, flapF) + ph * 3)
        else w = ((moth ? 0.04 : 0.05) + (moth ? 0.36 : 0.3) * osc) * (1 - boost * 0.7) * (flapF > 0 ? 1 : 0.4)
        wingL.rotation.set(0, -w, wing === 'dragon' ? -0.12 * osc : 0)
        wingR.rotation.set(0, w, wing === 'dragon' ? 0.12 * osc : 0)
      }
    }
    if (armL && arm) {
      if (arm === 'rock') {
        armL.rotation.set(armSw - armUp, 0, 0)
        armR.rotation.set(-armSw - armUp, 0, 0)
      } else {
        const w = 0.25 * Math.sin(t * 2.6 + ph * 4) * calm + armUp * 0.8
        armL.rotation.set(0, 0, w)
        armR.rotation.set(0, 0, -w)
      }
    }
  }
}

const monCache = new Map()
function monTemplate(sp, shiny) {
  const key = sp + (shiny ? '|s' : '')
  let tpl = monCache.get(key)
  if (!tpl) monCache.set(key, (tpl = creatureTemplate(sp, shiny)))
  return tpl
}

export function buildCreature(sp, { shiny = false, flash = false } = {}) {
  const tpl = monTemplate(sp, !!shiny)
  const g = new THREE.Group()
  g.name = 'creature'
  const motion = node(g, 'motion')
  const { inner, nodes, flashList } = instantiate(tpl.root, flash)
  motion.add(inner)
  const animate = creatureAnimator(motion, nodes, tpl.info, Math.random())
  g.userData = {
    species: sp,
    shiny: !!shiny,
    height: 1,
    radius: tpl.radius,
    animate,
    setFlash: flashFn(flashList),
    parts: {
      motion,
      body: nodes.body,
      head: nodes.head,
      mouth: nodes.mouth,
      eyes: [nodes.eyeL, nodes.eyeR].filter(Boolean),
      ears: [nodes.earL, nodes.earR].filter(Boolean),
      tail: nodes.tail || null,
      wings: [nodes.wingL, nodes.wingR].filter(Boolean),
      arms: [nodes.armL, nodes.armR].filter(Boolean),
    },
    dispose: () => disposeTree(g),
  }
  animate(0, EMPTY)
  return g
}

// 预热模板（首次构建约十几毫秒），可在加载阶段调用
export function prewarmCreature(sp, shiny = false) {
  monTemplate(sp, !!shiny)
}

// —— 训练家 ——

const trainerCache = new Map()
function trainerTemplate(look) {
  const idx = (v, n) => ((Math.floor(v) || 0) % n + n) % n
  const skin = SKIN[idx(look.skin, SKIN.length)], hair = HAIR[idx(look.hair, HAIR.length)]
  const shirt = SHIRT[idx(look.shirt, SHIRT.length)], pants = PANTS[idx(look.pants, PANTS.length)]
  const hat = HATC[idx(look.hatColor, HATC.length)], hatKind = idx(look.hat, 3)
  const shoe = '#2a2a35'

  const root = new THREE.Group()
  root.name = 'rig'
  for (const s of [-1, 1]) {
    const leg = node(root, s < 0 ? 'legL' : 'legR', [s * 0.075, 0.31, 0])
    part(leg, new THREE.CapsuleGeometry(0.062, 0.1, 4, 10), pants, { p: [0, -0.11, 0] })
    part(leg, ell(0.072, 0.05, 0.1, 14, 10), shoe, { p: [0, -0.255, 0.025] })
  }
  const torso = node(root, 'torso', [0, 0.31, 0])
  part(torso, new THREE.CapsuleGeometry(0.14, 0.14, 6, 18).scale(1.05, 1, 0.8), shirt, { p: [0, 0.16, 0] })
  part(torso, ell(0.152, 0.09, 0.125, 18, 10), pants, { p: [0, 0.01, 0] })
  part(torso, new THREE.TorusGeometry(0.146, 0.018, 6, 28).rotateX(PI / 2).scale(1.04, 1, 0.82), shade(pants, -0.25), { p: [0, 0.065, 0], ol: false })
  part(torso, new THREE.TorusGeometry(0.075, 0.022, 6, 18).rotateX(PI / 2), shade(shirt, 0.25), { p: [0, 0.3, 0.01], ol: false })
  for (const s of [-1, 1]) {
    const o = node(node(torso, s < 0 ? 'armL' : 'armR', [s * 0.165, 0.26, 0]), '', null, [0, 0, s * 0.14])
    part(o, new THREE.CapsuleGeometry(0.048, 0.1, 4, 10), shade(shirt, -0.12), { p: [0, -0.08, 0] })
    part(o, ell(0.052, 0.052, 0.052, 12, 10), skin, { p: [0, -0.19, 0] })
  }
  const head = node(torso, 'head', [0, 0.53, 0])
  const HS = { c: [0, 0, 0], r: [0.265, 0.25, 0.25] }
  part(head, ell(0.265, 0.25, 0.25, 30, 20), skin)
  const eyes = node(head, 'eyes', [0, -0.02, 0])
  for (const s of [-1, 1]) {
    const at = surf(HS, s * 0.09, -0.02)
    const e = node(eyes, '', [at.p.x, 0, at.p.z])
    e.quaternion.copy(at.q)
    part(e, ell(0.03, 0.045, 0.016, 12, 10), INK, { p: [0, 0, -0.004], ol: false })
    part(e, ell(0.012, 0.012, 0.007, 8, 6), WHITE, { p: [-0.009, 0.016, 0.01], ol: false })
  }
  const ms = surf(HS, 0, -0.115)
  part(head, arcLine(0.028, 0.0065), INK, { p: along(ms, 0.003), q: ms.q, ol: false })
  for (const s of [-1, 1]) {
    const at = surf(HS, s * 0.15, -0.085)
    part(head, ell(0.036, 0.022, 0.008, 12, 8), shade(skin, -0.12), { p: at.p, q: at.q, ol: false })
  }
  part(head, new THREE.SphereGeometry(0.283, 30, 14, 0, TAU, 0, 0.56 * PI), hair, { p: [0, 0.015, -0.01], r: [-0.5, 0, 0] })
  part(head, ell(0.25, 0.2, 0.15, 20, 12), hair, { p: [0, -0.05, -0.13] })
  for (const s of [-1, 1]) part(head, ell(0.05, 0.12, 0.08, 12, 10), hair, { p: [s * 0.245, -0.03, -0.03], r: [0, 0, s * 0.08] })
  // 刘海（戴帽子时被帽檐盖住，省掉）
  if (!hatKind) {
    for (const [x, y, z, rz] of [[-0.11, 0.15, 0.19, 0.5], [0, 0.17, 0.205, 0], [0.11, 0.15, 0.19, -0.5]]) {
      part(head, pod(0.075, 0.07, 0.05, 0.5), hair, { p: [x, y, z], r: [0.5, 0, rz] })
    }
  }
  if (hatKind === 1) {
    part(head, new THREE.SphereGeometry(0.295, 30, 10, 0, TAU, 0, PI / 2).scale(1, 0.92, 1), hat, { p: [0, 0.04, -0.01], r: [-0.12, 0, 0] })
    const brim = new THREE.CylinderGeometry(0.19, 0.19, 0.026, 26, 1, false, -PI / 2, PI).scale(1, 1, 1.05)
    part(head, brim, shade(hat, -0.25), { p: [0, 0.045, 0.13], r: [0.18, 0, 0] })
    part(head, ell(0.03, 0.022, 0.03, 10, 8), shade(hat, 0.25), { p: [0, 0.305, -0.04], ol: false })
  } else if (hatKind === 2) {
    part(head, new THREE.SphereGeometry(0.3, 30, 10, 0, TAU, 0, PI / 2), hat, { p: [0, 0.02, -0.01] })
    part(head, new THREE.TorusGeometry(0.293, 0.045, 8, 36).rotateX(PI / 2), shade(hat, 0.3), { p: [0, 0.035, -0.01] })
    part(head, ell(0.07, 0.07, 0.07, 14, 10), shade(hat, 0.3), { p: [0, 0.35, -0.02] })
  }
  mergeTree(root)
  finalize(root, OL_TRAINER)
  return root
}

function trainerAnimator(motion, n, ph) {
  const { legL, legR, armL, armR, torso, head, eyes } = n
  const blinkP = 3 + ph * 2, blinkO = ph * 9
  return function animate(t = 0, st = EMPTY) {
    const sp = clamp01((st && st.speed) || 0)
    const amp = Math.min(1, sp * 1.8), idle = 1 - amp
    const f = t * (7 + 7 * sp) + ph * 6
    const sw = Math.sin(f) * amp
    const br = Math.sin(t * 2.2 + ph * 10)
    legL.rotation.x = sw * 0.8
    legR.rotation.x = -sw * 0.8
    armL.rotation.set(-sw * 0.9, 0, -0.04 * br * idle)
    armR.rotation.set(sw * 0.9, 0, 0.04 * br * idle)
    motion.position.y = Math.abs(Math.cos(f)) * 0.045 * amp
    motion.rotation.x = 0.12 * sp * amp
    torso.rotation.y = sw * 0.12
    torso.scale.y = 1 + 0.018 * br * idle
    head.rotation.set(0.03 * Math.sin(t * 1.1 + ph * 3) * idle, -sw * 0.1, 0.04 * Math.sin(t * 0.7 + ph * 5) * idle)
    const bt = (t + blinkO) % blinkP
    eyes.scale.y = bt < 0.16 ? Math.max(0.1, Math.abs(Math.cos((bt / 0.16) * PI))) : 1
  }
}

export function buildTrainer(look = EMPTY) {
  look = look || EMPTY
  const key = [look.skin, look.hair, look.shirt, look.pants, look.hat, look.hatColor].map((v) => Math.floor(v) || 0).join('|')
  let tpl = trainerCache.get(key)
  if (!tpl) trainerCache.set(key, (tpl = trainerTemplate(look)))
  const g = new THREE.Group()
  g.name = 'trainer'
  const motion = node(g, 'motion')
  const { inner, nodes } = instantiate(tpl, false)
  motion.add(inner)
  const animate = trainerAnimator(motion, nodes, Math.random())
  g.userData = {
    height: 1.15,
    radius: 0.25,
    animate,
    parts: { motion, head: nodes.head, torso: nodes.torso, arms: [nodes.armL, nodes.armR], legs: [nodes.legL, nodes.legR] },
    dispose: () => disposeTree(g),
  }
  animate(0, EMPTY)
  return g
}

// —— 捕捉球 ——（球心在原点，半径 0.12，宝石朝 +Z；盖子绕后侧铰链打开）

const BALL_TOP = { ball: '#1fb5a3', great: '#3a86ff', ultra: '#8e5cf7' }
const BALL_R = 0.12
const ballCache = new Map()
function ballTemplate(kind) {
  const r = BALL_R, top = BALL_TOP[kind]
  const root = new THREE.Group()
  root.name = 'ball'
  const base = node(root, 'base')
  part(base, new THREE.SphereGeometry(r, 28, 10, 0, TAU, PI / 2, PI / 2), '#f4f4f4')
  part(base, new THREE.CircleGeometry(r * 0.97, 28).rotateX(-PI / 2), null, { mat: toonMat('#e8fbff', { emissive: '#7fc9d6' }), p: [0, 0.002, 0], ol: false })
  part(base, new THREE.CylinderGeometry(r * 1.02, r * 1.02, r * 0.17, 36, 1, true), INK, { ol: false })
  part(base, new THREE.CylinderGeometry(r * 0.3, r * 0.3, r * 0.12, 24).rotateX(PI / 2), '#f4f4f4', { p: [0, 0, r * 0.98] })
  part(base, new THREE.TorusGeometry(r * 0.3, r * 0.045, 6, 24), INK, { p: [0, 0, r * 1.04], ol: false })
  part(base, new THREE.OctahedronGeometry(1, 0).scale(r * 0.19, r * 0.25, r * 0.1), null, { mat: toonMat('#ffc43d', { emissive: shade('#ffc43d', -0.55) }), p: [0, 0, r * 1.07], ol: false })
  const lid = node(root, 'lid', [0, 0, -r])
  part(lid, new THREE.SphereGeometry(r, 28, 10, 0, TAU, 0, PI / 2), top, { p: [0, 0, r] })
  part(lid, new THREE.CircleGeometry(r * 0.97, 28).rotateX(PI / 2), shade(top, -0.35), { p: [0, -0.002, r], ol: false })
  const hs = surf({ c: [0, 0, r], r: [r, r, r] }, -r * 0.4, r * 0.55)
  part(lid, ell(r * 0.2, r * 0.11, r * 0.05, 12, 8), WHITE, { p: along(hs, 0), q: spin(hs.q, AX_Z, 0.5), ol: false })
  mergeTree(root)
  finalize(root, OL_BALL)
  return root
}

export function buildBall(kind = 'ball') {
  const k = BALL_TOP[kind] ? kind : 'ball'
  let tpl = ballCache.get(k)
  if (!tpl) ballCache.set(k, (tpl = ballTemplate(k)))
  const g = new THREE.Group()
  g.name = 'ball'
  const { inner, nodes } = instantiate(tpl, false)
  g.add(inner)
  const lid = nodes.lid
  g.userData = {
    kind: k,
    height: BALL_R * 2,
    radius: BALL_R,
    parts: { lid, base: nodes.base },
    open: (amount = 1) => { lid.rotation.x = -clamp01(amount) * 1.9 },
    dispose: () => disposeTree(g),
  }
  return g
}

// 释放所有模板缓存（仅在确定没有存活实例时调用，例如整页卸载）
export function clearModelCache() {
  for (const cache of [monCache, trainerCache, ballCache]) {
    for (const v of cache.values()) (v.root || v).traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.geometry.dispose() })
    cache.clear()
  }
}
