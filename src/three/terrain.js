// 3D 地形：把图块地图搭成卡通"玩具沙盘"。全部程序化生成，用坐标种子哈希保证每个客户端完全一致。
// 1 单位 = 1 图块，图块 (x, y) 占 X∈[x, x+1)、Z∈[y, y+1)，地面 y = 0。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { tileAt } from '../data/maps.js'
import { toonMat, addOutline, gradientMap, disposeTree, shade } from './materials.js'

const S = 4 // 地面网格每图块细分
const M = 6 // 地图外的过渡边距（图块）
const RING = 48 // 外圈地面延伸距离
const WATER_Y = -0.08
const BASIN_Y = -0.25

// 与 2D 图块相同的坐标哈希 → [0, 1)
const h3 = (x, y, s) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
function vnoise(x, y, s) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const a = h3(ix, iy, s), b = h3(ix + 1, iy, s), c = h3(ix, iy + 1, s), d = h3(ix + 1, iy + 1, s)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
const C = (hex) => new THREE.Color(hex)
const isWaterT = (t) => t === '~' || t === 'B'

const PALETTES = {
  light: {
    grass: '#8fd06b', grass2: '#76bd56', grass3: '#a9df86', tall: '#4f9c40', path: '#e0c48e', path2: '#c7a46b',
    grout: '#b4ad9f', slab: '#dedad0', sand: '#f0dc9c', sand2: '#dcc27f', bank: '#a08b5a', bottom: '#3f93a8',
    stone: '#c9c4b8', stoneTop: '#e7e3d9', stoneBottom: '#6fa7bd',
    bladeBase: '#2f7a31', bladeMid: '#58ad45', bladeTip: '#a6e283',
    trunk: '#8a5a33', trunkDark: '#6b4424',
    round: ['#2f7a3a', '#4aa64f', '#86d072'], pine: ['#1f6b45', '#2f8a52', '#5fb86a'], oval: ['#3b8a3a', '#5cb24e', '#9ad872'],
    rock: ['#6f6f7c', '#a3a3ad', '#cfcfd8'], moss: '#6aa850',
  },
  dark: {
    grass: '#5d9a4c', grass2: '#4b8440', grass3: '#6fae5a', tall: '#356b31', path: '#b99c6c', path2: '#9c7f52',
    grout: '#8e897d', slab: '#b9b5ab', sand: '#d6c38a', sand2: '#bba76e', bank: '#7d6c48', bottom: '#2c6f82',
    stone: '#a9a499', stoneTop: '#c7c2b6', stoneBottom: '#4d8298',
    bladeBase: '#1d4a22', bladeMid: '#357033', bladeTip: '#76b460',
    trunk: '#6e4a2c', trunkDark: '#4f331d',
    round: ['#16392a', '#24583a', '#40804a'], pine: ['#10342a', '#1f5238', '#397a4c'], oval: ['#1c4a2e', '#2f6a3a', '#5a9a56'],
    rock: ['#5b5c66', '#878893', '#adaeb8'], moss: '#4f8a44',
  },
}

// ---------- 几何合批 ----------
const _c = new THREE.Color()
class Batch {
  constructor() { this.parts = [] }
  // colorFn(x, y, z, nx, ny, nz, outColor) 在变换前的局部坐标上取色
  add(geo, color, m, colorFn) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
    const p = g.attributes.position.array, n = g.attributes.normal.array, cnt = g.attributes.position.count
    const col = new Float32Array(cnt * 3)
    for (let i = 0; i < cnt; i++) {
      if (colorFn) colorFn(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], n[i * 3], n[i * 3 + 1], n[i * 3 + 2], _c)
      else if (color) _c.copy(color)
      else _c.setRGB(1, 1, 1)
      col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    if (m) g.applyMatrix4(m)
    this.parts.push(g)
    return this
  }
  build() {
    if (!this.parts.length) return null
    const g = this.parts.length === 1 ? this.parts[0] : mergeGeometries(this.parts, false)
    if (g !== this.parts[0]) for (const p of this.parts) p.dispose()
    this.parts = []
    return g
  }
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3()
function mat(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz)
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e), _s.set(sx, sy, sz))
}
const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b)

// 构建期共享的单位图元（build 结束时释放）
function primitives() {
  return {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    cyl16: new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
    sph: new THREE.IcosahedronGeometry(1, 1),
    sph0: new THREE.IcosahedronGeometry(1, 0),
  }
}

// 抖动过的低多边形团块：同一方向的顶点得到同样的偏移，保证接缝闭合；法线取径向（平滑，描边连贯）
function blob(detail, rough, seed) {
  const g = new THREE.IcosahedronGeometry(1, detail)
  const p = g.attributes.position.array, n = g.attributes.normal.array
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2]
    const k = 1 + (h3(Math.round(x * 97), Math.round(y * 97) * 31 + Math.round(z * 97), seed) - 0.5) * rough
    n[i] = x; n[i + 1] = y; n[i + 2] = z
    p[i] = x * k; p[i + 1] = y * k; p[i + 2] = z * k
  }
  return g
}

// 三角棱柱（山墙阁楼）：(z, y) 平面三角形沿 X 拉伸
function atticPrism(xa, xb, z0, z1, zc, y0, y1) {
  const A = (x) => [x, y0, z0], B = (x) => [x, y0, z1], Cc = (x) => [x, y1, zc]
  const tris = [
    A(xa), B(xa), Cc(xa), // 西山墙
    A(xb), Cc(xb), B(xb), // 东山墙
    B(xa), B(xb), Cc(xb), B(xa), Cc(xb), Cc(xa), // 南坡
    A(xa), Cc(xa), Cc(xb), A(xa), Cc(xb), A(xb), // 北坡
  ]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3))
  g.computeVertexNormals()
  return g
}

// ---------- 摇曳材质（高草 / 花 / 草簇）----------
function swayMaterial(U, key, h, wind, push) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, vertexColors: true, gradientMap: gradientMap(), side: THREE.DoubleSide })
  m.userData.unique = true
  const f = (v) => v.toFixed(4)
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime
    sh.uniforms.uPlayer = U.uPlayer
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uPlayer;')
      .replace('#include <project_vertex>', `
vec4 wp = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
vec3 root = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float kh = clamp(position.y / ${f(h)}, 0.0, 1.0);
kh *= kh;
float ph = uTime * 1.7 + root.x * 0.55 + root.z * 0.37;
vec2 sw = vec2(sin(ph) * 0.75 + sin(ph * 2.3 + root.z * 1.3) * 0.3, cos(ph * 0.8 + root.x) * 0.45) * ${f(wind)};
vec2 dd = root.xz - uPlayer.xz;
float dl = length(dd);
float pk = 1.0 - smoothstep(0.12, 0.8, dl);
vec2 pd = dl > 0.001 ? dd / dl : vec2(0.0, 1.0);
wp.xz += (sw + pd * pk * ${f(push)}) * kh;
wp.y -= pk * kh * ${f(push * 0.45)};
vec4 mvPosition = viewMatrix * wp;
gl_Position = projectionMatrix * mvPosition;`)
    // 双面叶片统一用朝上的法线受光，背面不翻转
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
  }
  m.customProgramCacheKey = () => 'nm-sway-' + key
  return m
}

function waterMaterial(U) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradientMap(), transparent: true })
  m.userData.unique = true
  const uni = {
    uShallow: { value: C('#66c6ec') }, uDeep: { value: C('#2c86cc') },
    uHi: { value: C('#c4ecff') }, uFoam: { value: C('#f4fcff') },
  }
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = U.uTime
    Object.assign(sh.uniforms, uni)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute float aShore;\nvarying float vShore;\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vec3 wq = (modelMatrix * vec4(position, 1.0)).xyz;
float amp = smoothstep(0.05, 0.6, aShore);
transformed.y += (sin(wq.x * 1.9 + uTime * 1.3) + sin(wq.z * 2.3 - uTime * 1.1 + wq.x * 0.7)) * 0.009 * amp;
vShore = aShore;
vWp = wq;`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uShallow;\nuniform vec3 uDeep;\nuniform vec3 uHi;\nuniform vec3 uFoam;\nvarying float vShore;\nvarying vec3 vWp;')
      .replace('#include <color_fragment>', `#include <color_fragment>
float depthK = smoothstep(0.05, 1.4, vShore);
vec3 wcol = mix(uShallow, uDeep, depthK);
float w1 = sin(vWp.x * 2.2 + uTime * 1.1 + sin(vWp.z * 1.6 + uTime * 0.7) * 1.4);
float w2 = sin(vWp.z * 2.9 - uTime * 0.9 + sin(vWp.x * 1.3 - uTime * 0.5) * 1.2);
float band = step(1.45, w1 + w2 + 0.25 * sin(uTime * 0.6 + vWp.x * 0.8)) * smoothstep(0.12, 0.35, vShore);
float fl = 0.14 + 0.03 * sin(uTime * 2.1 + (vWp.x + vWp.z) * 5.0);
float foam = 1.0 - smoothstep(fl, fl + 0.03, vShore);
float ring = fl + 0.13 + 0.035 * sin(uTime * 1.4 + vWp.x * 3.0 - vWp.z * 2.0);
float foam2 = (1.0 - smoothstep(0.0, 0.018, abs(vShore - ring))) * 0.55;
float fo = max(foam, foam2);
wcol = mix(wcol, uHi, band * 0.6);
wcol = mix(wcol, uFoam, fo);
diffuseColor.rgb = wcol;
diffuseColor.a = max(mix(0.68, 0.86, depthK), fo);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += wcol * max(band * 0.45, fo) * 0.4;')
  }
  m.customProgramCacheKey = () => 'nm-water'
  return m
}

// ---------- 主入口 ----------
export function buildTerrain(map) {
  const dark = !!map.dark
  const P = PALETTES[dark ? 'dark' : 'light']
  const pal = {}
  for (const k in P) pal[k] = Array.isArray(P[k]) ? P[k].map(C) : C(P[k])
  pal.bg = C(map.bg || '#2f6f38')

  const U = { uTime: { value: 0 }, uPlayer: { value: new THREE.Vector3(-999, 0, -999) } }
  const group = new THREE.Group()
  group.name = 'terrain'
  const prim = primitives()
  const vcMat = toonMat(0xffffff, { vertexColors: true })
  const labelAnchors = []
  const ctx = { map, dark, pal, prim, U, group, vcMat }

  // 建筑占地（地面 AO、草簇排除）
  const bmask = new Uint8Array(map.w * map.h)
  for (const b of map.buildings) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) bmask[y * map.w + x] = 1
  ctx.bmask = bmask

  // 喷泉：与石板广场相邻的水域连通块
  const fountainTiles = new Set(), fountains = []
  {
    const seen = new Uint8Array(map.w * map.h)
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (seen[y * map.w + x] || !isWaterT(map.tiles[y][x])) continue
      const comp = [], st = [[x, y]]
      seen[y * map.w + x] = 1
      let plaza = false
      while (st.length) {
        const [cx, cy] = st.pop()
        comp.push([cx, cy])
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy, t = tileAt(map, nx, ny)
          if (t === 'p') plaza = true
          if (isWaterT(t) && !seen[ny * map.w + nx]) { seen[ny * map.w + nx] = 1; st.push([nx, ny]) }
        }
      }
      if (plaza) { fountains.push(comp); for (const [cx, cy] of comp) fountainTiles.add(cy * map.w + cx) }
    }
  }
  ctx.isFountain = (x, y) => x >= 0 && y >= 0 && x < map.w && y < map.h && fountainTiles.has(y * map.w + x)
  ctx.isPlaza = (x, y) => {
    const t = tileAt(map, x, y)
    if (t === 'p') return true
    if (t !== '#' || x < 0 || y < 0 || x >= map.w || y >= map.h) return false
    return tileAt(map, x, y + 1) === 'p' || tileAt(map, x - 1, y) === 'p' || tileAt(map, x + 1, y) === 'p'
  }

  const add = (obj, { cast = false, receive = true } = {}) => {
    obj.castShadow = cast
    obj.receiveShadow = receive
    obj.matrixAutoUpdate = false
    obj.updateMatrix()
    group.add(obj)
    return obj
  }
  ctx.add = add

  buildGround(ctx)
  buildPlaza(ctx)
  buildWater(ctx)
  const fountainFx = fountains.map((comp) => buildFountain(ctx, comp))
  buildGrass(ctx)
  buildFlowers(ctx)
  buildTrees(ctx)
  buildRocks(ctx)
  buildProps(ctx)
  buildBuildings(ctx, labelAnchors)

  for (const k in prim) prim[k].dispose()

  return {
    group,
    labelAnchors,
    update(t, playerPos) {
      U.uTime.value = t
      if (playerPos) U.uPlayer.value.set(playerPos.x, playerPos.y, playerPos.z)
      for (let i = 0; i < fountainFx.length; i++) fountainFx[i](t)
    },
    dispose() {
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose() })
      disposeTree(group)
      group.removeFromParent()
      group.clear()
    },
  }
}

// ---------- 地面 ----------
// 类别码
const K_GRASS = 0, K_TREE = 1, K_TALL = 2, K_PATH = 3, K_PLAZA = 4, K_SAND = 5, K_WATER = 6, K_FOUNT = 7, K_OUT = 8, K_OUTPATH = 9

function buildGround(ctx) {
  const { map, pal, bmask } = ctx
  const W = map.w, H = map.h
  const EW = W + 2 * M, EH = H + 2 * M
  // 扩展区域的图块类别
  const kind = new Uint8Array(EW * EH), outD = new Float32Array(EW * EH)
  for (let ty = -M; ty < H + M; ty++) for (let tx = -M; tx < W + M; tx++) {
    const i = (ty + M) * EW + tx + M
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) {
      const dx = tx < 0 ? -tx : tx >= W ? tx - W + 1 : 0, dy = ty < 0 ? -ty : ty >= H ? ty - H + 1 : 0
      outD[i] = Math.max(dx, dy)
      const cx = Math.min(W - 1, Math.max(0, tx)), cy = Math.min(H - 1, Math.max(0, ty))
      kind[i] = (dx === 0 || dy === 0) && map.tiles[cy][cx] === '=' ? K_OUTPATH : K_OUT
      continue
    }
    const t = map.tiles[ty][tx]
    kind[i] = t === ',' ? K_TALL : t === '=' ? K_PATH : t === 's' ? K_SAND : t === 'T' ? K_TREE
      : isWaterT(t) ? (ctx.isFountain(tx, ty) ? K_FOUNT : K_WATER) : ctx.isPlaza(tx, ty) ? K_PLAZA : K_GRASS
  }
  const kindAt = (tx, ty) => (tx < -M || ty < -M || tx >= W + M || ty >= H + M ? K_OUT : kind[(ty + M) * EW + tx + M])
  const dAt = (tx, ty) => (tx < -M || ty < -M || tx >= W + M || ty >= H + M ? M : outD[(ty + M) * EW + tx + M])

  const tmp = new THREE.Color(), acc = new THREE.Color()
  const grassAt = (px, pz, out) => {
    out.copy(pal.grass).lerp(pal.grass2, vnoise(px * 0.28, pz * 0.28, 7))
    const hi = vnoise(px * 0.9, pz * 0.9, 8) - 0.62
    if (hi > 0) out.lerp(pal.grass3, Math.min(1, hi * 2.2))
    return out
  }
  const sample = (px, pz, out) => {
    const tx = Math.floor(px), ty = Math.floor(pz), k = kindAt(tx, ty)
    switch (k) {
      case K_GRASS: return grassAt(px, pz, out)
      case K_TREE: return grassAt(px, pz, out).multiplyScalar(0.84)
      case K_TALL: return out.copy(pal.tall).multiplyScalar(0.92 + vnoise(px * 1.2, pz * 1.2, 12) * 0.14)
      case K_PATH: return out.copy(pal.path).lerp(pal.path2, vnoise(px * 1.4, pz * 1.4, 9) * 0.75)
      case K_PLAZA: return out.copy(pal.grout)
      case K_SAND: return out.copy(pal.sand).lerp(pal.sand2, vnoise(px * 1.1, pz * 1.1, 10) * 0.55)
      case K_WATER: return out.copy(pal.bank)
      case K_FOUNT: return out.copy(pal.stone)
      default: {
        const f = Math.min(1, dAt(tx, ty) / (M - 0.5))
        if (k === K_OUTPATH) out.copy(pal.path).lerp(pal.path2, vnoise(px * 1.4, pz * 1.4, 9) * 0.75)
        else grassAt(px, pz, out).multiplyScalar(0.9)
        return out.lerp(pal.bg, f * f * (3 - 2 * f))
      }
    }
  }

  const nx = EW * S + 1, nz = EH * S + 1, N = nx * nz
  const pos = new Float32Array((N + 16) * 3), col = new Float32Array((N + 16) * 3)
  const isW = (k) => k === K_WATER || k === K_FOUNT
  const touch = [0, 0, 0, 0]
  for (let j = 0; j < nz; j++) {
    const vz = -M + j / S, onZ = j % S === 0
    const tz0 = onZ ? Math.round(vz) - 1 : Math.floor(vz), tz1 = onZ ? tz0 + 1 : tz0
    for (let i = 0; i < nx; i++) {
      const vx = -M + i / S, onX = i % S === 0
      const tx0 = onX ? Math.round(vx) - 1 : Math.floor(vx), tx1 = onX ? tx0 + 1 : tx0
      touch[0] = kindAt(tx0, tz0); touch[1] = kindAt(tx1, tz0); touch[2] = kindAt(tx0, tz1); touch[3] = kindAt(tx1, tz1)
      let allW = true, allP = true, fount = false
      for (let q = 0; q < 4; q++) {
        if (!isW(touch[q])) allW = false
        if (touch[q] !== K_PATH && touch[q] !== K_OUTPATH) allP = false
        if (touch[q] === K_FOUNT) fount = true
      }
      const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1
      const y = allW ? BASIN_Y : allP && !edge ? -0.02 : 0
      if (allW) acc.copy(fount ? pal.stoneBottom : pal.bottom)
      else {
        // 四点抖动采样 → 边界柔和、土路边缘呈磨损的参差感
        const r = 0.3, jx = (h3(i, j, 11) - 0.5) * 0.3, jz = (h3(i, j, 13) - 0.5) * 0.3
        acc.setRGB(0, 0, 0)
        acc.add(sample(vx - r + jx, vz - r + jz, tmp)); acc.add(sample(vx + r + jx, vz - r + jz, tmp))
        acc.add(sample(vx - r + jx, vz + r + jz, tmp)); acc.add(sample(vx + r + jx, vz + r + jz, tmp))
        acc.multiplyScalar(0.25)
      }
      let k = 1 + (h3(i, j, 3) - 0.5) * 0.07
      // 建筑墙脚的环境光遮蔽
      for (const b of ctx.map.buildings) {
        const ox = Math.max(b.x - vx, 0, vx - b.x - b.w), oz = Math.max(b.y - vz, 0, vz - b.y - b.h)
        const d = Math.hypot(ox, oz)
        if (d < 0.45) k *= 0.72 + 0.28 * (d / 0.45)
      }
      const o = (j * nx + i) * 3
      pos[o] = vx; pos[o + 1] = y; pos[o + 2] = vz
      col[o] = acc.r * k; col[o + 1] = acc.g * k; col[o + 2] = acc.b * k
    }
  }
  const quads = (nx - 1) * (nz - 1)
  const idx = new Uint32Array(quads * 6 + 4 * 6)
  let q = 0
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1
    if ((i + j) & 1) { idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d }
    else { idx[q++] = a; idx[q++] = c; idx[q++] = d; idx[q++] = a; idx[q++] = d; idx[q++] = b }
  }
  // 外圈：四块大平面，颜色 = map.bg
  const x0 = -M, x1 = W + M, z0 = -M, z1 = H + M
  const rings = [
    [-RING, W + RING, -RING, z0], [-RING, W + RING, z1, H + RING],
    [-RING, x0, z0, z1], [x1, W + RING, z0, z1],
  ]
  let v = N
  for (const [ax, bx, az, bz] of rings) {
    const base = v
    for (const [px, pz] of [[ax, az], [bx, az], [ax, bz], [bx, bz]]) {
      pos[v * 3] = px; pos[v * 3 + 1] = 0; pos[v * 3 + 2] = pz
      col[v * 3] = pal.bg.r; col[v * 3 + 1] = pal.bg.g; col[v * 3 + 2] = pal.bg.b
      v++
    }
    idx[q++] = base; idx[q++] = base + 2; idx[q++] = base + 3; idx[q++] = base; idx[q++] = base + 3; idx[q++] = base + 1
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setIndex(new THREE.BufferAttribute(idx, 1))
  g.computeVertexNormals()
  const mesh = new THREE.Mesh(g, ctx.vcMat)
  mesh.name = 'ground'
  ctx.add(mesh, { receive: true })
}

// 石板广场：错缝铺装的石板块
function buildPlaza(ctx) {
  const { map, pal, prim } = ctx
  const batch = new Batch(), c = new THREE.Color(), moss = C('#8fae6a')
  for (let r = 0; r < map.h * 2; r++) {
    const ty = r >> 1
    let run0 = -1, runSlab = -1
    const flush = (cEnd) => {
      if (run0 < 0) return
      const xa = run0 / 2 + 0.03, xb = cEnd / 2 - 0.03, za = r / 2 + 0.03, zb = (r + 1) / 2 - 0.03
      const hv = h3(runSlab, r, 17)
      c.copy(pal.slab).multiplyScalar(0.92 + hv * 0.12)
      if (ctx.dark && h3(runSlab, r, 19) < 0.35) c.lerp(moss, 0.3)
      batch.add(prim.box, c, mat((xa + xb) / 2, 0.012, (za + zb) / 2, 0, 0, 0, xb - xa, 0.05, zb - za))
      run0 = -1
    }
    for (let cc = 0; cc <= map.w * 2; cc++) {
      const inP = cc < map.w * 2 && ctx.isPlaza(cc >> 1, ty)
      const slab = (cc + (r & 1)) >> 1
      if (run0 >= 0 && (!inP || slab !== runSlab)) flush(cc)
      if (inP && run0 < 0) { run0 = cc; runSlab = slab }
    }
  }
  const g = batch.build()
  if (!g) return
  const mesh = new THREE.Mesh(g, ctx.vcMat)
  mesh.name = 'plaza'
  ctx.add(mesh, { receive: true })
}

// ---------- 水面 ----------
function buildWater(ctx) {
  const { map } = ctx
  const tiles = []
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (isWaterT(map.tiles[y][x])) tiles.push([x, y])
  if (!tiles.length) return
  const vx = map.w * S + 1
  const vmap = new Int32Array(vx * (map.h * S + 1)).fill(-1)
  const pos = [], shore = [], idx = []
  const shoreDist = (px, pz) => {
    let best = 2
    const cx = Math.floor(px), cz = Math.floor(pz)
    for (let ty = cz - 2; ty <= cz + 2; ty++) for (let tx = cx - 2; tx <= cx + 2; tx++) {
      if (isWaterT(tileAt(map, tx, ty))) continue
      const dx = Math.max(tx - px, 0, px - tx - 1), dz = Math.max(ty - pz, 0, pz - ty - 1)
      const d = Math.hypot(dx, dz)
      if (d < best) best = d
    }
    return best
  }
  const vert = (gi, gj) => {
    const k = gj * vx + gi
    if (vmap[k] >= 0) return vmap[k]
    const px = gi / S, pz = gj / S
    vmap[k] = pos.length / 3
    pos.push(px, 0, pz)
    shore.push(shoreDist(px, pz))
    return vmap[k]
  }
  for (const [x, y] of tiles) for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const gi = x * S + i, gj = y * S + j
    const a = vert(gi, gj), b = vert(gi + 1, gj), c = vert(gi, gj + 1), d = vert(gi + 1, gj + 1)
    idx.push(a, c, d, a, d, b)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aShore', new THREE.Float32BufferAttribute(shore, 1))
  const nrm = new Float32Array(pos.length)
  for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  g.setIndex(idx)
  const mesh = new THREE.Mesh(g, waterMaterial(ctx.U))
  mesh.position.y = WATER_Y
  mesh.name = 'water'
  mesh.renderOrder = 1
  ctx.add(mesh, { receive: true })
}

// 喷泉：石砌池沿 + 中央喷水柱 + 水珠
function buildFountain(ctx, comp) {
  const { map, pal, prim } = ctx
  const stone = new Batch()
  const set = new Set(comp.map(([x, y]) => y * map.w + x))
  const inC = (x, y) => set.has(y * map.w + x) && x >= 0 && x < map.w
  const cRim = pal.stone, cCap = pal.stoneTop
  for (const [x, y] of comp) {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      if (inC(x + dx, y + dy)) continue
      const along = dy !== 0
      const ex = x + 0.5 + dx * 0.5, ez = y + 0.5 + dy * 0.5
      const len = 1.24
      stone.add(prim.box, cRim, mat(ex, 0.1, ez, 0, 0, 0, along ? len : 0.24, 0.3, along ? 0.24 : len))
      stone.add(prim.box, cCap, mat(ex, 0.275, ez, 0, 0, 0, along ? len + 0.04 : 0.3, 0.06, along ? 0.3 : len + 0.04))
    }
  }
  let cx = 0, cz = 0
  for (const [x, y] of comp) { cx += x + 0.5; cz += y + 0.5 }
  cx /= comp.length; cz /= comp.length
  const big = comp.length >= 4
  if (big) {
    stone.add(prim.cyl8, cRim, mat(cx, BASIN_Y + 0.08, cz, 0, 0, 0, 0.5, 0.16, 0.5))
    stone.add(prim.cyl8, cRim, mat(cx, 0.2, cz, 0, 0, 0, 0.2, 0.72, 0.2))
    stone.add(new THREE.CylinderGeometry(0.38, 0.16, 0.16, 12), cCap, mat(cx, 0.6, cz))
    stone.add(prim.cyl8, cCap, mat(cx, 0.76, cz, 0, 0, 0, 0.12, 0.2, 0.12))
  }
  const sg = stone.build()
  const rim = new THREE.Mesh(sg, ctx.vcMat)
  rim.name = 'fountain'
  ctx.add(rim, { cast: true, receive: true })
  addOutline(rim, 0.02)
  if (!big) return () => {}

  const jetMat = new THREE.MeshToonMaterial({ color: 0xc4ecff, emissive: 0x3b7fa6, gradientMap: gradientMap(), transparent: true, opacity: 0.78 })
  jetMat.userData.unique = true
  // 静态：碗中水面 + 溢出的水帘
  const still = new Batch(), white = C('#ffffff')
  still.add(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 16), white, mat(cx, 0.675, cz))
  still.add(new THREE.CylinderGeometry(0.37, 0.44, 0.7, 16, 1, true), white, mat(cx, 0.32, cz))
  const stillMesh = new THREE.Mesh(still.build(), jetMat)
  stillMesh.name = 'fountainWater'
  stillMesh.material.side = THREE.DoubleSide
  ctx.add(stillMesh, { receive: false })
  const jetGeo = new THREE.CylinderGeometry(0.035, 0.06, 1, 10)
  jetGeo.translate(0, 0.5, 0)
  const jet = new THREE.Mesh(jetGeo, jetMat)
  jet.position.set(cx, 0.84, cz)
  jet.scale.set(1, 0.32, 1)
  jet.name = 'fountainJet'
  ctx.group.add(jet)
  const N = 12
  const drops = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.035, 0), jetMat, N)
  drops.frustumCulled = false
  drops.name = 'fountainDrops'
  ctx.group.add(drops)
  const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  const top = 1.18
  return (t) => {
    jet.scale.y = 0.32 + Math.sin(t * 7.3) * 0.025 + Math.sin(t * 3.1) * 0.02
    for (let i = 0; i < N; i++) {
      const ph = (t * 0.85 + i / N + h3(i, 3, 9) * 0.3) % 1
      const a = (i / N) * Math.PI * 2 + h3(i, 7, 9)
      const r = 0.34 * ph
      p.set(cx + Math.cos(a) * r, top + 0.25 * ph - 0.77 * ph * ph - 0.08, cz + Math.sin(a) * r)
      const sc = 1 - ph * 0.5
      s.set(sc, sc * 1.3, sc)
      m4.compose(p, q, s)
      drops.setMatrixAt(i, m4)
    }
    drops.instanceMatrix.needsUpdate = true
  }
}

// ---------- 高草 / 草簇 ----------
function bladeClump(pal, h, blades, seed) {
  const pos = [], nrm = [], col = []
  const cA = pal.bladeBase, cB = pal.bladeMid, cT = pal.bladeTip, c = new THREE.Color()
  const U = [0, 0.38, 0.72, 1]
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + (h3(b, seed, 1) - 0.5) * 1.2
    const dx = Math.cos(a), dz = Math.sin(a), tx = -dz, tz = dx
    const off = 0.03 + h3(b, seed, 2) * 0.06, lean = 0.1 + h3(b, seed, 3) * 0.14
    const bh = h * (0.75 + h3(b, seed, 4) * 0.3), w0 = 0.07 + h3(b, seed, 5) * 0.03
    const ring = U.map((u) => {
      const cx = dx * (off + lean * u * u), cz = dz * (off + lean * u * u), y = u * bh, w = w0 * (1 - u) * 0.5
      return [[cx - tx * w, y, cz - tz * w], [cx + tx * w, y, cz + tz * w], u]
    })
    const push = (v, u) => {
      pos.push(...v); nrm.push(0, 1, 0)
      if (u < 0.5) c.copy(cA).lerp(cB, u / 0.5)
      else c.copy(cB).lerp(cT, (u - 0.5) / 0.5)
      col.push(c.r, c.g, c.b)
    }
    for (let k = 0; k < 3; k++) {
      const [l0, r0, u0] = ring[k], [l1, r1, u1] = ring[k + 1]
      if (k === 2) { push(l0, u0); push(r0, u0); push(l1, u1); continue }
      push(l0, u0); push(r0, u0); push(l1, u1)
      push(r0, u0); push(r1, u1); push(l1, u1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  return g
}

// 仅绕 Y 旋转 + 缩放的实例矩阵，直接写列主序数组
function pushTRS(arr, x, y, z, ry, sx, sy, sz) {
  const c = Math.cos(ry), s = Math.sin(ry)
  arr.push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x, y, z, 1)
}
function makeInstanced(geo, material, mats, cols) {
  const n = mats.length / 16
  const m = new THREE.InstancedMesh(geo, material, n)
  m.instanceMatrix.array.set(mats)
  m.instanceMatrix.needsUpdate = true
  if (cols) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cols), 3)
  m.computeBoundingSphere()
  return m
}

function buildGrass(ctx) {
  const { map, pal, U } = ctx
  const H = 0.6
  const mats = [], cols = [], tm = [], tc = []
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[y][x]
    if (t === ',') {
      // 4×4 分层抖动，保证密度均匀
      for (let k = 0; k < 16; k++) {
        const gx = k & 3, gz = k >> 2
        const px = x + (gx + 0.1 + h3(x * 16 + k, y, 31) * 0.8) / 4
        const pz = y + (gz + 0.1 + h3(x * 16 + k, y, 32) * 0.8) / 4
        const sc = 0.85 + h3(x * 16 + k, y, 33) * 0.35
        pushTRS(mats, px, 0, pz, h3(x * 16 + k, y, 34) * 6.283, sc, sc * (0.9 + h3(x * 16 + k, y, 35) * 0.35), sc)
        const v = 0.9 + h3(x * 16 + k, y, 36) * 0.2
        cols.push(v * (0.94 + h3(x, y * 16 + k, 37) * 0.1), v, v * 0.95)
      }
    } else if ((t === '.' || t === 'f') && !ctx.bmask[y * map.w + x] && h3(x, y, 21) < 0.3) {
      const n = 1 + (h3(x, y, 22) < 0.4 ? 1 : 0)
      for (let k = 0; k < n; k++) {
        const sc = 0.32 + h3(x + k, y, 23) * 0.16
        pushTRS(tm, x + 0.15 + h3(x, y + k, 24) * 0.7, 0, y + 0.15 + h3(x, y + k, 25) * 0.7, h3(x, y + k, 26) * 6.283, sc, sc, sc)
        const v = 1.05 + h3(x, y + k, 27) * 0.2
        tc.push(v, v, v)
      }
    }
  }
  if (!mats.length && !tm.length) return
  const geo = bladeClump(pal, H, 4, 1)
  const mat = swayMaterial(U, 'grass', H, 0.07, 0.34)
  if (mats.length) {
    const m = makeInstanced(geo, mat, mats, cols)
    m.name = 'tallGrass'
    ctx.add(m, { receive: true })
  }
  if (tm.length) {
    const m = makeInstanced(geo, mat, tm, tc)
    m.name = 'tufts'
    ctx.add(m, { receive: true })
  }
}

// ---------- 花 ----------
const PETALS = ['#ff6b8b', '#ffd23f', '#ffffff', '#b28dff', '#ff9f43']
function buildFlowers(ctx) {
  const { map, prim, U } = ctx
  const mats = [], cols = [], white = []
  const pc = PETALS.map(C)
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (map.tiles[y][x] !== 'f') continue
    const n = 3 + (h3(x, y, 40) < 0.5 ? 1 : 0) + (h3(x, y, 41) < 0.3 ? 1 : 0)
    for (let k = 0; k < n; k++) {
      const px = x + 0.14 + h3(x, y, 42 + k) * 0.72, pz = y + 0.14 + h3(x, y, 50 + k) * 0.72
      const sc = 0.85 + h3(x, y, 60 + k) * 0.4
      pushTRS(mats, px, 0, pz, h3(x, y, 70 + k) * 6.283, sc, sc * (0.85 + h3(x, y, 80 + k) * 0.35), sc)
      const c = pc[Math.floor(h3(x, y, 90 + k) * pc.length)]
      cols.push(c.r, c.g, c.b)
      white.push(1, 1, 1)
    }
  }
  if (!mats.length) return
  const petals = new Batch(), stems = new Batch()
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2
    petals.add(prim.sph0, null, mul(mat(Math.cos(a) * 0.06, 0.29, Math.sin(a) * 0.06, 0, -a, 0.25), mat(0, 0, 0, 0, 0, 0, 0.055, 0.022, 0.04)),
      (x, y, z, nx, ny, nz, out) => out.setScalar(0.82 + Math.max(0, ny) * 0.18))
  }
  stems.add(prim.cyl6, C('#3f8a3a'), mat(0, 0.14, 0, 0, 0, 0, 0.026, 0.28, 0.026))
  stems.add(prim.sph0, C('#4f9c42'), mat(0.05, 0.08, 0, 0, 0, 0.5, 0.07, 0.02, 0.035))
  stems.add(prim.sph0, C('#4f9c42'), mat(-0.045, 0.12, 0.01, 0, 0.4, -0.5, 0.06, 0.02, 0.03))
  stems.add(prim.sph0, C('#f7b500'), mat(0, 0.3, 0, 0, 0, 0, 0.038, 0.03, 0.038))
  const mat_ = swayMaterial(U, 'flower', 0.3, 0.035, 0.16)
  const a = makeInstanced(petals.build(), mat_, mats, cols)
  const b = makeInstanced(stems.build(), mat_, mats, white)
  a.name = 'flowers'; b.name = 'flowerStems'
  ctx.add(a, { receive: true })
  ctx.add(b, { receive: true })
}

// ---------- 树 ----------
function treeGeo(ctx, variant, lo) {
  const { pal, prim } = ctx
  const b = new Batch()
  const cT = pal.trunk, cTD = pal.trunkDark
  const trunkCol = (x, y, z, nx, ny, nz, out) => out.copy(cTD).lerp(cT, 0.35 + nx * 0.35 + (y + 0.5) * 0.3)
  const blobCol = ([d, m, l]) => (x, y, z, nx, ny, nz, out) => {
    const u = ny * 0.5 + 0.5
    return u < 0.55 ? out.copy(d).lerp(m, u / 0.55) : out.copy(m).lerp(l, (u - 0.55) / 0.45)
  }
  const det = lo ? 0 : 1
  if (variant === 0) {
    b.add(prim.cyl6, null, mat(0, 0.34, 0, 0, 0, 0, 0.2, 0.7, 0.2), trunkCol)
    const blobs = [[0, 1.0, 0, 0.56], [0.26, 1.3, 0.08, 0.42], [-0.22, 1.28, -0.12, 0.4]]
    blobs.forEach(([x, y, z, r], i) => {
      const g = blob(det, 0.28, 11 + i)
      b.add(g, null, mat(x, y, z, 0, i, 0, r, r * 0.92, r), blobCol(pal.round))
      g.dispose()
    })
  } else if (variant === 1) {
    b.add(prim.cyl6, null, mat(0, 0.25, 0, 0, 0, 0, 0.18, 0.5, 0.18), trunkCol)
    const tiers = [[0.62, 0.75, 0.72], [0.5, 0.66, 1.08], [0.36, 0.56, 1.42], [0.2, 0.42, 1.72]]
    const cone = new THREE.ConeGeometry(1, 1, lo ? 6 : 8, 1)
    const [d, m, l] = pal.pine
    tiers.forEach(([r, h, y], i) => {
      b.add(cone, null, mat(0, y, 0, 0, i * 0.4, 0, r, h, r), (x, yy, z, nx, ny, nz, out) =>
        yy < -0.45 ? out.copy(d) : out.copy(m).lerp(l, Math.max(0, yy + 0.5) * 0.7 + nx * 0.15))
    })
    cone.dispose()
  } else {
    b.add(prim.cyl6, null, mat(0, 0.4, 0, 0, 0, 0, 0.19, 0.8, 0.19), trunkCol)
    const blobs = [[0, 1.08, 0, 0.46, 1.3], [0.04, 1.66, 0.02, 0.32, 1.2]]
    blobs.forEach(([x, y, z, r, sy], i) => {
      const g = blob(det, 0.24, 21 + i)
      b.add(g, null, mat(x, y, z, 0, i * 0.7, 0, r, r * sy, r), blobCol(pal.oval))
      g.dispose()
    })
  }
  return b.build()
}

function buildTrees(ctx) {
  const { map, dark } = ctx
  const W = map.w, H = map.h
  const near = [[], [], []], nearC = [[], [], []], far = [[], [], []], farC = [[], [], []]
  const pick = (x, y) => {
    const r = h3(x, y, 5)
    return dark ? (r < 0.45 ? 1 : r < 0.8 ? 0 : 2) : (r < 0.55 ? 0 : r < 0.8 ? 1 : 2)
  }
  const place = (list, cl, x, y, jit) => {
    const v = pick(x, y)
    const px = x + 0.5 + (h3(x, y, 6) - 0.5) * jit, pz = y + 0.5 + (h3(x, y, 7) - 0.5) * jit
    const s = 0.9 + h3(x, y, 8) * 0.35
    const sy = s * (dark ? 1.15 + h3(x, y, 9) * 0.2 : 0.95 + h3(x, y, 9) * 0.15)
    pushTRS(list[v], px, 0, pz, h3(x, y, 10) * 6.283, s, sy, s)
    cl[v].push(0.9 + h3(x, y, 12) * 0.16, 0.93 + h3(x, y, 13) * 0.12, 0.86 + h3(x, y, 14) * 0.2)
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (map.tiles[y][x] === 'T') place(near, nearC, x, y, 0.2)
  // 地图外的树林：由近到远逐渐稀疏，通往地图出口的土路两侧留出通道
  const R = 15
  for (let y = -R; y < H + R; y++) for (let x = -R; x < W + R; x++) {
    if (x >= 0 && y >= 0 && x < W && y < H) continue
    const dx = x < 0 ? -x : x >= W ? x - W + 1 : 0, dy = y < 0 ? -y : y >= H ? y - H + 1 : 0
    const d = Math.max(dx, dy)
    const cx = Math.min(W - 1, Math.max(0, x)), cy = Math.min(H - 1, Math.max(0, y))
    if ((dx === 0 || dy === 0) && map.tiles[cy][cx] !== 'T') continue
    const p = d <= 2 ? 0.92 : d <= 6 ? 0.72 : d <= 10 ? 0.45 : 0.25
    if (h3(x, y, 15) > p) continue
    if (d <= 2) place(near, nearC, x, y, 0.5)
    else place(far, farC, x, y, 0.7)
  }
  for (let v = 0; v < 3; v++) {
    if (near[v].length) {
      const m = makeInstanced(treeGeo(ctx, v, false), ctx.vcMat, near[v], nearC[v])
      m.name = 'trees' + v
      ctx.add(m, { cast: true, receive: true })
      addOutline(m, 0.03)
    }
    if (far[v].length) {
      const m = makeInstanced(treeGeo(ctx, v, true), ctx.vcMat, far[v], farC[v])
      m.name = 'farTrees' + v
      ctx.add(m, { cast: false, receive: false })
      addOutline(m, 0.035)
    }
  }
}

// ---------- 岩石 ----------
function buildRocks(ctx) {
  const { map, pal, dark } = ctx
  const mats = [], cols = []
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (map.tiles[y][x] !== 'r') continue
    const s = 0.95 + h3(x, y, 60) * 0.25
    pushTRS(mats, x + 0.5, 0, y + 0.5, h3(x, y, 61) * 6.283, s, s * (0.9 + h3(x, y, 62) * 0.25), s)
    const v = 0.92 + h3(x, y, 63) * 0.14
    cols.push(v, v, v * 1.02)
  }
  if (!mats.length) return
  const b = new Batch()
  const [d, m, l] = pal.rock, moss = pal.moss
  const col = (x, y, z, nx, ny, nz, out) => {
    const u = ny * 0.5 + 0.5
    out.copy(d).lerp(m, Math.min(1, u * 1.4))
    if (u > 0.8) out.lerp(l, (u - 0.8) * 3)
    if (dark && ny > 0.75) out.lerp(moss, 0.55)
    return out
  }
  const g1 = blob(1, 0.42, 71), g2 = blob(1, 0.45, 72)
  b.add(g1, null, mat(0, 0.2, 0, 0, 0, 0, 0.38, 0.3, 0.33), col)
  b.add(g2, null, mat(0.27, 0.09, 0.2, 0, 0.6, 0, 0.19, 0.14, 0.17), col)
  g1.dispose(); g2.dispose()
  const mesh = makeInstanced(b.build(), ctx.vcMat, mats, cols)
  mesh.name = 'rocks'
  ctx.add(mesh, { cast: true, receive: true })
  addOutline(mesh, 0.025)
}

// ---------- 栅栏 / 告示牌 / 栈桥 ----------
function buildProps(ctx) {
  const { map, prim } = ctx
  const b = new Batch()
  const post = C('#a86f3d'), rail = C('#c98f55'), hi = C('#e0aa70'), dk = C('#8a5a2b'), sPost = C('#7a4f2a')
  const isF = (x, y) => tileAt(map, x, y) === '#' && x >= 0 && y >= 0 && x < map.w && y < map.h
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const t = map.tiles[y][x], cx = x + 0.5, cz = y + 0.5
    if (t === '#') {
      b.add(prim.box, post, mat(cx, 0.3, cz, 0, 0, 0, 0.13, 0.6, 0.13))
      b.add(prim.box, hi, mat(cx, 0.62, cz, 0, Math.PI / 4, 0, 0.12, 0.05, 0.12))
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => isF(x + dx, y + dy))
      const runs = dirs.length ? dirs : [[1, 0], [-1, 0]]
      for (const [dx, dy] of runs) {
        const mx = cx + dx * 0.25, mz = cz + dy * 0.25, horiz = dx !== 0
        for (const [ry, c] of [[0.24, rail], [0.46, rail]]) {
          b.add(prim.box, c, mat(mx, ry, mz, 0, 0, 0, horiz ? 0.56 : 0.05, 0.075, horiz ? 0.05 : 0.56))
          b.add(prim.box, hi, mat(mx, ry + 0.042, mz, 0, 0, 0, horiz ? 0.56 : 0.052, 0.012, horiz ? 0.052 : 0.56))
        }
      }
    } else if (t === 'S') {
      b.add(prim.box, sPost, mat(cx, 0.32, cz, 0, 0, 0, 0.1, 0.64, 0.1))
      b.add(prim.box, rail, mat(cx, 0.66, cz, 0, 0, 0, 0.8, 0.44, 0.07))
      b.add(prim.box, hi, mat(cx, 0.895, cz, 0, 0, 0, 0.84, 0.05, 0.09))
      b.add(prim.box, dk, mat(cx, 0.435, cz, 0, 0, 0, 0.84, 0.04, 0.09))
      for (const [ly, lw, lx] of [[0.77, 0.52, 0], [0.665, 0.42, -0.05], [0.56, 0.3, -0.11]]) {
        b.add(prim.box, dk, mat(cx + lx, ly, cz + 0.036, 0, 0, 0, lw, 0.03, 0.012))
      }
    } else if (t === 'B') {
      // 行走方向：南北两侧能走（栈桥/陆地）→ 纵向
      const walk = (tx, ty) => { const n = tileAt(map, tx, ty); return n === 'B' || (!isWaterT(n) && n !== 'T') }
      const vertical = walk(x, y - 1) || walk(x, y + 1) || !(walk(x - 1, y) || walk(x + 1, y))
      const R = mat(cx, 0, cz, 0, vertical ? 0 : Math.PI / 2, 0)
      for (let k = 0; k < 4; k++) {
        const c = new THREE.Color(0xb07a47).multiplyScalar(0.9 + h3(x * 4 + k, y, 90) * 0.18)
        b.add(prim.box, c, mul(R, mat((h3(x, y * 4 + k, 91) - 0.5) * 0.03, 0.045, -0.375 + k * 0.25, 0, 0, 0, 0.86, 0.05, 0.22)))
      }
      for (const sx of [-0.42, 0.42]) {
        b.add(prim.box, dk, mul(R, mat(sx, 0.0, 0, 0, 0, 0, 0.07, 0.08, 1.0)))
        for (const sz of [-0.38, 0.38]) b.add(prim.cyl6, C('#6b4424'), mul(R, mat(sx, -0.1, sz, 0, 0, 0, 0.1, 0.44, 0.1)))
      }
    }
  }
  const g = b.build()
  if (!g) return
  const mesh = new THREE.Mesh(g, ctx.vcMat)
  mesh.name = 'props'
  ctx.add(mesh, { cast: true, receive: true })
  addOutline(mesh, 0.018)
}

// ---------- 建筑 ----------
const WALL = '#f3ead6', TRIM = '#d9c9a6', BASE = '#b9a47e', FRAME = '#6b4a30', INK = '#1c1a2e'
function buildBuildings(ctx, anchors) {
  const { map, prim } = ctx
  if (!map.buildings.length) return
  const shell = new Batch(), detail = new Batch(), glass = new Batch()
  const cWall = C(WALL), cTrim = C(TRIM), cBase = C(BASE), cFrame = C(FRAME), cInk = C(INK), cWhite = C('#ffffff')
  const cSill = C('#e8dcc0'), cStep = C('#cdbb98'), cDoor = C('#8a5a2b'), cDoorD = C('#6b4424'), cKnob = C('#ffd23f')
  const cMetal = C('#8c96a3'), cBrick = C('#b86b4b'), cBrickD = C('#6e4a3a'), cGlassHi = C('#f2fbff')
  const box = (batch, c, M4, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) =>
    batch.add(prim.box, c, M4 ? mul(M4, mat(x, y, z, rx, ry, rz, sx, sy, sz)) : mat(x, y, z, rx, ry, rz, sx, sy, sz))

  // 窗：面坐标系 F 中 z = 0 为墙面、+z 朝外
  const addWindow = (F, lx, ly, flowers, seed) => {
    box(detail, cFrame, F, lx, ly, 0.03, 0.64, 0.58, 0.06)
    box(glass, null, F, lx, ly, 0.05, 0.52, 0.46, 0.03)
    box(detail, cFrame, F, lx, ly, 0.07, 0.04, 0.46, 0.02)
    box(detail, cFrame, F, lx, ly + 0.02, 0.07, 0.52, 0.04, 0.02)
    box(detail, cGlassHi, F, lx - 0.15, ly + 0.14, 0.068, 0.12, 0.04, 0.01, 0, 0, 0.5)
    box(detail, cSill, F, lx, ly - 0.31, 0.06, 0.74, 0.06, 0.14)
    if (flowers) {
      box(detail, cDoor, F, lx, ly - 0.4, 0.09, 0.62, 0.12, 0.14)
      for (let k = 0; k < 4; k++) {
        const c = C(PETALS[Math.floor(h3(seed, k, 5) * PETALS.length)])
        detail.add(prim.sph0, c, mul(F, mat(lx - 0.22 + k * 0.147, ly - 0.31, 0.1, 0, k, 0, 0.065)))
      }
    }
  }

  for (const b of map.buildings) {
    const x0 = b.x + 0.06, x1 = b.x + b.w - 0.06, z0 = b.y + 0.12, z1 = b.y + b.h - 0.1
    const W = x1 - x0, D = z1 - z0, cx = (x0 + x1) / 2, zc = (z0 + z1) / 2
    const shopLike = b.kind === 'center' || b.kind === 'shop'
    const wallH = b.kind === 'center' ? 1.7 : b.kind === 'shop' ? 1.6 : 1.45
    const half = D / 2, o = 0.24, t = 0.12
    const rise = Math.min(1.25, half * 0.64)
    const th = Math.atan2(rise, half), sin = Math.sin(th), cos = Math.cos(th)
    const ridgeY = wallH + rise
    const slopeLen = (half + o) / cos
    const Wr = W + 2 * o
    const roof = C(b.roof), roofD = C(shade(b.roof, -0.22)), roofDD = C(shade(b.roof, -0.38)), roofL = C(shade(b.roof, 0.14))

    // 墙体 + 阁楼山墙
    box(shell, cWall, null, cx, wallH / 2, zc, W, wallH, D)
    const attic = atticPrism(x0, x1, z0, z1, zc, wallH, ridgeY)
    shell.add(attic, cWall)
    attic.dispose()
    // 屋顶两坡
    for (const side of [1, -1]) {
      const R = mat(cx, ridgeY, zc, side * th, 0, 0)
      // 坡面局部系：+z 沿坡向下（北坡由 R 翻转）、+y 为坡面法线
      const along = (s, up) => mul(R, mat(0, up, side * s, 0, 0, 0))
      shell.add(prim.box, roof, mul(along(slopeLen / 2, t / 2), mat(0, 0, 0, 0, 0, 0, Wr, t, slopeLen)))
      for (let s = 0.32; s < slopeLen - 0.12; s += 0.3) {
        detail.add(prim.box, roofD, mul(along(s, t + 0.012), mat(0, 0, 0, 0, 0, 0, Wr + 0.01, 0.03, 0.05)))
        detail.add(prim.box, roofL, mul(along(s - 0.06, t + 0.004), mat(0, 0, 0, 0, 0, 0, Wr - 0.02, 0.012, 0.05)))
      }
      detail.add(prim.box, roofDD, mul(along(slopeLen - 0.03, t / 2), mat(0, 0, 0, 0, 0, 0, Wr + 0.03, t + 0.05, 0.07)))
    }
    shell.add(prim.box, roofDD, mat(cx, ridgeY + t * 0.9, zc, 0, 0, 0, Wr + 0.06, 0.13, 0.24))

    // 烟囱（民居），在北坡
    if (b.kind === 'house') {
      const chx = x0 + W * 0.74, chz = zc - half * 0.45
      const yRoof = ridgeY - (zc - chz) * (sin / cos) + t / cos
      const top = ridgeY + 0.42, bot = yRoof - 0.3
      box(shell, cBrick, null, chx, (top + bot) / 2, chz, 0.34, top - bot, 0.34)
      box(shell, cBrickD, null, chx, top + 0.04, chz, 0.42, 0.09, 0.42)
    }

    // 墙面装饰：墙裙、转角柱、檐下腰线
    box(detail, cBase, null, cx, 0.08, zc, W + 0.06, 0.16, D + 0.06)
    box(detail, cTrim, null, cx, wallH - 0.05, zc, W + 0.04, 0.1, D + 0.04)
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) box(detail, cTrim, null, px, wallH / 2, pz, 0.14, wallH, 0.14)
    if (shopLike) box(detail, roof, null, cx, wallH - 0.2, zc, W + 0.03, 0.2, D + 0.03)

    // 南立面窗户（避开门所在列）+ 东西侧窗
    const Fs = mat(0, 0, z1, 0, 0, 0)
    const dcol = b.door[0] - b.x
    const wy = wallH * 0.54
    for (let i = 1; i <= b.w - 2; i++) if (i !== dcol) addWindow(Fs, b.x + i + 0.5, wy, b.kind === 'house', b.x * 7 + i)
    addWindow(mat(x1, 0, zc, 0, Math.PI / 2, 0), 0, wy, false, 0)
    addWindow(mat(x0, 0, zc, 0, -Math.PI / 2, 0), 0, wy, false, 0)

    // 门
    const dx = b.door[0] + 0.5
    if (shopLike) {
      box(detail, cMetal, Fs, dx - 0.44, 0.6, 0.04, 0.08, 1.2, 0.08)
      box(detail, cMetal, Fs, dx + 0.44, 0.6, 0.04, 0.08, 1.2, 0.08)
      box(detail, cMetal, Fs, dx, 1.22, 0.04, 0.96, 0.08, 0.08)
      box(glass, null, Fs, dx - 0.2, 0.6, 0.02, 0.38, 1.14, 0.03)
      box(glass, null, Fs, dx + 0.2, 0.6, 0.03, 0.38, 1.14, 0.03)
      box(detail, cMetal, Fs, dx, 0.6, 0.05, 0.04, 1.16, 0.03)
      box(detail, cMetal, Fs, dx - 0.07, 0.6, 0.05, 0.025, 0.24, 0.03)
      box(detail, cMetal, Fs, dx + 0.07, 0.6, 0.055, 0.025, 0.24, 0.03)
      box(detail, cGlassHi, Fs, dx - 0.28, 0.92, 0.042, 0.06, 0.3, 0.01, 0, 0, 0.3)
      box(detail, cGlassHi, Fs, dx + 0.12, 0.92, 0.052, 0.06, 0.3, 0.01, 0, 0, 0.3)
      box(detail, cStep, Fs, dx, 0.035, 0.2, 1.1, 0.07, 0.4)
      box(detail, roofD, Fs, dx, 1.33, 0.18, 1.2, 0.06, 0.38, 0.22)
    } else {
      box(detail, cDoorD, Fs, dx - 0.37, 0.56, 0.05, 0.09, 1.12, 0.1)
      box(detail, cDoorD, Fs, dx + 0.37, 0.56, 0.05, 0.09, 1.12, 0.1)
      box(detail, cDoorD, Fs, dx, 1.14, 0.05, 0.84, 0.1, 0.1)
      box(detail, cDoor, Fs, dx, 0.54, 0.025, 0.66, 1.06, 0.05)
      box(detail, cDoorD, Fs, dx - 0.14, 0.78, 0.052, 0.2, 0.34, 0.01)
      box(detail, cDoorD, Fs, dx + 0.14, 0.78, 0.052, 0.2, 0.34, 0.01)
      box(detail, cDoorD, Fs, dx - 0.14, 0.32, 0.052, 0.2, 0.3, 0.01)
      box(detail, cDoorD, Fs, dx + 0.14, 0.32, 0.052, 0.2, 0.3, 0.01)
      detail.add(prim.sph, cKnob, mul(Fs, mat(dx + 0.22, 0.54, 0.075, 0, 0, 0, 0.042)))
      box(detail, cStep, Fs, dx, 0.035, 0.18, 0.96, 0.07, 0.34)
      box(detail, roof, Fs, dx, 1.34, 0.2, 1.04, 0.06, 0.4, 0.26)
    }

    // 屋顶徽记：南坡中央
    if (shopLike) {
      const E = mul(mat(cx, ridgeY, zc, th, 0, 0), mat(0, t, slopeLen * 0.5, 0, 0, 0))
      detail.add(prim.cyl16, cInk, mul(E, mat(0, 0.02, 0, 0, 0, 0, 1.0, 0.04, 1.0)))
      if (b.kind === 'center') {
        detail.add(prim.cyl16, cWhite, mul(E, mat(0, 0.045, 0, 0, 0, 0, 0.86, 0.04, 0.86)))
        box(detail, C('#ef476f'), E, 0, 0.075, 0, 0.16, 0.03, 0.56)
        box(detail, C('#ef476f'), E, 0, 0.075, 0, 0.56, 0.03, 0.16)
      } else {
        detail.add(prim.cyl16, C('#3a86ff'), mul(E, mat(0, 0.045, 0, 0, 0, 0, 0.86, 0.04, 0.86)))
        box(detail, cWhite, E, 0, 0.075, 0.05, 0.36, 0.03, 0.26)
        const handle = new THREE.TorusGeometry(0.08, 0.022, 6, 12, Math.PI)
        detail.add(handle, cWhite, mul(E, mat(0, 0.075, -0.08, -Math.PI / 2, 0, 0)))
        handle.dispose()
      }
    }

    anchors.push({ x: cx, y: ridgeY + 0.6, z: zc, text: b.label, kind: 'building' })
  }

  const shellMesh = new THREE.Mesh(shell.build(), ctx.vcMat)
  shellMesh.name = 'buildings'
  ctx.add(shellMesh, { cast: true, receive: true })
  addOutline(shellMesh, 0.035)
  const detailMesh = new THREE.Mesh(detail.build(), ctx.vcMat)
  detailMesh.name = 'buildingDetails'
  ctx.add(detailMesh, { cast: true, receive: true })
  const glassMesh = new THREE.Mesh(glass.build(), toonMat('#9fdcff', { emissive: 0x1d4a66 }))
  glassMesh.name = 'glass'
  ctx.add(glassMesh, { receive: true })
}
