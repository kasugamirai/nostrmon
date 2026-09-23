// Nostr：身份（自动生成 / nsec 导入 / NIP-07 扩展）+ 存档数据库（NIP-78 kind 30078）
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import * as nip19 from 'nostr-tools/nip19'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { NOSTR_RELAYS, SAVE_D, APP_TAG, lsGet, lsSet } from './config.js'

export { verifyEvent, nip19 }

export const pool = new SimplePool({ enablePing: true, enableReconnect: true })
export const relayStatus = Object.fromEntries(NOSTR_RELAYS.map((r) => [r, 'pending']))

const now = () => Math.floor(Date.now() / 1000)

function localSigner(skHex, created) {
  const sk = hexToBytes(skHex)
  const pubkey = getPublicKey(sk)
  return {
    type: 'local', pubkey, created,
    generated: lsGet('generated', false),
    npub: nip19.npubEncode(pubkey),
    nsec: () => nip19.nsecEncode(sk),
    sign: async (t) => finalizeEvent(t, sk),
  }
}

function nip07Signer(pubkey) {
  return {
    type: 'nip07', pubkey, created: false, generated: false,
    npub: nip19.npubEncode(pubkey),
    nsec: () => null,
    sign: (t) => window.nostr.signEvent(t),
  }
}

// 打开即用：没有密钥就自动生成一个新的 Nostr 账户
export async function initIdentity() {
  if (lsGet('signer') === 'nip07' && window.nostr) {
    try { return nip07Signer(await window.nostr.getPublicKey()) } catch { /* 回退到本地密钥 */ }
  }
  let skHex = lsGet('sk')
  let created = false
  if (!skHex || !/^[0-9a-f]{64}$/.test(skHex)) {
    skHex = bytesToHex(generateSecretKey())
    lsSet('sk', skHex)
    lsSet('generated', true)
    created = true
  }
  lsSet('signer', 'local')
  return localSigner(skHex, created)
}

export function importSecret(input) {
  let s = input.trim()
  let hex
  if (s.startsWith('nsec')) {
    const d = nip19.decode(s)
    if (d.type !== 'nsec') throw new Error('不是 nsec 私钥')
    hex = bytesToHex(d.data)
  } else if (/^[0-9a-f]{64}$/i.test(s)) hex = s.toLowerCase()
  else throw new Error('请输入 nsec1… 或 64 位十六进制私钥')
  getPublicKey(hexToBytes(hex))
  lsSet('sk', hex)
  lsSet('generated', false)
  lsSet('signer', 'local')
}

export function useExtension() { lsSet('signer', 'nip07') }

export function newIdentity() {
  lsSet('sk', bytesToHex(generateSecretKey()))
  lsSet('generated', true)
  lsSet('signer', 'local')
}

export async function publish(ev) {
  const res = await Promise.allSettled(pool.publish(NOSTR_RELAYS, ev, { maxWait: 7000 }))
  res.forEach((r, i) => { relayStatus[NOSTR_RELAYS[i]] = r.status === 'fulfilled' ? 'ok' : 'fail' })
  return res.filter((r) => r.status === 'fulfilled').length
}

export async function loadSave(pubkey) {
  const evs = await pool.querySync(NOSTR_RELAYS, { kinds: [30078], authors: [pubkey], '#d': [SAVE_D] }, { maxWait: 5000 })
  const best = evs.filter((e) => e.pubkey === pubkey).sort((a, b) => b.created_at - a.created_at)[0]
  if (!best) return null
  try { return { save: JSON.parse(best.content), created_at: best.created_at } } catch { return null }
}

// 存档：可替换的应用数据事件，每次写入覆盖旧版本
export async function publishSave(signer, save) {
  const ev = await signer.sign({
    kind: 30078,
    created_at: now(),
    tags: [['d', SAVE_D], ['t', APP_TAG], ['client', 'nostrmon'], ['alt', 'Nostrmon 游戏存档']],
    content: JSON.stringify(save),
  })
  return publish(ev)
}

// 只给自动生成的账户写 kind 0，避免覆盖用户已有的 Nostr 个人资料
export async function publishProfile(signer, name) {
  if (!signer.generated) return 0
  const ev = await signer.sign({
    kind: 0, created_at: now(), tags: [],
    content: JSON.stringify({ name, display_name: name, about: '在 Nostrmon 像素世界冒险的训练家' }),
  })
  return publish(ev)
}

export async function fetchProfileName(pubkey) {
  const ev = await pool.get(NOSTR_RELAYS, { kinds: [0], authors: [pubkey] }, { maxWait: 4000 })
  try { const c = JSON.parse(ev.content); return c.display_name || c.name || null } catch { return null }
}

export async function fetchLeaderboard() {
  const evs = await pool.querySync(NOSTR_RELAYS, { kinds: [30078], '#d': [SAVE_D], limit: 300 }, { maxWait: 6000 })
  const byPk = new Map()
  for (const e of evs) {
    const prev = byPk.get(e.pubkey)
    if (!prev || prev.created_at < e.created_at) byPk.set(e.pubkey, e)
  }
  const rows = []
  for (const e of byPk.values()) {
    try {
      const s = JSON.parse(e.content)
      rows.push({
        pubkey: e.pubkey, npub: nip19.npubEncode(e.pubkey), name: s.name || '无名训练家', look: s.look,
        caught: Object.keys(s.dex?.caught || {}).length, wins: s.stats?.pvpW || 0, losses: s.stats?.pvpL || 0,
        lead: s.party?.[0], updated: e.created_at * 1000,
      })
    } catch { /* 忽略损坏的存档 */ }
  }
  return rows.sort((a, b) => b.caught - a.caught || b.wins - a.wins || b.updated - a.updated)
}

export async function fetchPlayerSave(pubkey) {
  const r = await loadSave(pubkey)
  return r?.save || null
}

// relay 健康度：启动时探测一次连通性，之后以每次写入结果为准
export async function probeRelays() {
  await Promise.all(NOSTR_RELAYS.map(async (url) => {
    try { await pool.ensureRelay(url, { connectionTimeout: 5000 }); if (relayStatus[url] === 'pending') relayStatus[url] = 'ok' }
    catch { if (relayStatus[url] === 'pending') relayStatus[url] = 'fail' }
  }))
}
export function relayHealth() {
  const ok = NOSTR_RELAYS.filter((r) => relayStatus[r] === 'ok').length
  return { ok, total: NOSTR_RELAYS.length }
}
