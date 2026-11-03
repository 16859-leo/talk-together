# frontend

`搭个话` 的前端（Vite + React + TypeScript + Tailwind v4）。

当前进度：**M2 进行中**。WebSocket 链路（领票 → 建连 → 首帧快照 → 增量事件）和发送接口已经接上，并对 `contracts` 的本地 Mock 跑通；入房与创建房间的写接口还没接，演示时用本地快照 + 开发态身份。

## 启动

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run typecheck      # tsc --noEmit
npm run build          # tsc -b && vite build
```

联调时另开两个终端起 Mock：

```bash
npm run mock:http --prefix ../contracts
npm run mock:ws --prefix ../contracts -- host-stream
```

`/api` 通过 Vite 代理到 `http://127.0.0.1:4010`；WS 地址由票据接口返回的 `webSocketUrl` 决定，前端不自行拼接。

## 路由

| 路由 | 页面 | 状态 |
| --- | --- | --- |
| `/` | 开场 | 全屏标题 talk together |
| `/join/:roomId?inviteCode=` | 入房 | 表单校验来自 `client-config`；提交暂时直接跳房间 |
| `/rooms/:roomId` | 房间 | 接 WS 事件流；发送走 `POST /messages` |

## 目录

```
src/
├── app/App.tsx              路由表
├── pages/                   Home / Join / Room
├── features/
│   ├── join/JoinForm        昵称、兴趣标签、简介 + 校验
│   ├── room/MemberCard      成员名片（角色色、标签、掉线倒计时）
│   ├── room/InviteDialog    二维码 + 复制链接
│   └── chat/ChatFeed、Composer
├── state/
│   ├── roomStore.ts         reducer + useSyncExternalStore，含游标去重
│   ├── session.ts           房间级凭证存取（localStorage）
│   └── demo.ts              本地快照，作为后端未起时的兜底
└── shared/
    ├── api/client.ts        统一信封、ApiError、Bearer 与 X-Membership-Id
    ├── api/room.ts          票据、发消息、加入、创建
    ├── realtime/connection.ts  领票 → 建连 → 快照 → 事件；断线重连续票
    └── ui/Avatar、personColor
```

## 已实现的协议行为

- 每次连接（含重连）单独领取一次性票据，使用服务端返回的 `webSocketUrl`；
- 首帧 `room.snapshot` 整体替换状态并以 `cursor` 起算；
- 之后只接受 `sequence > cursor` 的事件，跳号正常、重复丢弃；
- 断线退避重连 0.5s → 5s，重连前重新领票；
- 发送带 `clientRequestId`，回执里的 `ai.status` 会区分「未受理 / 被忽略」，失败按 `retryAfterMs` 提示；
- 后端不可达时退回本地发送，界面不假死。

## 还没做的

- 入房与创建房间的真实提交（`bootstrapToken` + `clientRequestId` 幂等、多标签页共用一份待提交凭证）；
- 发送失败后的重试策略（目前每次发送生成新 ID，尚未复用上一次的 ID 重试）；
- 改资料、移出成员、关房，以及被移出/关房/满员的终态页；
- 断线期间的时间轴占位与「重连中」更细的状态提示；
- 单元测试：reducer 回放 `contracts/examples/ws/*` 的 12 个场景。

## 契约

类型来自 `../contracts`（`file:` 依赖），只做 `import type`：

```ts
import type { components } from '@talk-together/contracts'
```

前端不导入 `backend/` 的任何代码。协议字段变更先改 `contracts/`，重跑 `npm run types --prefix contracts`。

## 设计

视觉规范见 [`docs/frontend/design-system.md`](../docs/frontend/design-system.md)，静态稿在 [`design/`](../design)。
