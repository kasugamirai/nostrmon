# Nostrmon 像素精灵

一个类宝可梦的多人网页游戏：城镇 / 道路 / 村庄 / 森林四张地图，实时看到其他训练家走动和聊天，野外抓宠、NPC 训练家对战、玩家之间实时 PvP，全服共享的稀有精灵。

```bash
npm install
npm run dev      # http://localhost:5188
npm run build    # 输出 dist/，任何静态托管都能部署
```

## 架构

| 层 | 用途 | 实现 |
| --- | --- | --- |
| 身份 | 打开即自动生成 Nostr 密钥（存 localStorage），也可导入 nsec 或用 NIP-07 扩展 | `src/nostr.js` |
| 存档数据库 | 队伍 / 背包 / 图鉴 / 战绩 → NIP-78 `kind 30078`，`d=nostrmon:save:v1`，写入 4 个 relay | `src/nostr.js` |
| 排行榜 | 直接查询所有人的 `kind 30078` 存档事件 | `src/menus.js` |
| 实时同步 | y-websocket 协议，预设 `plateau` → `wss://ws.flow.plateau.reearth.io/<房间>?token=netdisk` | `src/config.js`, `src/net.js` |

Yjs 文档结构（房间 `nostrmon-world-v1`）：

- **awareness**：位置、朝向、外观、首发精灵、表情、在线签名凭证（临时状态）
- **`chat`** (Y.Array)：每条消息都是用 Nostr 私钥签名的事件，接收方 `verifyEvent` 校验后显示 ✓
- **`challenges` / `battles`** (Y.Map)：PvP 邀请与每回合的行动。双方只交换“行动”，伤害由同一随机种子在本地确定性计算（`src/battle.js`）
- **`spawns`** (Y.Map)：权威客户端（在线最小 clientID）定时刷新的稀有精灵，先到先得
- **`gifts`** (Y.Map)：玩家之间赠送道具

## URL 参数

- `?room=xxx` 换一个 Yjs 房间（私服）
- `?profile=xxx` 同一浏览器开多个独立账号（多开测试用）
- `?relay=plateau` 选择 Yjs 中继预设（在 `src/config.js` 的 `YJS_RELAY_PRESETS` 里加新的）

## 操作

方向键 / WASD 移动，Shift 奔跑，点击地面自动寻路；空格 / Z 互动；Enter 聊天；Esc / M 菜单；点击其他训练家发起对战。手机上有虚拟方向键和 A/B 键。

所有精灵、角色、地图图块都由代码程序化绘制（`src/render/`），没有外部图片资源；精灵均为原创设计。
