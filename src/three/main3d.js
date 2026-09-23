// 3D 版入口：复用共享核心（身份 / Yjs / Nostr 存档 / 聊天 / PvP / 战斗规则），替换大地图、战斗画面和操控
import { startGame } from '../core/game.js'
import { Wilds } from '../core/wilds.js'
import { World3D } from './world3d.js'
import { BattleUI3D } from './battleUI3d.js'
import { setupControls3D } from './controls3d.js'

startGame({
  World: World3D,
  BattleUI: BattleUI3D,
  Wilds,
  setupControls: setupControls3D,
  randomEncounters: false,
  mode: '3d',
  helpLine: 'WASD 移动 · 拖动画面转视角 · 滚轮缩放 · Shift 奔跑 · 空格 互动 · Enter 聊天 · Esc 菜单',
})
