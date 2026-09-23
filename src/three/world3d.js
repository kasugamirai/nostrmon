// 3D 大地图：地形 / 光照 / 天空、玩家与跟随精灵、NPC、远端玩家、野生精灵、稀有精灵、CSS2D 标签、
// 环绕镜头、键盘 + 指针 + 摇杆移动（圆 vs 图块碰撞）、互动、传送淡入淡出、位置广播。
// 坐标约定见 docs/3d-architecture.md：1 单位 = 1 格，图块 (x, y) 中心 = (x+0.5, 0, y+0.5)，模型 ry=0 朝 +Z。
import * as THREE from 'three'
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { MAPS, tileAt } from '../data/maps.js'
import { SPECIES } from '../data/species.js'
import { buildTerrain } from './terrain.js'
import { buildTrainer, buildCreature } from './models.js'
import { toonMat, addOutline } from './materials.js'
import './world3d.css'

const WALK = 3.6, RUN = 6.2, R = 0.28
const TAU = Math.PI * 2
const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' }
const DIR_RY = { down: 0, up: Math.PI, right: Math.PI / 2, left: -Math.PI / 2 }
const LABEL_FAR2 = 18 * 18
const FOLLOW_GAP = 1.1
const REACH = [0.55, 0.95]
const AXES = ['x', 'y', 'z']
const SHADOW_HALF = 14, SHADOW_RES = 2048
const SUN_OFFSET = new THREE.Vector3(-7, 16, 9)

// 白天 / 森林（夜）两套氛围
const DAY = {
  hemiSky: '#e4f3ff', hemiGround: '#93b56c', hemiI: 1.55, sun: '#fff0d4', sunI: 1.95,
  fog: '#d3ebf8', fogNear: 14, fogFar: 50, skyTop: '#4fa8ee', skyHorizon: '#d3ebf8', cloud: '#ffffff', clouds: 1, stars: 0,
  lantern: 0,
}
const NIGHT = {
  hemiSky: '#8ea8dc', hemiGround: '#263626', hemiI: 0.95, sun: '#aac4ff', sunI: 0.8,
  fog: '#15253a', fogNear: 3, fogFar: 26, skyTop: '#050b1e', skyHorizon: '#1a2f4d', cloud: '#2d4166', clouds: 0.45, stars: 1,
  lantern: 7,
}

// —— 小工具 ——
const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU)
const lerpAngle = (a, b, k) => a + wrapAngle(b - a) * k
const damp = (rate, dt) => 1 - Math.exp(-rate * dt)
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
const dirOf = (ry) => {
  const s = Math.sin(ry), c = Math.cos(ry)
  return Math.abs(s) > Math.abs(c) ? (s > 0 ? 'right' : 'left') : c > 0 ? 'down' : 'up'
}
// 速度 → 训练家动画档位：0 待机，0.5 走，1 跑
const animSpeed = (v) => (v < 0.15 ? 0 : v <= WALK ? 0.5 * v / WALK : Math.min(1, 0.5 + 0.5 * (v - WALK) / (RUN - WALK)))
const easeOutBack = (x) => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2)
const round = (v, n) => Math.round(v * n) / n

function el(tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text != null) e.textContent = text
  return e
}
function repop(e) {
  e.classList.remove('w3d-pop')
  void e.offsetWidth
  e.classList.add('w3d-pop')
}
function castShadows(root) {
  root.traverse((o) => { if (o.isMesh && !o.userData.isOutline) o.castShadow = true })
  return root
}
function disposeModel(m) {
  if (!m) return
  m.removeFromParent()
  m.userData.dispose?.()
}
// CSS2DObject 只在自身被 remove 时清理 DOM；整组摘下前先手动隐藏
function hideLabels(root) {
  root.traverse((o) => { if (o.isCSS2DObject) o.element.style.display = 'none' })
}

// —— 共享 uniform / 材质 / 几何体 ——
const U_TIME = { value: 0 }
const U_PX = { value: 600 } // 每单位世界尺寸在 1 单位深度处的像素数（随窗口更新）

const SPARK_VS = /* glsl */`
attribute float phase;
uniform float time, px, size;
varying float vA;
void main() {
  float k = fract(time * 0.42 + phase);
  vec3 p = position;
  p.y += k * 0.9;
  float s = sin(k * 3.14159);
  vA = s * (0.55 + 0.45 * sin(time * 11.0 + phase * 37.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = size * px * (0.5 + 0.5 * s) / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const SPARK_FS = /* glsl */`
uniform vec3 color;
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float star = max(0.0, 1.0 - abs(c.x * c.y) * 90.0 - d * 1.9);
  float a = (smoothstep(0.5, 0.0, d) * 0.45 + star) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(color * a, a);
  #include <colorspace_fragment>
}`
const FLY_VS = /* glsl */`
attribute float phase;
uniform float time, px, size;
varying float vA;
void main() {
  float t = time + phase * 50.0;
  vec3 p = position + vec3(sin(t * 0.37) * 0.9 + sin(t * 0.91) * 0.3, sin(t * 0.53) * 0.35, cos(t * 0.29) * 0.9 + cos(t * 0.77) * 0.3);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float blink = smoothstep(0.15, 0.85, 0.5 + 0.5 * sin(time * (1.1 + phase) + phase * 20.0));
  vA = blink * smoothstep(36.0, 12.0, -mv.z);
  gl_PointSize = size * px / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`
const FLY_FS = /* glsl */`
uniform vec3 color;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2) * vA;
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(color, vec3(1.0), smoothstep(0.55, 1.0, a)) * a, a);
  #include <colorspace_fragment>
}`

const matCache = new Map()
function pointsMat(kind, color, size) {
  const key = kind + color + size
  if (matCache.has(key)) return matCache.get(key)
  const m = new THREE.ShaderMaterial({
    uniforms: { time: U_TIME, px: U_PX, size: { value: size }, color: { value: new THREE.Color(color) } },
    vertexShader: kind === 'fly' ? FLY_VS : SPARK_VS,
    fragmentShader: kind === 'fly' ? FLY_FS : SPARK_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  })
  matCache.set(key, m)
  return m
}
function sparkles(n, radius, height, color, size) {
  const pos = new Float32Array(n * 3), ph = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.random() * TAU, r = radius * (0.35 + 0.65 * Math.random())
    pos[i * 3] = Math.cos(a) * r
    pos[i * 3 + 1] = Math.random() * height
    pos[i * 3 + 2] = Math.sin(a) * r
    ph[i] = Math.random()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('phase', new THREE.BufferAttribute(ph, 1))
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, height * 0.5 + 0.45, 0), radius + height + 1)
  const p = new THREE.Points(g, pointsMat('spark', color, size))
  p.renderOrder = 3
  return p
}

// 稀有精灵脚下的光环 + 光柱
const GLOW_MAT = new THREE.ShaderMaterial({
  uniforms: { time: U_TIME, color: { value: new THREE.Color('#ffd35a') } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform float time; uniform vec3 color; varying vec2 vUv;
    void main() {
      float d = length(vUv - 0.5) * 2.0;
      float pulse = 0.5 + 0.5 * sin(time * 3.2);
      float r0 = 0.62 + pulse * 0.08;
      float ring = smoothstep(r0 - 0.16, r0, d) * smoothstep(r0 + 0.2, r0, d);
      float fill = (1.0 - smoothstep(0.0, r0, d)) * 0.28;
      float a = (ring * (0.7 + 0.3 * pulse) + fill) * smoothstep(1.0, 0.9, d);
      gl_FragColor = vec4(color * a, a);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
})
const BEAM_MAT = new THREE.ShaderMaterial({
  uniforms: { time: U_TIME, color: { value: new THREE.Color('#ffe08a') } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: /* glsl */`
    uniform float time; uniform vec3 color; varying vec2 vUv;
    void main() {
      float a = pow(1.0 - vUv.y, 1.6) * (0.2 + 0.08 * sin(time * 2.0 + vUv.x * 18.0));
      gl_FragColor = vec4(color * a, a);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
})
const GLOW_GEO = new THREE.PlaneGeometry(1.9, 1.9).rotateX(-Math.PI / 2)
const BEAM_GEO = new THREE.CylinderGeometry(0.34, 0.52, 3.4, 20, 1, true).translate(0, 1.7, 0)
const MARK_GEO = new THREE.RingGeometry(0.2, 0.3, 32).rotateX(-Math.PI / 2)
// 不可见的点击代理：比模型大一圈，手机上也容易点中
const PICK_GEO = new THREE.CylinderGeometry(0.5, 0.5, 1.5, 8).translate(0, 0.75, 0)
const PICK_MAT = new THREE.MeshBasicMaterial({ visible: false })
for (const g of [GLOW_GEO, BEAM_GEO, MARK_GEO, PICK_GEO]) g.userData.shared = true

function pickProxy(kind, ref, sx = 1, sy = 1) {
  const m = new THREE.Mesh(PICK_GEO, PICK_MAT)
  m.scale.set(sx, sy, sx)
  m.userData.pick = { kind, ref }
  return m
}

// —— 天空穹顶：渐变 + 卡通分层云 + 星星 / 月亮 ——
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      time: U_TIME, top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, cloud: { value: new THREE.Color() },
      clouds: { value: 1 }, stars: { value: 0 }, sunDir: { value: SUN_OFFSET.clone().normalize() },
      moonDir: { value: new THREE.Vector3(0.45, 0.32, -1).normalize() },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: /* glsl */`
      uniform float time, clouds, stars; uniform vec3 top, horizon, cloud, sunDir, moonDir;
      varying vec3 vDir;
      float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
      float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return v; }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(horizon, top, pow(smoothstep(-0.02, 0.62, h), 0.85));
        vec2 uv = d.xz / max(h + 0.2, 0.05);
        float sd = max(dot(d, sunDir), 0.0);
        if (stars > 0.5) {
          float md = max(dot(d, moonDir), 0.0);
          col += vec3(0.95, 0.96, 0.88) * smoothstep(0.9990, 0.9993, md) + vec3(0.22, 0.3, 0.5) * pow(md, 40.0);
          vec2 g = uv * 34.0; vec2 id = floor(g); float r = hash(id);
          float s = step(0.982, r) * smoothstep(0.32, 0.0, length(fract(g) - 0.5)) * (0.55 + 0.45 * sin(time * 2.3 + r * 90.0));
          col += vec3(s) * stars * smoothstep(0.06, 0.4, h);
        } else {
          col += vec3(1.0, 0.93, 0.75) * pow(sd, 28.0) * 0.45;
        }
        if (clouds > 0.0 && h > 0.0) {
          vec2 q = uv * 0.85 + vec2(time * 0.012, time * 0.005);
          float n = fbm(q);
          float c = smoothstep(0.5, 0.54, n) * 0.8 + smoothstep(0.6, 0.64, n) * 0.2;
          float shadeN = fbm(q + vec2(0.06, 0.09));
          vec3 cc = mix(cloud * 0.86, cloud, smoothstep(0.52, 0.6, shadeN));
          col = mix(col, cc, c * clouds * smoothstep(0.02, 0.28, h));
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  })
  const m = new THREE.Mesh(new THREE.SphereGeometry(180, 32, 16), mat)
  m.renderOrder = -10
  m.frustumCulled = false
  return m
}

// —— 足迹：跟随精灵沿领队走过的路线追随 ——
class Trail {
  constructor(n = 48) { this.n = n; this.xs = new Float32Array(n); this.zs = new Float32Array(n); this.len = 0; this.head = -1 }
  reset(x, z) { this.len = 1; this.head = 0; this.xs[0] = x; this.zs[0] = z }
  push(x, z) {
    if (this.len) {
      const dx = x - this.xs[this.head], dz = z - this.zs[this.head]
      if (dx * dx + dz * dz < 0.01) return
    }
    this.head = (this.head + 1) % this.n
    this.xs[this.head] = x; this.zs[this.head] = z
    this.len = Math.min(this.len + 1, this.n)
  }
  // 从领队当前位置沿足迹倒退 back 距离处的点
  sample(x, z, back, out) {
    let px = x, pz = z, rem = back
    for (let i = 0; i < this.len; i++) {
      const k = (this.head - i + this.n) % this.n
      const cx = this.xs[k], cz = this.zs[k]
      const d = Math.hypot(cx - px, cz - pz)
      if (d >= rem && d > 1e-6) { const f = rem / d; out.x = px + (cx - px) * f; out.z = pz + (cz - pz) * f; return }
      rem -= d; px = cx; pz = cz
    }
    out.x = px; out.z = pz
  }
}

const _tp = { x: 0, z: 0 }
class Follower {
  constructor(parent) { this.parent = parent; this.model = null; this.key = ''; this.pos = new THREE.Vector3(); this.heading = 0; this.spd = 0; this.trail = new Trail() }
  set(info) {
    const key = info && SPECIES[info.sp] ? info.sp + '|' + !!info.shiny : ''
    if (key === this.key) return
    this.key = key
    disposeModel(this.model)
    this.model = null
    if (!key) return
    this.model = castShadows(buildCreature(info.sp, { shiny: !!info.shiny }))
    this.model.scale.setScalar(0.7)
    this.model.position.copy(this.pos)
    this.model.rotation.y = this.heading
    this.parent.add(this.model)
  }
  reset(x, z, ry, free) {
    let bx = x - Math.sin(ry) * FOLLOW_GAP, bz = z - Math.cos(ry) * FOLLOW_GAP
    if (free && !free(bx, bz)) { bx = x; bz = z }
    this.trail.reset(bx, bz)
    this.trail.push(x, z)
    this.pos.set(bx, 0, bz)
    this.heading = ry
    this.spd = 0
    if (this.model) { this.model.position.copy(this.pos); this.model.rotation.y = ry }
  }
  update(dt, t, lx, lz) {
    this.trail.push(lx, lz)
    if (!this.model) return
    this.trail.sample(lx, lz, FOLLOW_GAP, _tp)
    const k = damp(9, dt)
    const dx = (_tp.x - this.pos.x) * k, dz = (_tp.z - this.pos.z) * k
    this.pos.x += dx; this.pos.z += dz
    const v = dt > 0 ? Math.hypot(dx, dz) / dt : 0
    this.spd += (v - this.spd) * damp(10, dt)
    if (v > 0.35) this.heading = lerpAngle(this.heading, Math.atan2(dx, dz), damp(10, dt))
    const moving = this.spd > 0.45
    this.model.position.copy(this.pos)
    this.model.rotation.y = this.heading
    this.model.userData.animate?.(t, { moving, speed: Math.min(1, this.spd / RUN) })
  }
  dispose() { disposeModel(this.model); this.model = null; this.key = '' }
}

// —— 训练家头顶：聊天气泡 / 表情 / 名字 ——
class Tag {
  constructor(parent, cls) {
    this.root = el('div', 'w3d-tag')
    this.bubble = el('div', 'w3d-bubble')
    this.btext = el('div', 'w3d-btext')
    this.bubble.append(this.btext)
    this.emote = el('div', 'w3d-emote')
    this.name = el('div', 'w3d-name' + (cls ? ' ' + cls : ''))
    this.bubble.hidden = true
    this.emote.hidden = true
    this.root.append(this.bubble, this.emote, this.name)
    this.obj = new CSS2DObject(this.root)
    this.obj.center.set(0.5, 1)
    parent.add(this.obj)
    this.nameText = null; this.busy = false; this.bKey = 0; this.eKey = 0
  }
  setName(t, busy = false) {
    if (t !== this.nameText) { this.nameText = t; this.name.textContent = t }
    if (busy !== this.busy) { this.busy = busy; this.name.classList.toggle('busy', busy) }
  }
  setBubble(b) {
    const key = b ? b.t : 0
    if (key === this.bKey) return
    this.bKey = key
    this.bubble.hidden = !b
    if (b) { this.btext.textContent = b.text; repop(this.bubble) }
  }
  setEmote(e) {
    const key = e ? e.t : 0
    if (key === this.eKey) return
    this.eKey = key
    this.emote.hidden = !e
    if (e) { this.emote.textContent = e.e; repop(this.emote) }
  }
  dispose() { this.obj.removeFromParent() }
}

function simpleLabel(parent, cls, text) {
  const e = el('div', cls, text)
  const o = new CSS2DObject(e)
  o.center.set(0.5, 1)
  parent.add(o)
  return o
}

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3()
const _ndc = new THREE.Vector2()
const _ray = new THREE.Raycaster()
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

export class World3D {
  constructor(game, canvas) {
    this.g = game
    this.cv = canvas
    this.map = null
    this.entry = null
    this.p = { x: 0, y: 0, dir: 'down' }
    this.path = null
    this.running = false
    this.keys = new Set()
    this.joy = new THREE.Vector2()
    this.rotKey = 0
    this.pos = new THREE.Vector3()
    this.vel = new THREE.Vector2()
    this.heading = 0
    this.wantHeading = 0
    this.moving = false
    this.paused = false
    this.fading = false
    this.time = 0
    this.last = performance.now()
    this.lastSent = 0
    this.doorAt = -1e9
    this.stuckT = 0
    this.contactAt = 0
    this.wildCool = new Map()
    this.engagingId = null
    this.lastWildId = null
    this.nextLookCheck = 0
    this.nextLeadCheck = 0
    this.nextRemotePoll = 0
    this.nextSpawnPoll = 0
    this.hitTx = 0; this.hitTy = 0
    this.pdx = 0; this.pdz = 0
    this.maps = new Map()
    this.remotes = new Map()
    this.wilds = new Map()
    this.spawns = new Map()
    this.stamp = 0
    this.ptrs = new Map()
    this.pinch = null
    this.markT = 1

    // 镜头
    this.yaw = this.yawT = 0
    this.pitch = this.pitchT = 0.9
    this.dist = this.distT = 9
    this.focus = new THREE.Vector3()
    this.focusVel = new THREE.Vector3()

    this.initRenderer()
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.Fog(DAY.fog, 20, 60)
    this.labelScene = new THREE.Scene()
    this.labels = new THREE.Group()
    this.labelScene.add(this.labels)
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400)

    this.sky = makeSky()
    this.scene.add(this.sky)

    this.hemi = new THREE.HemisphereLight(DAY.hemiSky, DAY.hemiGround, DAY.hemiI)
    this.sun = new THREE.DirectionalLight(DAY.sun, DAY.sunI)
    const sh = this.sun.shadow
    this.sun.castShadow = true
    sh.mapSize.set(SHADOW_RES, SHADOW_RES)
    Object.assign(sh.camera, { left: -SHADOW_HALF, right: SHADOW_HALF, top: SHADOW_HALF, bottom: -SHADOW_HALF, near: 1, far: 60 })
    sh.camera.updateProjectionMatrix()
    sh.bias = -0.0004
    sh.normalBias = 0.025
    sh.radius = 3
    // 灯笼光常驻（白天强度 0），避免切图时灯光数量变化导致着色器重编译
    this.lamp = new THREE.PointLight('#ffb866', 0, 9, 1.4)
    this.scene.add(this.hemi, this.sun, this.sun.target, this.lamp)
    this.lantern = this.makeLantern()
    this.scene.add(this.lantern)
    this.fireflies = new Map()

    // 玩家
    this.me = { root: new THREE.Group(), model: null, lookKey: '', tag: new Tag(this.labels, 'me') }
    this.scene.add(this.me.root)
    this.fol = new Follower(this.scene)
    this.refreshLook(true)
    this.fol.set(this.g.leadInfo?.())

    // 点击地面的落点标记
    this.marker = new THREE.Mesh(MARK_GEO, new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, depthWrite: false }))
    this.marker.renderOrder = 2
    this.marker.visible = false
    this.scene.add(this.marker)

    this.resize()
    addEventListener('resize', () => this.resize())
    addEventListener('keydown', (e) => this.onKeyDown(e))
    addEventListener('keyup', (e) => this.onKeyUp(e))
    addEventListener('blur', () => { this.clearInput(); this.running = false; this.rotKey = 0 })
    document.addEventListener('visibilitychange', () => { this.last = performance.now() })
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e))
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e, true))
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault()
      this.distT = clamp(this.distT * Math.exp(e.deltaY * (e.deltaMode ? 0.05 : 0.0012)), 4.5, 16)
    }, { passive: false })

    this._loop = (t) => this.frame(t)
    requestAnimationFrame(this._loop)
  }

  initRenderer() {
    const r = new THREE.WebGLRenderer({ canvas: this.cv, antialias: true, powerPreference: 'high-performance' })
    r.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.NoToneMapping // 保持卡通配色原样
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap // r186 的 PCF + shadow.radius 即柔和阴影（PCFSoft 已移除）
    this.renderer = r
    const lr = new CSS2DRenderer()
    lr.domElement.className = 'w3d-labels'
    this.cv.after(lr.domElement)
    this.labelRenderer = lr
    this.fadeEl = el('div', 'w3d-fade')
    lr.domElement.after(this.fadeEl)
  }

  makeLantern() {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.15, 12), toonMat('#ffc36b', { emissive: '#ff9a2e' }))
    addOutline(body, 0.012)
    const capGeo = new THREE.CylinderGeometry(0.05, 0.095, 0.045, 12)
    const cap = new THREE.Mesh(capGeo, toonMat('#5b3a2a'))
    cap.position.y = 0.095
    const foot = new THREE.Mesh(capGeo, cap.material)
    foot.rotation.x = Math.PI
    foot.position.y = -0.095
    g.add(body, cap, foot)
    g.visible = false
    g.userData.vel = new THREE.Vector3()
    return g
  }

  // —— 地图 ——
  entryFor(map) {
    let e = this.maps.get(map.id)
    if (e) return e
    const terrain = buildTerrain(map)
    const npcRoot = new THREE.Group()
    const labelRoot = new THREE.Group()
    const npcs = map.npcs.map((npc) => {
      const root = new THREE.Group()
      root.position.set(npc.x + 0.5, 0, npc.y + 0.5)
      const model = castShadows(buildTrainer(npc.look))
      const heading = DIR_RY[npc.dir] ?? 0
      model.rotation.y = heading
      root.add(model, pickProxy('npc', npc))
      npcRoot.add(root)
      const box = el('div', 'w3d-npc')
      const alert = el('div', 'w3d-alert', '!')
      const name = el('div', 'w3d-npc-name', npc.name)
      box.append(alert, name)
      const label = new CSS2DObject(box)
      label.center.set(0.5, 1)
      label.position.set(npc.x + 0.5, 1.4, npc.y + 0.5)
      labelRoot.add(label)
      return { npc, root, model, heading, label, box, alert, near: false, alertOn: true }
    })
    const bld = (terrain.labelAnchors || []).map((a) => {
      const o = simpleLabel(labelRoot, 'w3d-bld', a.text)
      o.position.set(a.x, a.y, a.z)
      return o
    })
    const boxes = map.buildings.map((b) => ({ b, box: new THREE.Box3(new THREE.Vector3(b.x, 0, b.y), new THREE.Vector3(b.x + b.w, 3.2, b.y + b.h)) }))
    const npcTiles = new Set(map.npcs.map((n) => n.y * map.w + n.x))
    e = { terrain, npcRoot, labelRoot, npcs, bld, boxes, npcTiles }
    this.maps.set(map.id, e)
    return e
  }

  loadMap(id, x, y, dir = 'down') {
    const map = MAPS[id]
    if (!map) return
    if (this.entry) {
      this.scene.remove(this.entry.terrain.group, this.entry.npcRoot)
      hideLabels(this.entry.labelRoot)
      this.labelScene.remove(this.entry.labelRoot)
    }
    this.clearEntities()
    this.map = map
    const e = this.entry = this.entryFor(map)
    this.scene.add(e.terrain.group, e.npcRoot)
    this.labelScene.add(e.labelRoot)
    for (const a of e.npcs) { a.heading = DIR_RY[a.npc.dir] ?? 0; a.model.rotation.y = a.heading }
    this.applyAtmosphere(map)

    this.pos.set(x + 0.5, 0, y + 0.5)
    this.vel.set(0, 0)
    this.heading = this.wantHeading = DIR_RY[dir] ?? 0
    Object.assign(this.p, { x, y, dir: DIR_RY[dir] != null ? dir : 'down' })
    this.path = null
    this.stuckT = 0
    this.moving = false
    this.me.root.position.copy(this.pos)
    if (this.me.model) this.me.model.rotation.y = this.heading
    this.fol.reset(this.pos.x, this.pos.z, this.heading, (fx, fz) => !this.hits(fx, fz))
    this.lantern.position.set(this.pos.x + 0.5, 1.5, this.pos.z)
    this.nextRemotePoll = this.nextSpawnPoll = 0
    this.updateCamera(0, true)
  }

  applyAtmosphere(map) {
    const A = map.dark ? NIGHT : DAY
    this.atm = A
    this.hemi.color.set(A.hemiSky)
    this.hemi.groundColor.set(A.hemiGround)
    this.hemi.intensity = A.hemiI
    this.sun.color.set(A.sun)
    this.sun.intensity = A.sunI
    this.scene.fog.color.set(A.fog)
    this.renderer.setClearColor(A.fog)
    const u = this.sky.material.uniforms
    u.top.value.set(A.skyTop)
    u.horizon.value.set(A.skyHorizon)
    u.cloud.value.set(A.cloud)
    u.clouds.value = A.clouds
    u.stars.value = A.stars
    this.lamp.intensity = A.lantern
    this.lantern.visible = A.lantern > 0
    for (const [mid, f] of this.fireflies) f.visible = mid === map.id
    if (map.dark && !this.fireflies.has(map.id)) this.fireflies.set(map.id, this.makeFireflies(map))
  }

  makeFireflies(map) {
    const n = Math.round(map.w * map.h / 6)
    const pos = new Float32Array(n * 3), ph = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      pos[i * 3] = 1 + Math.random() * (map.w - 2)
      pos[i * 3 + 1] = 0.35 + Math.random() * 1.9
      pos[i * 3 + 2] = 1 + Math.random() * (map.h - 2)
      ph[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('phase', new THREE.BufferAttribute(ph, 1))
    const pts = new THREE.Points(g, pointsMat('fly', '#d8ff7a', 0.16))
    pts.frustumCulled = false
    pts.renderOrder = 4
    this.scene.add(pts)
    return pts
  }

  clearEntities() {
    for (const cid of [...this.remotes.keys()]) this.removeRemote(cid)
    for (const id of [...this.wilds.keys()]) this.removeWild(id)
    for (const id of [...this.spawns.keys()]) this.removeSpawn(id)
  }

  // —— 输入 ——
  get held() { return [...this.keys] }
  set held(_) { this.clearInput() }

  clearInput() {
    this.keys.clear()
    this.joy.set(0, 0)
    this.path = null
  }

  press(dir, down) {
    if (!DIR_RY.hasOwnProperty(dir)) return
    if (down) { this.path = null; this.keys.add(dir) } else this.keys.delete(dir)
  }

  setJoystick(x, y) {
    this.joy.set(clamp(+x || 0, -1, 1), clamp(+y || 0, -1, 1))
    if (this.joy.lengthSq() > 0.02) this.path = null
  }

  onKeyDown(e) {
    if (this.g.captureKey(e)) return
    const d = KEYMAP[e.code]
    if (d) { e.preventDefault(); this.path = null; this.keys.add(d) }
    else if (e.key === 'Shift') this.running = true
    else if (e.code === 'KeyQ') this.rotKey = -1
    else if (e.code === 'KeyE') this.rotKey = 1
    else if (e.code === 'Space' || e.code === 'KeyZ') { e.preventDefault(); if (!e.repeat) this.interact() }
  }

  onKeyUp(e) {
    const d = KEYMAP[e.code]
    if (d) this.keys.delete(d)
    if (e.key === 'Shift') this.running = false
    if ((e.code === 'KeyQ' && this.rotKey < 0) || (e.code === 'KeyE' && this.rotKey > 0)) this.rotKey = 0
  }

  onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return
    try { this.cv.setPointerCapture(e.pointerId) } catch {}
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), drag: false, btn: e.button })
    if (this.ptrs.size === 2) {
      const [a, b] = [...this.ptrs.values()]
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, dist: this.distT }
      a.drag = b.drag = true
    }
  }

  onPointerMove(e) {
    const p = this.ptrs.get(e.pointerId)
    if (!p) return
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    p.x = e.clientX; p.y = e.clientY
    if (this.pinch && this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()]
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
      this.distT = clamp(this.pinch.dist * this.pinch.d / d, 4.5, 16)
      return
    }
    if (!p.drag && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 7) { p.drag = true; this.cv.classList.add('w3d-drag') }
    if (p.drag && !this.pinch) {
      this.yawT -= dx * 0.0085
      this.pitchT = clamp(this.pitchT + dy * 0.006, 0.35, 1.35)
    }
  }

  onPointerUp(e, cancel = false) {
    const p = this.ptrs.get(e.pointerId)
    if (!p) return
    this.ptrs.delete(e.pointerId)
    if (!this.ptrs.size) { this.pinch = null; this.cv.classList.remove('w3d-drag') }
    const wasPinch = !!this.pinch || p.drag
    if (!cancel && !wasPinch && p.btn === 0 && performance.now() - p.t < 450) this.click(e.clientX, e.clientY)
  }

  // —— 点击：玩家 / NPC / 野生 / 稀有 / 建筑 / 地面 ——
  click(cx, cy) {
    if (!this.map || this.paused || this.fading || this.g.isBusy()) return
    const r = this.cv.getBoundingClientRect()
    _ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
    _ray.setFromCamera(_ndc, this.camera)
    const picks = []
    for (const o of this.remotes.values()) picks.push(o.proxy)
    for (const a of this.entry.npcs) picks.push(a.root.children[1])
    for (const o of this.wilds.values()) picks.push(o.proxy)
    for (const o of this.spawns.values()) picks.push(o.proxy)
    const hit = _ray.intersectObjects(picks, false)[0]
    if (hit) return this.onPick(hit.object.userData.pick)
    const ray = _ray.ray
    const gp = ray.intersectPlane(_plane, _v1)
    let bb = null, bd = gp ? gp.distanceTo(ray.origin) : Infinity
    for (const { b, box } of this.entry.boxes) {
      if (!ray.intersectBox(box, _v2)) continue
      const d = _v2.distanceTo(ray.origin)
      if (d < bd) { bd = d; bb = b }
    }
    if (bb) {
      const [dx, dy] = bb.door
      return this.goTo(dx, dy + 1, { fx: dx + 0.5, fz: dy + 1.5, range: 0.45, act: () => { this.faceTo(dx + 0.5, dy + 0.5); this.g.enterBuilding(bb) } })
    }
    if (!gp) return
    const x = clamp(gp.x, 0.3, this.map.w - 0.3), z = clamp(gp.z, 0.3, this.map.h - 0.3)
    const tx = Math.floor(x), ty = Math.floor(z)
    const sign = this.map.signs[`${tx},${ty}`]
    if (sign) return this.goTo(tx, ty, { adjacent: true, fx: tx + 0.5, fz: ty + 0.5, range: 1.25, act: () => { this.faceTo(tx + 0.5, ty + 0.5); this.g.say([sign]) } })
    this.showMarker(x, z)
    if (this.blocked(tx, ty)) return this.goTo(tx, ty, { adjacent: true, fx: tx + 0.5, fz: ty + 0.5, range: 0.95 })
    this.goTo(tx, ty, { fx: x, fz: z, range: 0.1, exact: true })
  }

  onPick({ kind, ref }) {
    const pos = this.pos
    if (kind === 'remote') {
      const r = this.remotes.get(ref)
      if (r) this.g.openPlayer(r.state)
    } else if (kind === 'npc') {
      const fx = ref.x + 0.5, fz = ref.y + 0.5
      const talk = () => { this.faceTo(fx, fz); this.g.talkNpc(ref) }
      if (Math.hypot(fx - pos.x, fz - pos.z) < 1.3) talk()
      else this.goTo(ref.x, ref.y, { adjacent: true, fx, fz, range: 1.25, act: talk })
    } else if (kind === 'wild') {
      const o = this.wilds.get(ref)
      if (o) this.path = { pts: [o.x, o.z], i: 0, fx: o.x, fz: o.z, range: 0, act: null, chase: ref }
    } else if (kind === 'spawn') {
      const o = this.spawns.get(ref)
      if (!o) return
      const s = o.s
      this.goTo(s.x, s.y, { fx: s.x + 0.5, fz: s.y + 0.5, range: 0.5, act: () => this.g.engageSpawn(s) })
    }
  }

  showMarker(x, z) {
    this.marker.position.set(x, 0.04, z)
    this.marker.visible = true
    this.markT = 0
  }

  // BFS 求路 + 视线拉直；找不到路时退化为直线
  goTo(gx, gy, { adjacent = false, fx, fz, range = 0.1, act = null, exact = false }) {
    const pts = this.findPath(gx, gy, adjacent)
    let path
    if (pts) {
      if (exact && pts.length >= 2) { pts[pts.length - 2] = fx; pts[pts.length - 1] = fz }
      else if (exact) pts.push(fx, fz)
      path = this.smoothPath(pts)
    } else path = [fx, fz]
    this.path = { pts: path.length ? path : [fx, fz], i: 0, fx, fz, range, act, chase: null }
    this.stuckT = 0
  }

  findPath(gx, gy, adjacent) {
    const m = this.map, W = m.w, H = m.h
    const sx = this.p.x, sy = this.p.y
    const isGoal = (x, y) => (adjacent ? Math.abs(x - gx) + Math.abs(y - gy) === 1 : x === gx && y === gy)
    if (isGoal(sx, sy)) return []
    const prev = new Int32Array(W * H).fill(-1)
    const q = new Int32Array(W * H)
    let qh = 0, qt = 0
    const start = sy * W + sx
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null
    prev[start] = start
    q[qt++] = start
    let found = -1
    while (qh < qt) {
      const cur = q[qh++]
      const x = cur % W, y = (cur - x) / W
      if (isGoal(x, y)) { found = cur; break }
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0)
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const ni = ny * W + nx
        if (prev[ni] !== -1 || this.blocked(nx, ny)) continue
        if (!isGoal(nx, ny) && this.warpAt(nx, ny)) continue
        prev[ni] = cur
        q[qt++] = ni
      }
    }
    if (found < 0) return null
    const tiles = []
    for (let c = found; c !== start; c = prev[c]) tiles.push(c)
    tiles.reverse()
    const pts = []
    for (const c of tiles) { const x = c % W; pts.push(x + 0.5, (c - x) / W + 0.5) }
    return pts
  }

  smoothPath(pts) {
    const out = []
    let cx = this.pos.x, cz = this.pos.z
    const n = pts.length / 2
    let i = 0
    while (i < n) {
      let j = i
      while (j + 1 < n && this.clearLine(cx, cz, pts[(j + 1) * 2], pts[(j + 1) * 2 + 1])) j++
      cx = pts[j * 2]; cz = pts[j * 2 + 1]
      out.push(cx, cz)
      i = j + 1
    }
    return out
  }

  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az)
    const n = Math.ceil(d / 0.15)
    for (let i = 1; i <= n; i++) {
      const f = i / n
      if (this.hits(ax + (bx - ax) * f, az + (bz - az) * f, R + 0.05)) return false
    }
    return true
  }

  // —— 碰撞 ——
  blocked(tx, ty) {
    const m = this.map
    if (tx < 0 || ty < 0 || tx >= m.w || ty >= m.h) return true
    const i = ty * m.w + tx
    return m.solid[i] === 1 || this.entry.npcTiles.has(i)
  }

  warpAt(tx, ty) {
    for (const w of this.map.warps) if (tx >= w.x && tx < w.x + w.w && ty >= w.y && ty < w.y + w.h) return w
    return null
  }

  hits(x, z, r = R) {
    const x0 = Math.floor(x - r), x1 = Math.floor(x + r), z0 = Math.floor(z - r), z1 = Math.floor(z + r)
    const r2 = r * r
    for (let ty = z0; ty <= z1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.blocked(tx, ty)) continue
        const dx = x - clamp(x, tx, tx + 1), dz = z - clamp(z, ty, ty + 1)
        if (dx * dx + dz * dz < r2) { this.hitTx = tx; this.hitTy = ty; return true }
      }
    }
    return false
  }

  // 沿单轴移动；被挡时二分逼近墙面，并返回挡路图块（-1 表示未被挡）
  moveAxis(axis, d) {
    const pos = this.pos
    const nx = axis === 0 ? pos.x + d : pos.x, nz = axis === 0 ? pos.z : pos.z + d
    if (!this.hits(nx, nz)) { pos.x = nx; pos.z = nz; return false }
    const htx = this.hitTx, hty = this.hitTy
    let lo = 0, hi = 1
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2
      if (this.hits(axis === 0 ? pos.x + d * mid : pos.x, axis === 0 ? pos.z : pos.z + d * mid)) hi = mid
      else lo = mid
    }
    if (axis === 0) pos.x += d * lo; else pos.z += d * lo
    this.hitTx = htx; this.hitTy = hty
    return true
  }

  // 贴着墙角时向空的一侧轻推，方便穿过一格宽的缺口
  slip(axis, d, amt) {
    const pos = this.pos
    const a = axis === 0 ? !this.hits(pos.x + d, pos.z + 0.24) : !this.hits(pos.x + 0.24, pos.z + d)
    const b = axis === 0 ? !this.hits(pos.x + d, pos.z - 0.24) : !this.hits(pos.x - 0.24, pos.z + d)
    if (a === b) return
    const s = a ? amt : -amt
    if (axis === 0) { if (!this.hits(pos.x, pos.z + s)) pos.z += s }
    else if (!this.hits(pos.x + s, pos.z)) pos.x += s
  }

  // —— 主循环 ——
  frame(t) {
    requestAnimationFrame(this._loop)
    const dt = Math.min(0.05, Math.max(0, (t - this.last) / 1000))
    this.last = t
    if (!this.map || this.paused || document.hidden) return
    this.time += dt
    U_TIME.value = this.time
    try {
      this.update(dt)
      this.renderer.render(this.scene, this.camera)
      this.labelRenderer.render(this.labelScene, this.camera)
    } catch (e) { console.error(e) }
  }

  update(dt) {
    const now = Date.now(), pnow = performance.now(), t = this.time
    if (pnow >= this.nextLookCheck) {
      this.nextLookCheck = pnow + 1000
      this.refreshLook()
      this.me.tag.setName('✓ ' + (this.g.save?.name || '训练家'), this.g.battleUI?.open === true)
    }
    if (pnow >= this.nextLeadCheck) { this.nextLeadCheck = pnow + 400; this.fol.set(this.g.leadInfo?.()) }
    this.updatePlayer(dt, pnow)
    const pos = this.pos
    this.me.root.position.copy(pos)
    if (this.me.model) {
      this.me.model.rotation.y = this.heading
      this.me.model.userData.animate?.(t, { speed: animSpeed(this.vel.length()) })
    }
    this.fol.update(dt, t, pos.x, pos.z)
    this.updateNpcs(dt, t)
    if (pnow >= this.nextRemotePoll) { this.nextRemotePoll = pnow + 100; this.pollRemotes() }
    this.updateRemotes(dt, t)
    this.updateWilds(dt, t, now)
    if (pnow >= this.nextSpawnPoll) { this.nextSpawnPoll = pnow + 250; this.pollSpawns() }
    this.updateSpawns(dt, t)
    this.updateCamera(dt, false)
    this.updateLights(dt, t)
    this.entry.terrain.update?.(t, pos)
    this.updateLabels(now)
    if (this.marker.visible) {
      this.markT += dt
      const k = Math.min(1, this.markT / 0.6)
      this.marker.scale.setScalar(0.6 + k * 1.2)
      this.marker.material.opacity = 0.9 * (1 - k)
      if (k >= 1) this.marker.visible = false
    }
  }

  updatePlayer(dt, pnow) {
    const pos = this.pos, vel = this.vel
    const busy = this.fading || this.g.isBusy()
    let wx = 0, wz = 0, mag = 0
    if (!busy) {
      const k = this.keys
      let ix = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)
      let iy = (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0)
      if (ix || iy) { const l = Math.hypot(ix, iy); ix /= l; iy /= l; mag = 1 }
      else {
        const jm = this.joy.length()
        if (jm > 0.12) { ix = this.joy.x / jm; iy = this.joy.y / jm; mag = Math.min(1, (jm - 0.12) / 0.7) }
      }
      if (mag > 0) {
        // 以镜头朝向为基准：右 = (cos yaw, -sin yaw)，前 = (-sin yaw, -cos yaw)
        const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw)
        wx = cy * ix - sy * iy
        wz = -sy * ix - cy * iy
        this.path = null
      } else if (this.path) {
        mag = this.followPath(dt)
        if (mag > 0) { wx = this.pdx; wz = this.pdz }
      }
    }
    const speed = (this.running ? RUN : WALK) * mag
    const k = damp(mag > 0 ? 12 : 18, dt)
    vel.x += (wx * speed - vel.x) * k
    vel.y += (wz * speed - vel.y) * k
    if (busy && vel.lengthSq() < 0.01) vel.set(0, 0)

    const dx = vel.x * dt, dz = vel.y * dt
    const x0 = pos.x, z0 = pos.z
    if (this.hits(pos.x, pos.z)) { pos.x += dx; pos.z += dz } // 卡在障碍里时允许脱身
    else {
      if (dx && this.moveAxis(0, dx)) {
        this.onBlocked(wx, wz, pnow)
        if (Math.abs(wz) < 0.4 && mag > 0) this.slip(0, dx, Math.abs(dx))
        vel.x = 0
      }
      if (dz && this.moveAxis(1, dz)) {
        this.onBlocked(wx, wz, pnow)
        if (Math.abs(wx) < 0.4 && mag > 0) this.slip(1, dz, Math.abs(dz))
        vel.y = 0
      }
    }

    // 点击移动卡住 → 放弃（若已在互动范围附近则直接互动）
    if (this.path && mag > 0) {
      const moved = Math.hypot(pos.x - x0, pos.z - z0)
      this.stuckT = moved < speed * dt * 0.25 ? this.stuckT + dt : 0
      if (this.stuckT > 0.3) {
        const P = this.path
        this.path = null
        this.stuckT = 0
        if (P.act && Math.hypot(P.fx - pos.x, P.fz - pos.z) < P.range + 0.6) { this.faceTo(P.fx, P.fz); P.act() }
      }
    }

    if (mag > 0 && (wx || wz)) this.wantHeading = Math.atan2(wx, wz)
    this.heading = lerpAngle(this.heading, this.wantHeading, damp(14, dt))
    this.p.dir = dirOf(this.wantHeading)

    // 进入新图块
    const tx = Math.floor(pos.x), ty = Math.floor(pos.z)
    if (tx !== this.p.x || ty !== this.p.y) {
      this.p.x = tx; this.p.y = ty
      const w = this.warpAt(tx, ty)
      this.sendPresence()
      if (w && !this.fading) this.startWarp(w, tx, ty)
      else if (!w) this.g.onArrive(tx, ty, tileAt(this.map, tx, ty))
    }
    const moving = vel.lengthSq() > 0.04
    if (moving ? pnow - this.lastSent >= 100 : this.moving) this.sendPresence()
    this.moving = moving
  }

  followPath(dt) {
    const P = this.path, pos = this.pos
    if (P.chase != null) {
      const o = this.wilds.get(P.chase)
      // 目标消失、被别人占用或刚打过（冷却中）→ 停止追赶
      if (!o || (o.w.battlingBy && P.chase !== this.engagingId) || (this.wildCool.get(P.chase) || 0) > Date.now()) { this.path = null; return 0 }
      P.pts[0] = P.fx = o.x; P.pts[1] = P.fz = o.z
    }
    const fd = Math.hypot(P.fx - pos.x, P.fz - pos.z)
    if (P.act && fd < P.range) { this.path = null; this.faceTo(P.fx, P.fz); P.act(); return 0 }
    let tx = P.pts[P.i * 2], tz = P.pts[P.i * 2 + 1]
    let d = Math.hypot(tx - pos.x, tz - pos.z)
    let last = P.i * 2 + 2 >= P.pts.length
    if (!last && d < 0.3) {
      P.i++
      tx = P.pts[P.i * 2]; tz = P.pts[P.i * 2 + 1]
      d = Math.hypot(tx - pos.x, tz - pos.z)
      last = P.i * 2 + 2 >= P.pts.length
    }
    if (last && !P.act && P.chase == null && d < 0.08) { this.path = null; return 0 }
    if (d < 1e-4) return 0
    this.pdx = (tx - pos.x) / d
    this.pdz = (tz - pos.z) / d
    return last && P.chase == null ? clamp(d / 0.5 + 0.15, 0.2, 1) : 1
  }

  onBlocked(wx, wz, pnow) {
    if (!(wx || wz) || pnow - this.doorAt < 1000 || this.g.isBusy()) return
    const tx = this.hitTx, ty = this.hitTy
    const b = this.map.buildings.find((b) => b.door[0] === tx && b.door[1] === ty)
    if (!b) return
    const cx = tx + 0.5 - this.pos.x, cz = ty + 0.5 - this.pos.z
    if (cx * wx + cz * wz <= 0.3 * Math.hypot(cx, cz)) return
    this.doorAt = pnow
    this.clearInput()
    this.vel.set(0, 0)
    this.g.enterBuilding(b)
  }

  faceTo(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z
    if (dx * dx + dz * dz < 1e-6) return
    this.wantHeading = Math.atan2(dx, dz)
    this.p.dir = dirOf(this.wantHeading)
  }

  startWarp(w, tx, ty) {
    this.fading = true
    this.path = null
    this.vel.set(0, 0)
    this.fadeEl.classList.add('on')
    setTimeout(() => {
      try { this.g.warp(w.to, w.tx + (tx - w.x), w.ty + (ty - w.y), w.dir) }
      catch (e) { console.error(e) }
      finally {
        requestAnimationFrame(() => {
          this.fadeEl.classList.remove('on')
          setTimeout(() => { this.fading = false }, 150)
        })
      }
    }, 260)
  }

  interact() {
    if (!this.map || this.paused || this.fading || this.g.isBusy()) return
    const pos = this.pos, fx = Math.sin(this.wantHeading), fz = Math.cos(this.wantHeading)
    // 1. 面前的 NPC
    let best = null, bd = 1.3
    for (const a of this.entry.npcs) {
      const dx = a.npc.x + 0.5 - pos.x, dz = a.npc.y + 0.5 - pos.z, d = Math.hypot(dx, dz)
      if (d < bd && dx * fx + dz * fz > 0.35 * d) { best = a; bd = d }
    }
    if (best) {
      this.faceTo(best.npc.x + 0.5, best.npc.y + 0.5)
      return this.g.talkNpc(best.npc)
    }
    // 2 / 3. 面前的告示牌、门
    for (const reach of REACH) {
      const tx = Math.floor(pos.x + fx * reach), ty = Math.floor(pos.z + fz * reach)
      const sign = this.map.signs[`${tx},${ty}`]
      if (sign) return this.g.say([sign])
      const b = this.map.buildings.find((b) => b.door[0] === tx && b.door[1] === ty)
      if (b) return this.g.enterBuilding(b)
    }
    // 4. 身边的其他玩家
    let rb = null
    bd = 1.3
    for (const r of this.remotes.values()) {
      const d = Math.hypot(r.pos.x - pos.x, r.pos.z - pos.z)
      if (d < bd) { rb = r; bd = d }
    }
    if (rb) return this.g.openPlayer(rb.state)
    // 5. 野生精灵
    let wb = null
    bd = 1.4
    for (const o of this.wilds.values()) {
      if (o.w.battlingBy && o.w.id !== this.engagingId) continue
      const d = Math.hypot(o.x - pos.x, o.z - pos.z)
      if (d < bd) { wb = o; bd = d }
    }
    if (wb) return this.engage(wb.w, Date.now())
    // 6. 稀有精灵
    for (const o of this.spawns.values()) {
      const s = o.s
      if (Math.hypot(s.x + 0.5 - pos.x, s.y + 0.5 - pos.z) < 1.3) { this.faceTo(s.x + 0.5, s.y + 0.5); return this.g.engageSpawn(s) }
    }
  }

  engage(w, now) {
    this.wildCool.set(w.id, now + 8000)
    this.engagingId = this.lastWildId = w.id
    this.path = null
    this.faceTo(w.x, w.y)
    Promise.resolve(this.g.engageWild(w)).catch((e) => console.error(e)).finally(() => {
      if (this.engagingId === w.id && !this.paused) this.engagingId = null
    })
  }

  sendPresence() {
    if (!this.map) return
    const p = this.p, pos = this.pos
    this.lastSent = performance.now()
    this.g.net?.setPresence({
      map: this.map.id, x: p.x, y: p.y, dir: p.dir,
      fx: round(pos.x, 1000), fy: round(pos.z, 1000), ry: round(wrapAngle(this.heading), 100), moving: this.vel.lengthSq() > 0.04,
    })
  }

  setPaused(on) {
    on = !!on
    if (on === this.paused) return
    this.paused = on
    this.clearInput()
    this.vel.set(0, 0)
    this.ptrs.clear()
    this.pinch = null
    if (!on) {
      const now = Date.now()
      this.last = performance.now()
      this.contactAt = now + 2500
      if (this.lastWildId != null) this.wildCool.set(this.lastWildId, now + 8000)
      this.engagingId = null
      if (this.wildCool.size > 64) for (const [id, until] of this.wildCool) if (until < now) this.wildCool.delete(id)
      this.nextRemotePoll = this.nextSpawnPoll = this.nextLookCheck = this.nextLeadCheck = 0
      this.moving = true // 下一帧发送一次“停止”状态
    }
  }

  // —— 玩家外观 ——
  refreshLook(force = false) {
    const look = this.g.save?.look || {}
    const key = JSON.stringify(look)
    if (!force && key === this.me.lookKey) return
    this.me.lookKey = key
    disposeModel(this.me.model)
    this.me.model = castShadows(buildTrainer(look))
    this.me.model.rotation.y = this.heading
    this.me.root.add(this.me.model)
  }

  // —— NPC ——
  updateNpcs(dt, t) {
    const pos = this.pos, beaten = this.g.save?.beaten || {}
    const k = damp(9, dt)
    for (const a of this.entry.npcs) {
      const dx = a.npc.x + 0.5 - pos.x, dz = a.npc.y + 0.5 - pos.z, d2 = dx * dx + dz * dz
      a.heading = lerpAngle(a.heading, DIR_RY[a.npc.dir] ?? a.heading, k)
      a.model.rotation.y = a.heading
      if (d2 < 900) a.model.userData.animate?.(t, { speed: 0 })
      a.label.visible = d2 < LABEL_FAR2
      const near = d2 < 9
      if (near !== a.near) { a.near = near; a.box.classList.toggle('near', near) }
      const alertOn = !!a.npc.trainer && !beaten[a.npc.id]
      if (alertOn !== a.alertOn) { a.alertOn = alertOn; a.alert.hidden = !alertOn }
    }
  }

  // —— 远端玩家 ——
  pollRemotes() {
    const net = this.g.net
    if (!net) return
    const stamp = ++this.stamp
    for (const s of net.players()) {
      if (s.map !== this.map.id) continue
      let r = this.remotes.get(s.cid)
      const is3d = typeof s.fx === 'number' && typeof s.fy === 'number'
      const tx = is3d ? s.fx : (s.x | 0) + 0.5, tz = is3d ? s.fy : (s.y | 0) + 0.5
      if (!r) r = this.addRemote(s, tx, tz)
      r.stamp = stamp
      r.state = s
      r.is3d = is3d
      r.tx = tx; r.tz = tz
      r.tRy = is3d && typeof s.ry === 'number' ? s.ry : DIR_RY[s.dir] ?? r.heading
      if (Math.hypot(tx - r.pos.x, tz - r.pos.z) > 4) this.placeRemote(r, tx, tz, r.tRy)
      const lk = JSON.stringify(s.look || {})
      if (lk !== r.lookKey) {
        r.lookKey = lk
        disposeModel(r.model)
        r.model = castShadows(buildTrainer(s.look || {}))
        r.model.rotation.y = r.heading
        r.root.add(r.model)
      }
      r.fol.set(s.lead)
      r.tag.setName((net.isVerified(s) ? '✓ ' : '') + (s.name || '训练家'), s.busy === 'battle')
    }
    for (const [cid, r] of this.remotes) if (r.stamp !== stamp) this.removeRemote(cid)
  }

  addRemote(s, x, z) {
    const root = new THREE.Group()
    const proxy = pickProxy('remote', s.cid)
    root.add(proxy)
    this.scene.add(root)
    const r = {
      cid: s.cid, state: s, root, proxy, model: null, lookKey: null, pos: root.position, heading: DIR_RY[s.dir] ?? 0,
      tx: x, tz: z, tRy: 0, is3d: false, spd: 0, stamp: 0, fol: new Follower(this.scene), tag: new Tag(this.labels, ''),
    }
    this.placeRemote(r, x, z, r.heading)
    this.remotes.set(s.cid, r)
    return r
  }

  placeRemote(r, x, z, ry) {
    r.pos.set(x, 0, z)
    r.heading = ry
    r.spd = 0
    r.fol.reset(x, z, ry)
  }

  removeRemote(cid) {
    const r = this.remotes.get(cid)
    if (!r) return
    disposeModel(r.model)
    r.root.removeFromParent()
    r.fol.dispose()
    r.tag.dispose()
    this.remotes.delete(cid)
  }

  updateRemotes(dt, t) {
    for (const r of this.remotes.values()) {
      const p = r.pos
      const dx = r.tx - p.x, dz = r.tz - p.z, d = Math.hypot(dx, dz)
      let mx = 0, mz = 0
      if (r.is3d) {
        const k = damp(10, dt)
        mx = dx * k; mz = dz * k
      } else if (d > 1e-3) {
        // 2D 客户端只发整格坐标：按距离自适应速度，走路时连续不卡顿
        const step = Math.min(d, clamp(d * 7, 3.2, 8.5) * dt)
        mx = dx / d * step; mz = dz / d * step
      }
      p.x += mx; p.z += mz
      const v = dt > 0 ? Math.hypot(mx, mz) / dt : 0
      r.spd += (v - r.spd) * damp(10, dt)
      const moving = r.spd > 0.3 || (r.is3d && r.state.moving && d > 0.05)
      const want = r.is3d ? r.tRy : v > 0.5 ? Math.atan2(mx, mz) : r.tRy
      r.heading = lerpAngle(r.heading, want, damp(r.is3d ? 12 : 14, dt))
      if (r.model) {
        r.model.rotation.y = r.heading
        r.model.userData.animate?.(t, { speed: moving ? Math.max(0.3, animSpeed(r.spd)) : 0 })
      }
      r.fol.update(dt, t, p.x, p.z)
    }
  }

  // —— 野生精灵 ——
  updateWilds(dt, t, now) {
    const W = this.g.wilds
    if (!W) return
    const list = W.list(this.map.id, now)
    const stamp = ++this.stamp
    const pos = this.pos
    let canContact = !this.paused && !this.fading && now > this.contactAt && !this.g.isBusy()
    const k = damp(8, dt)
    for (const w of list) {
      let o = this.wilds.get(w.id)
      if (!o) o = this.addWild(w, t)
      o.stamp = stamp
      o.w = w
      o.x = w.x; o.z = w.y
      o.root.position.set(w.x, 0, w.y)
      o.heading = lerpAngle(o.heading, w.heading || 0, k)
      o.model.rotation.y = o.heading
      const bt = t - o.born
      if (bt < 0.45) o.model.scale.setScalar(0.75 * Math.max(0.01, easeOutBack(bt / 0.45)))
      else if (!o.grown) { o.grown = true; o.model.scale.setScalar(0.75) }
      o.model.userData.animate?.(t, { moving: !!w.moving, speed: w.moving ? 0.5 : 0 })

      const other = !!w.battlingBy && w.id !== this.engagingId
      const dx = w.x - pos.x, dz = w.y - pos.z, d2 = dx * dx + dz * dz
      const by = other ? w.battlingBy : ''
      if (by !== o.by || o.lv !== w.lv) {
        o.by = by
        o.lv = w.lv
        o.label.element.textContent = other ? `⚔ ${by} 战斗中` : `${SPECIES[w.sp]?.name || '？'} Lv.${w.lv}`
        o.label.element.classList.toggle('fight', other)
      }
      o.label.visible = other ? d2 < LABEL_FAR2 : d2 < 12
      o.label.position.set(w.x, o.h + 0.2, w.y)
      if (canContact && !other && d2 < 0.65 * 0.65 && (this.wildCool.get(w.id) || 0) < now) {
        canContact = false
        this.engage(w, now)
      }
    }
    for (const [id, o] of this.wilds) if (o.stamp !== stamp) this.removeWild(id)
  }

  addWild(w, t) {
    const root = new THREE.Group()
    const model = castShadows(buildCreature(w.sp, { shiny: !!w.shiny }))
    model.scale.setScalar(0.01)
    root.add(model)
    const h = (model.userData.height || 1) * 0.75
    const proxy = pickProxy('wild', w.id, 1, Math.max(0.6, h / 1.4))
    root.add(proxy)
    let spark = null
    if (w.shiny) { spark = sparkles(10, 0.45, h, '#fff3b0', 0.11); root.add(spark) }
    this.scene.add(root)
    const label = simpleLabel(this.labels, 'w3d-wild', '')
    label.visible = false
    const o = { w, root, model, proxy, spark, label, h, heading: w.heading || 0, x: w.x, z: w.y, born: t, grown: false, stamp: 0, by: null, lv: null }
    this.wilds.set(w.id, o)
    return o
  }

  removeWild(id) {
    const o = this.wilds.get(id)
    if (!o) return
    disposeModel(o.model)
    o.spark?.geometry.dispose()
    o.root.removeFromParent()
    o.label.removeFromParent()
    this.wilds.delete(id)
  }

  // —— 稀有精灵 ——
  pollSpawns() {
    const list = this.g.spawnsOn?.(this.map.id) || []
    const stamp = ++this.stamp
    for (const s of list) {
      let o = this.spawns.get(s.id)
      if (!o) o = this.addSpawn(s)
      o.stamp = stamp
      o.s = s
    }
    for (const [id, o] of this.spawns) if (o.stamp !== stamp) this.removeSpawn(id)
  }

  addSpawn(s) {
    const root = new THREE.Group()
    root.position.set(s.x + 0.5, 0, s.y + 0.5)
    const sc = s.sp === 'thundrake' ? 1.2 : 0.95
    const model = castShadows(buildCreature(s.sp, { shiny: !!s.shiny }))
    model.scale.setScalar(sc)
    const h = (model.userData.height || 1) * sc
    const glow = new THREE.Mesh(GLOW_GEO, GLOW_MAT)
    glow.position.y = 0.03
    glow.renderOrder = 2
    const beam = new THREE.Mesh(BEAM_GEO, BEAM_MAT)
    beam.renderOrder = 2
    const spark = sparkles(16, 0.7, h + 0.3, '#ffe27a', 0.14)
    const proxy = pickProxy('spawn', s.id, 1.2, Math.max(0.8, h / 1.3))
    root.add(model, glow, beam, spark, proxy)
    this.scene.add(root)
    const label = simpleLabel(this.labels, 'w3d-rare', `${s.shiny ? '✦ ' : ''}${SPECIES[s.sp]?.name || '？'} Lv.${s.lv}`)
    label.position.set(s.x + 0.5, h + 0.45, s.y + 0.5)
    const o = { s, root, model, spark, proxy, label, h, phase: Math.random() * TAU, heading: 0, stamp: 0 }
    this.spawns.set(s.id, o)
    return o
  }

  removeSpawn(id) {
    const o = this.spawns.get(id)
    if (!o) return
    disposeModel(o.model)
    o.spark.geometry.dispose()
    o.root.removeFromParent()
    o.label.removeFromParent()
    this.spawns.delete(id)
  }

  updateSpawns(dt, t) {
    const pos = this.pos
    for (const o of this.spawns.values()) {
      const rp = o.root.position
      const dx = pos.x - rp.x, dz = pos.z - rp.z, d2 = dx * dx + dz * dz
      o.model.position.y = 0.14 + Math.sin(t * 2.4 + o.phase) * 0.08
      if (d2 < 36) o.heading = lerpAngle(o.heading, Math.atan2(dx, dz), damp(3, dt))
      o.model.rotation.y = o.heading
      o.model.userData.animate?.(t, { moving: false, action: 'idle' })
      o.label.visible = d2 < LABEL_FAR2
    }
  }

  // —— 标签 ——
  updateLabels(now) {
    const pos = this.pos, g = this.g, mapId = this.map.id
    const me = this.me.tag
    me.obj.position.set(pos.x, 1.42, pos.z)
    const mb = g.bubbles?.get(g.signer?.pubkey)
    me.setBubble(mb && now - mb.t < 7000 && mb.map === mapId ? mb : null)
    const me2 = g.net ? g.emotes?.get(g.net.cid) : null
    me.setEmote(me2 && now - me2.t < 2500 ? me2 : null)
    for (const r of this.remotes.values()) {
      const tag = r.tag
      const hidden = this.isFar(r.pos.x, r.pos.z)
      tag.obj.visible = !hidden
      if (hidden) continue
      tag.obj.position.set(r.pos.x, 1.42, r.pos.z)
      const b = g.bubbles?.get(r.state.pk)
      tag.setBubble(b && now - b.t < 7000 && b.map === mapId ? b : null)
      const e = g.emotes?.get(r.cid)
      tag.setEmote(e && now - e.t < 2500 ? e : null)
    }
    for (const o of this.entry.bld) o.visible = !this.isFar(o.position.x, o.position.z)
  }

  isFar(x, z) {
    const dx = x - this.pos.x, dz = z - this.pos.z
    return dx * dx + dz * dz > LABEL_FAR2
  }

  // —— 镜头 / 光照 ——
  updateCamera(dt, snap) {
    const pos = this.pos, cam = this.camera
    if (this.rotKey) this.yawT += this.rotKey * 2.2 * dt
    const k = snap ? 1 : damp(12, dt)
    this.yaw += (this.yawT - this.yaw) * k
    this.pitch += (this.pitchT - this.pitch) * k
    this.dist += (this.distT - this.dist) * (snap ? 1 : damp(10, dt))
    _v3.set(pos.x + this.vel.x * 0.12, 0.85, pos.z + this.vel.y * 0.12)
    if (snap) { this.focus.copy(_v3); this.focusVel.set(0, 0, 0) }
    else smoothDamp(this.focus, _v3, this.focusVel, 0.2, dt)
    const h = Math.cos(this.pitch) * this.dist
    cam.position.set(this.focus.x + Math.sin(this.yaw) * h, this.focus.y + Math.sin(this.pitch) * this.dist, this.focus.z + Math.cos(this.yaw) * h)
    cam.lookAt(this.focus)
    this.sky.position.copy(cam.position)
    const A = this.atm || DAY
    this.scene.fog.near = this.dist + A.fogNear
    this.scene.fog.far = this.dist + A.fogFar
  }

  updateLights(dt, t) {
    // 阴影相机跟随焦点，按阴影贴图像素对齐以减少闪烁
    const s = (SHADOW_HALF * 2) / SHADOW_RES
    const fx = Math.round(this.focus.x / s) * s, fz = Math.round(this.focus.z / s) * s
    this.sun.target.position.set(fx, 0, fz)
    this.sun.position.set(fx + SUN_OFFSET.x, SUN_OFFSET.y, fz + SUN_OFFSET.z)
    if (this.lantern.visible) {
      const L = this.lantern, pos = this.pos
      const side = this.heading + Math.PI * 0.72
      const k = damp(6, dt)
      L.position.x += (pos.x + Math.sin(side) * 0.5 - L.position.x) * k
      L.position.z += (pos.z + Math.cos(side) * 0.5 - L.position.z) * k
      L.position.y = 1.35 + Math.sin(t * 2.1) * 0.07
      L.rotation.z = Math.sin(t * 1.7) * 0.12
      this.lamp.position.set(L.position.x, L.position.y + 0.15, L.position.z)
      this.lamp.intensity = NIGHT.lantern * (0.94 + 0.06 * Math.sin(t * 9.3) * Math.sin(t * 4.1))
    }
  }

  resize() {
    const w = innerWidth, h = innerHeight
    const pr = Math.min(devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, false)
    this.labelRenderer.setSize(w, h)
    const a = w / Math.max(1, h)
    this.camera.aspect = a
    // 竖屏手机加大垂直视角，横向视野不至于太窄
    this.camera.fov = a >= 1 ? 42 : Math.min(62, 42 / Math.pow(a, 0.45))
    this.camera.updateProjectionMatrix()
    U_PX.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2))
  }
}

// 临界阻尼弹簧（Game Programming Gems 4 的 SmoothDamp），逐轴作用于 Vector3
function smoothDamp(cur, target, vel, smoothTime, dt) {
  if (dt <= 0) return
  const omega = 2 / smoothTime, x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  for (const a of AXES) {
    const change = cur[a] - target[a]
    const temp = (vel[a] + omega * change) * dt
    vel[a] = (vel[a] - omega * temp) * exp
    cur[a] = target[a] + (change + temp) * exp
  }
}
