// 3D 战斗舞台：独立 WebGLRenderer 渲染到 #b-3d。
// 负责场景（草地 / 湖畔 / 森林 / 竞技场）、双方站台与精灵、相机运镜、粒子池以及所有招式 / 受击 / 捕捉动画。
// 所有异步动画都由舞台自己的 tween 队列驱动；舞台关闭或不可用时 tween 立即结束，保证调用方的 Promise 一定会 resolve。
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { toonMat, addOutline, disposeTree } from './materials.js'
import { buildCreature, buildBall } from './models.js'
import { MOVES } from '../data/moves.js'
import { mulberry32 } from '../util.js'

const TAU = Math.PI * 2
const V = () => new THREE.Vector3()
const rnd = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const lerp = (a, b, t) => a + (b - a) * t

const E = {
  lin: (k) => k,
  in2: (k) => k * k,
  in: (k) => k * k * k,
  out: (k) => 1 - (1 - k) ** 3,
  inOut: (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2),
  back: (k) => { const c = 1.9; return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2 },
  bounce: (k) => {
    const n = 7.5625, d = 2.75
    if (k < 1 / d) return n * k * k
    if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75
    if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375
    return n * (k -= 2.625 / d) * k + 0.984375
  },
}

// —— 站位（世界坐标）：我方在左前，镜头在我方身后偏右，看向右后方的对手 ——
const HOME = { me: new THREE.Vector3(-1.6, 0.06, 1.6), foe: new THREE.Vector3(2.0, 0.06, -4.4) }
const PLAT = { me: 1.8, foe: 1.55 }
const SCALE = { me: 2.5, foe: 2.2 }
const FACE = { me: Math.atan2(3.6, -6.0), foe: Math.atan2(-2.0, 8.4) }
const TRAINER = { me: new THREE.Vector3(-3.6, 1.4, 6.4), foe: new THREE.Vector3(4.8, 1.8, -8.6) }
const MID = new THREE.Vector3(0.2, 0, -1.4)
const OTHER = { me: 'foe', foe: 'me' }
const CONTACT = new Set(['tackle', 'scratch', 'quick', 'headbutt', 'flamewheel', 'aquatail', 'spark', 'icefang', 'bugbite', 'peck', 'wingattack', 'lick'])

// 招式特效配色：[高光, 主色, 暗色]
const FX = {
  normal: [0xffffff, 0xfff1c2, 0xb8b690],
  fire: [0xffe56b, 0xff7a1f, 0xd8321a],
  water: [0xe6f6ff, 0x5aa9ff, 0x2a62d8],
  grass: [0xdcff9a, 0x6fd13f, 0x2f8a2a],
  electric: [0xffffd6, 0xffe033, 0xffa800],
  ice: [0xffffff, 0xa6f0ff, 0x55c7e8],
  rock: [0xeadcae, 0xb6a136, 0x7a6a3a],
  ground: [0xf0d49a, 0xc0904a, 0x7a5230],
  flying: [0xffffff, 0xdcd2ff, 0x8f78e6],
  bug: [0xf4ffd0, 0xc8e05a, 0x7e9a14],
  ghost: [0xe6ccff, 0x9a5cff, 0x3a1f66],
  psychic: [0xffd6e8, 0xff5a9e, 0xb23aff],
  dragon: [0xd8ccff, 0x7a4cff, 0x2a6cff],
}

// —— 场景环境 ——
const ENV = {
  meadow: { top: 0x3f8fe8, horizon: 0xd2f0ff, bottom: 0x9fd98a, sun: [0.35, 0.5, -0.8], sunColor: 0xfff4c8, sunSize: 0.012, fog: [0xd2f0ff, 34, 100], hemi: [0xe2f2ff, 0x6f9a52, 1.55], dir: [0xfff1dc, 2.0], stars: 0 },
  lake: { top: 0x6a86d6, horizon: 0xffc596, bottom: 0x7ec8ea, sun: [-0.22, 0.09, -1], sunColor: 0xffb070, sunSize: 0.035, fog: [0xffc596, 36, 110], hemi: [0xffe6cc, 0x5b8fa8, 1.5], dir: [0xffdcae, 2.0], stars: 0 },
  forest: { top: 0x0c1630, horizon: 0x21364d, bottom: 0x16241c, sun: [-0.45, 0.42, -0.8], sunColor: 0xe4ecff, sunSize: 0.01, fog: [0x21364d, 9, 40], hemi: [0x7890c4, 0x1f2f22, 1.35], dir: [0xbcd0ff, 1.7], stars: 1 },
  arena: { top: 0x3a8ff0, horizon: 0xffe9b8, bottom: 0xe9d3a2, sun: [0.3, 0.68, -0.66], sunColor: 0xfff6d8, sunSize: 0.01, fog: [0xffe9b8, 42, 120], hemi: [0xfff4e0, 0x8a7350, 1.55], dir: [0xfff0d8, 2.1], stars: 0 },
}

// —— 粒子池（一个 THREE.Points，自定义着色器，逐粒子尺寸 / 颜色 / 透明度 / 形状）——
// 形状：0 柔光点 1 四角星闪 2 实心圆 3 圆环 4 萤火（闪烁） 5 彩纸（翻转） 6 羽毛 / 叶片（旋转椭圆）
const P_VERT = `
attribute float aSize;
attribute float aAlpha;
attribute float aShape;
attribute vec3 aColor;
uniform float uPx;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSeed;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vShape = aShape;
  vSeed = fract(aSize * 91.7 + aShape * 0.37);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(aSize * projectionMatrix[1][1] * uPx / max(0.1, -mv.z), 0.0, 320.0);
}`
const P_FRAG = `
uniform float uTime;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSeed;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float a = 0.0;
  vec3 col = vColor;
  if (vShape < 0.5) {
    a = 1.0 - smoothstep(0.0, 1.0, r); a *= a;
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.35, r)) * 0.5);
  } else if (vShape < 1.5) {
    float s = max(0.0, 1.0 - abs(p.x) * 7.0) * (1.0 - abs(p.y)) + max(0.0, 1.0 - abs(p.y) * 7.0) * (1.0 - abs(p.x));
    a = clamp(s + (1.0 - smoothstep(0.0, 0.42, r)) * 0.8, 0.0, 1.0);
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.3, r)) * 0.7);
  } else if (vShape < 2.5) {
    a = 1.0 - smoothstep(0.72, 1.0, r);
  } else if (vShape < 3.5) {
    a = 1.0 - smoothstep(0.0, 0.2, abs(r - 0.78));
  } else if (vShape < 4.5) {
    a = 1.0 - smoothstep(0.0, 1.0, r); a *= a;
    a *= 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * 5.0 + vSeed * 40.0));
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.25, r)) * 0.6);
  } else if (vShape < 5.5) {
    float w = 0.12 + 0.45 * abs(sin(uTime * 9.0 + vSeed * 30.0));
    a = step(abs(p.x), w) * step(abs(p.y), 0.55);
  } else {
    float ang = vSeed * 6.2831 + uTime * 2.5;
    float c = cos(ang), s = sin(ang);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    a = 1.0 - smoothstep(0.8, 1.0, length(q * vec2(2.6, 1.0)));
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`

class Particles {
  constructor(cap, blending) {
    this.cap = cap
    this.n = 0
    this.pos = new Float32Array(cap * 3)
    this.col = new Float32Array(cap * 3)
    this.vel = new Float32Array(cap * 3)
    this.size = new Float32Array(cap)
    this.alpha = new Float32Array(cap)
    this.shape = new Float32Array(cap)
    this.life = new Float32Array(cap)
    this.max = new Float32Array(cap)
    this.s0 = new Float32Array(cap)
    this.s1 = new Float32Array(cap)
    this.a0 = new Float32Array(cap)
    this.grav = new Float32Array(cap)
    this.drag = new Float32Array(cap)
    const g = new THREE.BufferGeometry()
    const attr = (arr, n, name) => {
      const a = new THREE.BufferAttribute(arr, n)
      a.setUsage(THREE.DynamicDrawUsage)
      g.setAttribute(name, a)
      return a
    }
    this.attrs = [attr(this.pos, 3, 'position'), attr(this.col, 3, 'aColor'), attr(this.size, 1, 'aSize'), attr(this.alpha, 1, 'aAlpha'), attr(this.shape, 1, 'aShape')]
    g.setDrawRange(0, 0)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4)
    this.geo = g
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uPx: { value: 400 }, uTime: { value: 0 } },
      vertexShader: P_VERT, fragmentShader: P_FRAG,
      transparent: true, depthWrite: false, blending,
    })
    this.points = new THREE.Points(g, this.mat)
    this.points.frustumCulled = false
    this.points.renderOrder = blending === THREE.AdditiveBlending ? 6 : 5
  }

  spawn(x, y, z, vx, vy, vz, life, s0, s1, r, g, b, grav, drag, shape, alpha) {
    if (this.n >= this.cap) return
    const i = this.n++, i3 = i * 3
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz
    this.col[i3] = r; this.col[i3 + 1] = g; this.col[i3 + 2] = b
    this.life[i] = this.max[i] = Math.max(0.05, life)
    this.s0[i] = s0; this.s1[i] = s1; this.size[i] = s0
    this.a0[i] = alpha; this.alpha[i] = 0
    this.grav[i] = grav; this.drag[i] = drag; this.shape[i] = shape
  }

  move(src, dst) {
    const s3 = src * 3, d3 = dst * 3
    for (let k = 0; k < 3; k++) {
      this.pos[d3 + k] = this.pos[s3 + k]
      this.vel[d3 + k] = this.vel[s3 + k]
      this.col[d3 + k] = this.col[s3 + k]
    }
    this.size[dst] = this.size[src]; this.alpha[dst] = this.alpha[src]; this.shape[dst] = this.shape[src]
    this.life[dst] = this.life[src]; this.max[dst] = this.max[src]; this.s0[dst] = this.s0[src]; this.s1[dst] = this.s1[src]
    this.a0[dst] = this.a0[src]; this.grav[dst] = this.grav[src]; this.drag[dst] = this.drag[src]
  }

  update(dt, time) {
    this.mat.uniforms.uTime.value = time
    let n = this.n
    const { pos, vel, life, max } = this
    for (let i = 0; i < n;) {
      life[i] -= dt
      if (life[i] <= 0) {
        n--
        if (i !== n) this.move(n, i)
        continue
      }
      const i3 = i * 3
      const d = Math.max(0, 1 - this.drag[i] * dt)
      vel[i3] *= d; vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt; vel[i3 + 2] *= d
      pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt
      const k = 1 - life[i] / max[i]
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * k
      this.alpha[i] = this.a0[i] * Math.min(1, k * 12) * Math.min(1, (1 - k) * 2.2)
      i++
    }
    this.n = n
    this.geo.setDrawRange(0, n)
    if (n > 0 || this.dirty) {
      for (const a of this.attrs) {
        a.clearUpdateRanges()
        a.addUpdateRange(0, Math.max(1, n) * a.itemSize)
        a.needsUpdate = true
      }
    }
    this.dirty = n > 0
  }

  clear() { this.n = 0; this.geo.setDrawRange(0, 0) }
  dispose() { this.geo.dispose(); this.mat.dispose() }
}

function spec(o) {
  const s = Object.assign({ pool: 'glow', n: 12, speed: [1, 2], dir: null, spread: 1, up: 0, life: [0.4, 0.8], size: [0.12, 0.24], end: 0.3, color: 0xffffff, color2: null, grav: 0, drag: 2, shape: 0, alpha: 1, jitter: 0 }, o)
  s.c1 = new THREE.Color(s.color)
  s.c2 = new THREE.Color(s.color2 ?? s.color)
  return s
}

// —— 闪电：共享一条折线的两条面向相机的条带（外发光 + 白色内核），几何体原地重写 ——
class Bolt {
  constructor(segs, color, width) {
    this.segs = segs
    this.width = width
    this.pts = new Float32Array((segs + 1) * 3)
    this.meshes = [this.ribbon(color, 0.55), this.ribbon(0xffffff, 1)]
    this.meshes[0].renderOrder = 7
    this.meshes[1].renderOrder = 8
    this._a = V(); this._b = V(); this._c = V(); this._d = V(); this._u = V(); this._w = V()
  }

  ribbon(color, opacity) {
    const n = this.segs + 1
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 6), 3))
    const idx = []
    for (let i = 0; i < this.segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2) }
    g.setIndex(idx)
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }))
    m.material.userData.fx = true
    m.frustumCulled = false
    return m
  }

  regen(from, to, jag, camPos) {
    const { pts, segs } = this
    const dir = this._a.subVectors(to, from)
    const len = dir.length()
    dir.normalize()
    const u = this._u.set(0, 1, 0)
    if (Math.abs(dir.y) > 0.9) u.set(1, 0, 0)
    u.cross(dir).normalize()
    const w = this._w.crossVectors(dir, u)
    let ox = 0, oy = 0
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const env = Math.sin(Math.PI * t)
      ox = ox * 0.35 + (Math.random() * 2 - 1) * jag * len * 0.16
      oy = oy * 0.35 + (Math.random() * 2 - 1) * jag * len * 0.16
      pts[i * 3] = from.x + dir.x * len * t + (u.x * ox + w.x * oy) * env
      pts[i * 3 + 1] = from.y + dir.y * len * t + (u.y * ox + w.y * oy) * env
      pts[i * 3 + 2] = from.z + dir.z * len * t + (u.z * ox + w.z * oy) * env
    }
    this.write(this.meshes[0], this.width * 3.2, camPos)
    this.write(this.meshes[1], this.width, camPos)
  }

  write(mesh, width, camPos) {
    const { pts, segs } = this
    const arr = mesh.geometry.attributes.position.array
    const p = this._b, tg = this._c, side = this._d
    for (let i = 0; i <= segs; i++) {
      const a = Math.max(0, i - 1), b = Math.min(segs, i + 1)
      p.set(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2])
      tg.set(pts[b * 3] - pts[a * 3], pts[b * 3 + 1] - pts[a * 3 + 1], pts[b * 3 + 2] - pts[a * 3 + 2])
      side.subVectors(camPos, p).cross(tg).normalize().multiplyScalar(width * (0.5 + 0.5 * Math.sin(Math.PI * i / segs) + 0.15))
      arr[i * 6] = p.x + side.x; arr[i * 6 + 1] = p.y + side.y; arr[i * 6 + 2] = p.z + side.z
      arr[i * 6 + 3] = p.x - side.x; arr[i * 6 + 4] = p.y - side.y; arr[i * 6 + 5] = p.z - side.z
    }
    mesh.geometry.attributes.position.needsUpdate = true
  }
}

// —— 程序化贴图 ——
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  draw(c.getContext('2d'), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

function makeTextures() {
  if (typeof document === 'undefined') return {}
  const glow = canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.75)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.18)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    x.fillStyle = g
    x.fillRect(0, 0, w, w)
  })
  const star = canvasTex(128, 128, (x, w) => {
    const c = w / 2
    x.translate(c, c)
    x.shadowColor = 'rgba(255,255,255,0.9)'
    x.shadowBlur = 10
    x.fillStyle = '#fff'
    x.beginPath()
    for (let i = 0; i < 16; i++) {
      const r = i % 2 ? c * 0.3 : c * (i % 4 ? 0.72 : 0.92)
      const a = (i / 16) * TAU
      x.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    }
    x.closePath()
    x.fill()
  })
  const beam = canvasTex(4, 64, (x, w, h) => {
    const g = x.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#000')
    g.addColorStop(0.55, '#888')
    g.addColorStop(1, '#fff')
    x.fillStyle = g
    x.fillRect(0, 0, w, h)
  })
  const blob = canvasTex(64, 64, (x, w) => {
    const g = x.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2)
    g.addColorStop(0, 'rgba(0,0,0,0.85)')
    g.addColorStop(0.55, 'rgba(0,0,0,0.45)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, w, w)
  })
  return { glow, star, beam, blob }
}

function arenaFieldTex() {
  return canvasTex(512, 512, (x, w) => {
    const c = w / 2
    x.fillStyle = '#e6cf9c'
    x.fillRect(0, 0, w, w)
    for (let i = 0; i < 900; i++) {
      x.fillStyle = `rgba(120,90,40,${Math.random() * 0.08})`
      x.fillRect(Math.random() * w, Math.random() * w, 3, 3)
    }
    x.strokeStyle = '#fffaf0'
    x.lineWidth = 10
    x.beginPath(); x.arc(c, c, c - 14, 0, TAU); x.stroke()
    x.lineWidth = 5
    x.setLineDash([18, 14])
    x.beginPath(); x.arc(c, c, c * 0.62, 0, TAU); x.stroke()
    x.setLineDash([])
    x.lineWidth = 8
    x.beginPath(); x.arc(c, c, c * 0.2, 0, TAU); x.stroke()
    x.fillStyle = '#8e5cf7'
    x.beginPath(); x.arc(c, c, c * 0.16, 0, TAU); x.fill()
    x.fillStyle = '#fffaf0'
    x.beginPath(); x.arc(c, c, c * 0.06, 0, TAU); x.fill()
  })
}

// —— 共享几何体（整个渲染器生命周期内复用，不随战斗释放）——
function sharedGeometries() {
  const leafShape = new THREE.Shape()
  leafShape.moveTo(0, -1)
  leafShape.quadraticCurveTo(0.62, -0.1, 0, 1)
  leafShape.quadraticCurveTo(-0.62, -0.1, 0, -1)
  const crescent = new THREE.Shape()
  crescent.absarc(0, 0, 1, Math.PI * 0.1, Math.PI * 0.9, false)
  crescent.absarc(0, -0.38, 0.86, Math.PI * 0.84, Math.PI * 0.16, true)
  const jaw = new THREE.Shape()
  jaw.moveTo(-1, 0)
  for (let i = 1; i <= 8; i++) jaw.lineTo(-1 + i * 0.25, i % 2 ? -0.38 : 0)
  jaw.absarc(0, 0, 1, 0, Math.PI, false)
  const arrowShape = new THREE.Shape()
  arrowShape.moveTo(0, 1)
  arrowShape.lineTo(0.6, 0.35)
  arrowShape.lineTo(0.24, 0.35)
  arrowShape.lineTo(0.24, -0.8)
  arrowShape.lineTo(-0.24, -0.8)
  arrowShape.lineTo(-0.24, 0.35)
  arrowShape.lineTo(-0.6, 0.35)
  arrowShape.closePath()
  const shard = new THREE.OctahedronGeometry(1, 0)
  shard.scale(0.28, 1, 0.28)
  const beam = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true)
  const cone = new THREE.ConeGeometry(1, 1, 24, 1, true)
  cone.translate(0, -0.5, 0)
  const geo = {
    sphere: new THREE.SphereGeometry(1, 18, 12),
    leaf: new THREE.ShapeGeometry(leafShape, 6),
    rock: new THREE.DodecahedronGeometry(1, 0),
    shard,
    ring: new THREE.RingGeometry(0.8, 1, 48),
    thinRing: new THREE.RingGeometry(0.92, 1, 48),
    beam,
    cone,
    crescent: new THREE.ShapeGeometry(crescent, 12),
    jaw: new THREE.ShapeGeometry(jaw, 12),
    arrow: new THREE.ShapeGeometry(arrowShape),
    disc: new THREE.CircleGeometry(1, 28),
  }
  for (const g of Object.values(geo)) g.userData.shared = true
  return geo
}

// —— 场景搭建工具 ——
function part(geo, hex, fn) {
  let g = geo.index ? geo.toNonIndexed() : geo
  if (g !== geo) geo.dispose()
  fn?.(g)
  const c = new THREE.Color(hex)
  const n = g.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  return g
}

function merged(parts) {
  const g = mergeGeometries(parts)
  for (const p of parts) p.dispose()
  return g
}

const vcMat = () => toonMat(0xffffff, { vertexColors: true })

function scatter(geo, mat, list, { outline = 0, cast = false } = {}) {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length))
  m.count = list.length
  const o = new THREE.Object3D()
  const c = new THREE.Color()
  list.forEach((it, i) => {
    o.position.set(it.x, it.y || 0, it.z)
    o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0)
    const s = it.s ?? 1
    o.scale.set(it.sx ?? s, it.sy ?? s, it.sz ?? s)
    o.updateMatrix()
    m.setMatrixAt(i, o.matrix)
    if (it.c != null) m.setColorAt(i, c.set(it.c))
  })
  m.instanceMatrix.needsUpdate = true
  if (m.instanceColor) m.instanceColor.needsUpdate = true
  m.castShadow = cast
  m.receiveShadow = true
  m.computeBoundingSphere()
  if (outline) addOutline(m, outline)
  return m
}

function groundMesh(size, seg, colorAt) {
  const g = new THREE.PlaneGeometry(size, size, seg, seg)
  g.rotateX(-Math.PI / 2)
  const p = g.attributes.position
  const arr = new Float32Array(p.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < p.count; i++) {
    colorAt(p.getX(i), p.getZ(i), c)
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  const m = new THREE.Mesh(g, vcMat())
  m.receiveShadow = true
  return m
}

const noise2 = (x, z) => Math.sin(x * 0.31 + Math.sin(z * 0.17) * 2.1) * Math.cos(z * 0.27 - x * 0.11)
const nearPlat = (x, z, pad) => Math.hypot(x - HOME.me.x, z - HOME.me.z) < PLAT.me + pad || Math.hypot(x - HOME.foe.x, z - HOME.foe.z) < PLAT.foe + pad
// 镜头与两个站台之间的视线走廊，不放高大物件
const inView = (x, z) => z > -7 && z < 12 && x > -5.5 && x < 6

function platform(r, top, side, ring) {
  const g = new THREE.Group()
  const base = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.03, r * 1.14, 0.3, 48), toonMat(side))
  base.position.y = -0.12
  base.receiveShadow = true
  addOutline(base, 0.035)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 48), toonMat(top))
  cap.position.y = 0.03
  cap.receiveShadow = true
  const rg = new THREE.Mesh(new THREE.RingGeometry(r * 0.7, r * 0.78, 48), toonMat(ring))
  rg.rotation.x = -Math.PI / 2
  rg.position.y = 0.064
  rg.receiveShadow = true
  g.add(base, cap, rg)
  return g
}

function roundTreeGeo() {
  return merged([
    part(new THREE.CylinderGeometry(0.14, 0.2, 1.2, 7), 0x8a5a36, (g) => g.translate(0, 0.6, 0)),
    part(new THREE.IcosahedronGeometry(0.95, 1), 0x5cb04a, (g) => g.translate(0, 1.75, 0)),
    part(new THREE.IcosahedronGeometry(0.62, 1), 0x78c85a, (g) => g.translate(0.25, 2.4, 0.1)),
  ])
}

function pineGeo(c1, c2) {
  return merged([
    part(new THREE.CylinderGeometry(0.13, 0.2, 1.0, 6), 0x5a3b26, (g) => g.translate(0, 0.5, 0)),
    part(new THREE.ConeGeometry(1.15, 1.5, 8), c1, (g) => g.translate(0, 1.45, 0)),
    part(new THREE.ConeGeometry(0.9, 1.3, 8), c2, (g) => g.translate(0, 2.15, 0)),
    part(new THREE.ConeGeometry(0.58, 1.1, 8), c1, (g) => g.translate(0, 2.8, 0)),
  ])
}

function tuftGeo() {
  const parts = []
  for (let i = 0; i < 3; i++) {
    parts.push(part(new THREE.ConeGeometry(0.06, 0.38, 4), 0xffffff, (g) => {
      g.translate(0, 0.19, 0)
      g.rotateZ((i - 1) * 0.35)
      g.rotateY(i * 2.1)
    }))
  }
  return merged(parts)
}

function cloudGeo() {
  const parts = [[0, 0, 0, 1.3], [1.2, -0.2, 0.1, 0.95], [-1.2, -0.25, 0, 0.9], [0.5, 0.55, -0.1, 0.85], [-0.5, 0.4, 0.2, 0.75]]
  return merged(parts.map(([x, y, z, r]) => part(new THREE.SphereGeometry(r, 12, 8), 0xffffff, (g) => { g.scale(1, 0.72, 0.8); g.translate(x, y, z) })))
}

function skyMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() },
      uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunSize: { value: 0.01 },
      uStars: { value: 0 }, uTime: { value: 0 },
    },
    vertexShader: `varying vec3 vDir;
void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uBottom; uniform vec3 uSun; uniform vec3 uSunColor;
uniform float uSunSize; uniform float uStars; uniform float uTime;
varying vec3 vDir;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 0.62, h), 0.8)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.12, h));
  float s = max(dot(d, normalize(uSun)), 0.0);
  c += uSunColor * (smoothstep(1.0 - uSunSize, 1.0 - uSunSize * 0.55, s) * 0.9 + pow(s, 48.0) * 0.35 + pow(s, 6.0) * 0.08);
  if (uStars > 0.0 && h > 0.05) {
    vec3 g = floor(d * 260.0);
    float st = step(0.9975, hash(g));
    c += st * (0.5 + 0.5 * sin(uTime * 3.0 + hash(g + 1.0) * 30.0)) * smoothstep(0.05, 0.4, h) * vec3(0.9, 0.95, 1.0);
  }
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
    side: THREE.BackSide, depthWrite: false,
  })
  return m
}

function waterMaterial(horizon) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x2f7fc4) }, uShallow: { value: new THREE.Color(0x6fd0e8) },
      uFoam: { value: new THREE.Color(0xf4fbff) }, uHorizon: { value: new THREE.Color(horizon) },
      uA: { value: new THREE.Vector3(HOME.me.x, HOME.me.z, PLAT.me + 0.62) },
      uB: { value: new THREE.Vector3(HOME.foe.x, HOME.foe.z, PLAT.foe + 0.62) },
    },
    vertexShader: `varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform vec3 uHorizon;
uniform vec3 uA; uniform vec3 uB;
varying vec3 vW;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = vW.xz;
  float d = min(length(p - uA.xy) - uA.z, length(p - uB.xy) - uB.z);
  vec3 c = mix(uShallow, uDeep, smoothstep(0.0, 7.0, d));
  float w = sin(p.x * 1.2 + uTime * 1.1 + sin(p.y * 0.7 + uTime * 0.6) * 1.6) * sin(p.y * 1.6 - uTime * 0.9 + sin(p.x * 0.5) * 1.2);
  c = mix(c, c * 1.18 + 0.04, step(0.78, w));
  float ring = sin(d * 5.0 - uTime * 2.4);
  float foam = (1.0 - smoothstep(0.0, 0.25, d)) + step(0.86, ring) * (1.0 - smoothstep(0.2, 1.1, d)) * 0.75;
  c = mix(c, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
  vec2 cell = floor(p * 3.0);
  float tw = step(0.992, hash(cell)) * (0.5 + 0.5 * sin(uTime * 4.0 + hash(cell + 3.0) * 20.0));
  c += tw * 0.55;
  float dist = length(p - vec2(0.3, -1.4));
  c = mix(c, uHorizon, smoothstep(22.0, 70.0, dist));
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}`,
  })
  m.userData.unique = true
  return m
}

// 生成场景：返回 { group, update(t, dt, stage), hype? }
function buildArena(bg, kind, tex) {
  const group = new THREE.Group()
  const rng = mulberry32(bg.length * 977 + 13)
  const R = (a, b) => a + rng() * (b - a)
  const updates = []
  const arena = { group, hype: 0, update: (t, dt, st) => { for (const u of updates) u(t, dt, st) } }
  const ring = (count, rMin, rMax, fn, avoid = true) => {
    const out = []
    let guard = 0
    while (out.length < count && guard++ < count * 40) {
      const a = R(0, TAU), r = R(rMin, rMax)
      const x = MID.x + Math.cos(a) * r, z = MID.z + Math.sin(a) * r
      if (avoid && (inView(x, z) || nearPlat(x, z, 1))) continue
      out.push(fn(x, z))
    }
    return out
  }
  const around = (slot, count, pad, fn) => {
    const out = []
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + R(-0.2, 0.2), r = PLAT[slot] + pad + R(-0.1, 0.25)
      out.push(fn(HOME[slot].x + Math.cos(a) * r, HOME[slot].z + Math.sin(a) * r))
    }
    return out
  }

  if (bg === 'lake') {
    const water = new THREE.Mesh(new THREE.PlaneGeometry(220, 220, 1, 1), waterMaterial(ENV.lake.fog[0]))
    water.rotation.x = -Math.PI / 2
    water.position.y = -0.04
    group.add(water)
    updates.push((t) => { water.material.uniforms.uTime.value = t })
    // 远处湖岸：沙滩 → 草地
    const shoreGeo = new THREE.RingGeometry(34, 110, 72, 3)
    shoreGeo.rotateX(-Math.PI / 2)
    const sp = shoreGeo.attributes.position
    const sc = new Float32Array(sp.count * 3)
    const ca = new THREE.Color(0xf2d9a0), cb = new THREE.Color(0x7cc063), cc = new THREE.Color()
    for (let i = 0; i < sp.count; i++) {
      const r = Math.hypot(sp.getX(i), sp.getZ(i))
      cc.copy(ca).lerp(cb, clamp((r - 36) / 6, 0, 1))
      sc[i * 3] = cc.r; sc[i * 3 + 1] = cc.g; sc[i * 3 + 2] = cc.b
    }
    shoreGeo.setAttribute('color', new THREE.BufferAttribute(sc, 3))
    const shore = new THREE.Mesh(shoreGeo, vcMat())
    shore.position.set(MID.x, 0.02, MID.z)
    shore.receiveShadow = true
    group.add(shore)
    for (const slot of ['me', 'foe']) {
      const isl = new THREE.Mesh(new THREE.CylinderGeometry(PLAT[slot] + 0.6, PLAT[slot] + 0.9, 0.5, 40), toonMat(0xf0d49a))
      isl.position.set(HOME[slot].x, -0.25, HOME[slot].z)
      isl.receiveShadow = true
      addOutline(isl, 0.03)
      group.add(isl)
    }
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false })
    foamMat.userData.unique = true
    const foams = ['me', 'foe'].map((slot) => {
      const f = new THREE.Mesh(new THREE.RingGeometry(PLAT[slot] + 0.85, PLAT[slot] + 1.05, 48), foamMat)
      f.rotation.x = -Math.PI / 2
      f.position.set(HOME[slot].x, -0.02, HOME[slot].z)
      group.add(f)
      return f
    })
    updates.push((t) => {
      foams.forEach((f, i) => f.scale.setScalar(1 + Math.sin(t * 1.6 + i * 2) * 0.03))
      foamMat.opacity = 0.4 + Math.sin(t * 1.6) * 0.15
    })
    const hills = []
    for (let i = 0; i < 7; i++) hills.push({ x: R(-45, 45), y: -1, z: R(-62, -50), sx: R(9, 16), sy: R(4, 8), sz: R(6, 9), c: [0x6fb65a, 0x5aa14c, 0x80c068][i % 3] })
    group.add(scatter(new THREE.SphereGeometry(1, 20, 12), toonMat(0xffffff), hills, { outline: 0.015 }))
    const trees = []
    for (let i = 0; i < 26; i++) trees.push({ x: R(-50, 50), z: R(-46, -38), s: R(1.1, 1.8), ry: R(0, TAU), c: [0xffffff, 0xe6f5dc, 0xd0e8c8][i % 3] })
    group.add(scatter(roundTreeGeo(), vcMat(), trees, { outline: 0.03 }))
    const reeds = [...around('me', 9, 0.75, (x, z) => ({ x, z, s: R(0.8, 1.3), ry: R(0, TAU) })), ...around('foe', 7, 0.75, (x, z) => ({ x, z, s: R(0.8, 1.2), ry: R(0, TAU) }))]
      .filter((it) => Math.abs(it.x - HOME.me.x) > 0.4 || it.z < HOME.me.z)
    const reedGeo = merged([
      part(new THREE.CylinderGeometry(0.025, 0.035, 1.1, 5), 0x4f8f3a, (g) => g.translate(0, 0.45, 0)),
      part(new THREE.CylinderGeometry(0.07, 0.07, 0.28, 6), 0x7a4a2a, (g) => g.translate(0, 0.95, 0)),
      part(new THREE.CylinderGeometry(0.02, 0.03, 0.8, 4), 0x5fa046, (g) => { g.translate(0, 0.35, 0); g.rotateZ(0.25); g.translate(0.12, 0, 0) }),
    ])
    group.add(scatter(reedGeo, vcMat(), reeds, { outline: 0.012 }))
    const pads = []
    for (let i = 0; i < 16; i++) {
      const a = R(0, TAU), r = R(2.6, 9)
      const x = MID.x + Math.cos(a) * r * 1.3, z = MID.z + Math.sin(a) * r
      if (nearPlat(x, z, 1.2)) continue
      pads.push({ x, y: -0.02, z, s: R(0.28, 0.5), ry: R(0, TAU), c: [0x5fb04c, 0x76c25a, 0x4e9c42][i % 3] })
    }
    const padGeo = new THREE.CylinderGeometry(1, 1, 0.04, 14, 1, false, 0.4, TAU - 0.4)
    group.add(scatter(padGeo, toonMat(0xffffff), pads))
    const blooms = pads.filter((_, i) => i % 3 === 0).map((p) => ({ x: p.x + 0.1, y: 0.05, z: p.z, s: 0.1, c: 0xff9ec4 }))
    group.add(scatter(new THREE.IcosahedronGeometry(1, 0), toonMat(0xffffff), blooms))
    const glint = spec({ pool: 'glow', shape: 1, speed: [0, 0.05], life: [0.5, 1.1], size: [0.18, 0.32], end: 0.4, color: 0xfff4d0, drag: 0 })
    const gp = V()
    updates.push((t, dt, st) => {
      if (Math.random() < dt * 5) st.emit(glint, gp.set(MID.x + R(-9, 9), 0.05, MID.z + R(-8, 5)), 1)
    })
  } else {
    const dark = bg === 'forest'
    const colA = new THREE.Color(dark ? 0x355f38 : bg === 'arena' ? 0xcdb88a : 0x86cf62)
    const colB = new THREE.Color(dark ? 0x28472c : bg === 'arena' ? 0xb9a276 : 0x6db552)
    const colC = new THREE.Color(dark ? 0x3f6a3c : bg === 'arena' ? 0xd8c69c : 0xa0dc72)
    group.add(groundMesh(220, 64, (x, z, c) => {
      const n = noise2(x, z)
      c.copy(colA).lerp(n > 0 ? colC : colB, Math.abs(n) * 0.9)
    }))
  }

  if (bg === 'meadow') {
    const hills = []
    for (let i = 0; i < 8; i++) hills.push({ x: R(-50, 50), y: -1.2, z: R(-60, -38), sx: R(10, 18), sy: R(4, 9), sz: R(7, 10), c: [0x7cc463, 0x68b456, 0x8fd26e, 0x5da84e][i % 4] })
    group.add(scatter(new THREE.SphereGeometry(1, 22, 12), toonMat(0xffffff), hills, { outline: 0.012 }))
    const trees = ring(16, 9, 26, (x, z) => ({ x, z, s: R(1.0, 1.7), ry: R(0, TAU), c: [0xffffff, 0xe8f6dc, 0xd4ecc6][Math.floor(R(0, 3))] }))
    group.add(scatter(roundTreeGeo(), vcMat(), trees, { outline: 0.03, cast: true }))
    const tufts = [
      ...ring(170, 2, 22, (x, z) => ({ x, z, s: R(0.8, 1.5), ry: R(0, TAU), c: [0x5fae45, 0x76c455, 0x4f9c3c][Math.floor(R(0, 3))] }), false).filter((t) => !nearPlat(t.x, t.z, 0.2)),
      ...around('me', 16, 0.15, (x, z) => ({ x, z, s: R(0.9, 1.4), ry: R(0, TAU), c: 0x5fae45 })),
      ...around('foe', 14, 0.15, (x, z) => ({ x, z, s: R(0.9, 1.3), ry: R(0, TAU), c: 0x5fae45 })),
    ]
    group.add(scatter(tuftGeo(), vcMat(), tufts))
    const flowers = ring(70, 2.5, 20, (x, z) => ({ x, y: 0.1, z, s: R(0.06, 0.1), c: [0xffffff, 0xffe066, 0xff9ec4, 0xc8a8ff][Math.floor(R(0, 4))] }), false).filter((f) => !nearPlat(f.x, f.z, 0.3))
    group.add(scatter(new THREE.IcosahedronGeometry(1, 0), toonMat(0xffffff), flowers))
    const clouds = []
    for (let i = 0; i < 8; i++) clouds.push({ x: R(-60, 60), y: R(5.5, 10), z: R(-80, -52), s: R(2.5, 4.5) })
    const cm = scatter(cloudGeo(), vcMat(), clouds)
    cm.receiveShadow = false
    cm.frustumCulled = false
    group.add(cm)
    const o = new THREE.Object3D()
    updates.push((t, dt) => {
      for (let i = 0; i < clouds.length; i++) {
        const c = clouds[i]
        c.x += dt * (0.5 + (i % 3) * 0.25)
        if (c.x > 70) c.x = -70
        o.position.set(c.x, c.y, c.z)
        o.scale.setScalar(c.s)
        o.updateMatrix()
        cm.setMatrixAt(i, o.matrix)
      }
      cm.instanceMatrix.needsUpdate = true
    })
    const pollen = spec({ pool: 'glow', speed: [0.1, 0.35], life: [2.5, 4.5], size: [0.05, 0.09], end: 1, color: 0xfff6c0, color2: 0xffffff, drag: 0.2, up: 0.12, alpha: 0.8 })
    const pp = V()
    updates.push((t, dt, st) => { if (Math.random() < dt * 6) st.emit(pollen, pp.set(MID.x + R(-8, 8), R(0.3, 2.5), MID.z + R(-6, 6)), 1) })
  }

  if (bg === 'forest') {
    const pines = ring(46, 8, 30, (x, z) => ({ x, z, s: R(1.3, 2.4), ry: R(0, TAU), c: [0xffffff, 0xd6e4dc, 0xbfd2c6][Math.floor(R(0, 3))] }))
    for (let i = 0; i < 12; i++) pines.push({ x: R(-40, 40), z: R(-40, -30), s: R(2.2, 3.2), ry: R(0, TAU), c: 0xa8bcb0 })
    group.add(scatter(pineGeo(0x2f5d3a, 0x3c7046), vcMat(), pines, { outline: 0.03, cast: true }))
    const bushes = ring(24, 4.5, 14, (x, z) => ({ x, y: 0.15, z, sx: R(0.6, 1.1), sy: R(0.45, 0.7), sz: R(0.6, 1.1), c: [0x2e5a34, 0x3a6a3e][Math.floor(R(0, 2))] }))
    group.add(scatter(new THREE.IcosahedronGeometry(1, 1), toonMat(0xffffff), bushes, { outline: 0.02 }))
    const shrooms = [...around('foe', 5, 0.35, (x, z) => ({ x, z, s: R(0.7, 1.1), ry: R(0, TAU) })), ...ring(10, 3, 9, (x, z) => ({ x, z, s: R(0.7, 1.2), ry: R(0, TAU) }), false).filter((m) => !nearPlat(m.x, m.z, 0.3))]
    const stems = scatter(part(new THREE.CylinderGeometry(0.045, 0.06, 0.22, 6), 0xf2ead8, (g) => g.translate(0, 0.11, 0)), vcMat(), shrooms)
    const capGeo = new THREE.SphereGeometry(0.14, 12, 6, 0, TAU, 0, Math.PI / 2)
    capGeo.translate(0, 0.2, 0)
    const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    capMat.userData.unique = true
    const caps = scatter(capGeo, capMat, shrooms.map((m, i) => ({ ...m, c: i % 2 ? 0x7fe8ff : 0xff9ee0 })))
    group.add(stems, caps)
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, map: tex.beam || null })
    beamMat.userData.unique = true
    beamMat.userData.keepMap = true
    for (const slot of ['me', 'foe']) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(PLAT[slot] * 0.75, PLAT[slot] * 1.15, 11, 24, 1, true), beamMat)
      b.position.set(HOME[slot].x - 1.2, 5.3, HOME[slot].z - 0.8)
      b.rotation.set(-0.12, 0, 0.2)
      b.renderOrder = 3
      group.add(b)
    }
    updates.push((t) => { beamMat.opacity = 0.08 + Math.sin(t * 0.7) * 0.02 })
    const fly = spec({ pool: 'glow', shape: 4, speed: [0.08, 0.3], life: [3, 6], size: [0.1, 0.16], end: 1, color: 0xd8ff7a, color2: 0xfff29a, drag: 0.1, up: 0.05 })
    const fp = V()
    updates.push((t, dt, st) => { if (Math.random() < dt * 9) st.emit(fly, fp.set(MID.x + R(-9, 9), R(0.2, 3.2), MID.z + R(-8, 6)), 1) })
  }

  if (bg === 'arena') {
    const fieldTex = tex.glow ? arenaFieldTex() : null
    const topMat = toonMat(0xffffff, { unique: true })
    topMat.map = fieldTex
    const field = new THREE.Mesh(new THREE.CylinderGeometry(8.2, 8.4, 0.08, 64), [toonMat(0xb89a64), topMat, toonMat(0xb89a64)])
    field.position.set(MID.x, 0.0, MID.z)
    field.rotation.y = Math.atan2(HOME.foe.x - HOME.me.x, HOME.foe.z - HOME.me.z)
    field.receiveShadow = true
    group.add(field)
    const blocks = []
    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * TAU
      blocks.push({ x: MID.x + Math.cos(a) * 8.6, y: 0.18, z: MID.z + Math.sin(a) * 8.6, ry: -a, sx: 0.5, sy: 0.36, sz: 1.15, c: i % 2 ? 0xd9d0c0 : 0xbfb3a0 })
    }
    group.add(scatter(new THREE.BoxGeometry(1, 1, 1), toonMat(0xffffff), blocks, { outline: 0.03 }))
    const prof = [[11.5, 0], [11.5, 0.8], [12.6, 0.8], [12.6, 1.6], [13.7, 1.6], [13.7, 2.4], [14.8, 2.4], [14.8, 3.2], [16.2, 3.2], [16.2, 0]].map(([x, y]) => new THREE.Vector2(x, y))
    let stands = new THREE.LatheGeometry(prof, 72)
    const flat = stands.toNonIndexed()
    stands.dispose()
    flat.computeVertexNormals()
    stands = new THREE.Mesh(flat, toonMat(0xd8c7a0, { side: THREE.DoubleSide }))
    stands.position.copy(MID)
    stands.receiveShadow = true
    group.add(stands)
    const crowd = []
    const crowdCol = [0xff5a5f, 0x3a86ff, 0x8e5cf7, 0xffc43d, 0x1fb5a3, 0xf15bb5, 0xff9f1c, 0xf4f4f4]
    for (let step = 0; step < 4; step++) {
      const r = 12.05 + step * 1.1, y = 0.8 * (step + 1)
      for (let i = 0; i < 64; i++) {
        const a = (i / 64) * TAU + step * 0.05
        const ca = Math.atan2(9.7, 1.1)
        if (Math.abs(Math.atan2(Math.sin(a - ca), Math.cos(a - ca))) < 0.8) continue
        if (rng() < 0.12) continue
        crowd.push({ x: MID.x + Math.cos(a) * r, y, z: MID.z + Math.sin(a) * r, ry: -a - Math.PI / 2, s: R(0.85, 1.1), c: crowdCol[Math.floor(R(0, crowdCol.length))], ph: R(0, TAU) })
      }
    }
    const fanGeo = merged([
      part(new THREE.CylinderGeometry(0.2, 0.26, 0.5, 8), 0xffffff, (g) => g.translate(0, 0.25, 0)),
      part(new THREE.SphereGeometry(0.19, 10, 8), 0xf1d2b8, (g) => g.translate(0, 0.66, 0)),
    ])
    const cm = scatter(fanGeo, vcMat(), crowd)
    cm.frustumCulled = false
    group.add(cm)
    const o = new THREE.Object3D()
    updates.push((t, dt) => {
      arena.hype = Math.max(0, arena.hype - dt * 0.4)
      const h = 0.05 + arena.hype * 0.22
      for (let i = 0; i < crowd.length; i++) {
        const c = crowd[i]
        o.position.set(c.x, c.y + Math.abs(Math.sin(t * (4 + arena.hype * 5) + c.ph)) * h, c.z)
        o.rotation.set(0, c.ry, 0)
        o.scale.setScalar(c.s)
        o.updateMatrix()
        cm.setMatrixAt(i, o.matrix)
      }
      cm.instanceMatrix.needsUpdate = true
    })
    const poles = []
    const flags = []
    const flagCol = [0x8e5cf7, 0xff5a5f, 0x1fb5a3, 0xffc43d, 0x2f9df4]
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i - 4) * 0.36
      const x = MID.x + Math.cos(a) * 16.4, z = MID.z + Math.sin(a) * 16.4
      poles.push({ x, y: 3.2, z, s: 1 })
      flags.push({ x, y: 3.2 + 3.9, z, ry: -a + Math.PI, c: flagCol[i % flagCol.length] })
    }
    group.add(scatter(part(new THREE.CylinderGeometry(0.06, 0.08, 4.2, 6), 0x6b5a48, (g) => g.translate(0, 2.1, 0)), vcMat(), poles))
    const flagGeo = new THREE.PlaneGeometry(1.3, 1.9, 8, 4)
    flagGeo.translate(0.65, -0.95, 0)
    const base = Float32Array.from(flagGeo.attributes.position.array)
    const fm = scatter(flagGeo, toonMat(0xffffff, { side: THREE.DoubleSide }), flags)
    fm.frustumCulled = false
    group.add(fm)
    updates.push((t) => {
      const arr = flagGeo.attributes.position.array
      for (let i = 0; i < arr.length; i += 3) {
        const x = base[i]
        arr[i + 2] = Math.sin(x * 3.2 - t * 4.2 + base[i + 1] * 0.6) * 0.16 * x
      }
      flagGeo.attributes.position.needsUpdate = true
    })
  }

  // 站台
  const pal = {
    meadow: [0xa8de7c, 0xc49a62, 0x8cc865],
    lake: [0x9bd678, 0xc9a46a, 0x83c064],
    forest: [0x4f7d46, 0x6b5238, 0x41693b],
    arena: [0xe9e2d2, 0x9c917e, 0xd4c9b2],
  }[bg] || [0xa8de7c, 0xc49a62, 0x8cc865]
  for (const slot of ['me', 'foe']) {
    const p = platform(PLAT[slot], pal[0], pal[1], pal[2])
    p.position.set(HOME[slot].x, 0, HOME[slot].z)
    group.add(p)
  }
  return arena
}

// ============================================================================

export class BattleStage {
  constructor({ canvas, host, fx } = {}) {
    this.canvas = canvas || null
    this.host = host || null
    this.fxEl = fx || null
    this.ok = false
    this.running = false
    this.tried = false
    this.tasks = []
    this.time = 0
    this.slots = null
    this.world = null
    this.arena = null
    this.lastType = 'normal'
    this.lastMove = null
    this.W = 1
    this.H = 1
    this.shakeAmp = 0
    this.shakeDecay = 1.8
    this.punchK = 0
    this.punchAt = V()
    this.sweepK = 1
    this.sweepFrom = V()
    this.sweepLook = V()
    this.basePos = V()
    this.baseLook = V()
    this._cp = V()
    this._cl = V()
    this._pv = V()
    this._dn = V()
    this.motion = 1
    this.frame = this.frame.bind(this)
  }

  // —— 生命周期 ——
  init() {
    if (this.tried) return this.ok
    this.tried = true
    try {
      if (!this.canvas || typeof window === 'undefined') throw new Error('no canvas')
      this.renderer = this.createRenderer()
      this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true })
      this.canvas.addEventListener('webglcontextrestored', () => { this.lost = false })
      this.scene = new THREE.Scene()
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400)
      this.hemi = new THREE.HemisphereLight(0xffffff, 0x777777, 1.5)
      this.sun = new THREE.DirectionalLight(0xffffff, 2)
      this.sun.castShadow = true
      this.sun.shadow.mapSize.set(1024, 1024)
      const sc = this.sun.shadow.camera
      sc.left = -9; sc.right = 9; sc.top = 9; sc.bottom = -9; sc.near = 1; sc.far = 40
      sc.updateProjectionMatrix()
      this.sun.shadow.bias = -0.0006
      this.sun.shadow.normalBias = 0.02
      this.sun.position.set(MID.x + 5, 11, MID.z + 7)
      this.sun.target.position.copy(MID)
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(160, 32, 16), skyMaterial())
      this.sky.renderOrder = -10
      this.sky.frustumCulled = false
      this.fxRoot = new THREE.Group()
      this.glow = new Particles(1800, THREE.AdditiveBlending)
      this.solid = new Particles(1000, THREE.NormalBlending)
      this.scene.add(this.hemi, this.sun, this.sun.target, this.sky, this.fxRoot, this.glow.points, this.solid.points)
      this.tex = makeTextures()
      this.geo = sharedGeometries()
      if (typeof ResizeObserver !== 'undefined' && this.host) {
        this.ro = new ResizeObserver(() => { if (this.running) this.resize() })
        this.ro.observe(this.host)
      }
      this.motion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1
      this.ok = true
    } catch (err) {
      console.warn('[battle3d] WebGL 不可用，退回 2D 战斗画面', err)
      this.ok = false
    }
    return this.ok
  }

  createRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' })
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap
    return r
  }

  // cfg: { bg, kind, wild?: { sp, shiny, idx } }，返回开场运镜结束的 Promise
  open(cfg = {}) {
    if (!this.init()) return Promise.resolve(false)
    if (this.running) this.close()
    const bg = ENV[cfg.bg] ? cfg.bg : 'meadow'
    this.bg = bg
    this.kind = cfg.kind || 'wild'
    this.env(bg)
    this.world = new THREE.Group()
    try {
      this.arena = buildArena(bg, this.kind, this.tex)
      this.world.add(this.arena.group)
    } catch (err) {
      console.warn('[battle3d] 场景搭建失败', err)
      this.arena = null
    }
    this.slots = {}
    for (const key of ['me', 'foe']) {
      const anchor = new THREE.Group()
      anchor.position.copy(HOME[key])
      const blobMat = new THREE.MeshBasicMaterial({ map: this.tex.blob || null, color: 0x000000, transparent: true, opacity: 0, depthWrite: false })
      blobMat.userData.unique = true
      blobMat.userData.keepMap = true
      const blob = new THREE.Mesh(this.geo.disc, blobMat)
      blob.rotation.x = -Math.PI / 2
      blob.position.y = 0.012
      blob.renderOrder = 1
      anchor.add(blob)
      this.world.add(anchor)
      this.slots[key] = { key, anchor, blob, mon: null }
    }
    this.scene.add(this.world)
    this.time = 0
    this.shakeAmp = 0
    this.punchK = 0
    this.running = true
    this.resize()
    if (cfg.wild) {
      const m = this.makeMon('foe', cfg.wild)
      if (m) m.preplaced = true
    }
    this.last = performance.now()
    this.raf = requestAnimationFrame(this.frame)
    this.watch = setInterval(() => {
      const now = performance.now()
      if (this.running && now - this.last > 400) { this.step(Math.min(1, (now - this.last) / 1000)); this.last = now }
    }, 250)
    this.wipe()
    // 开场运镜：野生战从对手特写拉远，训练家 / 对战从高空俯冲
    if (cfg.wild) {
      this.sweepFrom.set(HOME.foe.x - 1.2, 1.9, HOME.foe.z + 4.4)
      this.sweepLook.set(HOME.foe.x, 1.1, HOME.foe.z)
    } else {
      this.sweepFrom.set(MID.x + 7, 8.5, MID.z + 13)
      this.sweepLook.set(MID.x, 0.5, MID.z - 2)
    }
    this.sweepK = 0
    const p = this.tween(1.1, (k) => { this.sweepK = k }, E.lin)
    if (this.kind === 'pvp') this.wait(700).then(() => this.celebrate(0.6))
    return p.then(() => true)
  }

  close() {
    if (!this.ok) return
    this.running = false
    cancelAnimationFrame(this.raf)
    clearInterval(this.watch)
    this.flushTasks()
    this.glow.clear()
    this.solid.clear()
    for (const c of [...this.fxRoot.children]) this.drop(c)
    if (this.slots) for (const S of Object.values(this.slots)) this.removeMon(S)
    if (this.world) {
      this.scene.remove(this.world)
      this.world.traverse((o) => {
        if (o.isInstancedMesh) o.dispose()
        const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
        for (const m of ms) if (m.userData?.keepMap) m.map = null
      })
      disposeTree(this.world)
    }
    this.world = null
    this.arena = null
    this.slots = null
    if (this.fxEl) for (const el of [...this.fxEl.querySelectorAll('.b3d-dmg, .b3d-flash, .b3d-wipe, .b3d-tag')]) el.remove()
  }

  env(bg) {
    const e = ENV[bg]
    const u = this.sky.material.uniforms
    u.uTop.value.set(e.top)
    u.uHorizon.value.set(e.horizon)
    u.uBottom.value.set(e.bottom)
    u.uSun.value.set(...e.sun).normalize()
    u.uSunColor.value.set(e.sunColor)
    u.uSunSize.value = e.sunSize
    u.uStars.value = e.stars
    this.scene.fog = new THREE.Fog(e.fog[0], e.fog[1], e.fog[2])
    this.hemi.color.set(e.hemi[0])
    this.hemi.groundColor.set(e.hemi[1])
    this.hemi.intensity = e.hemi[2]
    this.sun.color.set(e.dir[0])
    this.sun.intensity = e.dir[1]
    this.renderer.setClearColor(e.horizon)
  }

  resize() {
    if (!this.ok || !this.host) return
    const w = this.host.clientWidth, h = this.host.clientHeight
    if (w < 2 || h < 2) return
    this.W = w
    this.H = h
    this.renderer.setSize(w, h, false)
    const aspect = w / h
    this.camera.aspect = aspect
    // 竖屏时放大视角并把镜头略微拉高，保证双方都在画面内且不被信息框遮挡
    const port = clamp((1.45 - aspect) / 0.75, 0, 1)
    const hf = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(19)) * 1.6)
    this.camera.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(hf / 2) / aspect)), 38, 62)
    this.camera.updateProjectionMatrix()
    this.basePos.set(1.3 - port * 0.5, 2.75 + port * 0.35, 8.3 - port * 0.6)
    this.baseLook.set(0.45 - port * 0.6, 0.95 + port * 0.05, -1.6)
    const px = h * this.renderer.getPixelRatio() * 0.5
    this.glow.mat.uniforms.uPx.value = px
    this.solid.mat.uniforms.uPx.value = px
    if (this.running) this.render()
  }

  frame(now) {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.frame)
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000))
    this.last = now
    this.step(dt)
  }

  step(dt) {
    this.time += dt
    const t = this.time
    const tasks = this.tasks
    let j = 0
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i]
      task.t += dt
      const k = task.dur > 0 ? Math.min(1, task.t / task.dur) : 1
      try { task.fn(task.ease(k), dt, k) } catch (err) { console.warn('[battle3d]', err); task.t = task.dur }
      if (k >= 1) task.resolve()
      else tasks[j++] = task
    }
    // 回调里同步新建的任务会追加到数组末尾并在本轮一起推进；j 永远不超过 i，压缩不会覆盖未处理的任务
    tasks.length = j
    for (const key in this.slots) this.composeMon(this.slots[key])
    if (this.arena) this.arena.update(t, dt, this)
    this.sky.material.uniforms.uTime.value = t
    this.glow.update(dt, t)
    this.solid.update(dt, t)
    this.updateCamera(dt)
    this.render()
  }

  render() {
    if (this.lost || !this.renderer) return
    try { this.renderer.render(this.scene, this.camera) } catch (err) { console.warn('[battle3d] render', err); this.lost = true }
  }

  // —— 时间轴 ——
  tween(dur, fn, ease = E.out) {
    if (!this.running) {
      try { fn(1, 0, 1) } catch { /* 舞台已关闭 */ }
      return Promise.resolve()
    }
    return new Promise((resolve) => { this.tasks.push({ t: 0, dur, fn, ease, resolve }) })
  }

  wait(ms) { return this.tween(ms / 1000, () => {}, E.lin) }

  flushTasks() {
    const tasks = this.tasks
    this.tasks = []
    for (const t of tasks) t.resolve()
  }

  // —— 相机 ——
  updateCamera(dt) {
    const cam = this.camera
    const p = this._cp.copy(this.basePos), l = this._cl.copy(this.baseLook)
    const t = this.time
    p.x += Math.sin(t * 0.23) * 0.14
    p.y += Math.sin(t * 0.31 + 1) * 0.07
    p.z += Math.sin(t * 0.17 + 2) * 0.1
    if (this.sweepK < 1) {
      const e = E.inOut(this.sweepK)
      p.lerpVectors(this.sweepFrom, p, e)
      p.y += Math.sin(Math.PI * e) * 0.7
      l.lerpVectors(this.sweepLook, l, e)
    }
    if (this.punchK > 0) {
      p.lerp(this.punchAt, this.punchK * 0.16)
      l.lerp(this.punchAt, this.punchK * 0.3)
    }
    if (this.shakeAmp > 0) {
      const a = this.shakeAmp * this.shakeAmp * 0.32 * this.motion
      p.x += (Math.sin(t * 71) + Math.sin(t * 43.7)) * 0.5 * a
      p.y += (Math.sin(t * 63 + 1.3) + Math.sin(t * 37.1)) * 0.5 * a
      l.x += Math.sin(t * 55 + 2) * a * 0.4
      this.shakeAmp = Math.max(0, this.shakeAmp - dt * this.shakeDecay)
    }
    cam.position.copy(p)
    cam.lookAt(l)
  }

  shake(amount, decay = 1.8) {
    if (amount > this.shakeAmp) { this.shakeAmp = Math.min(1.2, amount); this.shakeDecay = decay }
  }

  punch(slot, strength = 1) {
    this.center(slot, this.punchAt, 0.5)
    const s = strength * this.motion
    return this.tween(0.42, (k) => { this.punchK = Math.sin(Math.PI * Math.min(1, k * 1.4)) ** 2 * s * (k < 0.7 ? 1 : (1 - k) / 0.3) }, E.lin).then(() => { this.punchK = 0 })
  }

  // —— 精灵 ——
  makeMon(key, info) {
    const S = this.slots?.[key]
    if (!S) return null
    this.removeMon(S)
    let model
    try { model = buildCreature(info.sp, { shiny: !!info.shiny, flash: true }) } catch (err) { console.warn('[battle3d] buildCreature', err) }
    if (!model) return null
    model.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true })
    const rig = new THREE.Group()
    rig.rotation.order = 'YXZ'
    rig.add(model)
    S.anchor.add(rig)
    const ud = model.userData || {}
    const m = {
      model, rig, idx: info.idx, sp: info.sp, shiny: !!info.shiny,
      h: ud.height || 1, r: ud.radius || 0.4, base: SCALE[key],
      pop: 1, off: V(), lean: 0, tilt: 0, yaw: 0, sink: 0, squash: 1, wob: 0, alpha: 1, hidden: false,
      hitFlash: 0, hitColor: 0xffffff, tint: 0, tintColor: 0xffffff, _fa: -1, _fh: null, _fc: -1,
      act: null, actT0: 0, actDur: 1,
      state: { moving: false, speed: 0, action: 'idle', actionT: 0 },
      fadeMats: null, preplaced: false,
    }
    S.mon = m
    this.composeMon(S)
    return m
  }

  removeMon(S) {
    const m = S?.mon
    if (!m) return
    S.mon = null
    m.rig.parent?.remove(m.rig)
    try {
      if (m.model.userData?.dispose) m.model.userData.dispose()
      else disposeTree(m.model)
    } catch (err) { console.warn('[battle3d] dispose', err) }
    if (m.fadeMats) for (const f of m.fadeMats) f.mat.dispose()
    S.blob.material.opacity = 0
  }

  act(m, name, dur) {
    if (!m || m.act === 'faint') return
    m.act = name
    m.actT0 = this.time
    m.actDur = Math.max(0.05, dur)
  }

  composeMon(S) {
    const m = S.mon
    if (!m) return
    const r = m.rig
    let wx = 0, wz = 0
    if (m.wob) { wx = Math.sin(this.time * 47) * m.wob * 0.12; wz = Math.cos(this.time * 39) * m.wob * 0.08 }
    r.position.set(m.off.x + wx, m.off.y - m.sink, m.off.z + wz)
    r.rotation.set(m.lean, FACE[S.key] + m.yaw, m.tilt + wx * 0.8)
    const s = m.base * Math.max(0, m.pop)
    const q = Math.sqrt(m.squash)
    r.scale.set(s / q, s * m.squash, s / q)
    r.visible = !m.hidden && m.pop > 0.002
    const st = m.state
    if (m.act) {
      const k = (this.time - m.actT0) / m.actDur
      if (k >= 1 && m.act !== 'faint') { m.act = null; st.action = 'idle'; st.actionT = 0 } else { st.action = m.act; st.actionT = Math.min(1, k) }
    }
    const ud = m.model.userData
    try { ud.animate?.(this.time, st) } catch { /* 模型动画异常不影响战斗 */ }
    const fa = Math.max(m.hitFlash, m.tint)
    const useHit = m.hitFlash >= m.tint
    const fc = useHit ? m.hitColor : m.tintColor
    if (Math.abs(fa - m._fa) > 0.004 || useHit !== m._fh || fc !== m._fc) {
      m._fa = fa; m._fh = useHit; m._fc = fc
      try { ud.setFlash?.(clamp(fa, 0, 1), fc) } catch { /* 忽略 */ }
    }
    const b = S.blob
    b.visible = r.visible
    b.position.set(m.off.x, 0.012, m.off.z)
    b.scale.setScalar(Math.max(0.01, m.r * s * 1.45 / (1 + Math.max(0, m.off.y) * 0.4)))
    b.material.opacity = 0.34 * clamp(m.pop, 0, 1) * m.alpha * clamp(1 - m.sink / (m.h * m.base * 0.6), 0, 1)
  }

  center(key, out, frac = 0.5) {
    const m = this.slots?.[key]?.mon
    out.copy(HOME[key])
    if (m) {
      out.add(m.off)
      out.y += m.h * m.base * clamp(m.pop, 0.2, 1.3) * frac - m.sink
    } else out.y += SCALE[key] * frac
    return out
  }

  radius(key) { return (this.slots?.[key]?.mon?.r || 0.4) * SCALE[key] }

  dirTo(a, b, out) {
    out.subVectors(HOME[b], HOME[a])
    out.y = 0
    return out.normalize()
  }

  // 嘴部附近：朝目标方向前探一些
  mouth(a, b, out) {
    const d = this.dirTo(a, b, this._pv)
    this.center(a, out, 0.62)
    return out.addScaledVector(d, this.radius(a) * 0.75)
  }

  // —— 通用特效工具 ——
  emit(s, p, n = s.n) {
    const pool = s.pool === 'solid' ? this.solid : this.glow
    if (!pool) return
    const d = s.dir, w = s.spread, j = s.jitter
    for (let i = 0; i < n; i++) {
      let ux = Math.random() * 2 - 1, uy = Math.random() * 2 - 1, uz = Math.random() * 2 - 1
      const ul = Math.hypot(ux, uy, uz) || 1
      ux /= ul; uy /= ul; uz /= ul
      let dx = ux, dy = uy, dz = uz
      if (d) { dx = d.x * (1 - w) + ux * w; dy = d.y * (1 - w) + uy * w; dz = d.z * (1 - w) + uz * w }
      const dl = Math.hypot(dx, dy, dz) || 1
      const sp = rnd(s.speed[0], s.speed[1]) / dl
      const t = Math.random()
      const size = rnd(s.size[0], s.size[1])
      pool.spawn(
        p.x + (Math.random() * 2 - 1) * j, p.y + (Math.random() * 2 - 1) * j, p.z + (Math.random() * 2 - 1) * j,
        dx * sp, dy * sp + s.up, dz * sp,
        rnd(s.life[0], s.life[1]), size, size * s.end,
        lerp(s.c1.r, s.c2.r, t), lerp(s.c1.g, s.c2.g, t), lerp(s.c1.b, s.c2.b, t),
        s.grav, s.drag, s.shape, s.alpha,
      )
    }
  }

  fxMat(color, { additive = true, opacity = 1, map = null, side = THREE.DoubleSide } = {}) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, map, side, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    m.userData.fx = true
    return m
  }

  add(o) { this.fxRoot.add(o); return o }

  drop(o) {
    if (!o) return
    o.parent?.remove(o)
    if (o.userData?.ball) { try { o.userData.dispose?.() } catch { /* 忽略 */ } }
    o.traverse((x) => {
      if (x.geometry && !x.isSprite && !x.geometry.userData?.shared && !x.userData?.isOutline) x.geometry.dispose()
      const ms = Array.isArray(x.material) ? x.material : x.material ? [x.material] : []
      for (const mt of ms) if (mt.userData?.fx) mt.dispose()
    })
  }

  sprite(color, size, { tex = 'glow', opacity = 1, additive = true } = {}) {
    const mat = new THREE.SpriteMaterial({ map: this.tex[tex] || null, color, transparent: true, opacity, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending })
    mat.userData.fx = true
    const s = new THREE.Sprite(mat)
    s.scale.setScalar(size)
    s.renderOrder = 7
    return this.add(s)
  }

  // 命中星爆
  impactStar(pos, color, size = 1.2, dur = 0.32) {
    const s = this.sprite(color, 0.01, { tex: 'star' })
    s.position.copy(pos)
    const rot = rnd(0, TAU)
    const g = this.sprite(color, 0.01)
    g.position.copy(pos)
    return this.tween(dur, (k) => {
      const e = E.back(Math.min(1, k * 2.6))
      s.scale.setScalar(size * e)
      s.material.rotation = rot + k * 0.6
      s.material.opacity = 1 - k * k
      g.scale.setScalar(size * 1.8 * E.out(k))
      g.material.opacity = 0.7 * (1 - k)
    }, E.lin).then(() => { this.drop(s); this.drop(g) })
  }

  // 圆环脉冲：flat 贴地；normal 指定朝向；否则面向相机
  ringPulse(pos, color, size, dur = 0.5, { flat = false, normal = null, from = 0.15, width = 'ring', opacity = 0.9, rise = 0 } = {}) {
    const m = this.add(new THREE.Mesh(this.geo[width === 'thin' ? 'thinRing' : 'ring'], this.fxMat(color, { opacity })))
    m.position.copy(pos)
    m.renderOrder = 7
    if (flat) m.rotation.x = -Math.PI / 2
    else if (normal) m.lookAt(this._pv.copy(pos).add(normal))
    const y0 = pos.y
    return this.tween(dur, (k) => {
      m.scale.setScalar(lerp(from, 1, E.out(k)) * size)
      m.material.opacity = opacity * (1 - k)
      if (rise) m.position.y = y0 + rise * k
      if (!flat && !normal) m.quaternion.copy(this.camera.quaternion)
    }, E.lin).then(() => this.drop(m))
  }

  // 沿两点放置一根圆柱（光束 / 水柱）
  orient(mesh, a, b, radius) {
    const d = this._pv.subVectors(b, a)
    const len = d.length() || 0.001
    mesh.position.copy(a).addScaledVector(d, 0.5)
    mesh.quaternion.setFromUnitVectors(Y_UP, d.divideScalar(len))
    mesh.scale.set(radius, len, radius)
  }

  // 抛射体：沿（可带侧偏与抛物高度的）路径飞行，到达时 resolve
  fly(obj, from, to, dur, { arc = 0.3, side = 0, wobble = 0, ease = E.lin, onStep = null } = {}) {
    const p = V()
    const perp = V(to.z - from.z, 0, from.x - to.x).normalize()
    return this.tween(dur, (k, dt) => {
      p.lerpVectors(from, to, k)
      const b = 4 * k * (1 - k)
      p.y += arc * b
      if (side) p.addScaledVector(perp, side * b)
      if (wobble) { p.addScaledVector(perp, Math.sin(k * 17) * wobble * (1 - k)); p.y += Math.cos(k * 13) * wobble * 0.6 * (1 - k) }
      obj.position.copy(p)
      onStep?.(k, p, dt)
    }, ease)
  }

  // 发光球（火球、暗影球、能量弹等）
  orb(from, to, { size = 0.3, core = 0xffffff, halo = 0xffaa33, dur = 0.4, arc = 0.25, side = 0, wobble = 0, trail = null, rate = 2, dark = false } = {}) {
    const g = new THREE.Group()
    this.add(g)
    const h = new THREE.Sprite(this.spriteMat(halo, 0.9))
    h.scale.setScalar(size * 2.6)
    const c = dark ? new THREE.Mesh(this.geo.sphere, this.fxMat(core, { additive: false, opacity: 0.95, side: THREE.FrontSide })) : new THREE.Sprite(this.spriteMat(core, 1))
    c.scale.setScalar(dark ? size * 0.55 : size * 1.1)
    h.renderOrder = c.renderOrder = 7
    g.add(h, c)
    g.position.copy(from)
    return this.fly(g, from, to, dur, {
      arc, side, wobble,
      onStep: (k, p) => {
        h.scale.setScalar(size * (2.4 + Math.sin(this.time * 30) * 0.3))
        if (trail) this.emit(trail, p, rate)
      },
    }).then(() => this.drop(g))
  }

  spriteMat(color, opacity) {
    const m = new THREE.SpriteMaterial({ map: this.tex.glow || null, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending })
    m.userData.fx = true
    return m
  }

  // 连续喷射粒子（火焰放射、水枪、冰雾、龙息……）
  stream(a, d, dur, s, rate, { travel = 0.35, spiral = 0, spiralR = 0 } = {}) {
    const from = this.mouth(a, d, V()), to = this.center(d, V(), 0.5)
    const dir = V().subVectors(to, from)
    const len = dir.length()
    dir.normalize()
    s.dir = dir
    s.speed = [len / travel * 0.92, len / travel * 1.05]
    s.life = [travel * 0.95, travel * 1.1]
    const u = V(0, 1, 0).cross(dir).normalize(), w = V().crossVectors(dir, u)
    const p = V()
    let acc = 0
    return this.tween(dur, (k, dt) => {
      acc += rate * dt
      while (acc >= 1) {
        acc--
        p.copy(from)
        if (spiral) {
          const ang = this.time * spiral + acc * 2
          p.addScaledVector(u, Math.cos(ang) * spiralR).addScaledVector(w, Math.sin(ang) * spiralR)
        }
        this.emit(s, p, 1)
      }
    }, E.lin)
  }

  // 目标临时变色（冰冻、灼烧、紫色诅咒……）
  tintPulse(key, color, amt, dur) {
    const m = this.slots?.[key]?.mon
    if (!m) return Promise.resolve()
    m.tintColor = color
    return this.tween(dur, (k) => { m.tint = amt * (1 - k) }, E.lin).then(() => { if (m.tintColor === color) m.tint = 0 })
  }

  // 施法小后仰
  cast(key, dur = 0.22) {
    const m = this.slots?.[key]?.mon
    if (!m) return Promise.resolve()
    this.act(m, 'attack', dur + 0.25)
    return this.tween(dur, (k) => { m.lean = -0.22 * Math.sin(Math.PI * k); m.squash = 1 + 0.08 * Math.sin(Math.PI * k) }, E.lin).then(() => { m.lean = 0; m.squash = 1 })
  }

  // 冲撞：蓄力后冲向目标，冲到时 resolve，返回动作不阻塞
  async lunge(a, d, o = {}) {
    const m = this.slots?.[a]?.mon
    if (!m) return
    const { reach = 0.7, dur = 0.28, hop = 0.25, lean = 0.35, spin = 0, wind = 0.14, onStep = null } = o
    const dir = this.dirTo(a, d, V())
    const dist = Math.hypot(HOME[d].x - HOME[a].x, HOME[d].z - HOME[a].z)
    const travel = Math.max(0.6, dist * reach - this.radius(d) * 0.6)
    const p = V()
    this.act(m, 'attack', wind + dur + 0.3)
    if (wind > 0) await this.tween(wind, (k) => { m.off.set(-dir.x * 0.3 * k, 0, -dir.z * 0.3 * k); m.lean = -0.25 * k }, E.out)
    await this.tween(dur, (k) => {
      const s = -0.3 + (travel + 0.3) * k
      m.off.set(dir.x * s, hop * Math.sin(Math.PI * k), dir.z * s)
      m.lean = lean * k
      m.yaw = spin * k
      if (onStep) onStep(k, this.center(a, p))
    }, E.in2)
    this.tween(0.4, (k) => {
      const s = travel * (1 - k)
      m.off.set(dir.x * s, 0, dir.z * s)
      m.lean = lean * (1 - k)
    }, E.out).then(() => { m.off.set(0, 0, 0); m.lean = 0; m.yaw = 0 })
  }

  burst(pos, type, s = 1) {
    const c = FX[type] || FX.normal
    this.emit(spec({ speed: [2, 5.5 * s], life: [0.25, 0.55], size: [0.14 * s, 0.3 * s], end: 0.1, color: c[0], color2: c[1], drag: 3.5, shape: 1 }), pos, Math.round(16 * s))
    this.emit(spec({ speed: [1, 3 * s], life: [0.3, 0.6], size: [0.25 * s, 0.5 * s], end: 1.6, color: c[1], color2: c[2], drag: 4 }), pos, Math.round(10 * s))
    if (type === 'rock' || type === 'ground') this.dust(pos, c[1], s)
  }

  dust(pos, color = 0xd8c7a0, s = 1) {
    this.emit(spec({ pool: 'solid', speed: [0.6, 2.2 * s], life: [0.5, 1.0], size: [0.3 * s, 0.55 * s], end: 2.2, color, color2: 0xf4ecd8, drag: 3, up: 0.8, alpha: 0.65, jitter: 0.25 }), pos, Math.round(14 * s))
  }

  feetOf(key, out) {
    const m = this.slots?.[key]?.mon
    out.copy(HOME[key])
    if (m) { out.x += m.off.x; out.z += m.off.z }
    out.y = 0.08
    return out
  }

  // ======================= 钩子实现 =======================

  async showMon(key, info) {
    if (!this.running || !this.slots) return
    const S = this.slots[key]
    const cur = S.mon
    if (cur && cur.preplaced && cur.idx === info.idx && cur.sp === info.sp) {
      cur.preplaced = false
      return this.cryFx(key)
    }
    const m = this.makeMon(key, info)
    if (!m) return
    if (info.anim !== 'enter') return
    m.pop = 0
    await this.enterFx(key, m)
  }

  hideMon(key) {
    if (this.slots?.[key]) this.removeMon(this.slots[key])
  }

  // 野生精灵登场：跳一下 + 尘土，闪光个体撒星星
  async cryFx(key) {
    const m = this.slots[key].mon
    if (!m) return
    const feet = this.feetOf(key, V())
    this.act(m, 'happy', 0.8)
    await this.tween(0.5, (k) => {
      m.off.y = Math.sin(Math.PI * k) * 0.55
      m.squash = 1 + Math.sin(Math.PI * 2 * k) * 0.1
    }, E.lin)
    m.off.y = 0
    m.squash = 1
    this.dust(feet, 0xd8c7a0, 0.8)
    this.ringPulse(feet, 0xffffff, this.radius(key) * 2.2, 0.5, { flat: true, opacity: 0.6 })
    if (m.shiny) this.shinyFx(key)
  }

  shinyFx(key) {
    const c = this.center(key, V(), 0.6)
    this.emit(spec({ shape: 1, speed: [1.5, 3.5], life: [0.5, 0.9], size: [0.25, 0.45], end: 0.1, color: 0xfff3a0, color2: 0xffffff, drag: 3 }), c, 22)
    for (let i = 0; i < 3; i++) this.wait(i * 160).then(() => this.impactStar(this.center(key, V(), 0.4 + i * 0.25).add(V(rnd(-0.6, 0.6), 0, rnd(-0.3, 0.3))), 0xfff0a0, 0.8))
  }

  // 丢球 → 开球闪光 → 光柱 → 放大弹出 + 星星
  async enterFx(key, m) {
    const to = this.center(key, V(), 0.45)
    const from = TRAINER[key].clone()
    let ball = null
    try { ball = buildBall('ball') } catch { /* 模型缺失就只放光柱 */ }
    if (ball) {
      ball.userData.ball = true
      ball.scale.setScalar(1.7)
      this.add(ball)
      await this.fly(ball, from, to, 0.42, { arc: 1.3, onStep: (k, p, dt) => { ball.rotation.x -= dt * 16 } })
      this.drop(ball)
    }
    this.impactStar(to, 0xffffff, 1.6, 0.35)
    this.emit(spec({ shape: 1, speed: [2, 5], life: [0.4, 0.8], size: [0.2, 0.4], end: 0.1, color: 0xffffff, color2: 0xbfe6ff, drag: 3 }), to, 24)
    const feet = this.feetOf(key, V())
    const col = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(0xcfe8ff, { map: this.tex.beam || null, opacity: 0.9 })))
    col.renderOrder = 7
    const R = this.radius(key)
    const H = m.h * m.base * 1.6
    this.tween(0.75, (k) => {
      const grow = E.out(Math.min(1, k * 3))
      col.scale.set(R * (1.1 - k * 0.6), H * grow, R * (1.1 - k * 0.6))
      col.position.set(feet.x, feet.y + H * grow * 0.5, feet.z)
      col.material.opacity = 0.9 * (1 - k)
    }, E.lin).then(() => this.drop(col))
    this.ringPulse(feet, 0xffffff, R * 2.4, 0.6, { flat: true, opacity: 0.8 })
    this.act(m, 'happy', 0.9)
    await this.tween(0.45, (k) => {
      m.pop = E.back(k)
      m.hitColor = 0xffffff
      m.hitFlash = 1 - k
    }, E.lin)
    m.pop = 1
    m.hitFlash = 0
    this.emit(spec({ shape: 1, speed: [1, 2.5], life: [0.5, 1], size: [0.15, 0.3], end: 0.1, color: 0xffffff, color2: 0xfff3a0, up: 1.2, drag: 2, jitter: R * 0.6 }), this.center(key, V(), 0.5), 16)
    if (m.shiny) this.shinyFx(key)
  }

  // 收回：变红缩小，沿红光飞回训练家
  async recall(key) {
    const S = this.slots?.[key]
    const m = S?.mon
    if (!m) return
    const c = this.center(key, V(), 0.5)
    const to = TRAINER[key]
    const beam = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(0xff4a4a, { opacity: 0.85 })))
    beam.renderOrder = 7
    const glow = this.sprite(0xff5a5a, this.radius(key) * 3)
    glow.position.copy(c)
    m.hitColor = 0xff4040
    const toward = V().subVectors(to, HOME[key]).setY(0).normalize()
    const red = spec({ speed: [0.3, 1], life: [0.3, 0.6], size: [0.15, 0.3], end: 0.2, color: 0xffb0b0, color2: 0xff3a3a, drag: 2 })
    await this.tween(0.5, (k) => {
      m.hitFlash = Math.min(1, k * 4)
      m.pop = 1 - E.in(k)
      m.off.copy(toward).multiplyScalar(k * 0.5)
      this.orient(beam, this.center(key, c), to, 0.12 * (1 - k * 0.7) * (0.8 + Math.random() * 0.4))
      beam.material.opacity = 0.85 * Math.min(1, k * 5) * (1 - k * 0.6)
      glow.position.copy(c)
      glow.material.opacity = 1 - k
      this.emit(red, c, 2)
    }, E.lin)
    this.tween(0.18, (k) => { beam.material.opacity = 0.5 * (1 - k) }, E.lin).then(() => this.drop(beam))
    this.drop(glow)
    this.removeMon(S)
  }

  // —— 招式 ——
  async move(key, id) {
    const mv = MOVES[id]
    if (!mv || !this.running) return
    const d = OTHER[key]
    this.lastType = mv.type
    this.lastMove = id
    this.drainFor = mv.effect?.drain ? key : null
    if (!this.slots[key].mon) return
    if (!mv.power) return this.statusFx(key, d, mv, id)
    const k = clamp(mv.power / 60, 0.6, 1.6)
    const fn = this['fx_' + mv.type] || this.fx_normal
    await fn.call(this, key, d, k, id, mv)
    if (mv.power >= 80) this.shake(0.4 * k)
  }

  async fx_normal(a, d, k, id) {
    const tgt = () => this.center(d, V(), 0.5)
    if (id === 'scratch') {
      await this.lunge(a, d, { reach: 0.5, dur: 0.22, hop: 0.15 })
      this.claws(d, 0xffffff)
      await this.wait(90)
      return
    }
    const quick = id === 'quick'
    const heavy = id === 'headbutt'
    const trail = quick ? spec({ speed: [0.1, 0.4], life: [0.18, 0.32], size: [0.3, 0.5], end: 0.2, color: 0xffffff, color2: 0xdfe8ff, jitter: 0.35, drag: 1 }) : null
    await this.lunge(a, d, {
      reach: quick ? 0.82 : 0.72, dur: quick ? 0.16 : heavy ? 0.3 : 0.26, hop: heavy ? 0.75 : 0.25, lean: heavy ? 0.7 : 0.35, wind: quick ? 0.06 : 0.16,
      onStep: trail && ((kk, p) => this.emit(trail, p, 3)),
    })
    this.impactStar(tgt(), 0xffffff, 0.9 + 0.5 * k)
  }

  claws(d, color) {
    const c = this.center(d, V(), 0.55)
    for (let i = 0; i < 3; i++) {
      const s = this.sprite(color, 0.001)
      s.position.copy(c)
      s.material.rotation = -0.75
      const off = (i - 1) * 0.28
      this.wait(i * 45).then(() => this.tween(0.32, (k) => {
        const len = this.radius(d) * 2.2 * E.out(Math.min(1, k * 3))
        s.scale.set(0.12, len, 1)
        s.position.set(c.x + off, c.y + off * 0.4, c.z + 0.2)
        s.material.opacity = 1 - E.in(k)
      }, E.lin)).then(() => this.drop(s))
    }
  }

  async fx_fire(a, d, k, id) {
    const C = FX.fire
    const target = this.center(d, V(), 0.5)
    if (id === 'flamewheel') {
      const ring = spec({ speed: [0.4, 1.2], life: [0.25, 0.45], size: [0.3, 0.55], end: 0.15, color: C[0], color2: C[1], jitter: 0.55, drag: 3, up: 0.9 })
      const p = V()
      await this.tween(0.25, () => this.emit(ring, this.center(a, p), 5), E.lin)
      await this.lunge(a, d, { reach: 0.72, dur: 0.3, hop: 0.2, spin: TAU, wind: 0.05, onStep: (kk, pp) => this.emit(ring, pp, 7) })
      this.tintPulse(d, 0xff7a1f, 0.6, 0.5)
      return
    }
    if (id === 'flamethrower') {
      this.cast(a, 0.3)
      const charge = this.sprite(C[1], 0.1)
      const mp = this.mouth(a, d, V())
      charge.position.copy(mp)
      await this.tween(0.2, (kk) => { charge.scale.setScalar(0.9 * kk) }, E.out)
      const fire = spec({ speed: [1, 1], life: [0.3, 0.3], size: [0.2, 0.32], end: 3.4, color: C[0], color2: C[1], spread: 0.07, drag: 0 })
      const smoke = spec({ pool: 'solid', speed: [1, 1], life: [0.3, 0.3], size: [0.2, 0.3], end: 4, color: 0x3a2a2a, color2: 0x6a4a3a, spread: 0.12, drag: 0, alpha: 0.28 })
      this.stream(a, d, 0.65, fire, 110 * k, { travel: 0.32 })
      this.stream(a, d, 0.65, smoke, 14, { travel: 0.4 })
      this.tween(0.65, (kk) => { charge.scale.setScalar(0.9 + Math.sin(this.time * 40) * 0.12); charge.material.opacity = 1 - kk * kk }, E.lin).then(() => this.drop(charge))
      const embers = spec({ shape: 2, speed: [1.5, 3.5], life: [0.4, 0.8], size: [0.05, 0.09], end: 0.3, color: C[0], color2: C[1], grav: 3, drag: 1, up: 1.5 })
      await this.wait(360)
      this.emit(embers, target, 26)
      this.tintPulse(d, 0xff6a1a, 0.7, 0.8)
      return
    }
    // 火花：连发小火球
    this.cast(a)
    const trail = spec({ speed: [0.1, 0.5], life: [0.2, 0.4], size: [0.14, 0.24], end: 0.2, color: C[0], color2: C[1], jitter: 0.06, up: 0.5, drag: 1 })
    const from = this.mouth(a, d, V())
    const shots = []
    const n = id === 'ember' ? 3 : 1
    for (let i = 0; i < n; i++) {
      shots.push(this.wait(i * 95).then(() => this.orb(from, V(target.x + rnd(-0.25, 0.25), target.y + rnd(-0.2, 0.2), target.z), {
        size: 0.16 + 0.06 * k, core: 0xfff3b0, halo: C[1], dur: 0.36, arc: 0.3, side: (i - 1) * 0.35, trail, rate: 2,
      }).then(() => this.emit(spec({ speed: [1, 3], life: [0.25, 0.5], size: [0.2, 0.35], end: 0.2, color: C[0], color2: C[2], drag: 3, up: 1 }), target, 10))))
    }
    await Promise.all(shots)
    this.tintPulse(d, 0xff7a1f, 0.5, 0.5)
  }

  async fx_water(a, d, k, id) {
    const C = FX.water
    const target = this.center(d, V(), 0.5)
    const splash = () => {
      this.emit(spec({ pool: 'solid', shape: 2, speed: [2, 4.5], life: [0.4, 0.8], size: [0.08, 0.15], end: 0.6, color: C[0], color2: C[1], grav: 9, drag: 1, up: 2, dir: V(0, 1, 0), spread: 0.8 }), target, Math.round(24 * k))
      this.emit(spec({ speed: [1, 2.5], life: [0.3, 0.5], size: [0.3, 0.5], end: 1.5, color: C[0], color2: C[1], drag: 3 }), target, 10)
      this.ringPulse(target, C[0], this.radius(d) * 1.8, 0.45, { opacity: 0.8 })
    }
    if (id === 'aquatail') {
      const drops = spec({ pool: 'solid', shape: 2, speed: [0.5, 1.5], life: [0.3, 0.5], size: [0.08, 0.14], end: 0.5, color: C[0], color2: C[1], jitter: 0.6, grav: 4, drag: 1 })
      await this.lunge(a, d, { reach: 0.72, dur: 0.32, hop: 0.45, spin: TAU, wind: 0.12, onStep: (kk, p) => this.emit(drops, p, 6) })
      splash()
      return
    }
    if (id === 'bubble') {
      this.cast(a)
      const from = this.mouth(a, d, V())
      const mat = toonMat(0xbfe8ff, { transparent: true, opacity: 0.6 })
      const shots = []
      for (let i = 0; i < 6; i++) {
        const b = this.add(new THREE.Mesh(this.geo.sphere, mat))
        b.scale.setScalar(rnd(0.1, 0.18) * (0.8 + k * 0.3))
        addOutline(b, 0.06)
        b.position.copy(from)
        b.visible = false
        const to = V(target.x + rnd(-0.4, 0.4), target.y + rnd(-0.3, 0.4), target.z + rnd(-0.2, 0.2))
        shots.push(this.wait(i * 70).then(() => { b.visible = true; return this.fly(b, from, to, 0.5, { arc: rnd(0.1, 0.5), side: rnd(-0.5, 0.5), wobble: 0.12 }) }).then(() => {
          this.emit(spec({ shape: 3, speed: [0.2, 0.6], life: [0.2, 0.35], size: [0.35, 0.5], end: 1.6, color: C[0], drag: 2 }), to, 1)
          this.emit(spec({ pool: 'solid', shape: 2, speed: [1, 2.5], life: [0.25, 0.45], size: [0.05, 0.09], end: 0.5, color: C[0], color2: C[1], grav: 5 }), to, 5)
          this.drop(b)
        }))
      }
      await Promise.all(shots)
      return
    }
    // 水枪：水柱 + 喷射粒子
    this.cast(a, 0.3)
    const from = this.mouth(a, d, V())
    const jet = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(C[1], { opacity: 0.55 })))
    const core = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(C[0], { opacity: 0.7 })))
    jet.renderOrder = core.renderOrder = 7
    const tip = V()
    const spray = spec({ speed: [1, 1], life: [0.3, 0.3], size: [0.16, 0.26], end: 1.6, color: C[0], color2: C[1], spread: 0.06, drag: 0 })
    this.stream(a, d, 0.55, spray, 60 * k, { travel: 0.26 })
    await this.tween(0.22, (kk) => {
      tip.lerpVectors(from, target, kk)
      this.orient(jet, from, tip, 0.11 * k + Math.sin(this.time * 50) * 0.02)
      this.orient(core, from, tip, 0.05 * k)
    }, E.out)
    splash()
    this.tween(0.35, (kk) => {
      this.orient(jet, from, target, (0.11 * k + Math.sin(this.time * 50) * 0.02) * (1 - kk))
      this.orient(core, from, target, 0.05 * k * (1 - kk))
      if (Math.random() < 0.4) this.emit(spec({ pool: 'solid', shape: 2, speed: [1.5, 3], life: [0.3, 0.6], size: [0.06, 0.1], end: 0.5, color: C[0], color2: C[1], grav: 8, up: 1.5 }), target, 3)
    }, E.lin).then(() => { this.drop(jet); this.drop(core) })
  }

  async fx_grass(a, d, k, id) {
    const C = FX.grass
    const target = this.center(d, V(), 0.5)
    const leafBits = spec({ pool: 'solid', shape: 6, speed: [1.5, 3.5], life: [0.6, 1.1], size: [0.14, 0.22], end: 0.8, color: 0x7ed957, color2: 0x3f9a34, grav: 2.5, drag: 2.5, up: 1.2 })
    if (id === 'vine') {
      this.cast(a, 0.25)
      const from = this.mouth(a, d, V())
      const vines = [0.9, -0.7].map((sideAmt, i) => {
        const ctrl = V().lerpVectors(from, target, 0.5)
        ctrl.y += 1.2 + i * 0.4
        ctrl.addScaledVector(V(target.z - from.z, 0, from.x - target.x).normalize(), sideAmt)
        const curve = new THREE.QuadraticBezierCurve3(from.clone(), ctrl, target.clone())
        const geo = new THREE.TubeGeometry(curve, 28, 0.05 + 0.02 * k, 6, false)
        geo.setDrawRange(0, 0)
        const mesh = this.add(new THREE.Mesh(geo, toonMat(i ? 0x4c9a35 : 0x5fae3f)))
        addOutline(mesh, 0.012)
        return mesh
      })
      const total = vines[0].geometry.index.count
      await this.tween(0.24, (kk) => { for (const v of vines) v.geometry.setDrawRange(0, Math.floor(total * kk / 6) * 6) }, E.out)
      this.impactStar(target, 0xeaffc0, 0.9)
      this.emit(leafBits, target, 10)
      this.wait(120).then(() => this.tween(0.25, (kk) => { for (const v of vines) v.geometry.setDrawRange(0, Math.floor(total * (1 - kk) / 6) * 6) }, E.in2)).then(() => { for (const v of vines) this.drop(v) })
      return
    }
    if (id === 'absorb') {
      this.cast(a)
      const trail = spec({ speed: [0.1, 0.3], life: [0.2, 0.4], size: [0.12, 0.2], end: 0.2, color: C[0], color2: C[1], drag: 1 })
      await this.orb(this.mouth(a, d, V()), target, { size: 0.16, core: 0xf0ffd0, halo: C[1], dur: 0.32, arc: 0.4, trail })
      this.emit(spec({ shape: 1, speed: [1, 3], life: [0.3, 0.6], size: [0.15, 0.3], end: 0.1, color: C[0], color2: C[1], drag: 3 }), target, 14)
      return
    }
    // 飞叶快刀 / 叶风暴：旋转叶片
    const storm = id === 'leafstorm'
    const n = storm ? 14 : 6
    const from = this.mouth(a, d, V())
    const home = this.center(a, V(), 0.5)
    this.cast(a, storm ? 0.4 : 0.22)
    const sparkle = spec({ speed: [0.1, 0.3], life: [0.2, 0.35], size: [0.1, 0.16], end: 0.2, color: C[0], color2: C[1], drag: 1 })
    const shots = []
    for (let i = 0; i < n; i++) {
      const leaf = this.add(new THREE.Mesh(this.geo.leaf, toonMat(i % 2 ? 0x6fd13f : 0x4fae34, { side: THREE.DoubleSide })))
      leaf.scale.setScalar(0.2 + 0.05 * k)
      leaf.position.copy(from)
      leaf.visible = false
      const to = V(target.x + rnd(-0.35, 0.35), target.y + rnd(-0.35, 0.35), target.z + rnd(-0.2, 0.2))
      const spin = rnd(14, 22)
      let chain = this.wait(i * (storm ? 40 : 70)).then(() => { leaf.visible = true })
      if (storm) {
        const r0 = this.radius(a) * 1.3, a0 = (i / n) * TAU
        chain = chain.then(() => this.tween(0.45, (kk, dt) => {
          const ang = a0 + kk * TAU * 1.2
          leaf.position.set(home.x + Math.cos(ang) * r0, home.y - 0.6 + kk * 1.2, home.z + Math.sin(ang) * r0)
          leaf.rotation.z += dt * spin
          leaf.rotation.y += dt * 6
        }, E.lin))
      }
      shots.push(chain.then(() => this.fly(leaf, leaf.position.clone(), to, storm ? 0.32 : 0.4, {
        arc: rnd(0.2, 0.7), side: rnd(-0.9, 0.9),
        onStep: (kk, p, dt) => { leaf.rotation.z += dt * spin; leaf.rotation.x += dt * 4; if (Math.random() < 0.5) this.emit(sparkle, p, 1) },
      })).then(() => {
        this.emit(leafBits, to, 2)
        this.emit(spec({ shape: 1, speed: [0.5, 1.5], life: [0.2, 0.35], size: [0.18, 0.3], end: 0.1, color: 0xffffff, color2: C[0], drag: 3 }), to, 2)
        this.drop(leaf)
      }))
    }
    await Promise.all(shots)
    if (storm) this.shake(0.5)
  }

  bolt(from, to, { dur = 0.35, width = 0.05, jag = 1, color = 0xffe033, segs = 14 } = {}) {
    const b = new Bolt(segs, color, width)
    for (const m of b.meshes) this.add(m)
    let acc = 1
    return this.tween(dur, (k, dt) => {
      acc += dt
      if (acc > 0.045) { acc = 0; b.regen(from, to, jag, this.camera.position) }
      const f = k < 0.7 ? 1 : (1 - k) / 0.3
      b.meshes[0].material.opacity = 0.55 * f * (0.7 + Math.random() * 0.3)
      b.meshes[1].material.opacity = f
    }, E.lin).then(() => { for (const m of b.meshes) this.drop(m) })
  }

  async fx_electric(a, d, k, id) {
    const C = FX.electric
    const target = this.center(d, V(), 0.5)
    const sparks = spec({ shape: 1, speed: [2, 5], life: [0.15, 0.35], size: [0.12, 0.25], end: 0.1, color: C[0], color2: C[1], drag: 4 })
    const crackle = spec({ shape: 1, speed: [0.5, 1.5], life: [0.1, 0.25], size: [0.14, 0.26], end: 0.2, color: C[0], color2: C[1], jitter: this.radius(a) * 0.9, drag: 2 })
    const ap = V()
    this.cast(a, 0.25)
    await this.tween(0.22, () => this.emit(crackle, this.center(a, ap), 3), E.lin)
    if (id === 'spark') {
      await this.lunge(a, d, { reach: 0.7, dur: 0.24, hop: 0.2, wind: 0.05, onStep: (kk, p) => this.emit(crackle, p, 4) })
      for (let i = 0; i < 3; i++) this.bolt(this.center(d, V(), 0.9).add(V(rnd(-0.8, 0.8), rnd(0.2, 0.8), 0)), target, { dur: 0.25, width: 0.03, jag: 0.8 })
      this.emit(sparks, target, 20)
      this.screenFlash('#fff6b0', 0.35, 200)
      return
    }
    if (id === 'thunderbolt') {
      this.screenFlash('#fffbe0', 0.75, 320)
      for (let i = 0; i < 3; i++) {
        this.wait(i * 70).then(() => this.bolt(V(target.x + rnd(-1.4, 1.4), target.y + 7, target.z + rnd(-1, 1)), target, { dur: 0.42, width: 0.075, jag: 0.9, segs: 18 }))
      }
      this.bolt(this.mouth(a, d, V()), target, { dur: 0.4, width: 0.05, jag: 1.1, segs: 16 })
      await this.wait(120)
      this.emit(sparks, target, 36)
      this.ringPulse(target, C[1], this.radius(d) * 2.4, 0.4)
      this.shake(0.7)
      await this.wait(120)
      return
    }
    this.bolt(this.mouth(a, d, V()), target, { dur: 0.36, width: 0.045, jag: 1.1 })
    this.screenFlash('#fff6b0', 0.3, 180)
    await this.wait(90)
    this.emit(sparks, target, 18)
    await this.wait(120)
  }

  frostCrystals(d, n = 5) {
    const feet = this.feetOf(d, V())
    const R = this.radius(d)
    const mat = this.fxMat(0xd8f6ff, { additive: false, opacity: 0.85, side: THREE.FrontSide })
    const shards = []
    for (let i = 0; i < n; i++) {
      const s = this.add(new THREE.Mesh(this.geo.shard, mat))
      const ang = (i / n) * TAU + rnd(-0.3, 0.3)
      s.position.set(feet.x + Math.cos(ang) * R * 0.9, 0.1, feet.z + Math.sin(ang) * R * 0.9)
      s.rotation.set(rnd(-0.4, 0.4), rnd(0, TAU), rnd(-0.4, 0.4))
      shards.push(s)
    }
    const sz = shards.map(() => rnd(0.4, 0.8))
    return this.tween(1.1, (k) => {
      const g = k < 0.2 ? E.back(k / 0.2) : k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1
      shards.forEach((s, i) => s.scale.setScalar(sz[i] * g))
    }, E.lin).then(() => { for (const s of shards) this.drop(s); mat.dispose() })
  }

  async fx_ice(a, d, k, id) {
    const C = FX.ice
    const target = this.center(d, V(), 0.5)
    const mist = spec({ pool: 'solid', speed: [0.3, 0.9], life: [0.6, 1.1], size: [0.4, 0.7], end: 2, color: 0xeafaff, color2: C[1], drag: 2, alpha: 0.4, jitter: 0.4 })
    const shardBits = spec({ shape: 1, speed: [2, 4.5], life: [0.3, 0.6], size: [0.12, 0.24], end: 0.1, color: C[0], color2: C[1], drag: 3 })
    if (id === 'icefang') {
      await this.lunge(a, d, { reach: 0.6, dur: 0.24, hop: 0.2 })
      const mat = this.fxMat(0xe8fbff, { additive: false, opacity: 0.92, side: THREE.FrontSide })
      const R = this.radius(d)
      const fangs = [1, -1].map((s) => {
        const f = this.add(new THREE.Mesh(this.geo.shard, mat))
        f.scale.set(0.5, 0.9, 0.5)
        f.rotation.z = s > 0 ? Math.PI : 0
        return f
      })
      await this.tween(0.16, (kk) => {
        fangs.forEach((f, i) => { const s = i ? -1 : 1; f.position.set(target.x, target.y + s * R * (1 - kk * 0.75), target.z + 0.3) })
      }, E.in2)
      this.emit(shardBits, target, 22)
      this.frostCrystals(d, 4)
      this.tintPulse(d, 0x9fe6ff, 0.75, 1.1)
      this.wait(140).then(() => { for (const f of fangs) this.drop(f); mat.dispose() })
      return
    }
    if (id === 'powdersnow') {
      this.cast(a, 0.3)
      const snow = spec({ pool: 'solid', shape: 1, speed: [1, 1], life: [0.4, 0.4], size: [0.1, 0.18], end: 0.8, color: 0xffffff, color2: 0xd6f6ff, spread: 0.18, drag: 0, alpha: 0.95 })
      this.stream(a, d, 0.6, snow, 70, { travel: 0.4, spiral: 9, spiralR: 0.15 })
      this.stream(a, d, 0.5, spec({ pool: 'solid', speed: [1, 1], life: [0.4, 0.4], size: [0.25, 0.4], end: 2.4, color: 0xeafaff, spread: 0.1, drag: 0, alpha: 0.3 }), 18, { travel: 0.45 })
      await this.wait(440)
      this.emit(mist, target, 10)
      this.tintPulse(d, 0x9fe6ff, 0.65, 1.2)
      return
    }
    // 冰冻光束
    this.cast(a, 0.3)
    const from = this.mouth(a, d, V())
    const outer = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(C[1], { opacity: 0.6 })))
    const core = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(0xffffff, { opacity: 0.95 })))
    outer.renderOrder = core.renderOrder = 7
    const tip = V()
    const along = spec({ shape: 1, speed: [0.2, 0.8], life: [0.3, 0.6], size: [0.12, 0.22], end: 0.2, color: C[0], color2: C[1], drag: 1 })
    const ap = V()
    await this.tween(0.2, (kk) => {
      tip.lerpVectors(from, target, kk)
      this.orient(outer, from, tip, 0.14 * k)
      this.orient(core, from, tip, 0.05 * k)
      this.emit(along, ap.lerpVectors(from, tip, Math.random()), 2)
    }, E.out)
    this.emit(shardBits, target, 26)
    this.emit(mist, target, 8)
    this.frostCrystals(d, 6)
    this.tintPulse(d, 0x9fe6ff, 0.85, 1.4)
    this.tween(0.4, (kk) => {
      const w = 1 - kk
      this.orient(outer, from, target, 0.14 * k * w * (0.85 + Math.random() * 0.3))
      this.orient(core, from, target, 0.05 * k * w)
      this.emit(along, ap.lerpVectors(from, target, Math.random()), 2)
    }, E.lin).then(() => { this.drop(outer); this.drop(core) })
  }

  async fx_rock(a, d, k, id) {
    const n = id === 'rockslide' ? 7 : 3
    const target = this.center(d, V(), 0.5)
    const R = this.radius(d)
    this.cast(a, 0.3)
    let first = null
    for (let i = 0; i < n; i++) {
      const rock = this.add(new THREE.Mesh(this.geo.rock, toonMat(i % 2 ? 0xa89060 : 0x8c7a52)))
      addOutline(rock, 0.06)
      const size = rnd(0.22, 0.34) * (0.8 + k * 0.3)
      rock.scale.setScalar(size)
      const to = V(target.x + rnd(-R * 0.7, R * 0.7), target.y + rnd(-0.3, 0.4), target.z + rnd(-0.4, 0.4))
      const from = V(to.x + rnd(-1, 1) + (id === 'rockslide' ? 1.5 : 0), to.y + 6 + i * 0.3, to.z + rnd(-0.5, 0.5))
      const spin = V(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8))
      rock.position.copy(from)
      this.wait(i * (id === 'rockslide' ? 85 : 110)).then(() => this.fly(rock, from, to, 0.4, {
        arc: 0, ease: E.in2, onStep: (kk, pp, dt) => { rock.rotation.x += spin.x * dt; rock.rotation.y += spin.y * dt; rock.rotation.z += spin.z * dt },
      })).then(() => {
        this.dust(to, 0xc8b48a, 0.7)
        this.emit(spec({ pool: 'solid', shape: 2, speed: [2, 4], life: [0.4, 0.7], size: [0.06, 0.11], end: 0.6, color: 0x8c7a52, color2: 0xb8a070, grav: 9, up: 2 }), to, 6)
        this.shake(0.25 + (id === 'rockslide' ? 0.2 : 0))
        const out = V(rnd(-1, 1), 0, rnd(-1, 1)).normalize()
        const start = rock.position.clone()
        return this.tween(0.45, (kk) => {
          rock.position.set(start.x + out.x * kk * 1.2, start.y + Math.sin(Math.PI * kk) * 0.5 - kk * 0.8, start.z + out.z * kk * 1.2)
          rock.scale.setScalar(size * (1 - E.in(kk)))
        }, E.lin).then(() => this.drop(rock))
      })
      if (i === Math.min(2, n - 1)) first = this.wait(i * (id === 'rockslide' ? 85 : 110) + 410)
    }
    await first
    if (id === 'rockslide') this.shake(0.6)
  }

  async fx_ground(a, d, k, id) {
    const C = FX.ground
    const target = this.center(d, V(), 0.5)
    const feetD = this.feetOf(d, V())
    const mud = spec({ pool: 'solid', shape: 2, speed: [2, 4], life: [0.45, 0.8], size: [0.08, 0.16], end: 0.6, color: 0x7a5230, color2: 0x9a6a3a, grav: 9, up: 2.2, drag: 1 })
    if (id === 'dig') {
      const m = this.slots[a].mon
      const feetA = this.feetOf(a, V())
      this.act(m, 'attack', 1.2)
      this.dust(feetA, 0xb08a5a, 1)
      await this.tween(0.32, (kk) => { m.sink = kk * m.h * m.base * 1.05; m.yaw = kk * 4 }, E.in2)
      m.hidden = true
      const p = V()
      const trail = spec({ pool: 'solid', speed: [0.5, 1.5], life: [0.4, 0.7], size: [0.2, 0.35], end: 1.6, color: 0x9a7048, color2: 0xc8a070, up: 1.2, drag: 2, alpha: 0.8, jitter: 0.15 })
      await this.tween(0.42, (kk) => {
        p.lerpVectors(feetA, feetD, kk)
        this.emit(trail, p, 3)
        if (Math.random() < 0.25) this.ringPulse(p, 0x7a5230, 0.6, 0.35, { flat: true, opacity: 0.5 })
      }, E.inOut)
      this.shake(0.8, 1.2)
      this.dust(feetD, 0xb08a5a, 1.6)
      this.emit(mud, feetD, 26)
      this.ringPulse(feetD, 0x7a5230, this.radius(d) * 2.8, 0.6, { flat: true, opacity: 0.7 })
      const off = V().subVectors(HOME[d], HOME[a]).multiplyScalar(0.72).setY(0)
      m.off.copy(off)
      m.hidden = false
      m.yaw = 0
      await this.tween(0.2, (kk) => { m.sink = (1 - kk) * m.h * m.base; m.off.y = Math.sin(Math.PI * kk) * 0.9 }, E.out)
      m.sink = 0
      this.tween(0.45, (kk) => {
        m.off.set(off.x * (1 - kk), Math.sin(Math.PI * kk) * 0.8, off.z * (1 - kk))
      }, E.inOut).then(() => { m.off.set(0, 0, 0) })
      return
    }
    // 泥巴射击
    this.cast(a, 0.25)
    const from = this.mouth(a, d, V())
    const shots = []
    for (let i = 0; i < 5; i++) {
      const blob = this.add(new THREE.Mesh(this.geo.sphere, toonMat(i % 2 ? 0x7a5230 : 0x8a5f38)))
      blob.scale.setScalar(rnd(0.1, 0.16) * (0.8 + 0.3 * k))
      addOutline(blob, 0.1)
      blob.position.copy(from)
      blob.visible = false
      const to = V(target.x + rnd(-0.4, 0.4), target.y + rnd(-0.3, 0.3), target.z + rnd(-0.2, 0.2))
      const s0 = blob.scale.x
      shots.push(this.wait(i * 70).then(() => {
        blob.visible = true
        return this.fly(blob, from, to, 0.36, { arc: rnd(0.4, 0.9), side: rnd(-0.4, 0.4), onStep: (kk) => { blob.scale.y = s0 * (1 + kk * 0.4) } })
      }).then(() => {
        this.emit(mud, to, 6)
        this.drop(blob)
      }))
    }
    await Promise.all(shots)
    this.ringPulse(feetD, 0x7a5230, this.radius(d) * 2.6, 0.55, { flat: true, opacity: 0.6 })
    this.ringPulse(feetD, 0x7a5230, this.radius(d) * 3.6, 0.75, { flat: true, opacity: 0.4, width: 'thin' })
    this.shake(0.55, 1.1)
  }

  // 风刃：面向相机的新月形，飞向目标
  crescent(from, to, color, { size = 0.9, dur = 0.34, side = 0, roll = 0 } = {}) {
    const m = this.add(new THREE.Mesh(this.geo.crescent, this.fxMat(color, { opacity: 0.95 })))
    m.renderOrder = 7
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll)
    return this.fly(m, from, to, dur, {
      arc: 0.2, side,
      onStep: (k) => {
        m.quaternion.copy(this.camera.quaternion).multiply(q)
        m.scale.setScalar(size * (0.5 + 0.5 * E.out(k)))
        m.material.opacity = 0.95 * (k < 0.85 ? 1 : (1 - k) / 0.15)
      },
    }).then(() => this.drop(m))
  }

  feathers(pos, n = 8, color = 0xffffff) {
    this.emit(spec({ pool: 'solid', shape: 6, speed: [1, 2.5], life: [0.8, 1.4], size: [0.16, 0.24], end: 1, color, color2: 0xe8e0ff, grav: 0.8, drag: 3, up: 1, alpha: 0.95 }), pos, n)
  }

  async fx_flying(a, d, k, id) {
    const C = FX.flying
    const target = this.center(d, V(), 0.5)
    if (id === 'wingattack') {
      const from = this.mouth(a, d, V())
      this.cast(a, 0.2)
      const w1 = this.crescent(from, target, C[1], { side: 0.8, roll: 0.7, size: 1.0 * k })
      const w2 = this.wait(80).then(() => this.crescent(from, target, 0xffffff, { side: -0.8, roll: -0.7, size: 0.95 * k }))
      await Promise.all([w1, w2])
      this.impactStar(target, 0xffffff, 1.1)
      this.feathers(target, 10)
      return
    }
    const streak = spec({ speed: [0.1, 0.3], life: [0.15, 0.25], size: [0.25, 0.4], end: 0.2, color: 0xffffff, jitter: 0.25, drag: 1 })
    await this.lunge(a, d, { reach: 0.78, dur: 0.18, hop: 0.2, lean: 0.55, wind: 0.08, onStep: (kk, p) => this.emit(streak, p, 2) })
    this.impactStar(target, 0xffffff, 0.8)
    this.feathers(target, 6)
  }

  async fx_bug(a, d, k, id) {
    const C = FX.bug
    const target = this.center(d, V(), 0.5)
    if (id === 'bugbite') {
      await this.lunge(a, d, { reach: 0.6, dur: 0.24, hop: 0.2 })
      await this.jaws(d, 0xf6ffe0)
      this.emit(spec({ pool: 'solid', shape: 2, speed: [1.5, 3.5], life: [0.4, 0.7], size: [0.06, 0.1], end: 0.5, color: C[1], color2: C[2], grav: 6, up: 1.5 }), target, 12)
      return
    }
    // 银色旋风
    this.cast(a, 0.3)
    const silver = spec({ shape: 1, speed: [1, 1], life: [0.4, 0.4], size: [0.12, 0.22], end: 0.5, color: 0xffffff, color2: 0xe6f0c0, spread: 0.08, drag: 0 })
    this.stream(a, d, 0.55, silver, 80, { travel: 0.4, spiral: 14, spiralR: 0.35 })
    const from = this.mouth(a, d, V())
    this.crescent(from, target, 0xf0f6e0, { side: 0.6, roll: 0.5, size: 0.9 })
    this.wait(120).then(() => this.crescent(from, target, 0xffffff, { side: -0.6, roll: -0.5, size: 0.8 }))
    await this.wait(460)
    this.emit(spec({ shape: 1, speed: [1.5, 3.5], life: [0.4, 0.7], size: [0.16, 0.28], end: 0.1, color: 0xffffff, color2: C[0], drag: 3 }), target, 20)
  }

  async jaws(d, color) {
    const c = this.center(d, V(), 0.5)
    const R = this.radius(d) * 0.9
    const up = this.add(new THREE.Mesh(this.geo.jaw, this.fxMat(color, { opacity: 0.95 })))
    const lo = this.add(new THREE.Mesh(this.geo.jaw, this.fxMat(color, { opacity: 0.95 })))
    up.renderOrder = lo.renderOrder = 8
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)
    const place = (gap, op) => {
      for (const [j, s] of [[up, 1], [lo, -1]]) {
        j.quaternion.copy(this.camera.quaternion)
        if (s < 0) j.quaternion.multiply(flip)
        j.scale.setScalar(R)
        j.position.copy(c).addScaledVector(this._pv.set(0, 1, 0).applyQuaternion(this.camera.quaternion), s * gap)
        j.material.opacity = op
      }
    }
    await this.tween(0.16, (k) => place(R * (0.9 - k * 0.85), 0.95), E.in2)
    this.impactStar(c, 0xffffff, 1)
    this.shake(0.2)
    this.tween(0.25, (k) => place(R * 0.05, 0.95 * (1 - k)), E.lin).then(() => { this.drop(up); this.drop(lo) })
  }

  async fx_ghost(a, d, k, id) {
    const C = FX.ghost
    const target = this.center(d, V(), 0.5)
    if (id === 'lick') {
      const slime = spec({ pool: 'solid', shape: 2, speed: [0.5, 1.5], life: [0.4, 0.8], size: [0.08, 0.14], end: 0.6, color: C[1], color2: 0xc07aff, grav: 5, jitter: 0.3 })
      await this.lunge(a, d, { reach: 0.62, dur: 0.24, hop: 0.2, onStep: (kk, p) => this.emit(slime, p, 2) })
      this.emit(slime, target, 12)
      this.tintPulse(d, 0xb070ff, 0.6, 0.7)
      this.impactStar(target, C[0], 0.8)
      return
    }
    // 暗影球：蓄力 → 摇摆飞行 → 暗色爆裂
    this.cast(a, 0.4)
    const from = this.mouth(a, d, V())
    const halo = this.sprite(C[1], 0.1)
    const core = this.add(new THREE.Mesh(this.geo.sphere, this.fxMat(0x24103e, { additive: false, opacity: 0.95, side: THREE.FrontSide })))
    halo.position.copy(from)
    core.position.copy(from)
    const inward = spec({ speed: [0.5, 1], life: [0.25, 0.4], size: [0.12, 0.2], end: 0.1, color: C[0], color2: C[1], jitter: 0.6, drag: 0 })
    const size = 0.22 + 0.08 * k
    await this.tween(0.3, (kk) => {
      halo.scale.setScalar(size * 2.8 * kk)
      core.scale.setScalar(size * 0.7 * kk)
      this.emit(inward, from, 2)
    }, E.out)
    const smoke = spec({ pool: 'solid', speed: [0.1, 0.4], life: [0.35, 0.6], size: [0.2, 0.35], end: 1.8, color: 0x2a1640, color2: 0x4a2a70, drag: 1, alpha: 0.55, jitter: 0.08 })
    const wisp = spec({ speed: [0.1, 0.4], life: [0.25, 0.45], size: [0.14, 0.24], end: 0.2, color: C[1], color2: C[0], drag: 1 })
    const g = new THREE.Group()
    this.add(g)
    g.attach(halo)
    g.attach(core)
    halo.position.set(0, 0, 0)
    core.position.set(0, 0, 0)
    g.position.copy(from)
    await this.fly(g, from, target, 0.48, { arc: 0.35, wobble: 0.28, onStep: (kk, p) => {
      halo.scale.setScalar(size * (2.6 + Math.sin(this.time * 24) * 0.35))
      this.emit(smoke, p, 1)
      this.emit(wisp, p, 2)
    } })
    this.drop(g)
    this.ringPulse(target, C[1], this.radius(d) * 2.4, 0.45)
    this.emit(spec({ pool: 'solid', speed: [1.5, 3.5], life: [0.4, 0.7], size: [0.25, 0.45], end: 1.8, color: 0x2a1640, color2: 0x5a2a90, drag: 3, alpha: 0.7 }), target, 16)
    this.tintPulse(d, 0x6a2aaa, 0.6, 0.7)
  }

  async fx_psychic(a, d, k, id) {
    const C = FX.psychic
    const target = this.center(d, V(), 0.5)
    this.tintPulse(a, 0xff7ab8, 0.5, 0.8)
    if (id === 'psybeam') {
      this.cast(a, 0.35)
      const from = this.mouth(a, d, V())
      const dir = V().subVectors(target, from).normalize()
      const hues = [0xff5a9e, 0xc48bff, 0x7ad8ff, 0xffd166]
      const shots = []
      for (let i = 0; i < 9; i++) {
        const ring = this.add(new THREE.Mesh(this.geo.ring, this.fxMat(hues[i % hues.length], { opacity: 0.9 })))
        ring.renderOrder = 7
        ring.scale.setScalar(0.01)
        shots.push(this.wait(i * 45).then(() => {
          ring.lookAt(this._pv.copy(from).add(dir))
          return this.fly(ring, from, target, 0.3, { arc: 0, onStep: (kk) => ring.scale.setScalar((0.2 + 0.25 * k) * (0.6 + Math.sin(kk * Math.PI) * 0.6)) })
        }).then(() => this.drop(ring)))
      }
      await this.wait(330)
      this.ringPulse(target, C[1], this.radius(d) * 2.3, 0.5, { normal: dir })
      const tm = this.slots[d].mon
      if (tm) tm.wob = 1
      this.wait(500).then(() => { const m = this.slots?.[d]?.mon; if (m) m.wob = 0 })
      return
    }
    // 念力：目标周围粉色同心圆涟漪 + 目标晃动
    this.cast(a, 0.35)
    const m = this.slots[d].mon
    for (let i = 0; i < 4; i++) this.wait(i * 110).then(() => this.ringPulse(this.center(d, V(), 0.5), i % 2 ? C[0] : C[1], this.radius(d) * (1.8 + i * 0.35), 0.55, { from: 0.1, width: i % 2 ? 'thin' : 'ring' }))
    if (m) m.wob = 1
    this.emit(spec({ shape: 1, speed: [0.4, 1.2], life: [0.4, 0.7], size: [0.14, 0.26], end: 0.2, color: C[0], color2: C[1], jitter: this.radius(d) * 0.8, drag: 1 }), target, 16)
    await this.wait(460)
    this.wait(300).then(() => { const mm = this.slots?.[d]?.mon; if (mm) mm.wob = 0 })
  }

  async fx_dragon(a, d, k, id) {
    const C = FX.dragon
    const target = this.center(d, V(), 0.5)
    if (id === 'dragonpulse') {
      this.cast(a, 0.45)
      const from = this.mouth(a, d, V())
      const halo = this.sprite(C[1], 0.1)
      halo.position.copy(from)
      const inward = spec({ speed: [0.4, 0.8], life: [0.3, 0.45], size: [0.14, 0.24], end: 0.1, color: C[0], color2: C[2], jitter: 0.7, drag: 0 })
      await this.tween(0.32, (kk) => { halo.scale.setScalar(1.3 * kk); this.emit(inward, from, 3) }, E.out)
      this.drop(halo)
      const helix = spec({ speed: [0.05, 0.2], life: [0.3, 0.5], size: [0.16, 0.26], end: 0.2, color: C[1], color2: C[2], drag: 1 })
      const dir = V().subVectors(target, from).normalize()
      const u = V(0, 1, 0).cross(dir).normalize(), w = V().crossVectors(dir, u)
      const hp = V()
      await this.orb(from, target, {
        size: 0.32, core: 0xf0e8ff, halo: C[1], dur: 0.42, arc: 0.1,
        trail: spec({ speed: [0.05, 0.2], life: [0.2, 0.35], size: [0.2, 0.3], end: 0.2, color: C[0], color2: C[1], drag: 1 }), rate: 2,
      }).then(() => {})
      for (let i = 0; i < 24; i++) {
        const t = i / 24, ang = t * TAU * 3
        hp.lerpVectors(from, target, t).addScaledVector(u, Math.cos(ang) * 0.3).addScaledVector(w, Math.sin(ang) * 0.3)
        this.emit(helix, hp, 1)
      }
      this.ringPulse(target, C[1], this.radius(d) * 2.8, 0.5)
      this.ringPulse(target, C[2], this.radius(d) * 3.6, 0.7, { width: 'thin' })
      this.emit(spec({ shape: 1, speed: [2, 5], life: [0.4, 0.7], size: [0.2, 0.36], end: 0.1, color: C[0], color2: C[1], drag: 3 }), target, 30)
      this.shake(0.6)
      return
    }
    // 龙息：紫蓝螺旋吐息
    this.cast(a, 0.35)
    const breath = spec({ speed: [1, 1], life: [0.35, 0.35], size: [0.2, 0.3], end: 2.6, color: C[1], color2: C[2], spread: 0.06, drag: 0 })
    const core = spec({ shape: 1, speed: [1, 1], life: [0.35, 0.35], size: [0.12, 0.2], end: 1, color: C[0], color2: 0xffffff, spread: 0.04, drag: 0 })
    this.stream(a, d, 0.6, breath, 80, { travel: 0.36, spiral: 16, spiralR: 0.28 })
    this.stream(a, d, 0.6, core, 40, { travel: 0.34 })
    await this.wait(400)
    this.emit(spec({ speed: [1.5, 3], life: [0.4, 0.7], size: [0.3, 0.5], end: 1.5, color: C[1], color2: C[2], drag: 3 }), target, 14)
    this.tintPulse(d, 0x8a6aff, 0.5, 0.6)
  }

  // —— 变化招式 ——
  async statusFx(a, d, mv, id) {
    const eff = mv.effect || {}
    const col = FX[mv.type] || FX.normal
    if (eff.heal) return this.sunHeal(a)
    if (eff.target === 'self') {
      if (id === 'agility') return this.agilityFx(a)
      return this.auraFx(a, id === 'harden' ? [0xffffff, 0xd6dde8, 0x8a96a8] : col, id)
    }
    if (id === 'leer') await this.leerFx(a, d)
    else await this.soundWaves(a, d)
    await this.debuffWave(d)
  }

  async auraFx(key, col, id) {
    const m = this.slots[key].mon
    if (!m) return
    const feet = this.feetOf(key, V())
    const R = this.radius(key)
    const H = m.h * m.base
    this.act(m, 'happy', 0.9)
    const rise = spec({ speed: [0.2, 0.5], life: [0.5, 0.9], size: [0.15, 0.28], end: 0.2, color: col[0], color2: col[1], up: 2.2, drag: 1, jitter: 0 })
    const p = V()
    for (let i = 0; i < 3; i++) this.wait(i * 150).then(() => this.ringPulse(feet, col[1], R * 1.5, 0.7, { flat: true, from: 0.9, rise: H * 0.9, opacity: 0.8 }))
    this.tintPulse(key, col[1], 0.55, 0.9)
    await this.tween(0.85, (k) => {
      for (let i = 0; i < 2; i++) {
        const ang = Math.random() * TAU
        p.set(feet.x + Math.cos(ang) * R * 0.9, feet.y + Math.random() * 0.3, feet.z + Math.sin(ang) * R * 0.9)
        this.emit(rise, p, 1)
      }
      if (id === 'growth') m.squash = 1 + Math.sin(k * Math.PI) * 0.14
      if (id === 'harden') m.hitFlash = k < 0.8 ? (Math.sin(k * 30) > 0 ? 0.55 : 0.1) : 0
    }, E.lin)
    m.squash = 1
    m.hitFlash = 0
    if (id === 'harden') this.impactStar(this.center(key, V(), 0.75), 0xffffff, 0.7)
  }

  async agilityFx(key) {
    const m = this.slots[key].mon
    if (!m) return
    const side = V(HOME[OTHER[key]].z - HOME[key].z, 0, HOME[key].x - HOME[OTHER[key]].x).normalize()
    const streak = spec({ speed: [0.05, 0.2], life: [0.18, 0.3], size: [0.3, 0.5], end: 0.3, color: 0xffd6e8, color2: 0xffffff, jitter: 0.35, drag: 1 })
    const p = V()
    this.act(m, 'happy', 0.9)
    this.tintPulse(key, 0xff8ac0, 0.5, 0.9)
    await this.tween(0.7, (k) => {
      const s = Math.sin(k * Math.PI * 4) * 0.55 * (1 - k * 0.4)
      m.off.set(side.x * s, Math.abs(Math.sin(k * Math.PI * 4)) * 0.15, side.z * s)
      this.emit(streak, this.center(key, p), 2)
    }, E.lin)
    m.off.set(0, 0, 0)
    this.ringPulse(this.feetOf(key, V()), 0xff8ac0, this.radius(key) * 2.2, 0.5, { flat: true })
  }

  async soundWaves(a, d) {
    const m = this.slots[a].mon
    if (m) this.act(m, 'happy', 0.7)
    const from = this.mouth(a, d, V())
    const to = this.center(d, V(), 0.55)
    if (m) this.tween(0.5, (k) => { m.squash = 1 + Math.sin(k * Math.PI * 3) * 0.08 }, E.lin).then(() => { m.squash = 1 })
    const waves = []
    // 新月的凸面朝向飞行方向：我方向右上、对手向左下
    const roll = a === 'me' ? -Math.PI / 2 : Math.PI / 2
    for (let i = 0; i < 3; i++) waves.push(this.wait(i * 120).then(() => this.crescent(from, to, i % 2 ? 0xffffff : 0xfff1c2, { size: 0.6 + i * 0.25, dur: 0.4, roll })))
    await Promise.all(waves)
  }

  async leerFx(a, d) {
    const eye = this.center(a, V(), 0.78).addScaledVector(this.dirTo(a, d, V()), this.radius(a) * 0.6)
    this.impactStar(eye, 0xff3a3a, 0.9, 0.45)
    this.impactStar(eye.clone().add(V(0.25, 0, 0)), 0xff3a3a, 0.7, 0.45)
    await this.wait(300)
    const m = this.slots[d].mon
    if (m) { m.wob = 0.6; this.wait(450).then(() => { m.wob = 0 }) }
  }

  async debuffWave(d) {
    const feet = this.feetOf(d, V())
    const top = this.center(d, V(), 1.05)
    const R = this.radius(d)
    this.tintPulse(d, 0x4a6aff, 0.45, 0.7)
    const fall = spec({ speed: [0.1, 0.3], life: [0.5, 0.8], size: [0.14, 0.24], end: 0.3, color: 0x9ab4ff, color2: 0x4a6aff, up: -2, drag: 0.5, jitter: R * 0.8 })
    this.emit(fall, top, 18)
    for (let i = 0; i < 2; i++) {
      const start = top.clone()
      this.wait(i * 140).then(() => this.ringPulse(start, 0x6a8aff, R * 1.6, 0.6, { flat: true, from: 1, rise: -(top.y - feet.y), opacity: 0.8 }))
    }
    await this.wait(520)
  }

  async sunHeal(key) {
    const m = this.slots[key].mon
    if (!m) return
    const feet = this.feetOf(key, V())
    const R = this.radius(key)
    const col = this.add(new THREE.Mesh(this.geo.beam, this.fxMat(0xffe89a, { opacity: 0.7 })))
    col.renderOrder = 7
    this.act(m, 'happy', 1)
    this.tintPulse(key, 0xfff0a0, 0.5, 1)
    const motes = spec({ shape: 1, speed: [0.1, 0.3], life: [0.5, 0.9], size: [0.14, 0.24], end: 0.2, color: 0xfff6c0, color2: 0xffd84a, up: -1.5, drag: 0.5, jitter: R })
    const top = V(feet.x, feet.y + 6, feet.z)
    await this.tween(0.8, (k) => {
      const g = E.out(Math.min(1, k * 3))
      col.scale.set(R * 1.1, 8 * g, R * 1.1)
      col.position.set(feet.x, 8 - 4 * g, feet.z)
      col.material.opacity = 0.7 * (k < 0.7 ? 1 : (1 - k) / 0.3)
      this.emit(motes, top.set(feet.x, feet.y + 2 + Math.random() * 3, feet.z), 1)
    }, E.lin)
    this.drop(col)
  }

  // —— 受击 / 闪避 / 倒下 / 能力变化 / 回复 ——
  hit(key, e = {}) {
    const S = this.slots?.[key]
    const m = S?.mon
    if (!m || !this.running) return Promise.resolve()
    const type = this.lastType || 'normal'
    const big = !!e.crit || e.eff > 1
    const weak = e.eff != null && e.eff < 1
    const c = this.center(key, V(), 0.55)
    this.burst(c, type, big ? 1.5 : weak ? 0.6 : 1)
    if (big) this.impactStar(c, e.crit ? 0xffe066 : 0xffffff, 1.6)
    const away = this.dirTo(OTHER[key], key, V())
    this.act(m, 'hurt', 0.55)
    m.hitColor = 0xffffff
    this.punch(key, big ? 1 : weak ? 0.3 : 0.6)
    if (big) this.shake(e.crit ? 0.75 : 0.6)
    else if (!weak) this.shake(0.22)
    if (this.arena && this.bg === 'arena') this.arena.hype = Math.min(1, this.arena.hype + (big ? 0.8 : 0.4))
    this.damageNumber(key, e)
    const amp = big ? 0.6 : weak ? 0.2 : 0.38
    return this.tween(0.55, (k) => {
      const push = amp * Math.sin(Math.PI * Math.min(1, k * 2.2)) * (1 - k * 0.6)
      const j = k < 0.5 ? Math.sin(k * 90) * 0.06 * (1 - k * 2) : 0
      m.off.set(away.x * push + j, 0, away.z * push)
      m.lean = -push * 0.5
      m.hitFlash = k < 0.55 ? (Math.floor(k * 14) % 2 ? 0.15 : 1) * (1 - k) : 0
    }, E.lin).then(() => { m.off.set(0, 0, 0); m.lean = 0; m.hitFlash = 0 })
  }

  async miss(key) {
    const m = this.slots?.[key]?.mon
    if (!m) return
    const o = OTHER[key]
    const side = V(HOME[o].z - HOME[key].z, 0, HOME[key].x - HOME[o].x).normalize()
    const streak = spec({ speed: [0.05, 0.2], life: [0.2, 0.3], size: [0.3, 0.45], end: 0.3, color: 0xffffff, jitter: 0.3, drag: 1, alpha: 0.7 })
    const p = V()
    this.drainFor = null
    this.floatTag(key, '未命中', 'miss')
    await this.tween(0.5, (k) => {
      const s = Math.sin(Math.PI * k) * 0.85
      m.off.set(side.x * s, Math.sin(Math.PI * k) * 0.25, side.z * s)
      m.tilt = Math.sin(Math.PI * k) * 0.2
      if (k < 0.4) this.emit(streak, this.center(key, p), 1)
    }, E.lin)
    m.off.set(0, 0, 0)
    m.tilt = 0
  }

  async faint(key) {
    const m = this.slots?.[key]?.mon
    if (!m) return
    this.act(m, 'faint', 1.1)
    const dir = key === 'me' ? -1 : 1
    await this.tween(0.3, (k) => { m.tilt = Math.sin(k * Math.PI * 3) * 0.12; m.squash = 1 - Math.sin(k * Math.PI) * 0.08 }, E.lin)
    this.prepareFade(m)
    const feet = this.feetOf(key, V())
    await this.tween(0.55, (k) => {
      m.tilt = dir * 1.35 * E.in(k)
      m.squash = 1
      this.setFade(m, k * 0.8, 1)
    }, E.lin)
    this.dust(feet, 0xd8c7a0, 1.2)
    this.shake(0.3)
    const H = m.h * m.base
    await this.tween(0.5, (k) => {
      m.sink = H * 0.5 * E.in2(k)
      m.alpha = 1 - k
      this.setFade(m, 0.8 + k * 0.2, 1 - k)
    }, E.lin)
    m.hidden = true
    m.alpha = 0
  }

  // 倒下时替换为可调色的材质副本：逐渐去色并淡出（描边直接隐藏）
  prepareFade(m) {
    if (m.fadeMats) return
    m.fadeMats = []
    const map = new Map()
    m.model.traverse((o) => {
      if (!o.material) return
      if (o.userData.isOutline || o.name === 'outline') { o.visible = false; return }
      const swap = (mat) => {
        if (!mat) return mat
        if (!map.has(mat)) {
          const c = mat.clone()
          c.userData = {}
          c.transparent = true
          const f = { mat: c, color: c.color ? c.color.clone() : null, emissive: c.emissive ? c.emissive.clone() : null }
          map.set(mat, c)
          m.fadeMats.push(f)
        }
        return map.get(mat)
      }
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
    })
  }

  setFade(m, grey, opacity) {
    if (!m.fadeMats) return
    for (const f of m.fadeMats) {
      if (f.color && f.mat.color) {
        const l = f.color.r * 0.3 + f.color.g * 0.59 + f.color.b * 0.11
        f.mat.color.setRGB(lerp(f.color.r, l * 0.75, grey), lerp(f.color.g, l * 0.75, grey), lerp(f.color.b, l * 0.8, grey))
      }
      if (f.emissive && f.mat.emissive) f.mat.emissive.copy(f.emissive).multiplyScalar(1 - grey)
      f.mat.opacity = opacity
    }
  }

  async stat(key, stat, up) {
    const m = this.slots?.[key]?.mon
    if (!m) return
    const feet = this.feetOf(key, V())
    const R = this.radius(key)
    const H = m.h * m.base
    const color = up ? 0xff8a3d : 0x4aa3ff
    const mat = this.fxMat(color, { additive: false, opacity: 0 })
    const arrows = []
    for (let i = 0; i < 8; i++) {
      const a = this.add(new THREE.Mesh(this.geo.arrow, mat))
      a.renderOrder = 8
      const ang = (i / 8) * TAU
      arrows.push({ a, ang, delay: (i % 4) * 0.12 + (i > 3 ? 0.06 : 0), r: R * (0.75 + (i % 2) * 0.3) })
    }
    this.act(m, up ? 'happy' : 'hurt', 0.8)
    this.tintPulse(key, color, 0.4, 0.9)
    this.ringPulse(feet, color, R * 2, 0.6, { flat: true, opacity: 0.7 })
    const spark = spec({ speed: [0.2, 0.5], life: [0.4, 0.7], size: [0.12, 0.22], end: 0.2, color: up ? 0xffd08a : 0xa8d4ff, color2: color, up: up ? 1.8 : -1.8, drag: 1, jitter: R * 0.8 })
    this.emit(spark, this.center(key, V(), up ? 0.2 : 0.9), 16)
    if (!up) m.wob = 0.35
    await this.tween(1.0, (k) => {
      let op = 0
      for (const it of arrows) {
        const t = clamp((k - it.delay) / 0.6, 0, 1)
        const y = up ? lerp(0.1, H * 1.1, E.out(t)) : lerp(H * 1.15, 0.1, E.in2(t))
        it.a.position.set(feet.x + Math.cos(it.ang + k) * it.r, y, feet.z + Math.sin(it.ang + k) * it.r)
        it.a.quaternion.copy(this.camera.quaternion)
        if (!up) it.a.rotateZ(Math.PI)
        it.a.scale.setScalar(0.22 + 0.06 * Math.sin(t * Math.PI))
        it.a.visible = t > 0 && t < 1
        op = Math.max(op, Math.sin(t * Math.PI))
      }
      mat.opacity = 0.9 * Math.min(1, k * 6) * (k > 0.85 ? (1 - k) / 0.15 : 1)
    }, E.lin)
    m.wob = 0
    for (const it of arrows) this.drop(it.a)
    mat.dispose()
  }

  async heal(key) {
    const m = this.slots?.[key]?.mon
    if (!m) return
    const R = this.radius(key)
    const feet = this.feetOf(key, V())
    // 吸取类招式：先让绿色光球从对手飞回
    const drain = this.drainFor === key
    this.drainFor = null
    if (drain && this.slots[OTHER[key]].mon) {
      const src = this.center(OTHER[key], V(), 0.5)
      const dst = this.center(key, V(), 0.5)
      const trail = spec({ speed: [0.05, 0.2], life: [0.2, 0.35], size: [0.1, 0.18], end: 0.2, color: 0xdcff9a, color2: 0x6fd13f, drag: 1 })
      const orbs = []
      for (let i = 0; i < 4; i++) orbs.push(this.wait(i * 70).then(() => this.orb(src.clone().add(V(rnd(-0.3, 0.3), rnd(-0.3, 0.3), 0)), dst, { size: 0.12, core: 0xf0ffd0, halo: 0x6fd13f, dur: 0.45, arc: rnd(0.5, 1.2), side: rnd(-0.8, 0.8), trail, rate: 1 })))
      await Promise.all(orbs)
    }
    this.act(m, 'happy', 0.9)
    this.tintPulse(key, 0x7dff9a, 0.5, 0.9)
    this.ringPulse(feet, 0x7dff9a, R * 2, 0.7, { flat: true, opacity: 0.7 })
    const green = spec({ shape: 1, speed: [0.1, 0.4], life: [0.6, 1.0], size: [0.14, 0.26], end: 0.2, color: 0xdfffe0, color2: 0x4fe07a, up: 1.6, drag: 0.6 })
    const p = V()
    await this.tween(0.8, () => {
      const ang = Math.random() * TAU, r = Math.random() * R
      this.emit(green, p.set(feet.x + Math.cos(ang) * r, feet.y + Math.random() * m.h * m.base * 0.6, feet.z + Math.sin(ang) * r), 1)
    }, E.lin)
  }

  // —— 捕捉球 ——
  async ball(e = {}) {
    const S = this.slots?.foe
    if (!S || !this.running) return
    const m = S.mon
    let ball
    try { ball = buildBall(e.ball || 'ball') } catch { ball = null }
    if (!ball) ball = new THREE.Mesh(this.geo.sphere, toonMat(0xff5a5f))
    ball.userData.ball = true
    // 私有材质副本：捕获成功后可以调暗而不影响共享材质
    const own = []
    ball.traverse((o) => {
      if (!o.material || o.userData.isOutline || o.name === 'outline') return
      const swap = (mt) => { const c = mt.clone(); c.userData = { fx: true }; own.push(c); return c }
      o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material)
    })
    const bs = 1.9
    const rad = 0.12 * bs
    ball.scale.setScalar(bs)
    this.add(ball)
    const from = this.camera.localToWorld(V(-0.9, -0.8, -2.4))
    const hover = this.center('foe', V(), 0.55)
    ball.position.copy(from)
    this.cast('me', 0.2)
    await this.fly(ball, from, hover, 0.62, { arc: 1.8, ease: E.lin, onStep: (k, p, dt) => { ball.rotation.x -= dt * 18; ball.rotation.y += dt * 3 } })
    ball.rotation.set(0, Math.atan2(this.camera.position.x - hover.x, this.camera.position.z - hover.z), 0)
    // 命中：闪光 + 红光吸入
    this.impactStar(hover, 0xffffff, 1.4)
    this.screenFlash('#ffffff', 0.35, 160)
    const glow = this.sprite(0xff3a3a, 0.1)
    glow.position.copy(hover)
    const red = spec({ speed: [0.4, 1], life: [0.25, 0.4], size: [0.16, 0.3], end: 0.1, color: 0xffc0c0, color2: 0xff3a3a, drag: 0, jitter: 0.05 })
    const tp = V()
    if (m) {
      m.hitColor = 0xff3a3a
      await this.tween(0.5, (k) => {
        m.hitFlash = Math.min(1, k * 4)
        m.pop = 1 - E.in(k)
        glow.scale.setScalar(this.radius('foe') * 3 * Math.sin(Math.PI * Math.min(1, k * 1.2)))
        const c = this.center('foe', tp, 0.5)
        this.emit(red, c.lerp(hover, 0.3), 2)
        ball.position.y = hover.y + Math.sin(k * Math.PI) * 0.15
      }, E.lin)
      m.hidden = true
      m.hitFlash = 0
    } else await this.wait(300)
    this.drop(glow)
    // 落地弹跳
    const floor = HOME.foe.y + rad
    const y0 = ball.position.y
    await this.tween(0.55, (k) => { ball.position.y = lerp(y0, floor, E.bounce(k)) }, E.lin)
    this.dust(this.feetOf('foe', V()), 0xd8c7a0, 0.5)
    await this.wait(220)
    const shakes = Math.max(0, Math.min(3, e.shakes | 0))
    const click = spec({ shape: 1, speed: [0.5, 1.2], life: [0.2, 0.35], size: [0.1, 0.18], end: 0.1, color: 0xffffff, color2: 0xfff0a0, drag: 2 })
    for (let i = 0; i < shakes; i++) {
      await this.tween(0.38, (k) => {
        ball.rotation.z = Math.sin(k * TAU) * 0.5 * (1 - k * 0.3)
        ball.position.x = hover.x - Math.sin(k * TAU) * 0.05
      }, E.lin)
      ball.rotation.z = 0
      this.emit(click, ball.position, 5)
      await this.wait(260)
    }
    if (e.caught) {
      const c = ball.position.clone()
      this.impactStar(c, 0xffe066, 1.2, 0.5)
      this.emit(spec({ shape: 1, speed: [1.5, 3.5], life: [0.6, 1], size: [0.22, 0.4], end: 0.1, color: 0xfff3a0, color2: 0xffc43d, drag: 2.5, up: 1.5 }), c, 26)
      this.emit(spec({ pool: 'solid', shape: 5, speed: [1.5, 3], life: [0.9, 1.4], size: [0.1, 0.16], end: 1, color: 0xffc43d, color2: 0xff5a5f, grav: 3, drag: 2, up: 2.5 }), c, 18)
      for (let i = 0; i < 3; i++) this.wait(120 + i * 140).then(() => this.impactStar(c.clone().add(V(rnd(-0.5, 0.5), rnd(0.2, 0.7), 0)), 0xfff3a0, 0.6))
      const cols = own.filter((mt) => mt.color).map((mt) => [mt, mt.color.clone()])
      await this.tween(0.4, (k) => { for (const [mt, c0] of cols) mt.color.copy(c0).multiplyScalar(1 - 0.45 * k) }, E.lin)
      return
    }
    // 挣脱：球炸开，精灵重新弹出
    const c = ball.position.clone()
    this.screenFlash('#ffffff', 0.45, 200)
    this.impactStar(c.clone().setY(c.y + 0.4), 0xffffff, 1.8)
    this.emit(spec({ shape: 1, speed: [2, 5], life: [0.3, 0.6], size: [0.18, 0.32], end: 0.1, color: 0xffffff, color2: 0xff9a9a, drag: 3 }), c, 24)
    this.drop(ball)
    if (m) {
      m.hidden = false
      m.hitColor = 0xffffff
      this.act(m, 'happy', 0.8)
      await this.tween(0.42, (k) => { m.pop = E.back(k); m.hitFlash = 1 - k }, E.lin)
      m.pop = 1
      m.hitFlash = 0
    }
  }

  // 彩纸（竞技场开场 / PvP 胜利）
  celebrate(s = 1) {
    if (!this.running) return
    const cols = [[0xff5a5f, 0xffc43d], [0x8e5cf7, 0x2f9df4], [0x1fb5a3, 0xffffff], [0xf15bb5, 0xffc43d]]
    const p = V()
    for (const [c1, c2] of cols) {
      const sp = spec({ pool: 'solid', shape: 5, speed: [0.5, 2], life: [2.2, 3.4], size: [0.14, 0.22], end: 1, color: c1, color2: c2, grav: 1.6, drag: 1.2, alpha: 1 })
      for (let i = 0; i < Math.round(26 * s); i++) this.emit(sp, p.set(MID.x + rnd(-8, 8), rnd(5, 8), MID.z + rnd(-6, 5)), 1)
    }
    if (this.arena) this.arena.hype = 1
  }

  // —— DOM 叠加层 ——
  project(key, frac, out) {
    this.center(key, out, frac)
    out.project(this.camera)
    return { x: (out.x + 1) / 2 * this.W, y: (1 - out.y) / 2 * this.H }
  }

  damageNumber(key, e) {
    if (!this.fxEl || typeof e.dmg !== 'number') return
    const p = this.project(key, 1.0, this._dn)
    const el = document.createElement('div')
    el.className = 'b3d-dmg' + (e.crit ? ' crit' : '') + (e.eff > 1 ? ' super' : e.eff < 1 ? ' weak' : '')
    const tag = e.crit ? '要害！' : e.eff > 1 ? '效果绝佳！' : ''
    el.innerHTML = (tag ? `<small>${tag}</small>` : '') + `<b>-${Math.max(0, Math.round(e.dmg))}</b>`
    el.style.left = clamp(p.x + rnd(-14, 14), 30, this.W - 30) + 'px'
    el.style.top = clamp(p.y, 40, this.H - 20) + 'px'
    this.fxEl.appendChild(el)
    setTimeout(() => el.remove(), 1400)
  }

  floatTag(key, text, cls = '') {
    if (!this.fxEl) return
    const p = this.project(key, 1.0, this._dn)
    const el = document.createElement('div')
    el.className = 'b3d-tag ' + cls
    el.textContent = text
    el.style.left = clamp(p.x, 40, this.W - 40) + 'px'
    el.style.top = clamp(p.y, 40, this.H - 20) + 'px'
    this.fxEl.appendChild(el)
    setTimeout(() => el.remove(), 1200)
  }

  screenFlash(color, strength = 0.5, ms = 200) {
    if (!this.fxEl) return
    const el = document.createElement('div')
    el.className = 'b3d-flash'
    el.style.background = color
    el.style.setProperty('--a', String(strength * (this.motion < 1 ? 0.4 : 1)))
    el.style.animationDuration = ms + 'ms'
    this.fxEl.appendChild(el)
    setTimeout(() => el.remove(), ms + 60)
  }

  wipe() {
    if (!this.fxEl) return
    const el = document.createElement('div')
    el.className = 'b3d-wipe'
    el.innerHTML = '<i></i><i></i>'
    this.fxEl.appendChild(el)
    setTimeout(() => el.remove(), 900)
  }
}

const Y_UP = new THREE.Vector3(0, 1, 0)
