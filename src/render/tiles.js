// 16px 像素图块与建筑，预渲染成两帧（水波、草丛摆动）
import { tileAt } from '../data/maps.js'
import { shade, INK } from './sprites.js'

export const TILE = 16

const h3 = (x, y, s) => {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(s, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const isWater = (t) => t === '~' || t === 'B'

function drawTile(ctx, map, x, y, frame) {
  const t = tileAt(map, x, y)
  const X = x * TILE, Y = y * TILE
  const R = (dx, dy, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(X + dx, Y + dy, w, h) }
  const disc = (cx, cy, r, c) => { for (let j = -r; j <= r; j++) { const w = Math.round(Math.sqrt(r * r - j * j)); R(cx - w, cy + j, w * 2, 1, c) } }
  const dark = !!map.dark

  const grass = () => {
    R(0, 0, 16, 16, dark ? '#5d9a4c' : '#8ccf6a')
    for (let k = 0; k < 5; k++) R(Math.floor(h3(x, y, k) * 15), Math.floor(h3(x, y, k + 9) * 14), 1, 2, dark ? '#4c8440' : '#72b957')
    if (h3(x, y, 77) < 0.3) R(Math.floor(h3(x, y, 78) * 14), Math.floor(h3(x, y, 79) * 14), 2, 1, dark ? '#6fae5a' : '#a9df88')
  }
  const water = () => {
    R(0, 0, 16, 16, '#4aa3de')
    for (let k = 0; k < 3; k++) {
      const wy = (k * 5 + frame * 2 + ((x * 3 + y) % 4)) % 15
      R(Math.floor(h3(x, y, k + 20) * 10), wy, 5, 1, '#7cc6ef')
    }
    const foam = '#c9ecfb'
    if (!isWater(tileAt(map, x, y - 1))) R(0, 0, 16, 2, foam)
    if (!isWater(tileAt(map, x, y + 1))) R(0, 14, 16, 2, '#3a8cc4')
    if (!isWater(tileAt(map, x - 1, y))) R(0, 0, 2, 16, foam)
    if (!isWater(tileAt(map, x + 1, y))) R(14, 0, 2, 16, foam)
  }

  switch (t) {
    case '.': grass(); break
    case ',': {
      R(0, 0, 16, 16, dark ? '#3f7d3a' : '#5fae4b')
      for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
        const bx = col * 4 + (row % 2 ? 2 : 0) - (row % 2 ? 1 : 0), by = row * 5 + 1
        const sway = (frame + row + col) % 2
        R(bx + 1 + sway, by, 1, 1, dark ? '#79b865' : '#9be07a')
        R(bx, by + 1, 1, 3, dark ? '#2c5e2a' : '#3f8a3a'); R(bx + 2, by + 1, 1, 3, dark ? '#2c5e2a' : '#3f8a3a')
        R(bx + 1, by + 1, 1, 3, dark ? '#4c8a40' : '#4f9c42')
      }
      break
    }
    case '=': {
      R(0, 0, 16, 16, '#e2c992')
      for (let k = 0; k < 3; k++) R(Math.floor(h3(x, y, k) * 14), Math.floor(h3(x, y, k + 5) * 14), 2, 1, k ? '#c9ad72' : '#f0dcae')
      const edge = '#c7ab73'
      const isPath = (tt) => tt === '=' || tt === 'p'
      if (!isPath(tileAt(map, x, y - 1))) R(0, 0, 16, 1, edge)
      if (!isPath(tileAt(map, x, y + 1))) R(0, 15, 16, 1, edge)
      if (!isPath(tileAt(map, x - 1, y))) R(0, 0, 1, 16, edge)
      if (!isPath(tileAt(map, x + 1, y))) R(15, 0, 1, 16, edge)
      break
    }
    case 'p': {
      R(0, 0, 16, 16, '#dcd8ce')
      const l = '#c3beb2'
      R(0, 0, 16, 1, l); R(0, 8, 16, 1, l)
      R((x % 2) * 8, 0, 1, 8, l); R(((x + 1) % 2) * 8, 8, 1, 8, l)
      R(2, 2, 2, 1, '#ebe8e1')
      break
    }
    case '~': water(); break
    case 's': R(0, 0, 16, 16, '#f0dc9c'); for (let k = 0; k < 4; k++) R(Math.floor(h3(x, y, k) * 15), Math.floor(h3(x, y, k + 3) * 15), 1, 1, '#d9bf78'); break
    case 'T': {
      grass()
      R(3, 13, 10, 2, dark ? '#2b4d27' : '#3b7a3b')
      R(6, 10, 4, 6, '#7a4f2a'); R(6, 10, 1, 6, '#5e3a1d')
      disc(8, 7, 7, dark ? '#1f4a2a' : '#2f7a3a')
      disc(8, 6, 6, dark ? '#2d6437' : '#45a04c')
      disc(6, 4, 3, dark ? '#3f7d45' : '#66be62')
      R(5, 3, 2, 1, dark ? '#58955a' : '#8bd67f')
      break
    }
    case 'f': {
      grass()
      const cols = ['#ff6b8b', '#ffd23f', '#ffffff', '#b28dff', '#ff9f43']
      for (let k = 0; k < 3; k++) {
        const fx = 2 + Math.floor(h3(x, y, k + 30) * 12), fy = 2 + Math.floor(h3(x, y, k + 40) * 11)
        const c = cols[Math.floor(h3(x, y, k + 50) * cols.length)]
        const s = frame && k === 1 ? 1 : 0
        R(fx - 1 + s, fy, 3, 1, c); R(fx + s, fy - 1, 1, 3, c); R(fx + s, fy, 1, 1, '#f7b500')
        R(fx, fy + 2, 1, 2, '#4f9c42')
      }
      break
    }
    case '#': {
      const under = tileAt(map, x, y + 1) === 'p' || tileAt(map, x - 1, y) === 'p' || tileAt(map, x + 1, y) === 'p'
      if (under) { R(0, 0, 16, 16, '#dcd8ce') } else grass()
      R(0, 6, 16, 2, '#c98f55'); R(0, 10, 16, 2, '#c98f55'); R(0, 6, 16, 1, '#e0aa70')
      R(2, 3, 2, 11, '#a86f3d'); R(12, 3, 2, 11, '#a86f3d'); R(2, 3, 2, 1, '#e0aa70'); R(12, 3, 2, 1, '#e0aa70')
      break
    }
    case 'r': grass(); disc(8, 9, 6, '#7d7d88'); disc(7, 8, 5, '#a3a3ad'); R(5, 5, 3, 1, '#cfcfd8'); break
    case 'S': {
      grass()
      R(7, 9, 2, 6, '#7a4f2a')
      R(2, 3, 12, 7, '#c98f55'); R(2, 3, 12, 1, '#e0aa70'); R(2, 9, 12, 1, '#8a5a2b')
      R(4, 5, 8, 1, '#8a5a2b'); R(4, 7, 6, 1, '#8a5a2b')
      break
    }
    case 'B': {
      water()
      R(2, 0, 12, 16, '#b07a47')
      for (let k = 0; k < 4; k++) R(2, k * 4 + 3, 12, 1, '#8a5a2b')
      R(2, 0, 1, 16, '#6b4424'); R(13, 0, 1, 16, '#6b4424')
      break
    }
    // —— 室内 ——
    case 'w': wood(); break
    case 'k': tilesFloor(); break
    case 'R': {
      floor()
      const isRug = (tt) => tt === 'R'
      R(0, 0, 16, 16, '#c0504d')
      R(2, 2, 12, 12, '#d8665f')
      for (let k = 0; k < 4; k++) R(4 + k * 3, 7, 2, 2, '#f2c14e')
      if (!isRug(tileAt(map, x, y - 1))) R(0, 0, 16, 2, '#f2c14e')
      if (!isRug(tileAt(map, x, y + 1))) R(0, 14, 16, 2, '#f2c14e')
      if (!isRug(tileAt(map, x - 1, y))) R(0, 0, 2, 16, '#f2c14e')
      if (!isRug(tileAt(map, x + 1, y))) R(14, 0, 2, 16, '#f2c14e')
      break
    }
    case 'x': floor(); R(1, 3, 14, 11, '#6b4424'); R(2, 4, 12, 9, '#8a5a2b'); for (let k = 0; k < 3; k++) R(3, 5 + k * 3, 10, 1, '#b07a47'); break
    case 'W': {
      if (tileAt(map, x, y + 1) === 'W') { R(0, 0, 16, 16, '#3b3552'); R(0, 15, 16, 1, '#57507a'); break }
      R(0, 0, 16, 16, '#f3e6c8')
      for (let k = 0; k < 16; k += 4) R(k + 1, 0, 1, 13, '#e8d6ad')
      R(0, 0, 16, 2, '#57507a')
      R(0, 13, 16, 3, '#8a5a2b'); R(0, 13, 16, 1, '#b07a47')
      if (x % 4 === 2) { R(3, 3, 10, 8, '#5a4632'); R(4, 4, 8, 6, '#9fdcff'); R(4, 4, 8, 2, '#d7f3ff'); R(7, 4, 1, 6, '#5a4632') }
      break
    }
    case 'C': {
      floor()
      R(0, 1, 16, 7, '#e8d2a8'); R(0, 1, 16, 1, '#f6e6c6')
      R(0, 8, 16, 7, '#b07a47'); R(0, 8, 16, 1, '#8a5a2b'); R(0, 14, 16, 1, '#6b4424')
      R(3, 10, 10, 3, '#9a6a3a')
      break
    }
    case 'b': {
      floor()
      const top = tileAt(map, x, y + 1) === 'b'
      R(1, 0, 14, 16, '#8a5a2b')
      if (top) { R(1, 1, 14, 4, '#6b4424'); R(2, 5, 12, 11, '#ffffff'); R(4, 7, 8, 5, '#eef3fb') }
      else { R(2, 0, 12, 13, '#5b8def'); R(2, 0, 12, 2, '#ffffff'); R(2, 13, 12, 2, '#6b4424') }
      break
    }
    case 't': floor(); R(1, 3, 14, 9, '#b07a47'); R(1, 3, 14, 2, '#d09a63'); R(2, 12, 2, 4, '#6b4424'); R(12, 12, 2, 4, '#6b4424'); break
    case 'c': floor(); R(3, 2, 10, 4, '#a8663a'); R(3, 6, 10, 6, '#c47b45'); R(3, 12, 2, 3, '#6b4424'); R(11, 12, 2, 3, '#6b4424'); break
    case 'h': {
      floor()
      R(1, 0, 14, 16, '#7a4f2a'); R(2, 1, 12, 14, '#5e3a1d')
      const books = ['#e84a5f', '#3a86ff', '#2ec4b6', '#ffc43d', '#8e5cf7', '#f4f4f4']
      for (let row = 0; row < 3; row++) {
        for (let k = 0; k < 5; k++) R(2 + k * 2 + (row % 2), 2 + row * 5, 2, 3 + ((k + x) % 2), books[(k + row + x) % books.length])
        R(2, 5 + row * 5, 12, 1, '#7a4f2a')
      }
      break
    }
    case 'D': {
      floor()
      R(0, 2, 16, 13, '#9aa5b1'); R(0, 2, 16, 1, '#c3ccd6'); R(0, 8, 16, 1, '#7b8794')
      const cols = ['#ef476f', '#1fb5a3', '#ffc43d', '#3a86ff', '#8e5cf7']
      for (let k = 0; k < 4; k++) { R(1 + k * 4, 4, 3, 4, cols[(k + x) % cols.length]); R(1 + k * 4, 10, 3, 4, cols[(k + x + 2) % cols.length]) }
      break
    }
    case 'P': floor(); R(5, 10, 6, 5, '#c96b3b'); R(5, 10, 6, 1, '#e08a5a'); disc(8, 6, 5, '#3f8f46'); disc(7, 5, 3, '#66be62'); break
    case 'M': {
      floor()
      R(1, 2, 14, 13, '#e9eef5'); R(1, 2, 14, 3, '#ef476f'); R(1, 14, 14, 1, '#b9c3cf')
      for (let k = 0; k < 3; k++) { disc(4 + k * 4, 8, 1, frame ? '#9fe8ff' : '#6fd3f5'); disc(4 + k * 4, 11, 1, frame ? '#6fd3f5' : '#9fe8ff') }
      break
    }
    case 'v': floor(); R(1, 3, 14, 9, '#1c1a2e'); R(2, 4, 12, 7, frame ? '#3a6ea5' : '#2f5f93'); R(3, 5, 4, 2, '#8fc3ff'); R(6, 12, 4, 3, '#555'); break
    default: grass()
  }

  function floor() { if (map.floor === 'k') tilesFloor(); else wood() }
  function wood() {
    R(0, 0, 16, 16, '#c9925a')
    for (let k = 0; k < 4; k++) R(0, k * 4 + 3, 16, 1, '#b07a47')
    for (let k = 0; k < 4; k++) R(((x * 5 + k * 7) % 12) + 2, k * 4, 1, 3, '#b07a47')
    R(0, 0, 16, 1, '#d6a36c')
  }
  function tilesFloor() {
    R(0, 0, 16, 16, '#e9eef5')
    R(0, 0, 8, 8, (x + y) % 2 ? '#dfe6ef' : '#e9eef5'); R(8, 8, 8, 8, (x + y) % 2 ? '#dfe6ef' : '#e9eef5')
    R(0, 0, 16, 1, '#cfd7e3'); R(0, 0, 1, 16, '#cfd7e3')
  }
}

function drawBuilding(ctx, b) {
  const X = b.x * TILE, Y = b.y * TILE, W = b.w * TILE, H = b.h * TILE
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h) }
  const wallH = b.kind === 'center' ? 28 : 24
  const roofH = H - wallH
  const roof = b.roof
  R(X + 4, Y + H - 1, W - 2, 3, 'rgba(0,0,0,.18)')
  // 墙
  R(X + 2, Y + roofH, W - 4, wallH, '#f3ead6')
  R(X + 2, Y + roofH, 2, wallH, '#d9c9a6'); R(X + W - 4, Y + roofH, 2, wallH, '#d9c9a6')
  R(X + 2, Y + H - 3, W - 4, 3, '#b9a47e')
  // 屋顶
  R(X, Y + 4, W, roofH - 4, roof)
  R(X + 3, Y + 1, W - 6, 4, shade(roof, -0.2))
  for (let yy = Y + 9; yy < Y + roofH - 4; yy += 5) { R(X, yy, W, 1, shade(roof, -0.16)); R(X, yy + 1, W, 1, shade(roof, 0.14)) }
  R(X - 1, Y + roofH - 3, W + 2, 3, shade(roof, -0.32))
  // 窗
  const dcol = b.door[0] - b.x
  for (const i of [1, b.w - 2]) {
    if (i === dcol || i <= 0 || i >= b.w - 1) continue
    const wx = X + i * TILE + 3, wy = Y + roofH + 6
    R(wx, wy, 10, 9, '#5a4632'); R(wx + 1, wy + 1, 8, 7, '#9fdcff'); R(wx + 1, wy + 1, 8, 2, '#d7f3ff'); R(wx + 4, wy + 1, 1, 7, '#5a4632')
  }
  // 门
  const dx = b.door[0] * TILE
  if (b.kind === 'center' || b.kind === 'shop') {
    R(dx + 2, Y + H - 17, 12, 14, '#5a4632'); R(dx + 3, Y + H - 16, 10, 13, '#bfe9ff'); R(dx + 7, Y + H - 16, 1, 13, '#5a4632'); R(dx + 3, Y + H - 16, 10, 3, '#e4f7ff')
  } else {
    R(dx + 3, Y + H - 16, 10, 13, '#6b4424'); R(dx + 4, Y + H - 15, 8, 12, '#8a5a2b'); R(dx + 10, Y + H - 9, 1, 2, '#ffd23f')
  }
  R(dx + 2, Y + H - 3, 12, 3, '#cdbb98')
  // 招牌徽记
  if (b.kind === 'center' || b.kind === 'shop') {
    const ex = X + W / 2, ey = Y + roofH / 2 + 1
    const disc = (cx, cy, r, c) => { for (let j = -r; j <= r; j++) { const w = Math.round(Math.sqrt(r * r - j * j)); R(cx - w, cy + j, w * 2, 1, c) } }
    disc(ex, ey, 7, INK); disc(ex, ey, 6, '#ffffff')
    if (b.kind === 'center') { R(ex - 1, ey - 4, 2, 8, '#ef476f'); R(ex - 4, ey - 1, 8, 2, '#ef476f') }
    else { R(ex - 3, ey - 2, 6, 5, '#3a86ff'); R(ex - 2, ey - 4, 4, 1, '#3a86ff'); R(ex - 2, ey - 4, 1, 2, '#3a86ff'); R(ex + 1, ey - 4, 1, 2, '#3a86ff') }
  }
}

// 返回两帧的地图底图
export function prerenderMap(map) {
  return [0, 1].map((frame) => {
    const cv = document.createElement('canvas')
    cv.width = map.w * TILE
    cv.height = map.h * TILE
    const ctx = cv.getContext('2d')
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) drawTile(ctx, map, x, y, frame)
    for (const b of map.buildings) drawBuilding(ctx, b)
    return cv
  })
}
