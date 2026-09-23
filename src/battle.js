// 确定性回合制战斗引擎。
// 同一份初始状态 + 同样的行动序列 + 同一个种子 → 完全相同的结果，
// PvP 双方各自在本地回放，只需通过 Yjs 同步“行动”。
// 事件只记录“哪一侧发生了什么”，文字由 UI 按各自视角生成。
import { MOVES } from './data/moves.js'
import { SPECIES } from './data/species.js'
import { effectiveness } from './data/types.js'
import { mulberry32, hashStr } from './util.js'

export const BALLS = { ball: 1, great: 1.7, ultra: 2.4 }
export const POTIONS = { potion: 20, super: 60, full: 9999 }

export const rngFor = (seed, turn) => mulberry32(hashStr(seed + ':' + turn))

export function createBattle({ kind, seed, sides }) {
  return {
    kind, seed, turn: 0, over: false, winner: null, reason: null,
    sides: sides.map((s) => ({
      ...s,
      team: s.team.map((m) => ({ ...m, moves: [...m.moves] })),
      active: Math.max(0, s.team.findIndex((m) => m.hp > 0)),
      stages: { atk: 0, def: 0, spd: 0 },
      runs: 0,
    })),
  }
}

export const activeMon = (st, i) => st.sides[i].team[st.sides[i].active]
export const hasHealthy = (side) => side.team.some((m) => m.hp > 0)

export function requiredActors(st) {
  if (st.over) return []
  const forced = [0, 1].filter((i) => activeMon(st, i).hp <= 0)
  return forced.length ? forced : [0, 1]
}
export const isForcedTurn = (st) => !st.over && [0, 1].some((i) => activeMon(st, i).hp <= 0)

const stageMul = (s) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s))
const speedOf = (st, i) => activeMon(st, i).spd * stageMul(st.sides[i].stages.spd)

export function catchChance(target, ball) {
  const rate = SPECIES[target.sp].catch / 255
  const hpF = target.hp / target.maxHp
  return Math.min(1, (1 - (2 / 3) * hpF) * rate * (BALLS[ball] || 1) * 1.6 + 0.02)
}

// AI：偏好克制属性与高威力招式
export function aiPickMove(st, i, rnd = Math.random) {
  const me = activeMon(st, i)
  const foe = activeMon(st, 1 - i)
  const scored = me.moves.map((id, idx) => {
    const mv = MOVES[id]
    let s = mv.power ? mv.power * effectiveness(mv.type, SPECIES[foe.sp].types) * (SPECIES[me.sp].types.includes(mv.type) ? 1.5 : 1) : 25
    if (mv.effect?.heal && me.hp / me.maxHp > 0.6) s = 5
    return { idx, s: s * (0.6 + rnd() * 0.8) }
  })
  scored.sort((a, b) => b.s - a.s)
  return { t: 'move', i: scored[0].idx }
}

export function resolveTurn(st, actions, rng) {
  const ev = []
  const end = (winner, reason) => {
    st.over = true
    st.winner = winner
    st.reason = reason
    ev.push({ t: 'end', winner, reason })
  }

  // 强制换人回合（有一方倒下）
  if (isForcedTurn(st)) {
    for (const i of requiredActors(st)) {
      const side = st.sides[i]
      let idx = actions[i]?.t === 'switch' ? actions[i].i : -1
      if (!(side.team[idx]?.hp > 0)) idx = side.team.findIndex((m) => m.hp > 0)
      side.active = idx
      side.stages = { atk: 0, def: 0, spd: 0 }
      ev.push({ t: 'switch', side: i, idx, forced: true })
    }
    st.turn++
    return ev
  }

  // 认输优先
  for (const i of [0, 1]) {
    if (actions[i]?.t === 'forfeit') {
      ev.push({ t: 'forfeit', side: i })
      end(1 - i, 'forfeit')
      st.turn++
      return ev
    }
  }

  const prio = (a) => (a.t === 'move' ? MOVES[activeMonMove(st, a)]?.pri || 0 : 6)
  const order = [0, 1]
    .filter((i) => actions[i])
    .map((i) => ({ i, a: actions[i], p: prio({ ...actions[i], side: i }), s: speedOf(st, i), r: rng() }))
    .sort((x, y) => y.p - x.p || y.s - x.s || x.r - y.r)

  for (const { i, a } of order) {
    if (st.over) break
    const side = st.sides[i]
    const foeI = 1 - i
    const foeSide = st.sides[foeI]

    if (a.t === 'run') {
      const ok = st.kind === 'wild' && (speedOf(st, i) >= speedOf(st, foeI) || rng() < 0.45 + side.runs * 0.2)
      side.runs++
      ev.push({ t: 'run', side: i, ok })
      if (ok) end(null, 'fled')
      continue
    }

    if (a.t === 'switch') {
      if (a.i === side.active || !(side.team[a.i]?.hp > 0)) continue
      const from = side.active
      side.active = a.i
      side.stages = { atk: 0, def: 0, spd: 0 }
      ev.push({ t: 'switch', side: i, idx: a.i, from })
      continue
    }

    if (a.t === 'item') {
      const m = side.team[a.target]
      if (!m || m.hp <= 0) continue
      const amt = Math.min(POTIONS[a.item] || 20, m.maxHp - m.hp)
      m.hp += amt
      ev.push({ t: 'item', side: i, item: a.item, target: a.target, hp: m.hp, amount: amt })
      continue
    }

    if (a.t === 'ball') {
      if (st.kind !== 'wild') { ev.push({ t: 'ball', side: i, ball: a.ball, blocked: true }); continue }
      const target = activeMon(st, foeI)
      const p = catchChance(target, a.ball)
      const caught = rng() < p
      let shakes = 3
      if (!caught) {
        const q = Math.pow(p, 1 / 3)
        shakes = 0
        while (shakes < 2 && rng() < q) shakes++
      }
      ev.push({ t: 'ball', side: i, ball: a.ball, shakes, caught })
      if (caught) end(i, 'caught')
      continue
    }

    if (a.t === 'move') {
      const att = activeMon(st, i)
      if (att.hp <= 0) continue
      const moveId = att.moves[a.i] || att.moves[0]
      const mv = MOVES[moveId]
      ev.push({ t: 'move', side: i, move: moveId })
      if (rng() * 100 >= mv.acc) { ev.push({ t: 'miss', side: i }); continue }

      if (mv.power > 0) {
        const tgt = activeMon(st, foeI)
        const eff = effectiveness(mv.type, SPECIES[tgt.sp].types)
        if (eff === 0) { ev.push({ t: 'noeffect', side: foeI }); continue }
        const A = att.atk * stageMul(side.stages.atk)
        const D = tgt.def * stageMul(foeSide.stages.def)
        const base = Math.floor(Math.floor((Math.floor((2 * att.lv) / 5 + 2) * mv.power * A) / D) / 50) + 2
        const stab = SPECIES[att.sp].types.includes(mv.type) ? 1.5 : 1
        const crit = rng() < 1 / 16
        const dmg = Math.max(1, Math.floor(base * stab * eff * (crit ? 1.5 : 1) * (0.85 + rng() * 0.15)))
        tgt.hp = Math.max(0, tgt.hp - dmg)
        ev.push({ t: 'damage', side: foeI, hp: tgt.hp, maxHp: tgt.maxHp, dmg, eff, crit })
        if (mv.effect?.drain && att.hp < att.maxHp) {
          const h = Math.min(att.maxHp - att.hp, Math.max(1, Math.floor(dmg * mv.effect.drain)))
          att.hp += h
          ev.push({ t: 'heal', side: i, hp: att.hp, amount: h, drain: true })
        }
        if (tgt.hp <= 0) {
          ev.push({ t: 'faint', side: foeI })
          if (!hasHealthy(foeSide)) end(i, 'ko')
        }
      } else if (mv.effect?.heal) {
        const h = Math.min(att.maxHp - att.hp, Math.floor(att.maxHp * mv.effect.heal))
        att.hp += h
        ev.push({ t: 'heal', side: i, hp: att.hp, amount: h })
      } else if (mv.effect?.stat) {
        const ti = mv.effect.target === 'self' ? i : foeI
        const stg = st.sides[ti].stages
        const before = stg[mv.effect.stat]
        stg[mv.effect.stat] = Math.max(-6, Math.min(6, before + mv.effect.stages))
        ev.push({ t: 'stat', side: ti, stat: mv.effect.stat, stages: mv.effect.stages, capped: before === stg[mv.effect.stat] })
      }
    }
  }
  st.turn++
  return ev
}

function activeMonMove(st, a) {
  const m = activeMon(st, a.side)
  return m.moves[a.i] || m.moves[0]
}
