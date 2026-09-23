// 菜单与弹窗：队伍 / 背包 / 图鉴 / 排行榜 / 训练家 / 帮助 / 商店 / 玩家名片 / 初始精灵 / 进化
import { SPECIES, SPECIES_LIST, STARTERS } from './data/species.js'
import { MOVES } from './data/moves.js'
import { TYPES } from './data/types.js'
import { MAPS } from './data/maps.js'
import { createMon, statsOf, monName, xpProgress, canEvolve, evolve } from './mon.js'
import { ITEMS } from './battleUI.js'
import * as nostr from './nostr.js'
import { YJS_PRESET, YJS_RELAY, WORLD_ROOM, NOSTR_RELAYS, PROFILE } from './config.js'
import { $, say, toast, openModal, closeModal, confirmBox, monCard, paintCanvases, typeBadges } from './ui.js'
import { monSprite, ballSprite, trainerSprite, SKIN, HAIR, SHIRT, PANTS, HATC } from './render/sprites.js'
import { escapeHtml, shortKey, timeAgo, sleep } from './util.js'

const TABS = [['party', '队伍'], ['bag', '背包'], ['dex', '图鉴'], ['rank', '排行榜'], ['account', '训练家'], ['help', '玩法']]

export function renderPartyBar(game) {
  const bar = $('party-bar')
  bar.innerHTML = game.save.party.map((m, i) => {
    const s = statsOf(m)
    const f = Math.max(0, m.hp / s.maxHp)
    return `<button class="pslot ${m.hp <= 0 ? 'fainted' : ''}" data-i="${i}" title="${escapeHtml(monName(m))} HP ${m.hp}/${s.maxHp}">
      <canvas data-sp="${m.sp}" data-shiny="${m.shiny ? 1 : 0}"></canvas>
      <span class="lv">Lv${m.lv}</span>
      <span class="hp"><i class="${f > 0.5 ? '' : f > 0.2 ? 'mid' : 'low'}" style="width:${f * 100}%"></i></span></button>`
  }).join('')
  paintCanvases(bar)
  bar.querySelectorAll('.pslot').forEach((b) => (b.onclick = () => !game.battleUI.open && openMenu(game, 'party')))
}

export function openMenu(game, tab = 'party') {
  const m = openModal(`
    <div class="mhead"><h2>菜单</h2><button class="close" data-close aria-label="关闭">✕</button></div>
    <div class="tabs">${TABS.map(([k, n]) => `<button class="btn ${k === tab ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="tab-body"></div>`, { onClose: () => game.updateHud() })
  const show = (k) => {
    m.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === k))
    const body = m.querySelector('#tab-body')
    ;({ party: renderParty, bag: renderBag, dex: renderDex, rank: renderRank, account: renderAccount, help: renderHelp })[k](game, body)
  }
  m.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)))
  show(tab)
}

// —— 队伍 ——
function renderParty(game, el, selUid) {
  const s = game.save
  el.innerHTML = `
    <p class="sub">队伍 ${s.party.length}/6 · 第一只会跟在你身后，所有人都看得到。</p>
    <div class="monlist" id="plist">${s.party.map((m, i) => monCard(m, { button: true, idx: i, extra: i === 0 ? '<span class="type" style="background:var(--ink)">首发</span>' : '' })).join('')}</div>
    <div id="pdetail"></div>
    <h3>仓库 <span class="sub">${s.box.length} 只</span></h3>
    <div class="monlist" id="blist">${s.box.length ? s.box.map((m, i) => monCard(m, { button: true, idx: i })).join('') : '<p class="sub">仓库是空的。队伍满 6 只后新收服的精灵会放到这里。</p>'}</div>`
  paintCanvases(el)
  el.querySelectorAll('#plist .moncard').forEach((b) => (b.onclick = () => detail('party', +b.dataset.idx)))
  el.querySelectorAll('#blist .moncard').forEach((b) => (b.onclick = () => detail('box', +b.dataset.idx)))
  if (selUid) {
    const i = s.party.findIndex((m) => m.uid === selUid)
    if (i >= 0) detail('party', i)
  }
  function detail(where, i) {
    const list = where === 'party' ? s.party : s.box
    const m = list[i]
    const st = statsOf(m)
    el.querySelectorAll('.moncard').forEach((c) => c.classList.remove('sel'))
    el.querySelector(`#${where === 'party' ? 'plist' : 'blist'} [data-idx="${i}"]`)?.classList.add('sel')
    const d = el.querySelector('#pdetail')
    d.innerHTML = `<div class="panel" style="padding:12px 14px;margin-top:10px;box-shadow:none">
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <canvas data-sp="${m.sp}" data-shiny="${m.shiny ? 1 : 0}" style="width:96px;height:96px;image-rendering:pixelated"></canvas>
        <div style="flex:1;min-width:180px">
          <div class="nm" style="font-family:var(--display);font-size:22px">${escapeHtml(monName(m))} <span class="mono" style="font-size:13px">Lv.${m.lv}</span></div>
          <div class="meta">${typeBadges(m.sp)} <span class="sub">No.${String(SPECIES[m.sp].no).padStart(3, '0')} ${SPECIES[m.sp].name}${m.shiny ? ' · <span class="shiny">闪光</span>' : ''}</span></div>
          <div class="sub mono" style="margin-top:4px">HP ${m.hp}/${st.maxHp} · 攻 ${st.atk} · 防 ${st.def} · 速 ${st.spd}</div>
          <div class="xp" style="height:5px;background:#d7dbe6;border-radius:3px;margin-top:4px;overflow:hidden"><i style="display:block;height:100%;width:${xpProgress(m) * 100}%;background:var(--sky)"></i></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px">${m.moves.map((id) => `<div style="border:2px solid var(--ink);border-left:8px solid ${TYPES[MOVES[id].type].color};border-radius:8px;padding:3px 8px;background:#fff"><b>${MOVES[id].name}</b><div class="sub mono" style="font-size:10px">${TYPES[MOVES[id].type].name} · ${MOVES[id].power || '—'} · ${MOVES[id].acc}%</div></div>`).join('')}</div>
      <div class="field" style="margin-top:10px"><label for="nick">昵称</label><div style="display:flex;gap:6px"><input id="nick" maxlength="8" value="${escapeHtml(m.nick || '')}" placeholder="${SPECIES[m.sp].name}"><button class="btn small" id="nick-save">保存</button></div></div>
      <div class="actions">
        ${where === 'party' && i > 0 ? '<button class="btn gold" id="to-lead">设为首发</button>' : ''}
        ${where === 'party' && s.party.length > 1 ? '<button class="btn" id="to-box">存入仓库</button>' : ''}
        ${where === 'box' ? `<button class="btn primary" id="to-party" ${s.party.length >= 6 ? 'disabled' : ''}>加入队伍</button>` : ''}
      </div>
      <p class="sub" style="margin-top:8px">${escapeHtml(SPECIES[m.sp].desc)}</p></div>`
    paintCanvases(d)
    const done = (uid) => { game.refreshPresence(); game.saveSoon(); renderParty(game, el, uid) }
    d.querySelector('#nick-save').onclick = () => { m.nick = d.querySelector('#nick').value.trim() || null; done(m.uid) }
    d.querySelector('#to-lead')?.addEventListener('click', () => { s.party.splice(i, 1); s.party.unshift(m); done(m.uid) })
    d.querySelector('#to-box')?.addEventListener('click', () => { s.party.splice(i, 1); s.box.push(m); done() })
    d.querySelector('#to-party')?.addEventListener('click', () => { s.box.splice(i, 1); s.party.push(m); done(m.uid) })
  }
}

// —— 背包 ——
function renderBag(game, el) {
  const s = game.save
  const rows = Object.entries(ITEMS).map(([k, it]) => {
    const n = s.bag[k] || 0
    return `<div class="shoprow"><canvas data-item="${k}"></canvas><div><b>${it.name}</b><div class="sub">${it.desc}</div></div><span class="mono">×${n}</span>
      <span>${it.kind === 'potion' && n > 0 ? `<button class="btn small" data-use="${k}">使用</button>` : ''}</span></div>`
  }).join('')
  el.innerHTML = `<p class="sub">金币：<b class="mono">${s.coins}</b> · 商店在新叶镇和晨风村。</p>${rows}<div id="use-target"></div>`
  paintItems(el)
  el.querySelectorAll('[data-use]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.use
    const t = el.querySelector('#use-target')
    t.innerHTML = `<h3>给谁使用 ${ITEMS[k].name}？</h3><div class="monlist">${s.party.map((m, i) => monCard(m, { button: true, idx: i })).join('')}</div>`
    paintCanvases(t)
    t.querySelectorAll('.moncard').forEach((c) => (c.onclick = () => {
      const m = s.party[+c.dataset.idx]
      const max = statsOf(m).maxHp
      if (m.hp <= 0) { toast('倒下的精灵需要去精灵驿站治疗。'); return }
      if (m.hp >= max) { toast(`${escapeHtml(monName(m))} 的体力是满的。`); return }
      const amt = Math.min(max - m.hp, { potion: 20, super: 60, full: 9999 }[k])
      m.hp += amt
      s.bag[k]--
      toast(`${escapeHtml(monName(m))} 恢复了 ${amt} HP。`)
      game.saveSoon()
      renderBag(game, el)
    }))
  }))
}

function paintItems(root) {
  root.querySelectorAll('canvas[data-item]').forEach((cv) => {
    const k = cv.dataset.item
    cv.width = 16; cv.height = 16
    const ctx = cv.getContext('2d')
    if (ITEMS[k].kind === 'ball') ctx.drawImage(ballSprite(k, 16), 0, 0)
    else {
      const c = { potion: '#ef476f', super: '#8e5cf7', full: '#ffc43d' }[k]
      ctx.fillStyle = '#1c1a2e'; ctx.fillRect(5, 1, 6, 14); ctx.fillRect(3, 5, 10, 10)
      ctx.fillStyle = '#e8eef8'; ctx.fillRect(6, 2, 4, 3)
      ctx.fillStyle = c; ctx.fillRect(4, 6, 8, 8)
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillRect(5, 7, 2, 3)
    }
  })
}

// —— 图鉴 ——
function renderDex(game, el) {
  const d = game.save.dex
  const caught = Object.keys(d.caught).length
  const seen = new Set([...Object.keys(d.seen), ...Object.keys(d.caught)]).size
  el.innerHTML = `<p class="sub">已收服 <b class="mono">${caught}</b> / ${SPECIES_LIST.length} · 已见过 <b class="mono">${seen}</b></p>
    <div class="dexgrid">${SPECIES_LIST.map((s) => {
      const known = d.seen[s.id] || d.caught[s.id]
      return `<button class="dexcell ${known ? '' : 'unseen'}" data-sp="${s.id}"><canvas data-sp="${s.id}"></canvas><div class="no">No.${String(s.no).padStart(3, '0')}</div><div>${known ? (d.caught[s.id] ? '★ ' : '') + s.name : '？？？'}</div></button>`
    }).join('')}</div><div id="dex-info"></div>`
  paintCanvases(el)
  el.querySelectorAll('.dexcell').forEach((b) => (b.onclick = () => {
    const s = SPECIES[b.dataset.sp]
    const known = d.seen[b.dataset.sp] || d.caught[b.dataset.sp]
    el.querySelector('#dex-info').innerHTML = known
      ? `<div class="panel" style="padding:10px 14px;margin-top:10px;box-shadow:none"><b style="font-family:var(--display);font-size:20px">${s.name}</b> ${typeBadges(b.dataset.sp)}<p class="sub">${s.desc}</p></div>`
      : '<p class="sub" style="margin-top:10px">还没有遇到过这只精灵。</p>'
  }))
}

// —— 排行榜（直接从 Nostr relay 读取所有玩家的存档事件）——
async function renderRank(game, el) {
  el.innerHTML = `<p class="sub">正在从 ${NOSTR_RELAYS.length} 个 Nostr relay 读取所有训练家的存档…</p>`
  let rows = []
  try { rows = await nostr.fetchLeaderboard() } catch (e) { el.innerHTML = `<p class="warnbox">读取失败：${escapeHtml(e.message)}</p>`; return }
  if (!el.isConnected) return
  const me = game.signer.pubkey
  el.innerHTML = `<p class="sub">数据来自 kind 30078 存档事件（d=nostrmon:save:v1），每条都经过签名校验。按收服种类、PvP 胜场排序。</p>
    <div class="tablewrap"><table class="table"><thead><tr><th>#</th><th>训练家</th><th>首发</th><th style="text-align:right">收服</th><th style="text-align:right">胜/负</th><th>更新</th></tr></thead>
    <tbody>${rows.slice(0, 50).map((r, i) => `<tr class="${r.pubkey === me ? 'me' : ''}" data-pk="${r.pubkey}" style="cursor:pointer">
      <td class="num">${i + 1}</td>
      <td><div style="display:flex;align-items:center;gap:6px">${r.look ? `<canvas data-look='${JSON.stringify(r.look)}' style="width:18px;height:22px;image-rendering:pixelated"></canvas>` : ''}<div><b>${escapeHtml(r.name)}</b><div class="sub mono" style="font-size:9px">${shortKey(r.npub)}</div></div></div></td>
      <td>${r.lead && SPECIES[r.lead.sp] ? `${SPECIES[r.lead.sp].name} <span class="mono" style="font-size:10px">Lv${r.lead.lv}</span>` : '—'}</td>
      <td class="num">${r.caught}</td><td class="num">${r.wins}/${r.losses}</td><td class="sub">${timeAgo(r.updated)}</td></tr>`).join('') || '<tr><td colspan="6">还没有记录</td></tr>'}</tbody></table></div>
    <div id="rank-detail"></div>`
  paintCanvases(el)
  el.querySelectorAll('tr[data-pk]').forEach((tr) => (tr.onclick = () => showSave(el.querySelector('#rank-detail'), tr.dataset.pk)))
}

async function showSave(box, pk, name) {
  box.innerHTML = '<p class="sub">正在从 Nostr 读取存档…</p>'
  const s = await nostr.fetchPlayerSave(pk).catch(() => null)
  if (!box.isConnected) return
  if (!s) { box.innerHTML = '<p class="sub">这位训练家还没有在 Nostr 上保存过存档。</p>'; return }
  box.innerHTML = `<h3>${escapeHtml(s.name || name || '训练家')} 的队伍</h3>
    <p class="sub">收服 ${Object.keys(s.dex?.caught || {}).length} 种 · PvP ${s.stats?.pvpW || 0} 胜 ${s.stats?.pvpL || 0} 负 · 金币 ${s.coins ?? '—'}</p>
    <div class="monlist">${(s.party || []).filter((m) => SPECIES[m.sp]).map((m) => monCard(m)).join('') || '<p class="sub">队伍为空</p>'}</div>`
  paintCanvases(box)
}

// —— 训练家 / Nostr 账户 ——
function renderAccount(game, el) {
  const s = game.save, sg = game.signer
  const typeName = { local: sg.generated ? '打开游戏时自动生成的本地密钥' : '导入的私钥', nip07: '浏览器扩展（NIP-07）' }[sg.type]
  const relays = Object.entries(nostr.relayStatus)
  const net = game.net
  el.innerHTML = `
    <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
      <canvas id="acc-look" width="18" height="22" style="width:72px;height:88px;image-rendering:pixelated;background:var(--paper-2);border-radius:12px;border:2px solid var(--ink)"></canvas>
      <div style="flex:1;min-width:200px">
        <div class="field"><label for="acc-name">训练家名字</label><div style="display:flex;gap:6px"><input id="acc-name" maxlength="12" value="${escapeHtml(s.name)}"><button class="btn small" id="acc-name-save">保存</button></div></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn small" data-look="hair">发型颜色</button><button class="btn small" data-look="shirt">上衣</button><button class="btn small" data-look="pants">裤子</button><button class="btn small" data-look="skin">肤色</button><button class="btn small" data-look="hat">帽子</button>
        </div>
      </div>
    </div>
    <h3>Nostr 身份</h3>
    <p class="sub">来源：${typeName}${PROFILE ? ` · 配置档 <b>${escapeHtml(PROFILE)}</b>` : ''}</p>
    <div class="keybox" id="acc-npub">${sg.npub}</div>
    <div class="actions" style="margin-top:8px"><button class="btn small" id="copy-npub">复制 npub</button>${sg.type === 'local' ? '<button class="btn small" id="show-nsec">显示私钥 nsec</button>' : ''}</div>
    <div id="nsec-box"></div>
    <h3>换个身份登录</h3>
    <div class="field"><label for="imp">导入已有私钥（nsec1… 或 hex）</label><div style="display:flex;gap:6px"><input id="imp" type="password" autocomplete="off" placeholder="nsec1…"><button class="btn small" id="imp-go">导入</button></div></div>
    <div class="actions">${window.nostr ? '<button class="btn violet small" id="use-ext">使用浏览器扩展登录（NIP-07）</button>' : ''}<button class="btn small" id="new-id">生成全新账户</button></div>
    <h3>同步状态</h3>
    <table class="table"><tbody>
      <tr><td>Yjs 中继</td><td><b>${YJS_PRESET}</b> · <span class="mono" style="font-size:10px">${YJS_RELAY.url}/${WORLD_ROOM}</span></td><td>${net.status === 'connected' ? '已连接' : net.status}</td></tr>
      ${relays.map(([r, st]) => `<tr><td>Nostr relay</td><td class="mono" style="font-size:10px">${r}</td><td>${{ ok: '✓ 可用', fail: '× 连接失败', pending: '… 连接中' }[st]}</td></tr>`).join('')}
      <tr><td>存档</td><td colspan="2">${game.lastSave.at ? `${timeAgo(game.lastSave.at)}写入 ${game.lastSave.ok} 个 relay` : '本次还未写入 relay'} <button class="btn small" id="save-now" style="margin-left:6px">立即保存</button></td></tr>
    </tbody></table>`
  const cv = el.querySelector('#acc-look')
  const paint = () => { const c = cv.getContext('2d'); c.clearRect(0, 0, 18, 22); c.drawImage(trainerSprite(s.look, 'down', 0), 0, 0) }
  paint()
  const sizes = { hair: HAIR.length, shirt: SHIRT.length, pants: PANTS.length, skin: SKIN.length, hat: 3 }
  el.querySelectorAll('[data-look]').forEach((b) => (b.onclick = () => {
    const k = b.dataset.look
    s.look = { ...s.look, [k]: ((s.look[k] || 0) + 1) % sizes[k] }
    if (k === 'hat') s.look.hatColor = ((s.look.hatColor || 0) + 1) % HATC.length
    paint(); game.refreshPresence(); game.saveSoon()
  }))
  el.querySelector('#acc-name-save').onclick = () => {
    const v = el.querySelector('#acc-name').value.trim().slice(0, 12)
    if (!v) return
    s.name = v
    game.refreshPresence(); game.saveNow()
    nostr.publishProfile(sg, v).catch(() => {})
    toast('名字已更新并签名保存到 Nostr。')
  }
  el.querySelector('#copy-npub').onclick = () => copy(sg.npub, el.querySelector('#acc-npub'))
  el.querySelector('#show-nsec')?.addEventListener('click', () => {
    const nsec = sg.nsec()
    el.querySelector('#nsec-box').innerHTML = `<div class="warnbox" style="margin-top:8px">私钥就是你的账号，任何拿到它的人都能以你的身份行动。请存到密码管理器里，不要发给别人。</div>
      <div class="keybox" id="nsec-val" style="margin-top:6px">${nsec}</div><div class="actions"><button class="btn small" id="copy-nsec">复制私钥</button></div>`
    el.querySelector('#copy-nsec').onclick = () => copy(nsec, el.querySelector('#nsec-val'))
  })
  el.querySelector('#imp-go').onclick = async () => {
    try {
      const v = el.querySelector('#imp').value
      if (!(await confirmBox('切换账户', '导入后将以这个私钥的身份重新进入游戏，并从 Nostr 读取它的存档。当前账户的私钥如果没有备份将无法找回。', '导入并重新载入'))) return
      nostr.importSecret(v)
      location.reload()
    } catch (e) { toast('导入失败：' + escapeHtml(e.message)) }
  }
  el.querySelector('#use-ext')?.addEventListener('click', async () => {
    if (!(await confirmBox('使用浏览器扩展', '之后的签名（存档、聊天）都会交给 Nostr 扩展完成。', '切换并重新载入'))) return
    nostr.useExtension(); location.reload()
  })
  el.querySelector('#new-id').onclick = async () => {
    if (!(await confirmBox('生成全新账户', '会创建一个新的 Nostr 身份并从头开始冒险。当前账户的私钥如果没有备份将无法找回。', '生成新账户'))) return
    nostr.newIdentity(); location.reload()
  }
  el.querySelector('#save-now').onclick = async (e) => {
    e.target.disabled = true
    await game.saveNow()
    renderAccount(game, el)
  }
}

function copy(text, sel) {
  navigator.clipboard?.writeText(text).then(() => toast('已复制'), () => {
    const r = document.createRange(); r.selectNodeContents(sel)
    const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    toast('请按 Ctrl/⌘+C 复制已选中的内容')
  })
}

function renderHelp(game, el) {
  el.innerHTML = `
    <h3>操作</h3>
    <table class="table"><tbody>
      <tr><td>移动</td><td>方向键 / WASD，按住 Shift 奔跑；也可以直接点击地面自动寻路</td></tr>
      <tr><td>互动</td><td>空格 / Z：和 NPC 说话、看告示牌、进门</td></tr>
      <tr><td>聊天</td><td>Enter 打开聊天框，消息会以气泡出现在你头上</td></tr>
      <tr><td>对战</td><td>点击其他训练家 → 发起对战</td></tr>
      <tr><td>菜单</td><td>Esc / M</td></tr>
    </tbody></table>
    <h3>这个世界是怎么运转的</h3>
    <p><b>身份：</b>第一次打开时自动生成一把 Nostr 私钥（secp256k1），公钥 npub 就是你的训练家 ID。每条聊天、在线状态都带有签名，其他人会校验，名字前的 ✓ 表示验证通过。</p>
    <p><b>存档：</b>队伍、背包、图鉴以 NIP-78 应用数据事件（kind 30078）签名后写入 ${NOSTR_RELAYS.length} 个公共 relay，换设备导入私钥即可继续。排行榜直接读取所有人的存档事件。</p>
    <p><b>实时：</b>所有玩家的位置、聊天、PvP 邀请与回合行动、稀有精灵刷新都通过 Yjs（y-websocket 协议）在 <span class="mono" style="font-size:11px">${YJS_RELAY.url}</span> 同步。PvP 双方只交换“行动”，伤害由各自用同一个随机种子确定性计算。</p>
    <p><b>稀有精灵：</b>道路、村子和森林的草丛里会不定时刷出发光的稀有精灵，所有在线玩家都能看到，先碰到的人先挑战。</p>`
}

// —— 商店 ——
export function openShop(game) {
  const s = game.save
  const render = () => {
    const m = openModal(`<div class="mhead"><div><h2>友好商店</h2><p class="sub">金币：<b class="mono">${s.coins}</b></p></div><button class="close" data-close aria-label="关闭">✕</button></div>
      ${Object.entries(ITEMS).map(([k, it]) => `<div class="shoprow"><canvas data-item="${k}"></canvas><div><b>${it.name}</b> <span class="sub">持有 ${s.bag[k] || 0}</span><div class="sub">${it.desc}</div></div><span class="price">¤${it.price}</span>
        <span style="display:flex;gap:4px"><button class="btn small" data-buy="${k}" data-n="1" ${s.coins < it.price ? 'disabled' : ''}>买 1</button><button class="btn small" data-buy="${k}" data-n="5" ${s.coins < it.price * 5 ? 'disabled' : ''}>买 5</button></span></div>`).join('')}`,
    { onClose: () => game.updateHud() })
    paintItems(m)
    m.querySelectorAll('[data-buy]').forEach((b) => (b.onclick = () => {
      const k = b.dataset.buy, n = +b.dataset.n
      const cost = ITEMS[k].price * n
      if (s.coins < cost) return
      s.coins -= cost
      s.bag[k] = (s.bag[k] || 0) + n
      game.saveSoon()
      game.updateHud()
      render()
    }))
  }
  render()
}

// —— 玩家名片 ——
export function openPlayerCard(game, p) {
  const npub = nostr.nip19.npubEncode(p.pk)
  const verified = game.net.isVerified(p)
  const isMe = p.pk === game.signer.pubkey
  const m = openModal(`
    <div class="mhead"><div style="display:flex;gap:12px;align-items:center">
      <canvas data-look='${JSON.stringify(p.look || {})}' style="width:54px;height:66px;image-rendering:pixelated;background:var(--paper-2);border-radius:10px;border:2px solid var(--ink)"></canvas>
      <div><h2>${escapeHtml(p.name || '训练家')}</h2>
      <div class="sub">${verified ? '<span style="color:var(--teal);font-weight:700">✓ Nostr 签名已验证</span>' : '<span style="color:var(--coral)">未验证签名</span>'} · 位于 ${escapeHtml(MAPS[p.map]?.name || '?')}${p.busy ? ' · <b>对战中</b>' : ''}</div></div></div>
      <button class="close" data-close aria-label="关闭">✕</button></div>
    <div class="keybox">${npub}</div>
    ${p.lead && SPECIES[p.lead.sp] ? `<p class="sub" style="margin-top:8px">首发伙伴：${p.lead.shiny ? '✦' : ''}${SPECIES[p.lead.sp].name}</p>` : ''}
    <div class="actions">
      ${isMe ? '' : `<button class="btn primary" id="pc-fight" ${p.busy ? 'disabled' : ''}>发起对战</button>`}
      <button class="btn" id="pc-save">查看 Nostr 存档</button>
      ${isMe ? '' : '<button class="btn" id="pc-wave">👋 打招呼</button><button class="btn gold" id="pc-gift">送 1 个捕捉球</button>'}
    </div>
    <div id="pc-extra"></div>`)
  paintCanvases(m)
  m.querySelector('#pc-fight')?.addEventListener('click', () => { closeModal(true); game.challenge(p) })
  m.querySelector('#pc-save').onclick = () => showSave(m.querySelector('#pc-extra'), p.pk, p.name)
  m.querySelector('#pc-wave')?.addEventListener('click', () => {
    game.emote('👋')
    game.net.sendChat(`@${p.name} 你好！`, game.world.map.id, game.save.name).catch(() => {})
    closeModal(true)
  })
  m.querySelector('#pc-gift')?.addEventListener('click', () => { game.gift(p, 'ball'); closeModal(true) })
}

// —— 在线列表 ——
export function openOnline(game) {
  const ps = game.net.players()
  const me = { cid: game.net.cid, pk: game.signer.pubkey, name: game.save.name, look: game.save.look, map: game.world.map.id, lead: game.leadInfo() }
  const all = [me, ...ps]
  const m = openModal(`<div class="mhead"><div><h2>在线训练家</h2><p class="sub">${all.length} 人 · 房间 <span class="mono" style="font-size:11px">${WORLD_ROOM}</span></p></div><button class="close" data-close aria-label="关闭">✕</button></div>
    <div class="plist">${all.map((p, i) => `<button class="prow" data-i="${i}"><canvas data-look='${JSON.stringify(p.look || {})}'></canvas>
      <span class="grow"><b>${escapeHtml(p.name || '训练家')}</b>${i === 0 ? ' <span class="sub">（你）</span>' : ''}${i > 0 && game.net.isVerified(p) ? ' <span style="color:var(--teal)">✓</span>' : ''}<small>${escapeHtml(MAPS[p.map]?.name || '?')}${p.busy ? ' · 对战中' : ''} · ${shortKey(nostr.nip19.npubEncode(p.pk))}</small></span>
      ${p.lead && SPECIES[p.lead.sp] ? `<canvas data-sp="${p.lead.sp}" data-shiny="${p.lead.shiny ? 1 : 0}" style="width:32px;height:32px"></canvas>` : ''}</button>`).join('')}</div>
    ${ps.length ? '' : '<p class="sub" style="margin-top:10px">现在只有你在线。把网址发给朋友，打开就能在同一张地图里见面。</p>'}`)
  paintCanvases(m)
  m.querySelectorAll('.prow').forEach((b) => (b.onclick = () => { const p = all[+b.dataset.i]; if (+b.dataset.i > 0) openPlayerCard(game, p) }))
}

// —— 初始精灵 ——
export function openStarter(game) {
  return new Promise((resolve) => {
    const s = game.save
    let pick = null
    const m = openModal(`<h2>选择你的第一只伙伴</h2>
      <p class="sub">白博士：这三只精灵都在等待一位训练家。选好之后，它会一直跟在你身边。</p>
      <div class="starters">${STARTERS.map((sp) => `<button class="starter" data-sp="${sp}"><canvas data-sp="${sp}"></canvas><b>${SPECIES[sp].name}</b><span>${typeBadges(sp)}</span></button>`).join('')}</div>
      <p class="sub" id="st-desc" style="min-height:3em">点一只精灵看看它的介绍。</p>
      <div class="field"><label for="st-name">你的训练家名字</label><input id="st-name" maxlength="12" value="${escapeHtml(s.name)}"></div>
      <p class="sub">你的 Nostr 公钥：<span class="mono" style="font-size:10px">${shortKey(game.signer.npub)}</span>（已自动生成，可在「训练家」里备份）</p>
      <div class="actions"><button class="btn primary" id="st-go" disabled>就决定是你了！</button></div>`, { dismissable: false })
    paintCanvases(m)
    m.querySelectorAll('.starter').forEach((b) => (b.onclick = () => {
      pick = b.dataset.sp
      m.querySelectorAll('.starter').forEach((x) => x.classList.toggle('sel', x === b))
      m.querySelector('#st-desc').textContent = SPECIES[pick].desc
      m.querySelector('#st-go').disabled = false
    }))
    m.querySelector('#st-go').onclick = async () => {
      if (!pick) return
      s.name = m.querySelector('#st-name').value.trim().slice(0, 12) || s.name
      const mon = createMon(pick, 6, { ot: game.signer.pubkey, caughtAt: Date.now() })
      s.party.push(mon)
      s.dex.seen[pick] = true
      s.dex.caught[pick] = true
      closeModal(true)
      game.refreshPresence()
      game.saveNow()
      await say([`你选择了 ${SPECIES[pick].name}！`, '往北走就是 1 号道路，草丛里住着很多野生精灵。', '累了就回精灵驿站休息。祝你冒险顺利！'], '白博士')
      resolve()
    }
  })
}

// —— 进化 ——
export async function runEvolutions(game) {
  for (const m of game.save.party) {
    if (!canEvolve(m)) continue
    const oldName = monName(m), from = m.sp, to = SPECIES[m.sp].evo.to
    await new Promise((resolve) => {
      const el = openModal(`<h2>咦？${escapeHtml(oldName)} 的样子……</h2>
        <div style="display:grid;place-items:center;margin:10px 0"><canvas id="evo" width="64" height="64" style="width:192px;height:192px;image-rendering:pixelated;transition:filter .1s"></canvas></div>
        <p id="evo-t" style="text-align:center;font-size:17px">……</p><div class="actions" style="justify-content:center"><button class="btn primary" id="evo-ok" hidden>太棒了！</button></div>`, { dismissable: false })
      const cv = el.querySelector('#evo'), ctx = cv.getContext('2d')
      const draw = (sp) => { ctx.clearRect(0, 0, 64, 64); ctx.drawImage(monSprite(sp, { size: 64, shiny: m.shiny }), 0, 0) }
      ;(async () => {
        let delay = 420
        for (let k = 0; k < 14; k++) {
          draw(k % 2 ? to : from)
          cv.style.filter = 'brightness(3) saturate(0)'
          await sleep(delay)
          delay = Math.max(70, delay * 0.8)
        }
        evolve(m)
        game.save.dex.seen[m.sp] = true
        game.save.dex.caught[m.sp] = true
        draw(m.sp)
        cv.style.filter = ''
        el.querySelector('#evo-t').textContent = `恭喜！${oldName} 进化成了 ${SPECIES[m.sp].name}！`
        const ok = el.querySelector('#evo-ok')
        ok.hidden = false
        ok.focus()
        ok.onclick = () => { closeModal(true); resolve() }
      })()
    })
  }
}
