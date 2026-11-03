# frontend

`搭个话` 的前端（Vite + React + TypeScript + Tailwind v4）。当前是 M0/M1 阶段：页面骨架、入房表单、房间页渲染都跑通了，网络层只接了 `client-config`，WebSocket 与写接口还没接。

## 启动

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run typecheck      # tsc --noEmit
npm run build          # tsc -b && vite build
```

`/api` 通过 Vite 代理到 `http://127.0.0.1:4010`（`contracts` 的 Prism Mock）：

```bash
npm run mock:http --prefix ../contracts
```

## 路由

| 路由 | 页面 | 状态 |
| --- | --- | --- |
| `/` | 入口 | 演示用，两个入口 |
| `/join/:roomId?inviteCode=` | 入房 | 表单 + 校验已做，提交暂时直接跳房间 |
| `/rooms/:roomId` | 房间 | 用本地快照渲染，输入可发消息（仅本地） |

## 目录

```
src/
├── app/App.tsx            路由表
├── pages/                 Home / Join / Room
├── features/
│   ├── join/JoinForm      昵称、兴趣标签、简介 + 校验
│   ├── room/MemberCard    成员名片（角色色、标签、掉线倒计时）
│   ├── room/InviteDialog  二维码 + 复制链接
│   └── chat/ChatFeed、Composer
├── state/
│   ├── roomStore.ts       reducer + useSyncExternalStore（已处理 snapshot / message.created / topic.changed / 成员事件 / AI 流式）
│   └── demo.ts            本地快照，后端就绪后删除
└── shared/
    ├── api/client.ts      请求封装：Bearer、X-Membership-Id、错误归一（ApiError）
    ├── api/types.ts       从 @talk-together/contracts 转出的类型别名
    └── ui/Avatar、personColor
```

## 契约

类型来自 `../contracts`（`file:` 依赖），只做 `import type`：

```ts
import type { components } from '@talk-together/contracts'
```

前端不导入 `backend/` 的任何代码。协议字段变更先改 `contracts/`，重跑 `npm run types --prefix contracts`。

## 还没做的

- WebSocket：领票 → 连 `webSocketUrl` → 用 `room.snapshot` 初始化 → 只处理 `sequence > cursor`；
- 写接口：创建 / 加入 / 改资料 / 移出 / 关房，以及 `clientRequestId` 幂等与本地重试；
- 入房前两次提交的 `bootstrapToken` 与多标签页协调；
- 发送时 `mentions: ["ai"]` 的真实提交与 `ai.status` 回执展示；
- 空态、错误态、限频冷却、被移出与关房终态页；
- 单元测试（reducer 回放 `contracts/examples/ws/*`）。

## 设计

视觉规范见 [`docs/frontend/design-system.md`](../docs/frontend/design-system.md)，静态稿在 [`design/`](../design)。
