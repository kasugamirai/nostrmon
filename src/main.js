// 2D 像素版入口
import { startGame } from './core/game.js'
import { World } from './world.js'
import { BattleUI } from './battleUI.js'

startGame({ World, BattleUI, mode: '2d' })
