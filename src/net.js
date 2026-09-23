// Yjs 实时层：y-websocket 协议连接 PLATEAU 中继
//   awareness → 玩家位置/朝向/外观（临时状态）
//   Y.Array chat → 已签名的聊天事件
//   Y.Map challenges / battles → PvP 邀请与回合行动
//   Y.Map spawns → 全服共享的稀有精灵
//   Y.Map gifts → 玩家间赠送道具
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { YJS_RELAY, WORLD_ROOM, CHAT_KIND, PRESENCE_KIND } from './config.js'
import { verifyEvent } from './nostr.js'

export class Net {
  constructor(signer) {
    this.signer = signer
    this.doc = new Y.Doc()
    this.provider = new WebsocketProvider(YJS_RELAY.url, WORLD_ROOM, this.doc, { params: { token: YJS_RELAY.token } })
    this.awareness = this.provider.awareness
    this.chat = this.doc.getArray('chat')
    this.challenges = this.doc.getMap('challenges')
    this.battles = this.doc.getMap('battles')
    this.spawns = this.doc.getMap('spawns')
    this.gifts = this.doc.getMap('gifts')
    this.local = {}
    this.verified = new Map() // `${cid}:${pk}` → bool
    this.status = 'connecting'
    this.synced = false
    this.provider.on('status', (e) => { this.status = e.status; this.onStatus?.(e.status) })
    this.provider.on('sync', (s) => { this.synced = s; if (s) this.onSync?.() })
    window.addEventListener('beforeunload', () => this.awareness.setLocalState(null))
  }

  get cid() { return this.doc.clientID }

  async initPresence(base) {
    // 在线凭证：用 Nostr 私钥签名，其他玩家据此显示“已验证”
    const proof = await this.signer.sign({ kind: PRESENCE_KIND, created_at: Math.floor(Date.now() / 1000), tags: [['room', WORLD_ROOM]], content: 'nostrmon-presence' })
    this.local = { ...base, pk: this.signer.pubkey, proof }
    this.awareness.setLocalState(this.local)
  }

  setPresence(patch) {
    Object.assign(this.local, patch)
    this.awareness.setLocalState({ ...this.local })
  }

  players() {
    const out = []
    this.awareness.getStates().forEach((s, cid) => {
      if (cid !== this.cid && s && s.pk && s.map) out.push({ cid, ...s })
    })
    return out
  }

  isVerified(p) {
    const k = `${p.cid}:${p.pk}`
    if (!this.verified.has(k)) {
      const e = p.proof
      let ok = false
      try { ok = !!e && e.pubkey === p.pk && e.kind === PRESENCE_KIND && e.tags?.some((t) => t[0] === 'room' && t[1] === WORLD_ROOM) && verifyEvent(e) } catch {}
      this.verified.set(k, ok)
    }
    return this.verified.get(k)
  }

  // 权威客户端：所有在线游戏客户端中 clientID 最小者，负责刷新稀有精灵、清理旧数据
  isAuthority() {
    let min = this.cid
    this.awareness.getStates().forEach((s, cid) => { if (s?.pk && cid < min) min = cid })
    return min === this.cid
  }

  async sendChat(text, map, name) {
    const ev = await this.signer.sign({
      kind: CHAT_KIND, created_at: Math.floor(Date.now() / 1000),
      tags: [['map', map], ['name', name], ['room', WORLD_ROOM]], content: text,
    })
    this.chat.push([ev])
  }

  static checkChat(ev) {
    try { return ev && ev.kind === CHAT_KIND && typeof ev.content === 'string' && verifyEvent(ev) } catch { return false }
  }

  trimChat() {
    if (this.chat.length > 160) this.chat.delete(0, this.chat.length - 120)
  }

  cleanup() {
    const cutoff = Date.now() - 60 * 60 * 1000
    this.doc.transact(() => {
      this.challenges.forEach((c, k) => { if ((c.ts || 0) < cutoff) this.challenges.delete(k) })
      this.battles.forEach((b, k) => { if ((b.get('meta')?.ts || 0) < cutoff) this.battles.delete(k) })
      this.gifts.forEach((g, k) => { if ((g.ts || 0) < cutoff - 23 * 3600 * 1000) this.gifts.delete(k) })
      this.spawns.forEach((s, k) => { if (s.exp < Date.now()) this.spawns.delete(k) })
    })
  }
}

export { Y }
