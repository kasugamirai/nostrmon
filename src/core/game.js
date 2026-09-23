// Nostrmon 共享核心：身份 → 世界连接 → 存档 → 社交 / 战斗。
// 2D 与 3D 客户端都调用 startGame()，只替换大地图渲染（World）和战斗画面（BattleUI）。
import { MAPS, RARE_SPAWNS } from '../data/maps.js'
import { SPECIES } from '../data/species.js'
import { createMon, snapshot, statsOf, gainXp, xpYield, canEvolve, evolve, healMon, monName, xpProgress } from '../mon.js'
import { createBattle, aiPickMove, activeMon } from '../battle.js'
import { ITEMS } from '../battleUI.js'
import { Net, Y } from '../net.js'
import * as nostr from '../nostr.js'
import { YJS_PRESET, YJS_RELAY, WORLD_ROOM, lsGet, lsSet } from '../config.js'
import { $, say, toast, openModal, closeModal, modalOpen, dialogOpen, dialogKey } from '../ui.js'
import { lookFromKey, trainerSprite } from '../render/sprites.js'
import { openMenu, openShop, openPlayerCard, openOnline, openStarter, runEvolutions, renderPartyBar } from '../menus.js'
import { pickWeighted, randId, shortKey, escapeHtml, sleep } from '../util.js'

const NAME_CHARS = '星禾岚澄川夏棠屿白青柚墨鹿萤枫溪朗乔糯栗芽泉野舟'
const PVP_TEAM = 3
let OPTS = {}

const game = {
  ready: false,
  signer: null,
  net: null,
  world: null,
  battleUI: null,
  save: null,
  bubbles: new Map(),
  emotes: new Map(),
  lock: false,
  steps: 0,
  lastSave: { at: 0, ok: 0 },
  bootAt: Date.now(),
}
window.nostrmon = game

// —— 加载步骤 ——
function step(text) {
  const li = document.createElement('li')
  li.textContent = text
  $('load-steps').appendChild(li)
  return { done: (t) => { li.className = 'done'; if (t) li.textContent = t }, fail: (t) => { li.className = 'fail'; if (t) li.textContent = t } }
}

function defaultSave(pk) {
  const b = (i) => parseInt(pk.slice(i * 2, i * 2 + 2), 16)
  const town = MAPS.town
  return {
    v: 1,
    name: NAME_CHARS[b(6) % NAME_CHARS.length] + NAME_CHARS[b(7) % NAME_CHARS.length],
    look: lookFromKey(pk),
    party: [], box: [],
    bag: { ball: 5, potion: 3 },
    coins: 100000,
    dex: { seen: {}, caught: {} },
    beaten: {},
    stats: { caught: 0, pvpW: 0, pvpL: 0 },
    pos: { map: 'town', ...town.start },
    respawn: { ...town.respawn },
    createdAt: Date.now(),
    updatedAt: 0,
  }
}

function normalizeSave(s, pk) {
  const d = defaultSave(pk)
  const out = { ...d, ...s }
  for (const k of ['bag', 'dex', 'stats', 'beaten']) out[k] = { ...d[k], ...(s?.[k] || {}) }
  out.dex.seen = { ...(s?.dex?.seen || {}) }
  out.dex.caught = { ...(s?.dex?.caught || {}) }
  out.party = (s?.party || []).filter((m) => SPECIES[m.sp])
  out.box = (s?.box || []).filter((m) => SPECIES[m.sp])
  if (!MAPS[out.pos?.map]) out.pos = d.pos
  if (!MAPS[out.respawn?.map]) out.respawn = d.respawn
  // 一次性补发：新规则下初始金币为 100000，老存档补足到这个数
  out.grants = { ...(s?.grants || {}) }
  if (!out.grants.coins100k) { out.coins = Math.max(out.coins || 0, 100000); out.grants.coins100k = true }
  return out
}

// —— 存档：本地缓存 + Nostr（kind 30078，可替换事件）——
let saving = false, savePending = false, dirty = false
function persistLocal() {
  game.save.updatedAt = Date.now()
  lsSet('save:' + game.signer.pubkey, game.save)
}
game.saveSoon = () => { persistLocal(); dirty = true }
game.saveNow = async () => {
  persistLocal()
  dirty = false
  if (saving) { savePending = true; return }
  saving = true
  updateNostrPill('saving')
  try {
    const n = await nostr.publishSave(game.signer, game.save)
    game.lastSave = { at: Date.now(), ok: n }
  } catch (e) {
    console.warn('save failed', e)
  } finally {
    saving = false
    updateNostrPill()
    if (savePending) { savePending = false; setTimeout(game.saveNow, 2500) }
  }
}

// —— HUD ——
function updateHud() {
  const s = game.save
  $('me-name').textContent = s.name
  $('me-key').textContent = shortKey(game.signer.npub)
  $('coins').querySelector('span').textContent = s.coins
  const av = $('me-avatar').getContext('2d')
  av.clearRect(0, 0, 18, 22)
  av.drawImage(trainerSprite(s.look, 'down', 0), 0, 0)
  renderPartyBar(game)
}
game.updateHud = updateHud

function updateNetPill() {
  const el = $('net-pill')
  const st = game.net?.status
  el.className = 'pill ' + (st === 'connected' && game.net.synced ? 'ok' : st === 'connected' || st === 'connecting' ? 'warn' : 'bad')
  el.querySelector('span').textContent = `Yjs · ${YJS_PRESET}`
  el.title = `${YJS_RELAY.url}/${WORLD_ROOM} · ${st || '未连接'}`
  $('online-count').textContent = (game.net?.players().length || 0) + 1
}
function updateNostrPill(state) {
  const el = $('nostr-pill')
  const { ok, total } = nostr.relayHealth()
  el.className = 'pill ' + (state === 'saving' ? 'warn' : ok > 0 ? 'ok' : 'bad')
  el.querySelector('span').textContent = state === 'saving' ? 'Nostr 保存中…' : `Nostr ${ok}/${total}`
}
game.updateNostrPill = updateNostrPill

function banner(text) {
  const b = $('map-banner')
  b.textContent = text
  b.classList.add('show')
  clearTimeout(banner.t)
  banner.t = setTimeout(() => b.classList.remove('show'), 2200)
}

// —— 聊天 ——
let unread = 0
function chatLine(html, cls = '') {
  const log = $('chat-log')
  const div = document.createElement('div')
  div.className = 'msg ' + cls
  div.innerHTML = html
  log.appendChild(div)
  if ($('chat').classList.contains('collapsed')) { unread++; $('chat-toggle').innerHTML = `聊天 <b>${unread}</b>` }
  while (log.children.length > 120) log.firstChild.remove()
  log.scrollTop = log.scrollHeight
  return div
}
game.sys = (text) => chatLine(escapeHtml(text), 'sys')

function renderChatEvent(ev, history) {
  if (!Net.checkChat(ev)) return
  const tag = (k) => ev.tags.find((t) => t[0] === k)?.[1]
  const map = tag('map'), name = tag('name') || '训练家'
  const mine = ev.pubkey === game.signer.pubkey
  const div = chatLine(`<span class="where">${escapeHtml(MAPS[map]?.name || '?')}</span><span class="who" data-pk="${ev.pubkey}">${escapeHtml(name)}</span><span class="v" title="Nostr 签名已验证">✓</span>：${escapeHtml(ev.content)}`, mine ? 'me' : '')
  div.querySelector('.who').onclick = () => {
    const p = game.net.players().find((x) => x.pk === ev.pubkey)
    if (p) openPlayerCard(game, p)
    else toast(`${escapeHtml(name)} 目前不在线<br><span class="sub">${shortKey(nostr.nip19.npubEncode(ev.pubkey))}</span>`)
  }
  if (!history && Date.now() / 1000 - ev.created_at < 60) game.bubbles.set(ev.pubkey, { text: ev.content, t: Date.now(), map })
}

function setupChat() {
  const form = $('chat-form'), input = $('chat-input')
  form.onsubmit = async (e) => {
    e.preventDefault()
    const text = input.value.trim().slice(0, 120)
    input.value = ''
    input.blur()
    if (!text) return
    try { await game.net.sendChat(text, game.world.map.id, game.save.name) } catch (err) { toast('发送失败：' + escapeHtml(err.message)) }
  }
  if (matchMedia('(pointer: coarse)').matches) $('chat').classList.add('collapsed')
  $('chat-toggle').onclick = () => {
    const c = $('chat')
    c.classList.toggle('collapsed')
    unread = 0
    $('chat-toggle').textContent = '聊天'
    $('chat-toggle').setAttribute('aria-expanded', String(!c.classList.contains('collapsed')))
  }
  const row = $('emote-row')
  for (const e of ['👋', '❤️', '😆', '❗', '❓', '💤', '🎉', '⚔️']) {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = e
    b.title = '表情'
    b.onclick = () => game.emote(e)
    row.appendChild(b)
  }
}

let emoteN = 0
game.emote = (e) => {
  emoteN++
  game.net.setPresence({ emote: { e, n: emoteN } })
  game.emotes.set(game.net.cid, { e, t: Date.now() })
}

// —— 世界事件 ——
game.isBusy = () => !game.ready || game.lock || dialogOpen() || modalOpen() || game.battleUI.open
game.captureKey = (e) => {
  if (!game.ready) return true
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') { if (e.key === 'Escape') e.target.blur(); return true }
  if (game.battleUI.open) { game.battleUI.key(e); return true }
  if (dialogOpen()) {
    if (['Space', 'Enter', 'KeyZ', 'KeyX', 'Escape'].includes(e.code)) { e.preventDefault(); if (!e.repeat) dialogKey() }
    return true
  }
  if (modalOpen()) { if (e.key === 'Escape') closeModal(); return true }
  if (e.code === 'Enter' || e.code === 'KeyT') {
    e.preventDefault()
    if ($('chat').classList.contains('collapsed')) $('chat-toggle').click()
    $('chat-input').focus()
    return true
  }
  if (e.code === 'Escape' || e.code === 'KeyM' || e.code === 'KeyX') { openMenu(game); return true }
  if (e.code === 'KeyN') { openMenu(game, 'map'); return true }
  return false
}

game.say = (lines, name) => say(lines, name)
game.partyMon = (uid) => game.save.party.find((m) => m.uid === uid)
game.xpProgress = xpProgress
game.leadInfo = () => {
  const m = game.save.party[0]
  return m ? { sp: m.sp, shiny: !!m.shiny } : null
}
game.refreshPresence = () => {
  game.net.setPresence({ name: game.save.name, look: game.save.look, lead: game.leadInfo() })
  updateHud()
}

// —— 地图传送 ——
// 从 (x, y) 向外找最近的空地（不是障碍、NPC 或出入口）；near=true 时不落在目标格本身（落在好友/精灵旁边）
function freeTile(m, x, y, near) {
  const blocked = (tx, ty) => m.solid[ty * m.w + tx] || m.npcs.some((n) => n.x === tx && n.y === ty) ||
    m.warps.some((w) => tx >= w.x && tx < w.x + w.w && ty >= w.y && ty < w.y + w.h)
  const seen = new Set([x + ',' + y])
  const q = [[x, y, 0]]
  while (q.length) {
    const [cx, cy, d] = q.shift()
    if (cx >= 0 && cy >= 0 && cx < m.w && cy < m.h && !(near && d === 0) && !blocked(cx, cy)) return { x: cx, y: cy }
    if (d >= 8) continue
    for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) {
      const k = cx + dx + ',' + (cy + dy)
      if (!seen.has(k)) { seen.add(k); q.push([cx + dx, cy + dy, d + 1]) }
    }
  }
  return null
}

game.teleport = async (mapId, x, y, label, { near = false } = {}) => {
  const m = MAPS[mapId]
  if (!m || game.battleUI.open || game.lock) return
  const spot = freeTile(m, x, y, near)
  if (!spot) { toast('那里没有落脚的地方。'); return }
  closeModal(true)
  game.lock = true
  game.world.held = []
  let fx = $('tp-fx')
  if (!fx) { fx = document.createElement('div'); fx.id = 'tp-fx'; $('app').appendChild(fx) }
  fx.classList.add('on')
  await sleep(380)
  game.warp(mapId, spot.x, spot.y, 'down')
  game.emote('✨')
  await sleep(120)
  fx.classList.remove('on')
  game.lock = false
  game.sys(`✨ 传送到了 ${label || m.name}`)
}

game.warp = (to, x, y, dir) => {
  game.world.loadMap(to, x, y, dir)
  game.save.pos = { map: to, x, y, dir }
  game.world.sendPresence()
  banner(MAPS[to].name)
  game.saveSoon()
}

game.onArrive = (x, y, tile) => {
  const s = game.save
  s.pos = { map: game.world.map.id, x, y, dir: game.world.p.dir }
  dirty = true
  const sp = game.spawnAt(game.world.map.id, x, y)
  if (sp) { game.engageSpawn(sp); return }
  const wild = game.world.map.wild
  if (OPTS.randomEncounters !== false && tile === ',' && wild && s.party.some((m) => m.hp > 0)) {
    game.steps++
    if (game.steps > 3 && Math.random() < 0.12) {
      game.steps = 0
      const [sp2] = pickWeighted(wild.table)
      const lv = wild.min + Math.floor(Math.random() * (wild.max - wild.min + 1))
      game.world.held = []
      game.startWild(sp2, lv, {})
    }
  }
}

game.talkNpc = async (npc) => {
  const p = game.world.p
  npc.dir = { up: 'down', down: 'up', left: 'right', right: 'left' }[p.dir] || npc.dir
  if (npc.action) return npcService(npc)
  if (npc.trainer && !game.save.beaten[npc.id]) {
    if (!game.save.party.some((m) => m.hp > 0)) { await say(['你的精灵都没有体力了，先去精灵驿站休息一下吧。'], npc.name); return }
    await say(npc.lines, npc.name)
    return game.startTrainer(npc)
  }
  await say(npc.trainer ? npc.after : npc.lines, npc.name)
}

async function npcService(npc) {
  const s = game.save
  if (npc.action === 'heal' || npc.action === 'home') {
    s.party.forEach(healMon)
    if (npc.action === 'heal') s.respawn = { map: game.world.map.id, x: npc.x, y: npc.y + 2 }
    updateHud()
    game.saveSoon()
    await say(npc.lines, npc.name)
  } else if (npc.action === 'shop') {
    await say(npc.lines, npc.name)
    openShop(game)
  }
}

// 进门：有室内地图就走进去（从出口地垫上方一格进入、面朝上），否则用旧的对话方式
game.enterBuilding = async (b) => {
  const s = game.save
  const inside = b.interior && MAPS[b.interior]
  if (inside) {
    game.world.held = []
    game.warp(inside.id, inside.entry.x, inside.entry.y, 'up')
    return
  }
  if (b.action === 'heal' || b.action === 'home') {
    s.party.forEach(healMon)
    if (b.action === 'heal') s.respawn = { map: game.world.map.id, x: b.door[0], y: b.door[1] + 1 }
    updateHud()
    game.saveSoon()
    await say(b.action === 'heal'
      ? ['欢迎来到精灵驿站！', '我来帮你的精灵们恢复体力……', '♪ ♪ ♪', '你的精灵都恢复健康了！欢迎再来！']
      : ['妈妈：回来啦？先好好休息一下吧。', '（队伍全部恢复了健康）'], b.action === 'heal' ? '驿站护士' : '妈妈')
  } else if (b.action === 'shop') openShop(game)
  else await say(b.lines || ['……'], b.label)
}

// —— 稀有精灵（全服共享）——
game.spawnsOn = (mapId) => {
  const out = []
  const now = Date.now()
  game.net?.spawns.forEach((s) => { if (s.map === mapId && s.exp > now) out.push(s) })
  return out
}
game.spawnAt = (mapId, x, y) => game.spawnsOn(mapId).find((s) => s.x === x && s.y === y)

game.engageSpawn = async (s) => {
  if (game.isBusy()) return
  if (!game.save.party.some((m) => m.hp > 0)) { toast('你的精灵都没有体力了，先去精灵驿站吧！'); return }
  const sp = game.net.spawns
  const cur = sp.get(s.id)
  if (!cur) return
  if (cur.by && cur.by !== game.signer.pubkey && Date.now() - cur.byT < 90000) {
    toast(`<b>${escapeHtml(cur.byName)}</b> 正在挑战这只 ${SPECIES[cur.sp].name}！`)
    return
  }
  game.lock = true
  game.world.held = []
  sp.set(s.id, { ...cur, by: game.signer.pubkey, byName: game.save.name, byT: Date.now() })
  await sleep(450)
  const again = sp.get(s.id)
  game.lock = false
  if (!again || again.by !== game.signer.pubkey) { toast('被别的训练家抢先了一步！'); return }
  game.startWild(again.sp, again.lv, { shiny: again.shiny, spawn: again })
}

// 可见的野生精灵（3D 版）：由 Wilds 模块确定性计算位置，交战时通过 awareness 占用
game.engageWild = async (w) => {
  if (game.isBusy() || !game.wilds) return
  if (!game.save.party.some((m) => m.hp > 0)) { toast('你的精灵都没有体力了，先去精灵驿站吧！'); return }
  game.lock = true
  game.world.held = []
  let ok = false
  try { ok = await game.wilds.engage(w) } finally { game.lock = false }
  if (!ok) { toast(`这只 ${SPECIES[w.sp].name} 正在和别的训练家战斗！`); return }
  await game.startWild(w.sp, w.lv, { shiny: !!w.shiny, wild: w })
}

function spawnTick() {
  const net = game.net
  if (!net.synced || !net.isAuthority()) return
  net.cleanup()
  net.trimChat()
  const now = Date.now()
  let active = 0
  net.spawns.forEach((s) => { if (s.exp > now) active++ })
  if (active >= 3 || Math.random() > 0.55) return
  const maps = Object.values(MAPS).filter((m) => m.spawn)
  const m = maps[Math.floor(Math.random() * maps.length)]
  const [x, y] = m.grassTiles[Math.floor(Math.random() * m.grassTiles.length)]
  const [sp, , min, max] = pickWeighted(RARE_SPAWNS)
  const id = randId(10)
  net.spawns.set(id, { id, map: m.id, x, y, sp, lv: min + Math.floor(Math.random() * (max - min + 1)), shiny: Math.random() < 0.12, ts: now, exp: now + 4 * 60 * 1000, by: null })
}

// —— 战斗 ——
function awardXp(foeSnap, mySnap, trainer) {
  const pm = game.partyMon(mySnap.uid)
  if (!pm) return []
  pm.hp = mySnap.hp
  const lines = gainXp(pm, xpYield(foeSnap, trainer))
  const st = statsOf(pm)
  Object.assign(mySnap, { lv: pm.lv, maxHp: st.maxHp, atk: st.atk, def: st.def, spd: st.spd, hp: pm.hp, moves: [...pm.moves] })
  return lines
}

game.useItem = (k) => { game.save.bag[k] = Math.max(0, (game.save.bag[k] || 0) - 1) }

function beginBattle() {
  game.world.setPaused?.(true)
  game.world.held = []
  game.world.path = null
  game.net.setPresence({ busy: 'battle' })
}
async function endBattle() {
  updateHud()
  await runEvolutions(game)
  game.battleUI.close()
  game.world.setPaused?.(false)
  game.net.setPresence({ busy: null })
  game.refreshPresence()
  game.saveNow()
}

async function blackout() {
  const s = game.save
  const lost = Math.floor(s.coins * 0.1)
  s.coins -= lost
  await game.battleUI.msg('你的精灵全部倒下了……', 1200)
  await game.battleUI.msg(`你慌忙跑回了精灵驿站。（遗失了 ${lost} 金币）`, 1500)
  s.party.forEach(healMon)
  const r = s.respawn
  game.world.loadMap(r.map, r.x, r.y, 'down')
  s.pos = { map: r.map, x: r.x, y: r.y, dir: 'down' }
  game.world.sendPresence()
}

game.startWild = async (sp, lv, { shiny, spawn, wild: wildRef } = {}) => {
  const s = game.save
  s.dex.seen[sp] = true
  const wild = createMon(sp, lv, { shiny })
  const seed = randId(12)
  const state = createBattle({
    kind: 'wild', seed,
    sides: [{ name: s.name, team: s.party.map((m) => snapshot(m)) }, { name: '野生', team: [snapshot(wild)] }],
  })
  beginBattle()
  const bg = game.world.map.battleBg
  const res = await game.battleUI.run({
    kind: 'wild', state, me: 0, seed, bg,
    intro: [spawn ? `${wild.shiny ? '闪闪发光的' : '稀有的'} ${SPECIES[sp].name} 出现了！` : `野生的 ${SPECIES[sp].name} 出现了！`],
    getFoeAction: (st) => aiPickMove(st, 1),
    onFoeFaint: (foe, mine) => awardXp(foe, mine, false),
  })
  for (const snap of state.sides[0].team) { const pm = game.partyMon(snap.uid); if (pm) pm.hp = snap.hp }
  const net = game.net
  if (res.reason === 'caught') {
    const caught = { ...wild, hp: state.sides[1].team[0].hp, ot: game.signer.pubkey, caughtAt: Date.now() }
    s.dex.caught[sp] = true
    s.stats.caught++
    if (s.party.length < 6) { s.party.push(caught); await game.battleUI.msg(`${SPECIES[sp].name} 加入了你的队伍！`) }
    else { s.box.push(caught); await game.battleUI.msg(`队伍已满，${SPECIES[sp].name} 被传送到了仓库。`) }
    if (wildRef) game.wilds?.markGone(wildRef.id, 'caught')
    if (spawn) {
      net.spawns.delete(spawn.id)
      net.sendChat(`✦ 收服了稀有的 ${wild.shiny ? '闪光' : ''}${SPECIES[sp].name}（Lv.${lv}）！`, game.world.map.id, s.name).catch(() => {})
    }
  } else {
    if (wildRef) {
      if (res.reason === 'ko' && res.winner === 0) game.wilds?.markGone(wildRef.id, 'ko')
      else game.wilds?.release(wildRef.id)
    }
    if (spawn) {
      const cur = net.spawns.get(spawn.id)
      if (cur && cur.by === game.signer.pubkey) net.spawns.set(spawn.id, { ...cur, by: null })
    }
    if (res.winner === 1) await blackout()
  }
  await endBattle()
}

game.startTrainer = async (npc) => {
  const s = game.save
  const team = npc.trainer.team.map(([sp, lv]) => createMon(sp, lv, { shiny: false }))
  team.forEach((m) => (s.dex.seen[m.sp] = true))
  const seed = randId(12)
  const state = createBattle({
    kind: 'trainer', seed,
    sides: [{ name: s.name, team: s.party.map((m) => snapshot(m)) }, { name: npc.name, team: team.map((m) => snapshot(m)) }],
  })
  beginBattle()
  const res = await game.battleUI.run({
    kind: 'trainer', state, me: 0, seed, bg: game.world.map.battleBg,
    intro: [`${npc.name} 想要对战！`, `${npc.name} 派出了 ${SPECIES[team[0].sp].name}！`],
    getFoeAction: (st) => {
      const side = st.sides[1]
      if (activeMon(st, 1).hp <= 0) return { t: 'switch', i: side.team.findIndex((m) => m.hp > 0) }
      return aiPickMove(st, 1)
    },
    onFoeFaint: (foe, mine) => awardXp(foe, mine, true),
  })
  for (const snap of state.sides[0].team) { const pm = game.partyMon(snap.uid); if (pm) pm.hp = snap.hp }
  if (res.winner === 0) {
    s.beaten[npc.id] = true
    s.coins += npc.trainer.reward
    await game.battleUI.msg(`你战胜了 ${npc.name}！`)
    await game.battleUI.msg(`获得了 ${npc.trainer.reward} 金币作为奖励。`)
    await endBattle()
    await say(npc.after, npc.name)
  } else {
    await blackout()
    await endBattle()
  }
}

// —— PvP：邀请 / 接受 / 确定性回放 ——
const pvpSnapshots = () => game.save.party.slice(0, PVP_TEAM).map((m) => snapshot(m, true))

game.challenge = (p0) => {
  const s = game.save
  if (!s.party.length) { toast('你还没有精灵！'); return }
  // 名片可能是几分钟前打开的：对方刷新页面后连接 ID 会变，发送前按公钥重新找到当前在线的那个连接
  const online = game.net.players()
  const p = online.find((x) => x.pk === p0.pk && x.cid === p0.cid) || online.find((x) => x.pk === p0.pk)
  if (!p) { toast(`${escapeHtml(p0.name || '对方')} 已经离线了。`); return }
  if (p.busy) { toast(`${escapeHtml(p.name)} 正在战斗中`); return }
  const id = randId(10)
  const c = {
    id, from: game.signer.pubkey, fromCid: game.net.cid, fromName: s.name,
    to: p.pk, toCid: p.cid, toName: p.name, status: 'pending', ts: Date.now(), team: pvpSnapshots(),
  }
  game.net.challenges.set(id, c)
  game.pendingChallenge = id
  const m = openModal(`<h2>发起对战</h2><p>已向 <b>${escapeHtml(p.name)}</b> 发出挑战，等待对方回应……</p>
    <p class="sub">规则：双方各派出队伍前 ${PVP_TEAM} 只精灵，状态全满。行动经 Yjs 同步，结果由双方本地确定性计算。</p>
    <div class="actions"><button class="btn" id="ch-cancel">取消挑战</button></div>`, { dismissable: false })
  m.querySelector('#ch-cancel').onclick = () => {
    const cur = game.net.challenges.get(id)
    if (cur?.status === 'pending') game.net.challenges.set(id, { ...cur, status: 'cancelled' })
    game.pendingChallenge = null
    closeModal(true)
  }
  setTimeout(() => {
    const cur = game.net.challenges.get(id)
    if (cur?.status === 'pending') game.net.challenges.set(id, { ...cur, status: 'expired' })
  }, CHALLENGE_MS)
}

// 页面在后台时闪烁标题，免得错过邀请
function attention(text) {
  if (!document.hidden) return
  const orig = document.title
  let on = false
  const iv = setInterval(() => { document.title = (on = !on) ? text : orig }, 900)
  const stop = () => { clearInterval(iv); document.title = orig; removeEventListener('visibilitychange', stop) }
  addEventListener('visibilitychange', stop)
}

const CHALLENGE_MS = 45000
const seenChallenge = new Set()
const inviteToasts = new Map()
function onChallenge(c) {
  // 时间窗口放宽到 2 分钟以容忍设备间的时钟误差；过期邀请由发起方主动标记 expired
  if (!c || seenChallenge.has(c.id + c.status) || Math.abs(Date.now() - c.ts) > 120000) return
  seenChallenge.add(c.id + c.status)
  const me = game.signer.pubkey, cid = game.net.cid
  // 同一个账号可能同时开着好几个标签页：邀请发给该公钥的所有页面，任一页面响应后其他页面的提示自动消失
  if (c.status !== 'pending') { inviteToasts.get(c.id)?.remove(); inviteToasts.delete(c.id) }
  const forMe = c.to === me
  if (forMe && c.status === 'pending') {
    // 正在战斗的页面不弹提示，交给同账号的其他页面；都没人响应时由发起方标记过期
    if (game.battleUI.open || !game.save.party.length) return
    game.sys(`⚔ ${c.fromName} 向你发起了对战！`)
    attention('⚔ 对战邀请！')
    inviteToasts.set(c.id, toast(`⚔ <b>${escapeHtml(c.fromName)}</b> 向你发起了对战！<br><span class="sub">双方各出前 ${PVP_TEAM} 只，状态全满</span>`, {
      tone: 'gold', timeout: CHALLENGE_MS - 2000,
      actions: [
        { label: '接受', cls: 'primary', onClick: () => acceptChallenge(c.id) },
        { label: '拒绝', onClick: () => { const cur = game.net.challenges.get(c.id); if (cur?.status === 'pending') game.net.challenges.set(c.id, { ...cur, status: 'declined' }) } },
      ],
    }))
  }
  if (c.from === me && c.fromCid === cid && c.id === game.pendingChallenge && c.status !== 'pending') {
    game.pendingChallenge = null
    closeModal(true)
    if (c.status === 'accepted') startPvp(c.battleId, 0)
    else if (c.status === 'declined') toast(`${escapeHtml(c.toName)} 拒绝了你的挑战。`)
    else if (c.status === 'busy') toast(`${escapeHtml(c.toName)} 正忙，稍后再试吧。`)
    else if (c.status === 'expired') toast(`${escapeHtml(c.toName)} 没有回应。`)
  }
}

function acceptChallenge(id) {
  const net = game.net
  const c = net.challenges.get(id)
  if (!c || c.status !== 'pending') { toast('这个挑战已经失效了。'); return }
  if (game.battleUI.open) { toast('你正在战斗中。'); return }
  closeModal(true)
  const bid = 'b_' + randId(10)
  const meta = {
    id: bid, seed: randId(16), ts: Date.now(),
    sides: [
      { pk: c.from, cid: c.fromCid, name: c.fromName, team: c.team },
      { pk: game.signer.pubkey, cid: net.cid, name: game.save.name, team: pvpSnapshots() },
    ],
  }
  net.doc.transact(() => {
    const bm = new Y.Map()
    net.battles.set(bid, bm)
    bm.set('meta', meta)
    bm.set('actions', new Y.Map())
    net.challenges.set(id, { ...c, status: 'accepted', battleId: bid })
  })
  startPvp(bid, 1)
}

function waitAction(actions, key, foeSide, foeCid, signal) {
  return new Promise((resolve) => {
    let done = false, gone = 0, waited = 0
    const finish = (a) => {
      if (done) return
      done = true
      actions.unobserve(check)
      clearInterval(iv)
      resolve(a)
    }
    function check() {
      const a = actions.get(key)
      if (a) return finish(a)
      for (const [k, v] of actions.entries()) if (k.endsWith(':' + foeSide) && v?.t === 'forfeit') return finish(v)
    }
    const iv = setInterval(() => {
      waited++
      gone = game.net.awareness.getStates().has(foeCid) ? 0 : gone + 1
      if (gone >= 20 || waited >= 100) finish({ t: 'forfeit', timeout: true })
    }, 1000)
    signal.addEventListener('abort', () => finish(null))
    actions.observe(check)
    check()
  })
}

async function startPvp(bid, me) {
  const net = game.net
  let bm = net.battles.get(bid)
  for (let i = 0; !bm?.get('actions') && i < 50; i++) { await sleep(100); bm = net.battles.get(bid) }
  if (!bm) { toast('对战数据同步失败。'); return }
  closeModal(true)
  const meta = bm.get('meta')
  const actions = bm.get('actions')
  const foe = meta.sides[1 - me]
  const state = createBattle({ kind: 'pvp', seed: meta.seed, sides: meta.sides.map((s) => ({ name: s.name, pk: s.pk, team: s.team })) })
  beginBattle()
  game.sys(`⚔ 与 ${foe.name} 的对战开始了！`)
  const res = await game.battleUI.run({
    kind: 'pvp', state, me, seed: meta.seed, bg: 'arena',
    intro: [`与 ${foe.name} 的对战开始了！`, `${foe.name} 派出了 ${SPECIES[foe.team[0].sp].name}！`],
    send: (turn, a) => actions.set(`${turn}:${me}`, a),
    getFoeAction: (st, turn, signal) => waitAction(actions, `${turn}:${1 - me}`, 1 - me, foe.cid, signal),
  })
  const s = game.save
  const won = res.winner === me
  if (won) {
    s.stats.pvpW++
    s.coins += 200
    await game.battleUI.msg(`你战胜了 ${foe.name}！获得 200 金币。`)
    net.sendChat(`⚔ 在对战中战胜了 ${foe.name}！`, game.world.map.id, s.name).catch(() => {})
  } else {
    s.stats.pvpL++
    s.coins += 50
    await game.battleUI.msg(`你输给了 ${foe.name}……获得 50 金币参与奖。`)
  }
  await endBattle()
}

// —— 赠礼 ——
function onGifts() {
  const me = game.signer.pubkey
  const claimed = (game.save.claimedGifts ||= [])
  game.net.gifts.forEach((g, k) => {
    if (g.to !== me) return
    game.net.gifts.delete(k)
    // 中继可能回滚到旧快照，已领取过的礼物会“复活”：按 id 去重，并忽略一天前的礼物
    if (claimed.includes(g.id || k) || Date.now() - (g.ts || 0) > 86400000) return
    claimed.push(g.id || k)
    if (claimed.length > 100) claimed.splice(0, claimed.length - 100)
    game.save.bag[g.item] = (game.save.bag[g.item] || 0) + g.n
    toast(`🎁 收到 <b>${escapeHtml(g.fromName)}</b> 赠送的 ${ITEMS[g.item]?.name || g.item} ×${g.n}！`, { tone: 'gold' })
    game.sys(`🎁 收到 ${g.fromName} 赠送的 ${ITEMS[g.item]?.name} ×${g.n}`)
    game.saveSoon()
  })
}
game.gift = (p, item) => {
  const s = game.save
  if (!(s.bag[item] > 0)) { toast(`你没有 ${ITEMS[item].name} 了。`); return }
  s.bag[item]--
  const id = randId(10)
  game.net.gifts.set(id, { id, to: p.pk, from: game.signer.pubkey, fromName: s.name, item, n: 1, ts: Date.now() })
  toast(`已把 ${ITEMS[item].name} 送给了 ${escapeHtml(p.name)}。`)
  game.saveSoon()
}
game.openPlayer = (p) => openPlayerCard(game, p)

// —— 触屏 ——
function setupTouch() {
  document.querySelectorAll('#touch [data-dir]').forEach((b) => {
    const d = b.dataset.dir
    const on = (e) => { e.preventDefault(); game.world.press(d, true) }
    const off = () => game.world.press(d, false)
    b.addEventListener('pointerdown', on)
    b.addEventListener('pointerup', off)
    b.addEventListener('pointerleave', off)
    b.addEventListener('pointercancel', off)
  })
  $('btn-a').addEventListener('pointerdown', (e) => {
    e.preventDefault()
    if (dialogOpen()) dialogKey()
    else if (game.battleUI.open) game.battleUI.skip?.()
    else game.world.interact()
  })
  const b = $('btn-b')
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); game.world.running = true })
  b.addEventListener('pointerup', () => (game.world.running = false))
  b.addEventListener('pointerleave', () => (game.world.running = false))
}

// —— 启动 ——
// opts: { World, BattleUI, Wilds?, setupControls?, randomEncounters?, mode?: '2d'|'3d', helpLine? }
export function startGame(opts) {
  OPTS = opts
  game.mode = opts.mode || '2d'
  return boot().catch((e) => {
    console.error(e)
    step('启动失败：' + e.message).fail()
  })
}

async function boot() {
  const s1 = step('读取 Nostr 身份…')
  const signer = await nostr.initIdentity()
  game.signer = signer
  s1.done(signer.created ? `已自动创建 Nostr 账户 ${shortKey(signer.npub)}` : `Nostr 身份 ${shortKey(signer.npub)}`)

  const s2 = step(`连接 Yjs 世界（${YJS_PRESET}）…`)
  const net = new Net(signer)
  game.net = net
  net.onStatus = updateNetPill
  const syncP = new Promise((r) => { if (net.synced) r(true); else net.provider.once('sync', () => r(true)); setTimeout(() => r(false), 8000) })

  const s3 = step('从 Nostr relay 读取存档…')
  let remote = null
  try { remote = await nostr.loadSave(signer.pubkey) } catch (e) { console.warn(e) }
  const local = lsGet('save:' + signer.pubkey)
  let save = null
  if (remote && (!local || (remote.save.updatedAt || 0) >= (local.updatedAt || 0))) { save = remote.save; s3.done('已从 Nostr 恢复存档') }
  else if (local) { save = local; s3.done(remote ? '使用较新的本地存档' : '使用本地存档（relay 上暂无）') }
  else s3.done('新的冒险开始！')
  game.save = normalizeSave(save, signer.pubkey)
  game.wilds = OPTS.Wilds ? new OPTS.Wilds(game) : null
  nostr.probeRelays().then(() => updateNostrPill())
  updateNostrPill()

  const synced = await syncP
  if (synced) s2.done(`已连接 ${YJS_RELAY.url.replace('wss://', '')}/${WORLD_ROOM}`)
  else s2.fail('Yjs 连接较慢，稍后会自动重试')

  // 大地图
  game.battleUI = new OPTS.BattleUI(game)
  game.world = new OPTS.World(game, $('world'))
  const pos = game.save.pos
  const map = MAPS[pos.map]
  const okPos = pos.x >= 0 && pos.y >= 0 && pos.x < map.w && pos.y < map.h && !map.solid[pos.y * map.w + pos.x] && !map.warps.some((w) => pos.x >= w.x && pos.x < w.x + w.w && pos.y >= w.y && pos.y < w.y + w.h)
  if (okPos) game.world.loadMap(pos.map, pos.x, pos.y, pos.dir || 'down')
  else game.world.loadMap('town', MAPS.town.start.x, MAPS.town.start.y, 'down')
  const p = game.world.p
  await net.initPresence({ name: game.save.name, look: game.save.look, lead: game.leadInfo(), map: game.world.map.id, x: p.x, y: p.y, dir: p.dir, busy: null, client: game.mode })

  setupChat()

  // 实时事件
  let histDone = false
  net.chat.observe((ev) => {
    const added = []
    ev.changes.added.forEach((item) => item.content.getContent().forEach((c) => added.push(c)))
    const hist = !histDone && added.length > 3
    ;(hist ? added.slice(-30) : added).forEach((e) => renderChatEvent(e, hist))
    histDone = true
  })
  if (net.chat.length) { net.chat.toArray().slice(-30).forEach((e) => renderChatEvent(e, true)); histDone = true }
  net.challenges.observe((ev) => ev.keysChanged.forEach((k) => onChallenge(net.challenges.get(k))))
  net.gifts.observe(onGifts)
  onGifts()
  net.spawns.observe((ev) => {
    ev.changes.keys.forEach((chg, k) => {
      if (chg.action !== 'add') return
      const s = net.spawns.get(k)
      if (!s || Date.now() - s.ts > 15000) return
      const txt = `✦ 稀有的 ${s.shiny ? '闪光' : ''}${SPECIES[s.sp].name}（Lv.${s.lv}）出现在了 ${MAPS[s.map].name}！`
      game.sys(txt)
      toast(escapeHtml(txt), { tone: 'gold' })
    })
  })
  const names = new Map()
  const lastEmote = new Map()
  net.awareness.on('change', ({ added, removed }) => {
    const states = net.awareness.getStates()
    for (const cid of added) {
      const st = states.get(cid)
      if (st?.pk && cid !== net.cid && Date.now() - game.bootAt > 5000) game.sys(`${st.name || '训练家'} 进入了 ${MAPS[st.map]?.name || '世界'}`)
    }
    for (const cid of removed) if (names.has(cid)) { game.sys(`${names.get(cid)} 离开了`); names.delete(cid) }
    states.forEach((st, cid) => {
      if (!st?.pk) return
      names.set(cid, st.name || '训练家')
      if (st.emote && cid !== net.cid && lastEmote.get(cid) !== st.emote.n) {
        if (lastEmote.has(cid) || Date.now() - game.bootAt > 3000) game.emotes.set(cid, { e: st.emote.e, t: Date.now() })
        lastEmote.set(cid, st.emote.n)
      }
    })
    updateNetPill()
  })
  net.onSync = updateNetPill
  setInterval(spawnTick, 12000)
  setInterval(() => { if (dirty && !saving) game.saveNow() }, 45000)
  setInterval(() => { updateNetPill(); updateNostrPill(saving ? 'saving' : undefined) }, 3000)
  addEventListener('beforeunload', persistLocal)

  // 界面
  ;(OPTS.setupControls || setupTouch)(game)
  $('menu-btn').onclick = () => !game.battleUI.open && openMenu(game, 'party')
  if ($('map-btn')) $('map-btn').onclick = () => !game.battleUI.open && openMenu(game, 'map')
  $('me-chip').onclick = () => !game.battleUI.open && openMenu(game, 'account')
  $('online-btn').onclick = () => !game.battleUI.open && openOnline(game)
  $('coins').onclick = () => !game.battleUI.open && openMenu(game, 'bag')
  updateHud()
  updateNetPill()
  await document.fonts?.ready
  $('loading').remove()
  unread = 0
  $('chat-toggle').textContent = '聊天'
  game.ready = true
  banner(game.world.map.name)
  game.sys(`欢迎来到 Nostrmon！你的身份：${shortKey(signer.npub)}`)
  game.sys(OPTS.helpLine || '方向键/WASD 移动 · Shift 奔跑 · 空格 互动 · Enter 聊天 · Esc 菜单 · N 地图传送')

  if (!game.save.party.length) {
    await openStarter(game)
    if (signer.generated) nostr.publishProfile(signer, game.save.name).catch(() => {})
  }
}

export { game }
