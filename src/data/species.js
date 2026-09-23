// 原创精灵图鉴。look 字段交给 render/sprites.js 程序化绘制像素立绘。
export const SPECIES = {
  flamefox: {
    no: 1, name: '火苗狐', types: ['fire'], base: { hp: 39, atk: 55, def: 43, spd: 65 }, catch: 45, xp: 62,
    learn: [[1, 'scratch'], [1, 'growl'], [5, 'ember'], [9, 'quick'], [13, 'flamewheel'], [20, 'flamethrower']],
    evo: { lv: 16, to: 'blazefox' },
    look: { body: 'oval', c1: '#f2713a', c2: '#ffe2b8', c3: '#ffd23f', ears: 'fox', tail: 'flame', eyes: 'big', extra: ['cheeks'] },
    desc: '尾巴尖上的小火苗会随心情忽明忽暗，开心时会烧得特别旺。',
  },
  blazefox: {
    no: 2, name: '焰尾狐', types: ['fire'], base: { hp: 58, atk: 82, def: 62, spd: 92 }, catch: 45, xp: 142,
    learn: [[1, 'scratch'], [1, 'ember'], [13, 'flamewheel'], [20, 'flamethrower'], [26, 'headbutt']],
    look: { body: 'long', c1: '#e0482c', c2: '#ffd9a8', c3: '#ffcf2e', ears: 'fox', tail: 'flame', eyes: 'fierce', extra: ['mane'] },
    desc: '奔跑时尾焰拉出长长的光带，夜里远远就能看见。',
  },
  bubfrog: {
    no: 3, name: '泡泡蛙', types: ['water'], base: { hp: 44, atk: 48, def: 65, spd: 43 }, catch: 45, xp: 63,
    learn: [[1, 'tackle'], [1, 'growl'], [5, 'bubble'], [9, 'harden'], [12, 'watergun'], [20, 'aquatail']],
    evo: { lv: 16, to: 'tidefrog' },
    look: { body: 'wide', c1: '#4fa3e8', c2: '#d6f0ff', c3: '#ff8fb1', ears: 'frog', tail: 'none', eyes: 'big', extra: ['cheeks', 'bubble'] },
    desc: '从嘴里吐出的泡泡有弹性，可以在上面跳来跳去。',
  },
  tidefrog: {
    no: 4, name: '浪涌蛙', types: ['water'], base: { hp: 72, atk: 70, def: 90, spd: 58 }, catch: 45, xp: 142,
    learn: [[1, 'tackle'], [1, 'bubble'], [12, 'watergun'], [20, 'aquatail'], [28, 'icefang']],
    look: { body: 'wide', c1: '#2f6fd1', c2: '#bfe6ff', c3: '#ffd23f', ears: 'frog', tail: 'none', eyes: 'fierce', extra: ['crest'] },
    desc: '用背上的鳍感知海浪的方向，能掀起一人高的水墙。',
  },
  sprout: {
    no: 5, name: '芽芽龟', types: ['grass'], base: { hp: 45, atk: 49, def: 52, spd: 45 }, catch: 45, xp: 64,
    learn: [[1, 'tackle'], [1, 'growl'], [5, 'vine'], [9, 'absorb'], [12, 'growth'], [16, 'razorleaf'], [24, 'leafstorm']],
    evo: { lv: 16, to: 'grovetle' },
    look: { body: 'round', c1: '#8bd46a', c2: '#f4e8b0', c3: '#5aa33c', ears: 'leaf', tail: 'none', eyes: 'normal', extra: ['shell'] },
    desc: '晒太阳时头上的嫩芽会轻轻摇晃，看起来很惬意。',
  },
  grovetle: {
    no: 6, name: '森甲龟', types: ['grass'], base: { hp: 80, atk: 80, def: 85, spd: 58 }, catch: 45, xp: 142,
    learn: [[1, 'tackle'], [1, 'vine'], [16, 'razorleaf'], [24, 'leafstorm'], [30, 'synthesis']],
    look: { body: 'wide', c1: '#5fae48', c2: '#e8d99a', c3: '#3d7f2c', ears: 'bush', tail: 'none', eyes: 'fierce', extra: ['shell'] },
    desc: '背甲上长着一小片灌木，小鸟会在上面筑巢。',
  },
  zappy: {
    no: 7, name: '噼啪鼠', types: ['electric'], base: { hp: 35, atk: 55, def: 40, spd: 90 }, catch: 90, xp: 82,
    learn: [[1, 'thundershock'], [1, 'growl'], [6, 'quick'], [11, 'spark'], [17, 'agility'], [22, 'thunderbolt']],
    look: { body: 'round', c1: '#8fcfff', c2: '#f4fbff', c3: '#ffd23f', ears: 'round', tail: 'bolt', eyes: 'big', extra: ['cheeks'], cheek: '#ffd23f' },
    desc: '圆滚滚的蓝色仓鼠，尾巴会攒静电，被摸到时噼啪作响。',
  },
  chirp: {
    no: 8, name: '啾啾鸟', types: ['normal', 'flying'], base: { hp: 40, atk: 45, def: 40, spd: 58 }, catch: 255, xp: 50,
    learn: [[1, 'tackle'], [1, 'growl'], [5, 'peck'], [11, 'quick'], [15, 'wingattack']],
    look: { body: 'bird', c1: '#b88a5c', c2: '#f5e6cf', c3: '#f2a33a', ears: 'tuft', tail: 'feather', eyes: 'normal', extra: ['wings'] },
    desc: '每天清晨准时在树梢上叫醒整个小镇。',
  },
  fluffbun: {
    no: 9, name: '毛球兔', types: ['normal'], base: { hp: 52, atk: 45, def: 45, spd: 60 }, catch: 255, xp: 52,
    learn: [[1, 'tackle'], [1, 'leer'], [6, 'quick'], [12, 'headbutt']],
    look: { body: 'round', c1: '#f3efe6', c2: '#ffd6e0', c3: '#f7a1b8', ears: 'bunny', tail: 'puff', eyes: 'sleepy', extra: ['cheeks'] },
    desc: '软绵绵的一团，睡着的时候经常被误认成棉花。',
  },
  pebblin: {
    no: 10, name: '石头仔', types: ['rock', 'ground'], base: { hp: 40, atk: 80, def: 100, spd: 20 }, catch: 190, xp: 60,
    learn: [[1, 'tackle'], [1, 'harden'], [6, 'rockthrow'], [11, 'mudshot'], [17, 'rockslide'], [24, 'dig']],
    look: { body: 'round', c1: '#9a8f80', c2: '#bdb3a4', c3: '#6d6356', ears: 'none', tail: 'none', eyes: 'fierce', extra: ['rocky', 'arms'] },
    desc: '常常把自己埋在路边，被踩到时会大发脾气。',
  },
  shroomy: {
    no: 11, name: '蘑菇菇', types: ['grass'], base: { hp: 60, atk: 55, def: 55, spd: 30 }, catch: 190, xp: 62,
    learn: [[1, 'absorb'], [1, 'growth'], [7, 'vine'], [13, 'razorleaf'], [19, 'synthesis']],
    look: { body: 'pear', c1: '#f5e9d3', c2: '#fff8ec', c3: '#e0453a', ears: 'none', tail: 'none', eyes: 'sleepy', extra: ['cap'] },
    desc: '在潮湿的树荫下成群出现，头上的伞盖会散发孢子。',
  },
  wispy: {
    no: 12, name: '小幽灵', types: ['ghost'], base: { hp: 38, atk: 62, def: 38, spd: 82 }, catch: 120, xp: 70,
    learn: [[1, 'lick'], [1, 'leer'], [8, 'confusion'], [14, 'shadowball'], [20, 'psybeam']],
    look: { body: 'ghost', c1: '#9b7fd1', c2: '#c9b6f0', c3: '#ff6fa8', ears: 'none', tail: 'none', eyes: 'glow', extra: ['tongue'] },
    desc: '喜欢在夜里的森林中捉弄迷路的旅人，但并无恶意。',
  },
  frostcat: {
    no: 13, name: '冰晶猫', types: ['ice'], base: { hp: 55, atk: 62, def: 50, spd: 72 }, catch: 90, xp: 78,
    learn: [[1, 'scratch'], [1, 'growl'], [6, 'powdersnow'], [12, 'quick'], [16, 'icefang'], [24, 'icebeam']],
    look: { body: 'oval', c1: '#bfe9f2', c2: '#ffffff', c3: '#5cb8d6', ears: 'cat', tail: 'curl', eyes: 'normal', extra: ['crystal'] },
    desc: '呼出的气会凝成细小的冰晶，在阳光下闪闪发亮。',
  },
  beetlet: {
    no: 14, name: '甲虫宝', types: ['bug'], base: { hp: 45, atk: 52, def: 58, spd: 40 }, catch: 255, xp: 48,
    learn: [[1, 'tackle'], [1, 'harden'], [5, 'bugbite'], [12, 'headbutt'], [18, 'silverwind']],
    look: { body: 'round', c1: '#6aa33a', c2: '#d8e88a', c3: '#3b5e1f', ears: 'antenna', tail: 'none', eyes: 'big', extra: ['beetle'] },
    desc: '背壳坚硬，喜欢用触角去碰碰新朋友。',
  },
  lunamoth: {
    no: 15, name: '月光蝶', types: ['bug', 'psychic'], base: { hp: 60, atk: 72, def: 60, spd: 88 }, catch: 45, xp: 160,
    learn: [[1, 'confusion'], [1, 'bugbite'], [10, 'psybeam'], [15, 'agility'], [20, 'silverwind']],
    look: { body: 'tall', c1: '#7d6fd6', c2: '#e9e2ff', c3: '#ffe27a', ears: 'antenna', tail: 'none', eyes: 'glow', extra: ['moth'] },
    desc: '只在满月前后现身，翅膀上的鳞粉会映出月光。',
  },
  thundrake: {
    no: 16, name: '雷鸣龙', types: ['dragon', 'electric'], base: { hp: 82, atk: 98, def: 80, spd: 92 }, catch: 12, xp: 240,
    learn: [[1, 'dragonbreath'], [1, 'spark'], [18, 'thunderbolt'], [24, 'dragonpulse']],
    look: { body: 'tall', c1: '#3f4fb8', c2: '#ffe066', c3: '#ffd23f', ears: 'horns', tail: 'bolt', eyes: 'fierce', extra: ['dragonwings'] },
    desc: '传说中伴随雷雨出现的龙。能见到它的训练家屈指可数。',
  },
  coralfin: {
    no: 17, name: '珊瑚鱼', types: ['water'], base: { hp: 45, atk: 55, def: 50, spd: 68 }, catch: 190, xp: 58,
    learn: [[1, 'bubble'], [1, 'leer'], [8, 'watergun'], [16, 'aquatail']],
    look: { body: 'fish', c1: '#ff8a65', c2: '#fff1e6', c3: '#ff5e7e', ears: 'fin', tail: 'fish', eyes: 'big', extra: ['stripes'] },
    desc: '鱼鳞像珊瑚一样五彩斑斓，常在湖边浅水处晒太阳。',
  },
  molebit: {
    no: 18, name: '沙沙鼹', types: ['ground'], base: { hp: 50, atk: 66, def: 55, spd: 45 }, catch: 190, xp: 60,
    learn: [[1, 'scratch'], [1, 'leer'], [6, 'mudshot'], [13, 'headbutt'], [18, 'dig']],
    look: { body: 'pear', c1: '#a0724a', c2: '#e8c9a0', c3: '#ff9d8f', ears: 'round', tail: 'none', eyes: 'sleepy', extra: ['claws', 'nose'] },
    desc: '一天能挖出十几条地道，农夫们又爱又恨。',
  },
}

// 坐骑专用的原创传说精灵（每位训练家开局赠送），不会在野外出现
SPECIES.skyqilin = {
  no: 19, name: '天穹麒麟', types: ['psychic', 'dragon'], base: { hp: 105, atk: 110, def: 100, spd: 125 }, catch: 3, xp: 300, mount: true,
  learn: [[1, 'dragonpulse'], [1, 'psybeam'], [1, 'agility'], [1, 'headbutt']],
  look: { body: 'long', c1: '#fbf6ea', c2: '#dfe7f1', c3: '#ffc43d', ears: 'horns', tail: 'curl', eyes: 'fierce', extra: ['mane', 'crest'] },
  desc: '传说中踏云而行的神兽，金色的鬃毛能驱散雷雨。它愿意载着信任的训练家穿越整个世界。',
}

export const SPECIES_LIST = Object.entries(SPECIES).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.no - b.no)
export const STARTERS = ['flamefox', 'bubfrog', 'sprout']
export const DEFAULT_MOUNT = 'skyqilin'
