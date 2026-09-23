export const TYPES = {
  normal: { name: '普通', color: '#a8a77a' },
  fire: { name: '火', color: '#ee8130' },
  water: { name: '水', color: '#6390f0' },
  grass: { name: '草', color: '#6fb83f' },
  electric: { name: '电', color: '#e8bd12' },
  ice: { name: '冰', color: '#6cc9c5' },
  rock: { name: '岩石', color: '#b6a136' },
  ground: { name: '地面', color: '#d4a84a' },
  flying: { name: '飞行', color: '#8f78e6' },
  bug: { name: '虫', color: '#98ad16' },
  ghost: { name: '幽灵', color: '#735797' },
  psychic: { name: '超能', color: '#f95587' },
  dragon: { name: '龙', color: '#6f35fc' },
}

// 攻击属性 → 防守属性 → 倍率（未列出为 1）
const CHART = {
  normal: { rock: 0.5, ghost: 0 },
  fire: { grass: 2, ice: 2, bug: 2, fire: 0.5, water: 0.5, rock: 0.5, dragon: 0.5 },
  water: { fire: 2, rock: 2, ground: 2, water: 0.5, grass: 0.5, dragon: 0.5 },
  grass: { water: 2, rock: 2, ground: 2, fire: 0.5, grass: 0.5, flying: 0.5, bug: 0.5, dragon: 0.5 },
  electric: { water: 2, flying: 2, electric: 0.5, grass: 0.5, dragon: 0.5, ground: 0 },
  ice: { grass: 2, ground: 2, flying: 2, dragon: 2, fire: 0.5, water: 0.5, ice: 0.5 },
  rock: { fire: 2, ice: 2, flying: 2, bug: 2, ground: 0.5 },
  ground: { fire: 2, electric: 2, rock: 2, grass: 0.5, bug: 0.5, flying: 0 },
  flying: { grass: 2, bug: 2, electric: 0.5, rock: 0.5 },
  bug: { grass: 2, psychic: 2, fire: 0.5, flying: 0.5, ghost: 0.5 },
  ghost: { ghost: 2, psychic: 2, normal: 0 },
  psychic: { ground: 2, rock: 2, psychic: 0.5 },
  dragon: { dragon: 2 },
}

export function effectiveness(atkType, defTypes) {
  return defTypes.reduce((m, t) => m * (CHART[atkType]?.[t] ?? 1), 1)
}
