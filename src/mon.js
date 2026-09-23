// 精灵实例：个体值、能力值、经验、升级、进化、战斗快照
import { SPECIES } from './data/species.js'
import { MOVES } from './data/moves.js'
import { hashStr, randId } from './util.js'

export const MAX_LEVEL = 50

export const xpForLevel = (lv) => (lv <= 1 ? 0 : Math.floor(lv * lv * lv * 0.8))

const iv = (uid, k) => hashStr(uid + k) % 16

export function statsOf(mon) {
  const b = SPECIES[mon.sp].base
  const L = mon.lv
  const st = (k) => Math.floor(((b[k] * 2 + iv(mon.uid, k)) * L) / 100) + 5
  return {
    maxHp: Math.floor(((b.hp * 2 + iv(mon.uid, 'hp')) * L) / 100) + L + 10,
    atk: st('atk'),
    def: st('def'),
    spd: st('spd'),
  }
}

export function movesAtLevel(sp, lv) {
  const list = []
  for (const [l, m] of SPECIES[sp].learn) if (l <= lv && !list.includes(m)) list.push(m)
  return list.slice(-4)
}

export function createMon(sp, lv, opts = {}) {
  const m = {
    uid: randId(12),
    sp,
    lv,
    xp: xpForLevel(lv),
    moves: movesAtLevel(sp, lv),
    shiny: opts.shiny ?? Math.random() < 1 / 128,
    nick: null,
    ot: opts.ot || null,
    caughtAt: opts.caughtAt || null,
  }
  m.hp = statsOf(m).maxHp
  return m
}

export const monName = (m) => m.nick || SPECIES[m.sp].name

export function healMon(m) {
  m.hp = statsOf(m).maxHp
}

// 战斗用快照（与存档对象解耦，PvP 双方各持一份相同数据做确定性回放）
export function snapshot(m, fullHeal = false) {
  const s = statsOf(m)
  return {
    uid: m.uid, sp: m.sp, nick: m.nick, lv: m.lv, shiny: !!m.shiny,
    hp: fullHeal ? s.maxHp : Math.min(m.hp, s.maxHp), maxHp: s.maxHp,
    atk: s.atk, def: s.def, spd: s.spd, moves: [...m.moves],
  }
}

export function xpYield(snap, isTrainer) {
  return Math.max(1, Math.floor((SPECIES[snap.sp].xp * snap.lv) / 6 * (isTrainer ? 1.5 : 1)))
}

// 获得经验：返回消息列表，可能包含升级、学会新招式
export function gainXp(m, amount) {
  const msgs = []
  if (m.lv >= MAX_LEVEL) return msgs
  m.xp += amount
  msgs.push(`${monName(m)} 获得了 ${amount} 点经验值！`)
  while (m.lv < MAX_LEVEL && m.xp >= xpForLevel(m.lv + 1)) {
    const before = statsOf(m).maxHp
    m.lv++
    const after = statsOf(m).maxHp
    m.hp = Math.max(1, Math.min(after, m.hp + (after - before)))
    msgs.push(`${monName(m)} 升到了 ${m.lv} 级！`)
    for (const [l, mv] of SPECIES[m.sp].learn) {
      if (l !== m.lv || m.moves.includes(mv)) continue
      if (m.moves.length < 4) {
        m.moves.push(mv)
        msgs.push(`${monName(m)} 学会了 ${MOVES[mv].name}！`)
      } else {
        // 自动替换威力最低的招式
        let wi = 0
        m.moves.forEach((x, i) => { if (MOVES[x].power < MOVES[m.moves[wi]].power) wi = i })
        if (MOVES[m.moves[wi]].power < MOVES[mv].power || MOVES[mv].power === 0) {
          const old = m.moves[wi]
          m.moves[wi] = mv
          msgs.push(`${monName(m)} 忘记了 ${MOVES[old].name}，学会了 ${MOVES[mv].name}！`)
        }
      }
    }
  }
  return msgs
}

export function canEvolve(m) {
  const e = SPECIES[m.sp].evo
  return !!(e && m.lv >= e.lv)
}

export function evolve(m) {
  const e = SPECIES[m.sp].evo
  const before = statsOf(m).maxHp
  m.sp = e.to
  const after = statsOf(m).maxHp
  m.hp = Math.min(after, m.hp + (after - before))
  for (const [l, mv] of SPECIES[m.sp].learn) {
    if (l <= m.lv && !m.moves.includes(mv) && m.moves.length < 4) m.moves.push(mv)
  }
}

export function xpProgress(m) {
  if (m.lv >= MAX_LEVEL) return 1
  const a = xpForLevel(m.lv), b = xpForLevel(m.lv + 1)
  return Math.max(0, Math.min(1, (m.xp - a) / (b - a)))
}
