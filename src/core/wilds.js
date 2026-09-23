// 可见的野生精灵：每张有草丛的地图上有若干“栖息点”（slot），每个栖息点住着一只精灵。
// 位置 / 物种 / 等级完全由 (地图, 栖息点, 世代, 时间) 决定，所有客户端各自计算，不需要网络同步；
// 只有“被收服 / 被打倒”（Y.Map wildGone）和“正在交战”（awareness.battling）需要同步。
import { MAPS } from '../data/maps.js'
import { mulberry32, hashStr, pickWeighted, sleep } from '../util.js'

const SEG = 5000 // 每段 5 秒：前 40% 发呆，后 60% 走向下一个目标
const IDLE = 0.4
const STAY = 0.3
const RADIUS = 3.2
const HOME_GAP = 3
const GONE_MS = 45000
const CLAIM_WAIT = 350
const OFF = 0.2 // 站位相对格子中心的随机偏移
const MARGIN = 0.24 // 连线检查时的安全边距（≥ OFF）
const LOOKBACK = 10

// 整数混合哈希：避免每帧拼接字符串
function mix(a, b) {
  let h = Math.imul(a ^ Math.imul(b | 0, 0x9e3779b1), 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}
const rnd = (seed, k, salt) => mix(mix(seed, k), salt) / 4294967296

function parseId(id) {
  if (typeof id !== 'string') return null
  const parts = id.split(':')
  if (parts.length !== 3) return null
  const slot = +parts[1], gen = +parts[2]
  if (!Number.isInteger(slot) || !Number.isInteger(gen) || slot < 0 || gen < 0) return null
  return { map: parts[0], slot, gen, key: parts[0] + ':' + slot }
}

// 草丛掩码：只允许走在 ',' 上，并避开 NPC 和传送点
function grassMask(m) {
  const mask = new Uint8Array(m.w * m.h)
  for (const [x, y] of m.grassTiles) mask[y * m.w + x] = 1
  for (const n of m.npcs || []) if (n.x >= 0 && n.y >= 0 && n.x < m.w && n.y < m.h) mask[n.y * m.w + n.x] = 0
  for (const w of m.warps || []) {
    for (let y = w.y; y < w.y + w.h; y++) for (let x = w.x; x < w.x + w.w; x++) if (x >= 0 && y >= 0 && x < m.w && y < m.h) mask[y * m.w + x] = 0
  }
  return mask
}

function onGrass(m, mask, x, y) {
  const tx = Math.floor(x), ty = Math.floor(y)
  return tx >= 0 && ty >= 0 && tx < m.w && ty < m.h && mask[ty * m.w + tx] === 1
}

// 两个格子中心之间的直线（加上 ±MARGIN 的方框）是否全程都在草丛里
function clearLine(m, mask, a, b) {
  const ax = (a % m.w) + 0.5, ay = Math.floor(a / m.w) + 0.5
  const bx = (b % m.w) + 0.5, by = Math.floor(b / m.w) + 0.5
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.04))
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t
    if (!onGrass(m, mask, x - MARGIN, y - MARGIN) || !onGrass(m, mask, x + MARGIN, y - MARGIN) ||
        !onGrass(m, mask, x - MARGIN, y + MARGIN) || !onGrass(m, mask, x + MARGIN, y + MARGIN)) return false
  }
  return true
}

// 每张地图只算一次：栖息点 + 活动范围
function buildHerd(m) {
  const mask = grassMask(m)
  const grass = m.grassTiles.filter(([x, y]) => mask[y * m.w + x])
  const n = grass.length ? Math.max(3, Math.min(9, Math.round(grass.length / 22))) : 0
  const order = grass.slice()
  const r = mulberry32(hashStr('wild-herd:' + m.id))
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    const t = order[i]; order[i] = order[j]; order[j] = t
  }
  const homes = []
  for (const t of order) {
    if (homes.length >= n) break
    if (homes.every((h) => Math.hypot(h[0] - t[0], h[1] - t[1]) >= HOME_GAP)) homes.push(t)
  }
  for (const t of order) {
    if (homes.length >= n) break
    if (!homes.includes(t)) homes.push(t)
  }

  const slots = homes.map(([hx, hy], slot) => {
    const home = hy * m.w + hx
    // 半径内的草丛格，按离家远近排序；只保留两两之间直线可达的格子（凸的活动范围），
    // 这样任意两个目标之间直走都不会穿过树木、水面或小路
    const near = grass
      .map(([x, y]) => ({ i: y * m.w + x, d: (x - hx) * (x - hx) + (y - hy) * (y - hy), x, y }))
      .filter((c) => c.d <= RADIUS * RADIUS)
      .sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x)
    const tiles = [home]
    for (const c of near) {
      if (c.i === home) continue
      if (tiles.every((t) => clearLine(m, mask, t, c.i))) tiles.push(c.i)
    }
    const key = m.id + ':' + slot
    return {
      slot, key, home, tiles: Int32Array.from(tiles), w: m.w,
      phase: hashStr('wild-phase:' + key) % SEG,
      gen: -1, id: '', seed: 0, sp: '', lv: 1, shiny: false,
      x: 0, y: 0, heading: 0, moving: false, speed: 0,
    }
  })
  return { map: m, slots, byKey: new Map(slots.map((s) => [s.key, s])) }
}

export class Wilds {
  constructor(game) {
    this.game = game
    this.herds = new Map()
    this._goneMap = null
    this._aw = null
    this._claims = new Map() // wild id → 交战中的训练家名字
    this._claimCid = new Map()
    this._claimsDirty = true
    this._claimsLive = false
  }

  herd(mapId) {
    let h = this.herds.get(mapId)
    if (h === undefined) {
      const m = MAPS[mapId]
      h = m && m.wild && m.grassTiles?.length ? buildHerd(m) : null
      this.herds.set(mapId, h)
    }
    return h
  }

  list(mapId, now = Date.now()) {
    const out = []
    const h = this.herd(mapId)
    if (!h) return out
    const gone = this._gone()
    const claims = this._claimsMap()
    for (let i = 0; i < h.slots.length; i++) {
      const s = h.slots[i]
      const gen = this._state(gone, s, now)
      if (gen < 0) continue
      if (s.gen !== gen) this._roll(s, h.map, gen)
      this._motion(s, now)
      out.push({
        id: s.id, map: mapId, sp: s.sp, lv: s.lv, shiny: s.shiny,
        x: s.x, y: s.y, heading: s.heading, moving: s.moving, speed: s.speed,
        battlingBy: claims.get(s.id) ?? null,
      })
    }
    return out
  }

  async engage(w) {
    const net = this.game.net
    if (!w || !net || !this._current(w.id)) return false
    if (this._otherClaim(w.id) !== null) return false
    net.setPresence({ battling: w.id })
    await sleep(CLAIM_WAIT)
    const other = this._otherClaim(w.id)
    if (!this._current(w.id) || (other !== null && other < net.cid)) {
      this.release(w.id)
      return false
    }
    return true
  }

  release(id) {
    const net = this.game.net
    if (!net) return
    const mine = net.awareness?.getLocalState?.()?.battling ?? net.local?.battling
    if (mine === id) net.setPresence({ battling: null })
  }

  markGone(id, reason) {
    const p = parseId(id)
    const gone = this._gone()
    if (p && gone) {
      const cur = gone.get(p.key)
      if (!cur || !(Number(cur.gen) >= p.gen)) {
        const now = Date.now()
        gone.set(p.key, { gen: p.gen, until: now + GONE_MS, by: this.game.signer?.pubkey ?? null, reason: reason ?? null, ts: now })
      }
    }
    this.release(id)
  }

  // —— 内部 ——

  _gone() {
    if (!this._goneMap) {
      const doc = this.game.net?.doc
      if (doc) this._goneMap = doc.getMap('wildGone')
    }
    return this._goneMap
  }

  // 当前世代；不可见（刚被收服，冷却中）返回 -1
  _state(gone, s, now) {
    const e = gone ? gone.get(s.key) : null
    if (!e) return 0
    const g = Number(e.gen)
    if (!Number.isInteger(g) || g < 0) return 0
    return now >= (Number(e.until) || 0) ? g + 1 : -1
  }

  _current(id) {
    const p = parseId(id)
    if (!p) return false
    const h = this.herd(p.map)
    const s = h?.byKey.get(p.key)
    return !!s && this._state(this._gone(), s, Date.now()) === p.gen
  }

  _roll(s, m, gen) {
    s.gen = gen
    s.id = s.key + ':' + gen
    s.seed = hashStr(s.id)
    const r = mulberry32(s.seed)
    s.sp = pickWeighted(m.wild.table, r)[0]
    s.lv = m.wild.min + Math.floor(r() * (m.wild.max - m.wild.min + 1))
    s.shiny = r() < 1 / 64
  }

  // 第 k 段结束时所在的格子（s.tiles 下标）；30% 的段落原地不动
  _target(s, k) {
    let j = k, n = 0
    while (n < 8 && rnd(s.seed, j, 1) < STAY) { j--; n++ }
    if (n === 8) return 0
    return Math.floor(rnd(s.seed, j, 2) * s.tiles.length)
  }

  _px(s, t) { const i = s.tiles[t]; return (i % s.w) + 0.5 + (rnd(s.seed, i, 3) - 0.5) * 2 * OFF }
  _py(s, t) { const i = s.tiles[t]; return Math.floor(i / s.w) + 0.5 + (rnd(s.seed, i, 4) - 0.5) * 2 * OFF }

  _motion(s, now) {
    const u = (now + s.phase) / SEG
    const k = Math.floor(u), f = u - k
    const a = this._target(s, k - 1)
    const ax = this._px(s, a), ay = this._py(s, a)
    if (f >= IDLE) {
      const b = this._target(s, k)
      if (b !== a) {
        const bx = this._px(s, b), by = this._py(s, b)
        const q = (f - IDLE) / (1 - IDLE)
        const e = q * q * (3 - 2 * q)
        s.x = ax + (bx - ax) * e
        s.y = ay + (by - ay) * e
        s.heading = Math.atan2(bx - ax, by - ay)
        s.moving = true
        // 当前速度（格/秒），给动画用
        s.speed = (6 * q * (1 - q) * Math.hypot(bx - ax, by - ay)) / ((1 - IDLE) * SEG / 1000)
        return
      }
    }
    s.x = ax
    s.y = ay
    s.moving = false
    s.speed = 0
    s.heading = this._lastHeading(s, k - 1)
  }

  // 最近一次走动的朝向（发呆时保持）
  _lastHeading(s, k) {
    let cur = this._target(s, k)
    for (let j = k; j > k - LOOKBACK; j--) {
      const prev = this._target(s, j - 1)
      if (prev !== cur) return Math.atan2(this._px(s, cur) - this._px(s, prev), this._py(s, cur) - this._py(s, prev))
      cur = prev
    }
    return (rnd(s.seed, 0, 5) - 0.5) * 2 * Math.PI
  }

  _claimsMap() {
    const net = this.game.net
    const aw = net?.awareness
    if (!aw) return this._claims
    if (this._aw !== aw) {
      this._aw = aw
      this._claimsDirty = true
      this._claimsLive = typeof aw.on === 'function'
      if (this._claimsLive) aw.on('change', () => { this._claimsDirty = true })
    }
    if (!this._claimsDirty && this._claimsLive) return this._claims
    this._claimsDirty = false
    const c = this._claims
    c.clear()
    this._claimCid.clear()
    const me = net.cid
    aw.getStates().forEach((st, cid) => {
      const b = st && st.battling
      if (typeof b !== 'string' || !b) return
      // 同一只被多人占用时，显示 clientID 最小者（与 engage 的裁决一致）
      if (c.has(b) && this._claimCid.get(b) < cid) return
      this._claimCid.set(b, cid)
      c.set(b, cid === me ? (this.game.save?.name || st.name || '我') : (st.name || '训练家'))
    })
    return c
  }

  // 其他客户端中占用这只的最小 clientID；没有返回 null
  _otherClaim(id) {
    const net = this.game.net
    const aw = net?.awareness
    if (!aw) return null
    let min = null
    aw.getStates().forEach((st, cid) => {
      if (cid !== net.cid && st && st.battling === id && (min === null || cid < min)) min = cid
    })
    return min
  }
}
