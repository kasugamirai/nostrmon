// 全局配置：Yjs 中继预设、房间、Nostr relay 列表
const qs = new URLSearchParams(location.search)

// Yjs 同步中继预设。连接走 y-websocket 协议：
//   <url>/<房间名>?token=<token>
export const YJS_RELAY_PRESETS = {
  plateau: { url: 'wss://ws.flow.plateau.reearth.io', token: 'netdisk', label: 'PLATEAU Flow' },
}
export const DEFAULT_YJS_PRESET = 'plateau'
export const YJS_PRESET = YJS_RELAY_PRESETS[qs.get('relay')] ? qs.get('relay') : DEFAULT_YJS_PRESET
export const YJS_RELAY = YJS_RELAY_PRESETS[YJS_PRESET]

// 整个世界共享一个 Yjs 房间（?room= 可切换到私服）
export const WORLD_ROOM = (qs.get('room') || 'nostrmon-world-v1').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 64)

// ?profile=xxx 可在同一浏览器里开多个独立账号（方便多开测试）
export const PROFILE = (qs.get('profile') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 16)
const LS_PREFIX = 'nostrmon' + (PROFILE ? ':' + PROFILE : '') + ':'

export const NOSTR_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom']
export const SAVE_D = 'nostrmon:save:v1' // NIP-78 (kind 30078) 存档的 d 标签
export const APP_TAG = 'nostrmon'
export const CHAT_KIND = 20420 // 临时事件区间：签名但只经 Yjs 传播，不发到 relay
export const PRESENCE_KIND = 20421

export function lsGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(LS_PREFIX + key)
    return v == null ? fallback : JSON.parse(v)
  } catch { return fallback }
}
export function lsSet(key, value) {
  try { localStorage.setItem(LS_PREFIX + key, JSON.stringify(value)) } catch {}
}
export function lsDel(key) {
  try { localStorage.removeItem(LS_PREFIX + key) } catch {}
}
