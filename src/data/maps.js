// 地图用种子随机数确定性生成 —— 所有客户端看到的世界完全一致。
// 户外图块：. 草地  , 高草丛(遇敌)  = 土路  p 石板  ~ 水  s 沙  T 树  f 花  # 栅栏  r 岩石  S 告示牌  B 栈桥
// 室内图块：w 木地板  k 瓷砖地板  R 地毯  x 出口地垫（传送）  W 墙  C 柜台  b 床  t 桌子  c 椅子/长凳  h 书架  D 货架  P 盆栽  M 治疗机  v 电视
//          F 冰箱/冷柜  K 灶台/水槽  L 落地灯  O 沙发  A 衣柜  E 书桌+电脑  G 壁炉  Q 鱼缸
// 室内还有 theme（墙纸/地板配色）和 decor（挂在墙上或摆在桌面/柜台上的小物件，不占格子）
import { mulberry32 } from '../util.js'

const grid = (w, h, ch) => Array.from({ length: h }, () => Array(w).fill(ch))
function rect(g, x, y, w, h, ch) {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j] && g[j][i] !== undefined) g[j][i] = ch
}
function border(g, t = 2) {
  const H = g.length, W = g[0].length
  rect(g, 0, 0, W, t, 'T'); rect(g, 0, H - t, W, t, 'T'); rect(g, 0, 0, t, H, 'T'); rect(g, W - t, 0, t, H, 'T')
}
function scatter(g, rng, x, y, w, h, ch, p, on = '.') {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (g[j]?.[i] === on && rng() < p) g[j][i] = ch
}
const set = (g, x, y, ch) => { g[y][x] = ch }

// 训练家外观：皮肤/头发/上衣/裤子 为调色板索引，hat 0 无 1 鸭舌帽 2 毛线帽
const L = (skin, hair, shirt, pants, hat = 0, hatColor = 0) => ({ skin, hair, shirt, pants, hat, hatColor })

function town() {
  const g = grid(36, 28, '.'), r = mulberry32(101)
  border(g)
  scatter(g, r, 3, 3, 12, 3, 'f', 0.35)
  scatter(g, r, 21, 3, 12, 3, 'f', 0.35)
  rect(g, 17, 0, 2, 22, '=')
  rect(g, 2, 11, 32, 2, '=')
  rect(g, 2, 20, 32, 2, '=')
  rect(g, 7, 10, 1, 1, '='); rect(g, 28, 10, 1, 1, '=')
  rect(g, 7, 19, 1, 1, '='); rect(g, 28, 19, 1, 1, '=')
  rect(g, 12, 13, 12, 6, 'p')
  rect(g, 16, 15, 4, 2, '~')
  rect(g, 3, 22, 10, 4, 's')
  rect(g, 4, 23, 7, 3, '~')
  rect(g, 22, 22, 11, 4, 'p')
  rect(g, 22, 22, 11, 1, '#'); rect(g, 22, 22, 1, 4, '#'); rect(g, 32, 22, 1, 4, '#')
  rect(g, 27, 22, 2, 1, 'p')
  for (const [x, y] of [[12, 6], [23, 6], [12, 8], [23, 8], [2 + 12, 22], [20, 25]]) set(g, x, y, 'T')
  set(g, 15, 10, 'S'); set(g, 21, 22, 'S')
  return {
    id: 'town', name: '新叶镇', g, bg: '#2f6f38', battleBg: 'meadow',
    start: { x: 7, y: 10, dir: 'down' }, respawn: { map: 'town', x: 7, y: 19 },
    signs: {
      '15,10': '新叶镇 —— 梦想开始的地方。北边是 1 号道路。',
      '21,22': '对战广场：点击其他训练家即可发起实时对战！',
    },
    buildings: [
      { x: 5, y: 6, w: 5, h: 4, kind: 'house', roof: '#d64545', label: '你的家', door: [7, 9], action: 'home', interior: 'town_home' },
      { x: 26, y: 6, w: 5, h: 4, kind: 'house', roof: '#3f8f5a', label: '小光家', door: [28, 9], action: 'talk', interior: 'town_house2',
        lines: ['小光出门冒险去了，留下了一张字条：', '“听说幽影森林的祭坛附近，有人见过会发光的蝴蝶！”'] },
      { x: 4, y: 15, w: 6, h: 4, kind: 'center', roof: '#ef476f', label: '精灵驿站', door: [7, 18], action: 'heal', interior: 'town_center' },
      { x: 26, y: 15, w: 5, h: 4, kind: 'shop', roof: '#3a86ff', label: '友好商店', door: [28, 18], action: 'shop', interior: 'town_shop' },
    ],
    npcs: [
      { id: 'prof', x: 20, y: 10, dir: 'down', name: '白博士', look: L(0, 4, 7, 0, 0),
        lines: ['欢迎来到 Nostrmon 的世界！', '你的训练家身份是一把 Nostr 密钥，打开游戏时就自动生成好了。', '你的队伍、背包和图鉴都签名保存在 Nostr relay 上，换台电脑导入密钥就能继续冒险。', '走进高草丛会遇到野生精灵，削弱后丢出捕捉球就能收服！'] },
      { id: 'kid', x: 14, y: 19, dir: 'right', name: '小胖', look: L(1, 0, 3, 1, 1, 1),
        lines: ['按 Enter 可以聊天，附近的训练家头上会冒出你说的话！', '每条聊天消息都用你的 Nostr 密钥签过名，别人没法冒充你哦。'] },
      { id: 'girl', x: 12, y: 23, dir: 'left', name: '小美', look: L(0, 6, 6, 2),
        lines: ['池塘的水好清啊～', '听说晨风村的湖边能遇到珊瑚鱼。'] },
      { id: 't_town', x: 25, y: 24, dir: 'left', name: '新手训练家 小刚', look: L(2, 0, 1, 0, 1, 0),
        lines: ['嘿！眼神对上了就要对战！'], after: ['输了……我得多去草丛里练练。'],
        trainer: { team: [['fluffbun', 3], ['chirp', 3]], reward: 120 } },
    ],
    warps: [{ x: 17, y: 0, w: 2, h: 1, to: 'route1', tx: 13, ty: 38, dir: 'up' }],
    wild: null,
  }
}

function route1() {
  const g = grid(28, 40, '.'), r = mulberry32(202)
  border(g)
  scatter(g, r, 2, 2, 24, 36, 'T', 0.06)
  scatter(g, r, 2, 2, 24, 36, 'f', 0.05)
  rect(g, 13, 30, 2, 10, '=')
  rect(g, 8, 28, 7, 2, '=')
  rect(g, 8, 16, 2, 14, '=')
  rect(g, 8, 16, 12, 2, '=')
  rect(g, 18, 6, 2, 14, '=')
  rect(g, 20, 18, 8, 2, '=')
  rect(g, 13, 6, 7, 2, '=')
  rect(g, 13, 0, 2, 8, '=')
  rect(g, 15, 23, 8, 5, ',')
  rect(g, 3, 19, 4, 8, ',')
  rect(g, 10, 9, 6, 6, ',')
  rect(g, 21, 3, 5, 10, ',')
  rect(g, 3, 31, 8, 5, ',')
  rect(g, 17, 31, 7, 5, ',')
  rect(g, 3, 7, 6, 5, '~')
  rect(g, 11, 19, 4, 4, 'T')
  for (const [x, y] of [[7, 24], [20, 10], [15, 36], [16, 5]]) set(g, x, y, '.')
  set(g, 15, 36, 'S'); set(g, 16, 5, 'S')
  return {
    id: 'route1', name: '1 号道路', g, bg: '#2f6f38', battleBg: 'meadow', spawn: true,
    signs: {
      '15,36': '1 号道路｜北：晨风村　东：幽影森林',
      '16,5': '注意：草丛里偶尔会出现发光的稀有精灵，所有训练家都能看见，先到先得！',
    },
    buildings: [],
    npcs: [
      { id: 't_bug', x: 7, y: 24, dir: 'right', name: '捕虫少年 小哲', look: L(1, 1, 5, 3, 1, 5),
        lines: ['我的虫虫大军可是很厉害的！'], after: ['我的甲虫宝需要再多吃点树汁……'],
        trainer: { team: [['beetlet', 5], ['beetlet', 6]], reward: 150 } },
      { id: 't_lass', x: 20, y: 10, dir: 'left', name: '少女 美美', look: L(0, 3, 6, 4),
        lines: ['可爱的精灵也可以很强哦！'], after: ['唔……你的精灵也很可爱嘛。'],
        trainer: { team: [['fluffbun', 7], ['chirp', 8]], reward: 180 } },
    ],
    warps: [
      { x: 13, y: 39, w: 2, h: 1, to: 'town', tx: 17, ty: 1, dir: 'down' },
      { x: 13, y: 0, w: 2, h: 1, to: 'village', tx: 16, ty: 24, dir: 'up' },
      { x: 27, y: 18, w: 1, h: 2, to: 'forest', tx: 1, ty: 11, dir: 'right' },
    ],
    wild: { min: 2, max: 6, table: [['fluffbun', 30], ['chirp', 30], ['beetlet', 20], ['molebit', 12], ['zappy', 8]] },
  }
}

function village() {
  const g = grid(34, 26, '.'), r = mulberry32(303)
  border(g)
  rect(g, 16, 13, 2, 13, '=')
  rect(g, 2, 13, 30, 2, '=')
  rect(g, 2, 21, 30, 2, '=')
  rect(g, 3, 2, 16, 9, 's')
  rect(g, 4, 3, 14, 6, '~')
  rect(g, 10, 6, 1, 3, 'B')
  rect(g, 20, 3, 11, 5, ',')
  rect(g, 9, 16, 5, 4, ',')
  scatter(g, r, 19, 15, 12, 5, 'f', 0.25)
  for (const [x, y] of [[19, 10], [19, 11], [2 + 29, 16], [14, 17]]) set(g, x, y, 'T')
  set(g, 15, 12, 'S')
  set(g, 21, 16, '.')
  return {
    id: 'village', name: '晨风村', g, bg: '#2f6f38', battleBg: 'lake', spawn: true,
    signs: { '15,12': '晨风村 —— 湖畔的宁静小村。精灵驿站就在东边。' },
    buildings: [
      { x: 20, y: 9, w: 6, h: 4, kind: 'center', roof: '#ef476f', label: '精灵驿站', door: [23, 12], action: 'heal', interior: 'village_center' },
      { x: 27, y: 9, w: 5, h: 4, kind: 'house', roof: '#8a5a44', label: '村长家', door: [29, 12], action: 'talk', interior: 'village_elder',
        lines: ['村长：年轻人，这个世界没有中心服务器。', '村长：大家的位置和聊天通过 Yjs 实时同步，存档则写在 Nostr 上——谁也删不掉你的冒险记录。'] },
      { x: 4, y: 17, w: 5, h: 4, kind: 'house', roof: '#c77dff', label: '民居', door: [6, 20], action: 'talk', interior: 'village_house',
        lines: ['屋里传来了烤面包的香味……', '“出门在外，记得常回精灵驿站休息！”'] },
      { x: 24, y: 17, w: 5, h: 4, kind: 'shop', roof: '#3a86ff', label: '湖畔商店', door: [26, 20], action: 'shop', interior: 'village_shop' },
    ],
    npcs: [
      { id: 'fisher', x: 10, y: 9, dir: 'up', name: '钓鱼大叔', look: L(2, 4, 4, 2, 2, 3),
        lines: ['湖里的珊瑚鱼偶尔会跳到岸边的草丛里。', '钓不到鱼的日子，我就看看天上的云。'] },
      { id: 't_snow', x: 21, y: 16, dir: 'down', name: '冰雪少女 小雪', look: L(0, 4, 2, 3, 2, 2),
        lines: ['我的冰晶猫可不怕任何人！'], after: ['你的精灵真温暖……'],
        trainer: { team: [['frostcat', 10], ['coralfin', 11]], reward: 320 } },
      { id: 'traveler', x: 12, y: 14, dir: 'down', name: '旅行者 阿远', look: L(1, 2, 4, 1, 1, 4),
        lines: ['点击别的训练家可以发起实时对战，双方的行动经 Yjs 同步，结果各自本地确定性计算。', '赢了能拿金币，战绩会写进你的 Nostr 存档，排行榜上所有人都看得到！'] },
    ],
    warps: [{ x: 16, y: 25, w: 2, h: 1, to: 'route1', tx: 13, ty: 1, dir: 'down' }],
    wild: { min: 5, max: 10, table: [['chirp', 20], ['molebit', 15], ['pebblin', 20], ['shroomy', 15], ['coralfin', 15], ['frostcat', 10], ['zappy', 5]] },
  }
}

function forest() {
  const g = grid(30, 24, '.'), r = mulberry32(404)
  border(g)
  scatter(g, r, 2, 2, 26, 20, 'T', 0.38)
  rect(g, 3, 3, 9, 8, ',')
  rect(g, 19, 3, 8, 8, ',')
  rect(g, 3, 13, 10, 8, ',')
  rect(g, 19, 13, 8, 8, ',')
  rect(g, 0, 11, 16, 2, '=')
  rect(g, 12, 8, 7, 7, '.')
  rect(g, 14, 10, 3, 3, 'p')
  for (const [x, y] of [[13, 9], [17, 9], [13, 13], [17, 13]]) set(g, x, y, 'r')
  set(g, 15, 9, 'S')
  return {
    id: 'forest', name: '幽影森林', g, bg: '#16301f', battleBg: 'forest', spawn: true, dark: true,
    signs: { '15,9': '古老的祭坛：据说月光蝶会在月夜降临……' },
    buildings: [],
    npcs: [
      { id: 't_ghost', x: 15, y: 14, dir: 'up', name: '灵媒师 阿幽', look: L(0, 7, 4, 0, 2, 4),
        lines: ['森林里的灵魂在低语……它们想和你玩玩。'], after: ['灵魂们说，你是个温柔的训练家。'],
        trainer: { team: [['wispy', 12], ['shroomy', 12], ['wispy', 13]], reward: 450 } },
      { id: 'lostboy', x: 7, y: 12, dir: 'right', name: '迷路的少年', look: L(1, 1, 0, 1),
        lines: ['呜呜……这片森林好暗，我找不到回去的路了。', '往西走就能回到 1 号道路？谢谢你！'] },
    ],
    warps: [{ x: 0, y: 11, w: 1, h: 2, to: 'route1', tx: 26, ty: 18, dir: 'left' }],
    wild: { min: 8, max: 13, table: [['wispy', 25], ['shroomy', 25], ['beetlet', 18], ['molebit', 10], ['frostcat', 8], ['lunamoth', 6]] },
  }
}


// —— 室内 ——
// 房间：上方两行墙、左右墙，底边中央是出口地垫 x（踩上去回到门外）。玩家从地垫上方一格进入、面朝上。
function room(w, h, floor) {
  const g = grid(w, h, floor)
  rect(g, 0, 0, w, 2, 'W'); rect(g, 0, 0, 1, h, 'W'); rect(g, w - 1, 0, 1, h, 'W')
  const mx = Math.floor(w / 2)
  set(g, mx, h - 1, 'x')
  return { g, mx }
}
// theme: { wall, stripe, trim, floor: 'light'|'dark', sofa }
// decor: [{ x, y, k }]，k ∈ window curtain painting clock poster calendar certificate worldmap shelfWall
//        （以上挂在墙面行 y=1）| vase teaset bread books trophy register bell flowerpot lamp（放在桌面/柜台/书架上）
const THEMES = {
  home: { wall: '#f6e3c6', stripe: '#ecd2ac', trim: '#8a5a2b', floor: 'light', sofa: '#e07a5f' },
  kid: { wall: '#d9ecf7', stripe: '#c5e0f0', trim: '#5a6f8a', floor: 'light', sofa: '#5b8def' },
  center: { wall: '#fde4ea', stripe: '#f7cfd9', trim: '#c05070', floor: 'light', sofa: '#ef476f' },
  shop: { wall: '#e3f1e0', stripe: '#cfe6c9', trim: '#3f7d5a', floor: 'light', sofa: '#3a86ff' },
  elder: { wall: '#efe0c9', stripe: '#e0cba9', trim: '#5e3a1d', floor: 'dark', sofa: '#7a3b2e' },
  bakery: { wall: '#fff1d6', stripe: '#f6deb0', trim: '#a8663a', floor: 'light', sofa: '#e9a23b' },
}

function interior(id, name, outside, door, { w, h, floor, theme, build, decor = [], npcs = [], signs = {} }) {
  const { g, mx } = room(w, h, floor)
  build(g)
  return {
    id, name, g, bg: '#15131f', battleBg: 'meadow', interior: true, floor, theme: THEMES[theme], decor,
    entry: { x: mx, y: h - 2 },
    signs, buildings: [], npcs,
    warps: [{ x: mx, y: h - 1, w: 1, h: 1, to: outside, tx: door[0], ty: door[1] + 1, dir: 'down' }],
    wild: null,
  }
}

function centerRoom(id, name, outside, door, nurseId) {
  return interior(id, name, outside, door, {
    w: 13, h: 9, floor: 'k', theme: 'center',
    build: (g) => {
      rect(g, 3, 3, 7, 1, 'C')
      set(g, 4, 2, 'M'); set(g, 8, 2, 'M')
      set(g, 1, 2, 'P'); set(g, 11, 2, 'P'); set(g, 1, 7, 'P'); set(g, 11, 7, 'P')
      rect(g, 1, 5, 2, 1, 'c'); rect(g, 10, 5, 2, 1, 'c')
      set(g, 11, 4, 'Q'); set(g, 1, 4, 'L')
      rect(g, 5, 5, 3, 3, 'R')
    },
    decor: [
      { x: 2, y: 1, k: 'poster' }, { x: 6, y: 1, k: 'clock' }, { x: 10, y: 1, k: 'certificate' },
      { x: 3, y: 1, k: 'curtain' }, { x: 9, y: 1, k: 'curtain' },
      { x: 5, y: 3, k: 'bell' }, { x: 3, y: 3, k: 'flowerpot' }, { x: 9, y: 3, k: 'books' },
    ],
    npcs: [{ id: nurseId, x: 6, y: 2, dir: 'down', name: '驿站护士', look: L(0, 6, 7, 1, 2, 0), action: 'heal',
      lines: ['欢迎来到精灵驿站！', '我来帮你的精灵们恢复体力……', '♪ ♪ ♪', '你的精灵都恢复健康了！欢迎再来！'] }],
    signs: {},
  })
}

function shopRoom(id, name, outside, door, clerkId) {
  return interior(id, name, outside, door, {
    w: 11, h: 8, floor: 'k', theme: 'shop',
    build: (g) => {
      rect(g, 1, 3, 3, 1, 'C')
      rect(g, 6, 2, 4, 1, 'D'); rect(g, 6, 4, 4, 1, 'D')
      rect(g, 4, 2, 1, 1, 'F')
      set(g, 1, 6, 'P'); set(g, 9, 6, 'P')
      rect(g, 4, 5, 3, 2, 'R')
    },
    decor: [
      { x: 2, y: 1, k: 'poster' }, { x: 5, y: 1, k: 'clock' }, { x: 8, y: 1, k: 'calendar' },
      { x: 2, y: 3, k: 'register' }, { x: 1, y: 3, k: 'flowerpot' },
    ],
    npcs: [{ id: clerkId, x: 2, y: 2, dir: 'down', name: '店员', look: L(1, 0, 1, 3, 1, 1), action: 'shop',
      lines: ['欢迎光临！需要点什么？'] }],
  })
}

const INTERIORS = [
  interior('town_home', '你的家', 'town', [7, 9], {
    w: 11, h: 9, floor: 'w', theme: 'home',
    build: (g) => {
      rect(g, 1, 2, 2, 1, 'K'); set(g, 3, 2, 'F')
      set(g, 5, 2, 'v'); set(g, 6, 2, 'h')
      set(g, 8, 2, 'L'); rect(g, 9, 2, 1, 2, 'b')
      rect(g, 2, 4, 2, 1, 't'); set(g, 1, 4, 'c'); set(g, 4, 4, 'c')
      rect(g, 5, 4, 2, 1, 'O')
      rect(g, 3, 6, 5, 2, 'R')
      set(g, 1, 7, 'P'); set(g, 9, 7, 'P')
    },
    decor: [
      { x: 2, y: 1, k: 'shelfWall' }, { x: 4, y: 1, k: 'curtain' }, { x: 6, y: 1, k: 'painting' },
      { x: 8, y: 1, k: 'clock' }, { x: 9, y: 1, k: 'calendar' },
      { x: 2, y: 4, k: 'vase' }, { x: 3, y: 4, k: 'teaset' }, { x: 6, y: 2, k: 'trophy' },
    ],
    npcs: [{ id: 'mom', x: 7, y: 5, dir: 'left', name: '妈妈', look: L(0, 1, 6, 2), action: 'home',
      lines: ['回来啦？先好好休息一下吧。', '（队伍全部恢复了健康）'] }],
  }),
  interior('town_house2', '小光家', 'town', [28, 9], {
    w: 9, h: 8, floor: 'w', theme: 'kid',
    build: (g) => {
      set(g, 1, 2, 'E'); rect(g, 2, 2, 2, 1, 'h')
      set(g, 5, 2, 'A'); rect(g, 7, 2, 1, 2, 'b')
      set(g, 4, 4, 't'); set(g, 5, 4, 'c')
      rect(g, 2, 5, 4, 2, 'R')
      set(g, 1, 6, 'P'); set(g, 7, 6, 'Q')
    },
    decor: [
      { x: 1, y: 1, k: 'poster' }, { x: 3, y: 1, k: 'worldmap' }, { x: 6, y: 1, k: 'curtain' },
      { x: 2, y: 2, k: 'trophy' }, { x: 3, y: 2, k: 'books' },
    ],
    signs: { '4,4': '桌上有一张字条：“听说幽影森林的祭坛附近，有人见过会发光的蝴蝶！——小光”' },
  }),
  centerRoom('town_center', '新叶镇·精灵驿站', 'town', [7, 18], 'nurse_town'),
  shopRoom('town_shop', '友好商店', 'town', [28, 18], 'clerk_town'),
  centerRoom('village_center', '晨风村·精灵驿站', 'village', [23, 12], 'nurse_village'),
  interior('village_elder', '村长家', 'village', [29, 12], {
    w: 10, h: 8, floor: 'w', theme: 'elder',
    build: (g) => {
      rect(g, 1, 2, 3, 1, 'h'); set(g, 5, 2, 'G'); set(g, 7, 2, 'h')
      set(g, 4, 2, 'L'); set(g, 8, 2, 'P')
      rect(g, 3, 4, 3, 1, 't')
      rect(g, 3, 5, 4, 2, 'R')
      set(g, 1, 6, 'P'); rect(g, 8, 5, 1, 2, 'O')
    },
    decor: [
      { x: 2, y: 1, k: 'worldmap' }, { x: 5, y: 1, k: 'painting' }, { x: 7, y: 1, k: 'certificate' },
      { x: 3, y: 4, k: 'teaset' }, { x: 5, y: 4, k: 'books' }, { x: 7, y: 2, k: 'trophy' },
    ],
    npcs: [{ id: 'elder', x: 7, y: 4, dir: 'left', name: '村长 老松', look: L(1, 4, 5, 2, 0),
      lines: ['年轻人，这个世界没有中心服务器。', '大家的位置和聊天通过 Yjs 实时同步，存档则签名写在 Nostr 上——谁也删不掉你的冒险记录。'] }],
  }),
  interior('village_house', '民居', 'village', [6, 20], {
    w: 9, h: 8, floor: 'w', theme: 'bakery',
    build: (g) => {
      rect(g, 1, 2, 3, 1, 'K'); set(g, 4, 2, 'F')
      rect(g, 7, 2, 1, 2, 'b')
      set(g, 3, 4, 't'); set(g, 4, 4, 't'); set(g, 2, 4, 'c'); set(g, 5, 4, 'c')
      rect(g, 2, 5, 5, 2, 'R')
      set(g, 7, 6, 'P')
    },
    decor: [
      { x: 2, y: 1, k: 'shelfWall' }, { x: 5, y: 1, k: 'curtain' }, { x: 6, y: 1, k: 'painting' },
      { x: 3, y: 4, k: 'bread' }, { x: 4, y: 4, k: 'vase' },
    ],
    npcs: [{ id: 'baker', x: 6, y: 4, dir: 'down', name: '面包奶奶', look: L(0, 4, 3, 4, 2, 3),
      lines: ['刚烤好的面包，要不要尝一块？', '出门在外，记得常回精灵驿站休息哦。'] }],
  }),
  shopRoom('village_shop', '湖畔商店', 'village', [26, 20], 'clerk_village'),
]

// 多人共享的稀有精灵：[物种, 权重, 最低等级, 最高等级]
export const RARE_SPAWNS = [
  ['zappy', 30, 9, 13], ['frostcat', 24, 10, 14], ['lunamoth', 20, 12, 16], ['wispy', 16, 11, 15], ['thundrake', 6, 17, 21],
]

const SOLID = new Set(['T', '~', '#', 'r', 'S', 'W', 'C', 'b', 't', 'c', 'h', 'D', 'P', 'M', 'v', 'F', 'K', 'L', 'O', 'A', 'E', 'G', 'Q'])

function finalize(m) {
  m.h = m.g.length
  m.w = m.g[0].length
  m.tiles = m.g.map((row) => row.join(''))
  m.solid = new Uint8Array(m.w * m.h)
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (SOLID.has(m.g[y][x])) m.solid[y * m.w + x] = 1
  for (const b of m.buildings) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) m.solid[y * m.w + x] = 1
  }
  m.grassTiles = []
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (m.g[y][x] === ',') m.grassTiles.push([x, y])
  delete m.g
  return m
}

export const MAPS = Object.fromEntries([town(), route1(), village(), forest(), ...INTERIORS].map((m) => [m.id, finalize(m)]))
export const tileAt = (m, x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? (m.interior ? 'W' : 'T') : m.tiles[y][x])
