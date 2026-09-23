export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashStr(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const randId = (n = 10) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(36).padStart(2, '0').slice(-1)).join('')

export function pickWeighted(table, rng = Math.random) {
  const total = table.reduce((s, e) => s + e[1], 0)
  let r = rng() * total
  for (const e of table) {
    r -= e[1]
    if (r <= 0) return e
  }
  return table[table.length - 1]
}

export function shortKey(npub) {
  return npub ? npub.slice(0, 10) + '…' + npub.slice(-4) : ''
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export function timeAgo(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return s + ' 秒前'
  if (s < 3600) return Math.round(s / 60) + ' 分钟前'
  if (s < 86400) return Math.round(s / 3600) + ' 小时前'
  return Math.round(s / 86400) + ' 天前'
}
