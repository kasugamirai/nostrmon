// 战斗画面：选择行动、按视角播放引擎事件、动画。
// 动画都走 fx*/showMon/hideMon 钩子：2D 版用 DOM 精灵图实现，3D 版（src/three/battleUI3d.js）继承后覆盖。
import { MOVES } from './data/moves.js'
import { SPECIES } from './data/species.js'
import { TYPES } from './data/types.js'
import { resolveTurn, requiredActors, isForcedTurn, activeMon, rngFor, BALLS, POTIONS } from './battle.js'
import { monSprite, ballSprite } from './render/sprites.js'
import { sleep, escapeHtml } from './util.js'

export const ITEMS = {
  ball: { name: '捕捉球', desc: '投向野生精灵来收服它。', price: 200, kind: 'ball' },
  great: { name: '超级捕捉球', desc: '比普通捕捉球更容易收服精灵。', price: 600, kind: 'ball' },
  ultra: { name: '星辰球', desc: '闪烁着星光的高级球，收服率极高。', price: 1200, kind: 'ball' },
  potion: { name: '伤药', desc: '恢复 20 HP。', price: 300, kind: 'potion' },
  super: { name: '好伤药', desc: '恢复 60 HP。', price: 700, kind: 'potion' },
  full: { name: '全满药', desc: '完全恢复 HP。', price: 1500, kind: 'potion' },
}
const STAT = { atk: '攻击', def: '防御', spd: '速度' }

const $ = (id) => document.getElementById(id)
const hpClass = (f) => (f > 0.5 ? '' : f > 0.2 ? 'mid' : 'low')

export class BattleUI {
  constructor(game) {
    this.g = game
    this.root = $('battle')
    this.scene = $('b-scene')
    this.msgEl = $('b-msg')
    this.menu = $('b-menu')
    this.top = $('b-top')
    this.cv = { 0: null, 1: null }
    this.skip = null
    this.msgEl.addEventListener('click', () => this.skip?.())
  }

  get open() { return !this.root.hidden }

  key(e) {
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyZ') { if (this.skip) { e.preventDefault(); this.skip() } }
  }

  // 按视角生成精灵称呼
  label(side, idx = this.view.active[side]) {
    const m = this.st.sides[side].team[idx]
    const nm = m.nick || SPECIES[m.sp].name
    if (side === this.me) return nm
    return (this.cfg.kind === 'wild' ? '野生的 ' : '对手的 ') + nm
  }

  async msg(text, hold = 0) {
    this.msgEl.textContent = ''
    let done = false
    const full = text
    await new Promise((resolve) => {
      let i = 0
      const finish = () => { done = true; this.msgEl.textContent = full; resolve() }
      this.skip = finish
      const tick = () => {
        if (done) return
        i += 2
        this.msgEl.textContent = full.slice(0, i)
        if (i >= full.length) finish()
        else setTimeout(tick, 18)
      }
      tick()
    })
    await new Promise((resolve) => {
      const t = setTimeout(resolve, hold || Math.min(1500, 650 + text.length * 22))
      this.skip = () => { clearTimeout(t); resolve() }
    })
    this.skip = null
  }

  setSprite(side, idx, anim) {
    const m = this.st.sides[side].team[idx]
    const cv = side === this.me ? $('b-me') : $('b-foe')
    const src = monSprite(m.sp, { size: 64, back: side === this.me, shiny: m.shiny })
    const ctx = cv.getContext('2d')
    ctx.clearRect(0, 0, 64, 64)
    ctx.drawImage(src, 0, 0)
    cv.className = 'b-mon' + (anim ? ' ' + anim : '')
  }

  spriteEl(side) { return side === this.me ? $('b-me') : $('b-foe') }

  async anim(side, cls, ms) {
    const el = this.spriteEl(side)
    el.classList.remove(cls)
    void el.offsetWidth
    el.classList.add(cls)
    await sleep(ms)
    if (cls !== 'faint' && cls !== 'gone') el.classList.remove(cls)
  }

  renderInfo(side) {
    const s = this.st.sides[side]
    const idx = this.view.active[side]
    const m = s.team[idx]
    const hp = this.view.hp[side][idx]
    const f = hp / m.maxHp
    const isMe = side === this.me
    const el = isMe ? $('b-me-info') : $('b-foe-info')
    const caught = !isMe && this.cfg.kind === 'wild' && this.g.save.dex.caught[m.sp]
    const dots = this.cfg.kind !== 'wild' ? `<div class="dots">${s.team.map((t, i) => `<i class="${this.view.hp[side][i] <= 0 ? 'out' : ''}"></i>`).join('')}</div>` : ''
    let xp = ''
    if (isMe && this.cfg.kind !== 'pvp') {
      const pm = this.g.partyMon(m.uid)
      if (pm) xp = `<div class="xp"><i style="width:${Math.round(this.g.xpProgress(pm) * 100)}%"></i></div>`
    }
    el.innerHTML = `
      <div class="nmrow"><span class="nm">${m.shiny ? '<span class="shiny">✦</span>' : ''}${caught ? '★ ' : ''}${escapeHtml(m.nick || SPECIES[m.sp].name)}</span><span class="lv">Lv.${m.lv}</span></div>
      <div class="hpwrap"><span>HP</span><div class="hp"><i class="${hpClass(f)}" style="width:${Math.max(0, f * 100)}%"></i></div></div>
      ${isMe ? `<div class="hpnum">${Math.max(0, hp)} / ${m.maxHp}</div>` : ''}${xp}${dots}`
  }

  setHp(side, idx, hp) {
    this.view.hp[side][idx] = hp
    if (this.view.active[side] !== idx) return
    const m = this.st.sides[side].team[idx]
    const el = side === this.me ? $('b-me-info') : $('b-foe-info')
    const bar = el.querySelector('.hp i')
    const f = hp / m.maxHp
    if (bar) { bar.style.width = Math.max(0, f * 100) + '%'; bar.className = hpClass(f) }
    const num = el.querySelector('.hpnum')
    if (num) num.textContent = `${Math.max(0, hp)} / ${m.maxHp}`
  }

  syncView() {
    this.view = {
      active: this.st.sides.map((s) => s.active),
      hp: this.st.sides.map((s) => s.team.map((m) => m.hp)),
    }
  }

  // —— 主循环 ——
  async run(cfg) {
    this.cfg = cfg
    this.st = cfg.state
    this.me = cfg.me
    this.foe = 1 - cfg.me
    this.syncView()
    this.scene.className = cfg.bg || 'meadow'
    this.top.innerHTML = ''
    this.menu.innerHTML = ''
    this.root.hidden = false
    await this.stageEnter(cfg)
    this.showMon(this.foe, this.view.active[this.foe], 'enter')
    this.hideMon(this.me)
    $('b-me-info').style.visibility = 'hidden'
    this.renderInfo(this.foe)
    for (const line of cfg.intro || []) await this.msg(line)
    this.showMon(this.me, this.view.active[this.me], 'enter')
    $('b-me-info').style.visibility = 'visible'
    this.renderInfo(this.me)
    await this.msg(`去吧，${this.label(this.me)}！`, 700)

    const st = this.st
    while (!st.over) {
      const req = requiredActors(st)
      const turn = st.turn
      const ac = new AbortController()
      let mine = null, theirs = null
      const tasks = []
      if (req.includes(this.me)) {
        tasks.push(this.choose(isForcedTurn(st), ac.signal).then(async (a) => {
          mine = a
          if (a) {
            await cfg.send?.(turn, a)
            if (a.t === 'forfeit') ac.abort()
            if (req.includes(this.foe) && cfg.kind === 'pvp') { this.menu.innerHTML = ''; this.msgEl.textContent = '等待对手行动…' }
          }
        }))
      }
      if (req.includes(this.foe)) {
        tasks.push(Promise.resolve(cfg.getFoeAction(st, turn, ac.signal)).then((a) => {
          theirs = a
          if (a?.t === 'forfeit') ac.abort()
        }))
      }
      await Promise.all(tasks)
      this.top.innerHTML = ''
      const actions = {}
      if (mine) actions[this.me] = mine
      if (theirs) actions[this.foe] = theirs
      this.syncView()
      const events = resolveTurn(st, actions, rngFor(cfg.seed, turn))
      await this.play(events)
      this.syncView()
    }
    return { winner: st.winner, reason: st.reason }
  }

  close() { this.root.hidden = true; this.skip = null; this.stageExit() }

  // —— 动画钩子（2D 实现）——
  async stageEnter() { $('b-ball').hidden = true }
  stageExit() {}
  showMon(side, idx, anim) { this.setSprite(side, idx, anim) }
  hideMon(side) { this.spriteEl(side).className = 'b-mon gone' }
  async fxRecall(side) { await this.anim(side, 'gone', 300) }
  async fxMove(side /* , moveId */) { await this.anim(side, side === this.me ? 'lunge-me' : 'lunge-foe', 300) }
  fxHit(side /* , e */) { this.anim(side, 'hit', 450) }
  async fxMiss() {}
  async fxFaint(side) { await this.anim(side, 'faint', 520) }
  async fxStat() {}
  fxHeal() {}

  // —— 选择行动 ——
  choose(forced, signal) {
    return new Promise((resolve) => {
      let settled = false
      let timer = null
      const done = (a) => {
        if (settled) return
        settled = true
        clearInterval(timer)
        this.menu.innerHTML = ''
        resolve(a)
      }
      signal.addEventListener('abort', () => done(null))
      if (this.cfg.kind === 'pvp') {
        let left = 60
        const paint = () => { this.top.innerHTML = `<span class="pill"><i class="dot"></i>回合 ${this.st.turn + 1} · 剩余 <b class="mono">${left}</b> 秒</span>` }
        paint()
        timer = setInterval(() => {
          left--
          paint()
          if (left <= 0) done(forced ? { t: 'switch', i: this.firstSwitchable() } : { t: 'move', i: 0 })
        }, 1000)
      }
      const self = this
      const side = this.st.sides[this.me]
      const mon = activeMon(this.st, this.me)
      const B = (label, cls, onClick, disabled) => {
        const b = document.createElement('button')
        b.className = 'btn ' + (cls || '')
        b.innerHTML = label
        b.disabled = !!disabled
        b.onclick = onClick
        this.menu.appendChild(b)
        return b
      }
      function main() {
        self.menu.innerHTML = ''
        self.msgEl.textContent = `${self.label(self.me)} 要怎么做？`
        B('战斗', 'primary', fight)
        B('背包', '', bag, self.cfg.kind === 'pvp')
        B('精灵', '', () => party(false))
        if (self.cfg.kind === 'pvp') B('认输', '', () => done({ t: 'forfeit' }))
        else B('逃跑', '', () => done({ t: 'run' }), self.cfg.kind !== 'wild')
        self.menu.querySelector('.btn')?.focus()
      }
      function fight() {
        self.menu.innerHTML = ''
        mon.moves.forEach((id, i) => {
          const mv = MOVES[id]
          const b = B(`${mv.name}<small>${TYPES[mv.type].name} · ${mv.power ? '威力 ' + mv.power : '变化'} · 命中 ${mv.acc}</small>`, 'move', () => done({ t: 'move', i }))
          b.style.borderLeftColor = TYPES[mv.type].color
        })
        B('返回', 'small wide', main)
        self.menu.querySelector('.btn')?.focus()
      }
      function bag() {
        self.menu.innerHTML = ''
        const bagItems = Object.entries(self.g.save.bag).filter(([k, n]) => n > 0 && ITEMS[k])
        if (!bagItems.length) self.msgEl.textContent = '背包里什么都没有……'
        for (const [k, n] of bagItems) {
          const it = ITEMS[k]
          B(`${it.name} ×${n}`, '', () => {
            if (it.kind === 'ball') {
              if (self.cfg.kind !== 'wild') { self.msgEl.textContent = '不能对训练家的精灵使用！'; return }
              self.g.useItem(k)
              done({ t: 'ball', ball: k })
            } else party(true, k)
          })
        }
        B('返回', 'small wide', main)
      }
      function party(forItem, item) {
        self.menu.innerHTML = ''
        self.msgEl.textContent = forItem ? '给哪只精灵使用？' : forced ? '要派出哪只精灵？' : '要换上哪只精灵？'
        side.team.forEach((m, i) => {
          const nm = m.nick || SPECIES[m.sp].name
          const cur = i === side.active
          const dis = forItem ? m.hp <= 0 || m.hp >= m.maxHp : m.hp <= 0 || cur
          B(`${nm}<small>Lv.${m.lv} · HP ${m.hp}/${m.maxHp}${cur ? ' · 场上' : ''}</small>`, 'move', () => {
            if (forItem) { self.g.useItem(item); done({ t: 'item', item, target: i }) } else done({ t: 'switch', i })
          }, dis)
        })
        if (!forced) B('返回', 'small wide', main)
      }
      if (forced) party(false)
      else main()
    })
  }

  firstSwitchable() { return this.st.sides[this.me].team.findIndex((m) => m.hp > 0) }

  // —— 播放事件 ——
  async play(events) {
    for (const e of events) {
      const s = e.side
      const isMe = s === this.me
      switch (e.t) {
        case 'switch': {
          const fromName = e.from != null ? this.label(s, e.from) : null
          if (e.from != null) {
            await this.msg(isMe ? `${fromName}，回来吧！` : `${this.st.sides[s].name} 收回了 ${fromName}！`, 600)
            await this.fxRecall(s)
          }
          this.view.active[s] = e.idx
          this.showMon(s, e.idx, 'enter')
          this.renderInfo(s)
          await this.msg(isMe ? `去吧，${this.label(s)}！` : `${this.st.sides[s].name} 派出了 ${this.label(s)}！`, 700)
          break
        }
        case 'move':
          await this.msg(`${this.label(s)} 使用了 ${MOVES[e.move].name}！`, 350)
          await this.fxMove(s, e.move)
          break
        case 'miss': await this.fxMiss(s); await this.msg('但是没有命中！'); break
        case 'noeffect': await this.msg(`对 ${this.label(s)} 好像没有效果……`); break
        case 'damage': {
          this.fxHit(s, e)
          this.setHp(s, this.view.active[s], e.hp)
          await sleep(550)
          if (e.crit) await this.msg('击中了要害！', 700)
          if (e.eff > 1) await this.msg('效果绝佳！', 800)
          else if (e.eff < 1) await this.msg('效果不太好……', 800)
          break
        }
        case 'heal':
          this.fxHeal(s)
          this.setHp(s, this.view.active[s], e.hp)
          await this.msg(e.drain ? `${this.label(s)} 吸取了对手的体力！` : `${this.label(s)} 恢复了体力！`)
          break
        case 'stat': {
          const up = e.stages > 0
          if (!e.capped) await this.fxStat(s, e.stat, up)
          if (e.capped) await this.msg(`${this.label(s)} 的${STAT[e.stat]}已经无法再${up ? '提高' : '降低'}了！`)
          else await this.msg(`${this.label(s)} 的${STAT[e.stat]}${Math.abs(e.stages) > 1 ? '大幅' : ''}${up ? '提高' : '降低'}了！`)
          break
        }
        case 'faint': {
          await this.fxFaint(s)
          this.renderInfo(s)
          await this.msg(`${this.label(s)} 倒下了！`)
          if (!isMe && this.cfg.onFoeFaint) {
            const mine = this.st.sides[this.me].team[this.view.active[this.me]]
            const lines = this.cfg.onFoeFaint(this.st.sides[s].team[this.view.active[s]], mine)
            this.view.hp[this.me][this.view.active[this.me]] = mine.hp
            this.renderInfo(this.me)
            for (const l of lines) await this.msg(l)
          }
          break
        }
        case 'item': {
          const who = isMe ? '你' : this.st.sides[s].name
          if (e.target === this.view.active[s]) this.fxHeal(s)
          this.setHp(s, e.target, e.hp)
          await this.msg(`${who} 使用了 ${ITEMS[e.item].name}！${this.st.sides[s].team[e.target].nick || SPECIES[this.st.sides[s].team[e.target].sp].name} 恢复了 ${e.amount} HP。`)
          break
        }
        case 'ball': await this.throwBall(e); break
        case 'run': await this.msg(e.ok ? '顺利逃走了！' : '逃不掉！'); break
        case 'forfeit': await this.msg(isMe ? '你认输了……' : `${this.st.sides[s].name} 认输了！`); break
      }
    }
  }

  async throwBall(e) {
    await this.msg(`你丢出了 ${ITEMS[e.ball].name}！`, 300)
    if (e.blocked) { await this.msg('不能抢夺别人的精灵！'); return }
    await this.fxBall(e)
    const nm = this.label(this.foe).replace('野生的 ', '')
    if (e.caught) await this.msg(`太好了！成功收服了 ${nm}！`, 1300)
    else await this.msg(['哎呀！精灵挣脱了！', '啊！差一点就抓到了！', '可恶！就差一点点！'][Math.min(2, e.shakes)])
  }

  // 抛球动画：命中 → 吸入 → 落地摇晃 e.shakes 次 → 成功留在原地 / 失败精灵重新出现
  async fxBall(e) {
    const ball = $('b-ball')
    const ctx = ball.getContext('2d')
    ctx.clearRect(0, 0, 16, 16)
    ctx.drawImage(ballSprite(e.ball, 16), 0, 0)
    const sceneR = this.scene.getBoundingClientRect()
    const foeR = this.spriteEl(this.foe).getBoundingClientRect()
    const tx = foeR.left - sceneR.left + foeR.width / 2 - 16
    const ty = foeR.top - sceneR.top + foeR.height * 0.55 - 16
    ball.hidden = false
    ball.style.filter = ''
    ball.style.transition = 'none'
    ball.style.transform = `translate(${sceneR.width * 0.12}px, ${sceneR.height * 0.75}px) rotate(0deg)`
    void ball.offsetWidth
    ball.style.transition = 'transform 0.6s cubic-bezier(.3,-0.4,.6,1)'
    ball.style.transform = `translate(${tx}px, ${ty}px) rotate(720deg)`
    await sleep(650)
    await this.anim(this.foe, 'glow', 250)
    this.spriteEl(this.foe).classList.add('gone')
    ball.style.transition = 'transform 0.35s ease-in'
    const ground = foeR.top - sceneR.top + foeR.height - 34
    ball.style.transform = `translate(${tx}px, ${ground}px)`
    await sleep(500)
    for (let k = 0; k < e.shakes; k++) {
      ball.style.transition = 'transform 0.15s'
      ball.style.transform = `translate(${tx - 5}px, ${ground}px) rotate(-22deg)`
      await sleep(160)
      ball.style.transform = `translate(${tx + 5}px, ${ground}px) rotate(22deg)`
      await sleep(160)
      ball.style.transform = `translate(${tx}px, ${ground}px) rotate(0deg)`
      await sleep(420)
    }
    if (e.caught) ball.style.filter = 'brightness(0.7)'
    else {
      ball.hidden = true
      this.spriteEl(this.foe).className = 'b-mon enter'
    }
  }
}

export { BALLS, POTIONS }
