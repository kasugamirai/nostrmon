// 3D 战斗画面：继承 BattleUI（回合流程、菜单、消息框、血条都不变），只替换表现层钩子，交给 BattleStage 渲染。
// 每个钩子都有 try/catch + 超时兜底，WebGL 不可用时整体退回基类的 2D 精灵表现。
import './battle3d.css'
import { BattleUI } from '../battleUI.js'
import { BattleStage } from './battleStage.js'

const $ = (id) => document.getElementById(id)

// 动画出错或卡住都不能拖住回合流程：最多等 ms 毫秒
function guard(p, ms) {
  let timer = null
  return Promise.race([
    Promise.resolve(p).catch((err) => console.warn('[battle3d]', err)),
    new Promise((resolve) => { timer = setTimeout(resolve, ms) }),
  ]).finally(() => clearTimeout(timer))
}

function attempt(fn) {
  try { return fn() } catch (err) { console.warn('[battle3d]', err); return undefined }
}

export class BattleUI3D extends BattleUI {
  constructor(game) {
    super(game)
    this.stage = new BattleStage({ canvas: $('b-3d'), host: this.scene, fx: $('b-fx') })
    this.gl = false
  }

  slot(side) { return side === this.me ? 'me' : 'foe' }

  monInfo(side, idx, anim) {
    const m = this.st.sides[side].team[idx]
    return { sp: m.sp, shiny: !!m.shiny, idx, anim }
  }

  // WebGL 不可用：显示基类的像素精灵画布，由 battle3d.css 负责摆位
  useFallback(on) {
    this.scene.classList.toggle('b3d-fallback', on)
    this.scene.classList.toggle('b3d-on', !on)
    for (const id of ['b-foe', 'b-me']) { const el = $(id); if (el) el.hidden = !on }
    const cv = $('b-3d')
    if (cv) cv.style.visibility = on ? 'hidden' : ''
  }

  async stageEnter(cfg) {
    const wild = cfg.kind === 'wild' ? attempt(() => this.monInfo(this.foe, this.view.active[this.foe])) : null
    let intro = null
    try {
      intro = this.stage.open({ bg: cfg.bg, kind: cfg.kind, wild })
      this.gl = this.stage.ok
    } catch (err) {
      console.warn('[battle3d] 舞台初始化失败', err)
      attempt(() => this.stage.close())
      this.gl = false
    }
    this.useFallback(!this.gl)
    const ball = $('b-ball')
    if (ball) ball.hidden = true
    if (!this.gl) return super.stageEnter(cfg)
    await guard(intro, 2200)
  }

  stageExit() {
    attempt(() => this.stage.close())
    for (const id of ['b-foe', 'b-me', 'b-ball']) { const el = $(id); if (el) el.hidden = true }
    this.scene.classList.remove('b3d-fallback', 'b3d-on')
  }

  showMon(side, idx, anim) {
    if (!this.gl) return super.showMon(side, idx, anim)
    return guard(attempt(() => this.stage.showMon(this.slot(side), this.monInfo(side, idx, anim))), 2000)
  }

  hideMon(side) {
    if (!this.gl) return super.hideMon(side)
    attempt(() => this.stage.hideMon(this.slot(side)))
  }

  async fxRecall(side) {
    if (!this.gl) return super.fxRecall(side)
    await guard(attempt(() => this.stage.recall(this.slot(side))), 1500)
  }

  async fxMove(side, moveId) {
    if (!this.gl) return super.fxMove(side, moveId)
    await guard(attempt(() => this.stage.move(this.slot(side), moveId)), 2600)
  }

  // 基类不等待受击动画（约 550 ms 后接着显示效果文字），这里同样即发即走
  fxHit(side, e) {
    if (!this.gl) return super.fxHit(side, e)
    return guard(attempt(() => this.stage.hit(this.slot(side), e)), 1200)
  }

  async fxMiss(side) {
    if (!this.gl) return super.fxMiss(side)
    await guard(attempt(() => this.stage.miss(this.slot(side))), 1200)
  }

  async fxFaint(side) {
    if (!this.gl) return super.fxFaint(side)
    await guard(attempt(() => this.stage.faint(this.slot(side))), 2200)
    // 击败训练家 / PvP 对手的最后一只精灵：撒彩纸
    if (side === this.foe && this.cfg.kind !== 'wild' && this.st.over && this.st.winner === this.me) attempt(() => this.stage.celebrate(1))
  }

  async fxStat(side, stat, up) {
    if (!this.gl) return super.fxStat(side, stat, up)
    await guard(attempt(() => this.stage.stat(this.slot(side), stat, up)), 1600)
  }

  fxHeal(side) {
    if (!this.gl) return super.fxHeal(side)
    return guard(attempt(() => this.stage.heal(this.slot(side))), 2000)
  }

  async fxBall(e) {
    if (!this.gl) return super.fxBall(e)
    await guard(attempt(() => this.stage.ball(e)), 6500)
  }
}
