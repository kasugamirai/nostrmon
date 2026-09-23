// 程序化像素立绘：精灵（正面/背面/迷你）与训练家（四方向三帧）
import { SPECIES } from '../data/species.js'

export const INK = '#1c1a2e'
const INK_RGB = [28, 26, 46]

export function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex)
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt)
  return toHex(r + (t - r) * p, g + (t - g) * p, b + (t - b) * p)
}
export function hueRotate(hex, deg) {
  let [r, g, b] = hexToRgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  h = (h + deg / 360) % 1
  const f = (p, q, t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  if (s === 0) return hex
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  return toHex(f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255)
}

// 透明度二值化 + 1px 描边 → 干净的像素风
function pixelize(cv, outline = true) {
  const ctx = cv.getContext('2d')
  const w = cv.width, h = cv.height
  const img = ctx.getImageData(0, 0, w, h)
  const d = img.data
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0
  if (outline) {
    const a = new Uint8Array(w * h)
    for (let p = 0; p < w * h; p++) a[p] = d[p * 4 + 3] ? 1 : 0
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x
      if (a[p]) continue
      if ((x > 0 && a[p - 1]) || (x < w - 1 && a[p + 1]) || (y > 0 && a[p - w]) || (y < h - 1 && a[p + w])) {
        d[p * 4] = INK_RGB[0]; d[p * 4 + 1] = INK_RGB[1]; d[p * 4 + 2] = INK_RGB[2]; d[p * 4 + 3] = 255
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  return cv
}

const BODIES = {
  round: { parts: [[50, 60, 28, 27]], face: [50, 56], fw: 11, feet: [[37, 86], [63, 86]], belly: [50, 70, 17, 14] },
  oval: { parts: [[53, 72, 22, 14], [48, 46, 22, 19]], face: [48, 48], fw: 10, feet: [[36, 85], [46, 86], [60, 86], [70, 85]], belly: [53, 75, 13, 8] },
  long: { parts: [[57, 69, 27, 14], [37, 44, 19, 17]], face: [35, 46], fw: 8, feet: [[36, 84], [46, 85], [68, 85], [78, 84]], belly: [57, 74, 17, 7] },
  wide: { parts: [[50, 64, 33, 23]], face: [50, 58], fw: 13, feet: [[29, 86], [71, 86]], belly: [50, 72, 21, 13] },
  pear: { parts: [[50, 69, 25, 21], [50, 48, 19, 18]], face: [50, 52], fw: 9, feet: [[38, 89], [62, 89]], belly: [50, 74, 15, 12] },
  tall: { parts: [[50, 66, 17, 22], [50, 36, 17, 15]], face: [50, 37], fw: 8, feet: [[42, 89], [58, 89]], belly: [50, 68, 10, 15] },
  ghost: { parts: [[50, 47, 25, 25]], face: [50, 45], fw: 10, feet: [], belly: null, ghost: true },
  fish: { parts: [[45, 56, 30, 21]], face: [40, 52], fw: 10, feet: [], belly: [43, 64, 20, 8] },
  bird: { parts: [[50, 60, 25, 25]], face: [50, 51], fw: 10, feet: [[42, 87], [58, 87]], belly: [50, 68, 15, 14], beak: true },
}

function drawCreature(ctx, sp, back, shiny, small) {
  const L = SPECIES[sp].look
  const hr = (c) => (shiny ? hueRotate(c, 150) : c)
  const c1 = hr(L.c1), c2 = hr(L.c2), c3 = hr(L.c3)
  const d1 = shade(c1, -0.22)
  const B = BODIES[L.body]
  const [cx, cy, rx, ry] = B.parts[0]
  const head = B.parts[B.parts.length - 1]
  const [hx, hy, hrx, hry] = head
  const top = hy - hry
  const [fx, fy] = B.face
  const ex = small ? 1.7 : 1
  const has = (k) => L.extra?.includes(k)

  const E = (x, y, a, b, c, rot = 0) => { ctx.fillStyle = c; ctx.beginPath(); ctx.ellipse(x, y, a, b, rot, 0, Math.PI * 2); ctx.fill() }
  const P = (pts, c) => { ctx.fillStyle = c; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill() }
  const Ln = (pts, c, w) => { ctx.strokeStyle = c; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke() }
  const bodyPath = () => { ctx.beginPath(); for (const [x, y, a, b] of B.parts) { ctx.moveTo(x + a, y); ctx.ellipse(x, y, a, b, 0, 0, Math.PI * 2) } }

  if (back) { ctx.translate(100, 0); ctx.scale(-1, 1) }

  // —— 身后的部件 ——
  if (has('moth')) {
    for (const s of [-1, 1]) {
      E(cx + s * 25, cy - 16, 23, 17, c2, s * 0.5)
      E(cx + s * 25, cy - 16, 19, 13, c1, s * 0.5)
      E(cx + s * 19, cy + 12, 15, 11, c2, -s * 0.4)
      E(cx + s * 19, cy + 12, 11, 8, shade(c1, -0.15), -s * 0.4)
      E(cx + s * 29, cy - 18, 5.5, 5.5, c3)
    }
  }
  if (has('dragonwings')) {
    for (const s of [-1, 1]) P([[cx + s * 8, cy - 14], [cx + s * 44, cy - 38], [cx + s * 38, cy - 14], [cx + s * 46, cy - 2], [cx + s * 14, cy + 4]], d1)
  }
  if (has('wings')) for (const s of [-1, 1]) E(cx + s * rx * 0.95, cy + 2, 9, 15, d1, -s * 0.5)
  if (has('mane')) for (let k = 0; k < 7; k++) {
    const a = Math.PI * (0.05 + k * 0.15)
    E(hx + Math.cos(a) * hrx * 1.02, hy + Math.sin(a) * hry * 0.9 + 3, 8, 6, c3)
  }
  if (has('beetle') && !back) E(cx, cy - 6, rx * 1.02, ry * 0.92, c3)
  if (has('shell') && !back) E(cx, cy - 5, rx * 1.08, ry * 0.95, c3)
  if (!back) drawTail()

  // —— 脚 ——
  for (const [x, y] of B.feet) E(x, y, 7, 5, d1)
  if (has('claws')) for (const [x, y] of B.feet) { P([[x - 5, y + 2], [x - 3, y + 7], [x - 1, y + 2]], '#ffffff'); P([[x + 1, y + 2], [x + 3, y + 7], [x + 5, y + 2]], '#ffffff') }

  // —— 身体 ——
  ctx.fillStyle = c1
  bodyPath(); ctx.fill()
  if (B.ghost) P([[cx - rx, cy], [cx - rx + 2, cy + 30], [cx - 10, cy + 22], [cx, cy + 34], [cx + 10, cy + 22], [cx + rx - 2, cy + 30], [cx + rx, cy]], c1)
  if (B.parts.length > 1) E(B.parts[0][0], B.parts[0][1] - B.parts[0][3] * 0.6, B.parts[0][2] * 0.6, B.parts[0][3] * 0.6, c1)
  // 高光 / 阴影
  ctx.save(); bodyPath(); ctx.clip()
  E(cx + rx * 0.35, cy + ry * 0.55, rx * 0.9, ry * 0.5, shade(c1, -0.12))
  if (!back && B.belly) E(...B.belly, c2)
  if (has('stripes')) for (let k = -1; k <= 1; k++) E(cx + k * 11, cy, 3.2, ry, c3)
  if (has('rocky')) { E(cx - 12, cy - 10, 5, 4, L.c3); E(cx + 14, cy + 6, 6, 4, L.c3); E(cx - 4, cy + 15, 4, 3, L.c3) }
  E(hx - hrx * 0.35, hy - hry * 0.45, hrx * 0.28, hry * 0.2, shade(c1, 0.35))
  ctx.restore()
  if (has('arms')) for (const s of [-1, 1]) E(cx + s * (rx + 3), cy + 5, 9, 8, shade(c1, -0.15))
  if (has('beetle')) for (const s of [-1, 1]) { Ln([[cx + s * rx * 0.8, cy + 8], [cx + s * (rx + 7), cy + 14]], INK, 2.5) }

  // —— 背面才看得到的壳 ——
  if (back && (has('shell') || has('beetle'))) {
    E(cx, cy - 2, rx * 0.98, ry * 0.9, c3)
    if (has('shell')) {
      const dk = shade(c3, -0.3)
      P([[cx - 8, cy - 12], [cx + 8, cy - 12], [cx + 12, cy], [cx + 8, cy + 12], [cx - 8, cy + 12], [cx - 12, cy]], shade(c3, 0.15))
      Ln([[cx - 12, cy], [cx - rx * 0.9, cy]], dk, 2.5); Ln([[cx + 12, cy], [cx + rx * 0.9, cy]], dk, 2.5)
    } else Ln([[cx, cy - ry * 0.9], [cx, cy + ry * 0.8]], shade(c3, -0.35), 2.5)
  }
  if (back) drawTail()

  // —— 头部装饰 ——
  const ear = (s, tipK, wK, inner) => {
    const b1 = [hx + s * hrx * 0.25, hy - hry * 0.8]
    const b2 = [hx + s * hrx * 0.98, hy - hry * 0.3]
    const tip = [hx + s * hrx * 0.82, hy - hry * tipK]
    P([b1, tip, b2], c1)
    if (inner) P([[b1[0] + s * 4, b1[1] + 2], [tip[0] - s * 1.5, tip[1] + 7], [b2[0] - s * 3, b2[1] - 2]], inner)
  }
  for (const s of [-1, 1]) {
    switch (L.ears) {
      case 'fox': ear(s, 1.6, 1, c2); break
      case 'cat': ear(s, 1.35, 1, c3); break
      case 'pointy': {
        ear(s, 1.9, 1, null)
        const tip = [hx + s * hrx * 0.82, hy - hry * 1.9]
        P([tip, [tip[0] - s * 5, tip[1] + 10], [tip[0] + s * 4, tip[1] + 11]], c3)
        break
      }
      case 'bunny': E(hx + s * hrx * 0.42, hy - hry * 1.3, 6.5, 17, c1, s * 0.22); if (!back) E(hx + s * hrx * 0.42, hy - hry * 1.25, 3, 12, c3, s * 0.22); break
      case 'round': E(hx + s * hrx * 0.72, hy - hry * 0.78, 7.5, 7.5, c1); if (!back) E(hx + s * hrx * 0.72, hy - hry * 0.78, 4, 4, c3); break
      case 'frog': E(hx + s * hrx * 0.48, hy - hry * 0.78, 10, 9, c1); break
      case 'antenna': Ln([[hx + s * 6, top + 4], [hx + s * 13, top - 12]], d1, 2.5); E(hx + s * 13, top - 13, 4.2, 4.2, c3); break
      case 'horns': P([[hx + s * 5, top + 5], [hx + s * 18, top - 16], [hx + s * 13, top + 6]], c3); break
    }
  }
  if (L.ears === 'leaf') { Ln([[hx, top + 4], [hx, top - 6]], c3, 3); E(hx - 7, top - 8, 8, 4, c3, -0.5); E(hx + 7, top - 9, 8, 4, shade(c3, 0.2), 0.5) }
  if (L.ears === 'bush') { E(hx - 11, top + 3, 8, 7, c3); E(hx + 11, top + 3, 8, 7, c3); E(hx, top - 3, 10, 8, shade(c3, 0.15)) }
  if (L.ears === 'tuft') { E(hx - 5, top - 3, 3, 8, d1, -0.4); E(hx + 1, top - 5, 3, 9, d1, 0); E(hx + 7, top - 3, 3, 8, d1, 0.4) }
  if (L.ears === 'fin' || has('crest')) P([[hx - 7, top + 6], [hx + 2, top - 15], [hx + 14, top - 6], [hx + 10, top + 6]], c3)
  if (has('crystal')) { P([[hx, top - 9], [hx + 4.5, top - 2], [hx, top + 5], [hx - 4.5, top - 2]], c3) }
  if (has('cap')) {
    ctx.fillStyle = c3; ctx.beginPath(); ctx.ellipse(hx, top + 12, hrx * 1.7, hry * 1.05, 0, Math.PI, Math.PI * 2); ctx.closePath(); ctx.fill()
    E(hx - 12, top + 2, 4, 3.5, '#ffffff'); E(hx + 9, top - 1, 5, 4, '#ffffff'); E(hx + 20, top + 8, 3, 2.5, '#ffffff'); E(hx - 22, top + 9, 2.5, 2.5, '#ffffff')
  }

  // —— 脸 ——
  if (!back) {
    const eyePos = L.ears === 'frog'
      ? [[hx - hrx * 0.48, hy - hry * 0.8], [hx + hrx * 0.48, hy - hry * 0.8]]
      : [[fx - B.fw, fy], [fx + B.fw, fy]]
    eyePos.forEach(([x, y], k) => {
      const s = k ? 1 : -1
      switch (L.eyes) {
        case 'big': E(x, y, 4.6 * ex, 5.6 * ex, INK); if (!small) { E(x - 1.5, y - 2, 1.9, 1.9, '#fff'); E(x + 1.5, y + 2.2, 0.9, 0.9, '#fff') } break
        case 'sleepy': ctx.strokeStyle = INK; ctx.lineWidth = 2.4 * ex; ctx.beginPath(); ctx.arc(x, y - 2, 3.8, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); break
        case 'fierce': E(x, y + 1, 3.4 * ex, 3.9 * ex, INK); if (!small) E(x - 1, y - 0.5, 1.2, 1.2, '#fff'); Ln([[x + s * 5.5, y - 6.5], [x - s * 4, y - 3.5]], INK, 2.4 * ex); break
        case 'glow': E(x, y, 4.6 * ex, 5.8 * ex, '#fff6cf'); E(x, y + 1, 2.2 * ex, 3.2 * ex, L.c3 === '#ffe27a' ? '#5a3fc0' : c3); break
        default: E(x, y, 3.3 * ex, 4.3 * ex, INK); if (!small) E(x - 1, y - 1.5, 1.3, 1.3, '#fff')
      }
    })
    if (has('cheeks')) for (const s of [-1, 1]) E(fx + s * B.fw * 1.55, fy + 7, 4.6, 3.4, L.cheek || '#ff9aa2')
    if (has('nose')) E(fx, fy + 5, 4.5, 3.3, c3)
    if (B.beak) P([[fx - 5, fy + 5], [fx + 5, fy + 5], [fx, fy + 12]], c3)
    else if (!small) {
      ctx.strokeStyle = INK; ctx.lineWidth = 1.8; ctx.beginPath()
      if (L.ears === 'frog') ctx.arc(fx, fy + 1, 8, 0.2 * Math.PI, 0.8 * Math.PI)
      else if (L.eyes === 'fierce') { ctx.moveTo(fx - 3.5, fy + 8); ctx.lineTo(fx + 3.5, fy + 8) }
      else ctx.arc(fx, fy + (has('nose') ? 8 : 5), 3, 0.2 * Math.PI, 0.8 * Math.PI)
      ctx.stroke()
      if (L.eyes === 'fierce') P([[fx + 0.5, fy + 8], [fx + 3.5, fy + 8], [fx + 2, fy + 11.5]], '#ffffff')
    }
    if (has('tongue')) E(fx + 2, fy + 11, 3.5, 4.5, c3)
    if (has('bubble')) { E(fx + B.fw * 2.1, fy + 12, 5, 5, '#bfe8ff'); E(fx + B.fw * 2.1 - 1.5, fy + 10.5, 1.6, 1.6, '#ffffff'); E(fx + B.fw * 2.7, fy + 3, 3, 3, '#bfe8ff') }
  }

  function drawTail() {
    const tx = cx + rx * 0.8, ty = cy + ry * 0.15
    switch (L.tail) {
      case 'flame': E(tx + 6, ty - 4, 7, 12, c1, 0.6); E(tx + 13, ty - 17, 9, 12, c3, 0.5); E(tx + 15, ty - 21, 4.5, 6.5, '#fff6c9', 0.5); break
      case 'bolt': P([[tx - 2, ty + 2], [tx + 14, ty - 10], [tx + 8, ty - 14], [tx + 22, ty - 32], [tx + 19, ty - 16], [tx + 26, ty - 14], [tx + 6, ty + 6]], c3); break
      case 'puff': E(tx + 4, ty + 8, 8, 8, c2); break
      case 'curl': ctx.strokeStyle = c1; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(tx + 10, ty - 8, 10, 0.5 * Math.PI, 1.8 * Math.PI); ctx.stroke(); E(tx + 18, ty - 13, 3.5, 3.5, c3); break
      case 'feather': E(tx + 3, ty + 6, 13, 5, d1, -0.3); E(tx + 5, ty + 12, 13, 5, c1, 0.1); break
      case 'fish': P([[cx + rx - 5, cy - 4], [cx + rx + 18, cy - 20], [cx + rx + 13, cy], [cx + rx + 18, cy + 18], [cx + rx - 5, cy + 5]], c3); break
    }
  }
}

const cache = new Map()

// size: 画布像素边长；back: 背面；small: 迷你版（放大眼睛、省略高光）
export function monSprite(sp, { size = 64, back = false, shiny = false } = {}) {
  const key = `${sp}|${size}|${back}|${shiny}`
  let cv = cache.get(key)
  if (cv) return cv
  cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  ctx.save()
  ctx.translate(size * 0.04, size * 0.04)
  ctx.scale((size * 0.92) / 100, (size * 0.92) / 100)
  drawCreature(ctx, sp, back, shiny, size < 40)
  ctx.restore()
  pixelize(cv, true)
  cache.set(key, cv)
  return cv
}

// —— 训练家 ——
export const SKIN = ['#f6d3b3', '#e8b98f', '#c98e62', '#8d5a3b']
export const HAIR = ['#2b2118', '#6b3e1f', '#c9862f', '#e8d06a', '#dcdcdc', '#3d5bd9', '#d94a7a', '#3aa66b']
export const SHIRT = ['#e84a5f', '#3a86ff', '#2ec4b6', '#ff9f1c', '#8338ec', '#06a77d', '#f15bb5', '#f4f4f4', '#222831']
export const PANTS = ['#2b2d42', '#3d405b', '#5c4033', '#1d3557', '#4a4e69']
export const HATC = ['#e63946', '#1d3557', '#f4a261', '#2a9d8f', '#6d597a', '#ffb703']

export function lookFromKey(hex) {
  const b = (i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return { skin: b(0) % SKIN.length, hair: b(1) % HAIR.length, shirt: b(2) % SHIRT.length, pants: b(3) % PANTS.length, hat: b(4) % 3, hatColor: b(5) % HATC.length }
}

function paintTrainer(ctx, look, dir, frame) {
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x + 1, y + 1, w, h) }
  const skin = SKIN[look.skin % SKIN.length], hair = HAIR[look.hair % HAIR.length]
  const shirt = SHIRT[look.shirt % SHIRT.length], pants = PANTS[look.pants % PANTS.length]
  const hat = HATC[(look.hatColor || 0) % HATC.length]
  const shoe = '#2a2a35'
  if (dir === 'down' || dir === 'up') {
    const lUp = frame === 1, rUp = frame === 2
    R(4, 14, 3, lUp ? 3 : 4, pants); R(9, 14, 3, rUp ? 3 : 4, pants)
    R(4, lUp ? 17 : 18, 3, 2, shoe); R(9, rUp ? 17 : 18, 3, 2, shoe)
    R(3, 8, 10, 6, shirt)
    R(3, 13, 10, 1, shade(pants, -0.25))
    R(2, 9, 1, 4, shade(shirt, -0.12)); R(13, 9, 1, 4, shade(shirt, -0.12))
    R(2, frame === 1 ? 12 : 13, 1, 1, skin); R(13, frame === 2 ? 12 : 13, 1, 1, skin)
    R(3, 1, 10, 7, skin)
    if (dir === 'down') {
      R(3, 0, 10, 3, hair); R(2, 1, 1, 5, hair); R(13, 1, 1, 5, hair); R(3, 3, 1, 2, hair); R(12, 3, 1, 2, hair)
      R(5, 4, 1, 2, INK); R(10, 4, 1, 2, INK)
      R(4, 6, 1, 1, shade(skin, -0.12)); R(11, 6, 1, 1, shade(skin, -0.12))
      if (look.hat === 1) { R(3, 0, 10, 2, hat); R(2, 2, 12, 1, shade(hat, -0.25)) }
      if (look.hat === 2) { R(3, 0, 10, 3, hat); R(3, 2, 10, 1, shade(hat, 0.3)) }
      R(6, 8, 4, 1, shade(shirt, 0.25))
    } else {
      R(2, 0, 12, 8, hair); R(6, 8, 4, 1, skin)
      if (look.hat === 1) R(2, 0, 12, 3, hat)
      if (look.hat === 2) { R(2, 0, 12, 4, hat); R(2, 3, 12, 1, shade(hat, 0.3)) }
    }
  } else {
    // 朝左绘制，朝右时镜像
    if (frame === 0) { R(6, 14, 4, 4, pants); R(5, 18, 5, 2, shoe) }
    else {
      const a = frame === 1
      R(a ? 5 : 8, 14, 3, 4, pants); R(a ? 8 : 5, 14, 3, 3, shade(pants, -0.15))
      R(a ? 4 : 8, 18, 4, 2, shoe); R(a ? 8 : 4, 17, 3, 2, shade(shoe, 0.15))
    }
    R(5, 8, 6, 6, shirt)
    R(5, 13, 6, 1, shade(pants, -0.25))
    const sw = frame === 1 ? -1 : frame === 2 ? 1 : 0
    R(7 + sw, 9, 2, 4, shade(shirt, -0.15)); R(7 + sw, 13, 2, 1, skin)
    R(4, 1, 8, 7, skin)
    R(5, 0, 7, 2, hair); R(8, 1, 4, 6, hair); R(11, 2, 1, 5, hair); R(4, 1, 2, 1, hair)
    R(5, 4, 1, 2, INK)
    if (look.hat === 1) { R(5, 0, 7, 2, hat); R(2, 2, 5, 1, shade(hat, -0.25)) }
    if (look.hat === 2) { R(4, 0, 8, 3, hat); R(4, 2, 8, 1, shade(hat, 0.3)) }
  }
}

export function trainerSprite(look, dir = 'down', frame = 0) {
  const key = `t|${look.skin}${look.hair}${look.shirt}${look.pants}${look.hat}${look.hatColor}|${dir}|${frame}`
  let cv = cache.get(key)
  if (cv) return cv
  cv = document.createElement('canvas')
  cv.width = 18; cv.height = 22
  const ctx = cv.getContext('2d')
  if (dir === 'right') {
    ctx.translate(18, 0); ctx.scale(-1, 1)
    paintTrainer(ctx, look, 'left', frame)
  } else paintTrainer(ctx, look, dir, frame)
  pixelize(cv, true)
  cache.set(key, cv)
  return cv
}

// 捕捉球（自有设计：上半彩色、腰带、中心宝石）
export function ballSprite(kind = 'ball', size = 16) {
  const key = `ball|${kind}|${size}`
  let cv = cache.get(key)
  if (cv) return cv
  cv = document.createElement('canvas')
  cv.width = cv.height = size
  const ctx = cv.getContext('2d')
  const top = { ball: '#1fb5a3', great: '#3a86ff', ultra: '#8e5cf7' }[kind] || '#1fb5a3'
  ctx.scale(size / 16, size / 16)
  ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc(8, 8, 6.5, 0, Math.PI * 2); ctx.fill()
  ctx.fillStyle = top; ctx.beginPath(); ctx.arc(8, 8, 6.5, Math.PI, Math.PI * 2); ctx.fill()
  ctx.fillStyle = INK; ctx.fillRect(1.5, 7.3, 13, 1.6)
  ctx.fillStyle = '#ffc43d'; ctx.beginPath(); ctx.moveTo(8, 5.6); ctx.lineTo(10.2, 8.1); ctx.lineTo(8, 10.6); ctx.lineTo(5.8, 8.1); ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fillRect(4.5, 3.5, 2, 1.2)
  pixelize(cv, true)
  cache.set(key, cv)
  return cv
}
