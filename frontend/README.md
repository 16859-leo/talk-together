# frontend

`搭个话` 的前端（Vite + React + TypeScript + Tailwind v4）。

当前进度：**M2 基本完成**。入房提交、WebSocket 事件流、发送与幂等重试都已接上，并对 `contracts` 的本地 Mock 跑通；创建房间与成员管理还没接。

## 启动

```bash
npm install
npm run dev            # http://127.0.0.1:5173
npm run typecheck      # tsc --noEmit
npm test               # 回放 contracts 的 12 个 WS 场景
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
| `/` | 开场 | 全屏标题 talk together，主按钮开房 |
| `/create` | 创建房间 | `POST /rooms`，建成后直接进房 |
| `/join/:roomId?inviteCode=` | 入房 | 真实提交 `POST /rooms/{id}/members`，含引导凭证与错误映射 |
| `/rooms/:roomId` | 房间 | WS 事件流 + 发送 + 退出；已有关房/被移出终态 |

## 目录

```
src/
├── app/App.tsx              路由表
├── pages/                   Home / Join / Room
├── features/
│   ├── join/JoinForm        昵称、兴趣标签、简介 + 校验
│   ├── room/MemberCard      成员名片（角色色、标签、掉线倒计时）
│   ├── room/InviteDialog    二维码 + 复制链接
│   └── chat/ChatFeed、Composer（失败会把文字还回去）
├── state/
│   ├── roomStore.ts         reducer + useSyncExternalStore，含游标去重
│   ├── session.ts           成员凭证与入房引导凭证（localStorage）
│   └── demo.ts              本地快照，作为后端未起时的兜底
└── shared/
    ├── api/client.ts        统一信封、ApiError、Bearer 与 X-Membership-Id
    ├── api/room.ts          票据、发消息、加入、创建、getSelf、退出
    ├── realtime/connection.ts  领票 → 建连 → 快照 → 事件；断线重连续票
    └── ui/Avatar、personColor
```

## 已实现的协议行为

- **入房**：每次提交带 `bootstrapToken` + `clientRequestId`（存在 localStorage，重试和并行标签页复用同一份），成功后保存 `memberCredential` 与 `membershipId` 并清掉引导凭证；`BOOTSTRAP_CONFLICT` 会重建后允许重试；
- **错误映射**：满员、昵称重复、邀请失效、被移出、字段校验都映射到具体提示，`fieldErrors` 会落到对应输入项；
- **凭证恢复**：进房间先用 `getSelf` 校验，`membership: null` 时给出「这次入房已经结束」终态；
- **实时**：每次连接（含重连）单独领票，首帧快照整体替换，之后只接受 `sequence > cursor`；
- **发送**：带 `clientRequestId`，失败时复用同一个 ID 重试；`ai.status` 区分未受理/被忽略，`retryAfterMs` 会显示等待时间；
- **退出**：先调 `DELETE /members/me`，再清本地凭证回首页。

## 掉线与重连

- 断线时顶部出「连接断了，正在重连…」，输入框暂时禁用，重连成功后以新快照收敛；
- 房主掉线时（oom.updated 的 host_reconnecting）出橙色横幅，按 hostRecoveryExpiresAt 秒级倒计时，并说明超时会关房；
- 成员掉线在名片上是虚线 + 倒计时，useNow 每秒刷新。

## 还没做的

- 消息时间轴上的「今天/更早」分隔；
- 房主关闭房间的二次确认文案还可以更具体。

## 测试

`npm test` 会把 `contracts/examples/ws/` 的 12 个场景逐帧喂给 `applyServerMessage`，断言：

- 首帧必为快照，`self` 与 `viewer` 一致；
- 终态回复的状态与完整文本；
- `forbiddenReplyIds` / `forbiddenMessageIds` 不出现（入房前已开始的回复不泄漏）；
- 游标推进到场景最大序号，重复帧不再改变状态。

另外三条针对归并逻辑的用例：快照整体替换、迟到事件被丢弃、增量只追加到同一条回复。

## 联调

后端按同一契约实现后，把前端指向它即可（不动代码）：

```bash
echo "VITE_API_BASE=http://127.0.0.1:8787/api/v1" > .env.local
npm run dev
```

接口清单、CORS 要求、响应语义与验收场景见 [docs/frontend/integration.md](../docs/frontend/integration.md)。

## 契约

类型来自 `../contracts`（`file:` 依赖），只做 `import type`：

```ts
import type { components } from '@talk-together/contracts'
```

前端不导入 `backend/` 的任何代码。协议字段变更先改 `contracts/`，重跑 `npm run types --prefix contracts`。

## 设计

视觉规范见 [`docs/frontend/design-system.md`](../docs/frontend/design-system.md)，静态稿在 [`design/`](../design)。
