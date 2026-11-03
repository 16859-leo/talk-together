# 前端实现方案（Implementation Plan）

范围：`frontend/` 从零到可演示的 V0.1 前端，按 [需求对齐](requirements.md)、[联调契约](../api.md)、[协议说明](../api/wire.md) 与 [目录规划](../architecture.md) 实现。
契约基线 v0.1.0 已可用：`npm ci --prefix contracts && npm run check --prefix contracts && npm run types --prefix contracts` 通过（11 个操作、49 个模型、43 个 HTTP 样例、12 个 WS 场景）。
本方案待确认后再进入编码。

## 1. 技术选择

| 项 | 选择 | 理由 |
| --- | --- | --- |
| 构建 | Vite + React + TypeScript（严格模式） | 架构已确认，纯客户端应用，无 SSR 职责 |
| 路由 | `react-router` | 三条路由足够，`/join/:roomId?inviteCode=` 与契约 `joinPath` 对齐 |
| 样式 | Tailwind（+ shadcn/ui 按需） | 架构允许，先落设计 token 再写组件 |
| 状态 | 纯 reducer + `useSyncExternalStore` 自建 store | 归并逻辑可脱离 React 单测，能用 `contracts/examples/ws/*` 回放验收；不引入额外状态库 |
| HTTP | 原生 `fetch` 封装，无请求库 | 接口少，鉴权头与错误码映射集中在 `shared/api` |
| 实时 | 原生 `WebSocket` | 只有下行事件，上行全走 REST |
| 测试 | `vitest` 跑 reducer 与回放；`playwright` 可选 | 12 个 WS 场景即状态机验收用例 |
| 契约 | `"@talk-together/contracts": "file:../contracts"`，只用 `import type` | 类型单一来源，不在浏览器里跑 JSON Schema 校验（包体积/依赖不值得） |

## 2. 目录与职责

```text
frontend/
├── package.json / vite.config.ts / tsconfig.json / tailwind 配置
├── index.html
└── src/
    ├── app/            # 入口、路由表、全局装配（store、api client、连接管理）
    ├── pages/          # CreateRoomPage、JoinPage、RoomPage、RoomEndedPage
    ├── features/
    │   ├── room/       # 入房表单、邀请弹层、成员列表、资料编辑、房主管理
    │   ├── chat/       # 消息流、输入区、发送状态、限频冷却
    │   └── ai/         # 房主 @AI 入口、流式回复卡片、排队/失败标记
    ├── state/          # store、reducer、selector、跨标签页协调
    └── shared/
        ├── api/        # fetch 封装、鉴权头、错误归一、接口函数
        ├── realtime/   # 领票、连接、重连退避、事件分发、游标
        └── ui/         # Button/Dialog/Input/Avatar/Badge/Toast 等无业务组件
```

依赖方向：`pages → features → state/shared`；`shared` 不感知房间规则；组件不直接拼 AI 回复，也不直接改游标。

## 3. 关键实现点

### 3.1 身份与凭证

- 存储键按房间隔离：`tt:{roomId}:credential`、`tt:{roomId}:member`（`memberId`/`role`/`nickname`）、`tt:{roomId}:bootstrap`（`bootstrapToken` + `clientRequestId`，仅首次提交期间存在）。
- 首次创建/加入前写入 bootstrap，成功拿到 `memberCredential` 后清除；并行标签页通过 `BroadcastChannel` 复用同一 bootstrap，避免同一浏览器建出两个身份。
- 退出、被移出、关房时清理房间级键并广播结束信号。

### 3.2 发送与幂等

- 发送按钮生成 `clientRequestId`（`crypto.randomUUID()`）并保存到内存的重试上下文，超时/网络错误重试复用，成功或用户改内容后丢弃。
- 回执只用于更新「本端发送状态」与 AI 受理提示，不写 `sequence`，不推进游标。
- `429` 时按 `retryAfterMs` 冻结输入区并倒计时。

### 3.3 连接与恢复

状态机：`idle → ticketing → connecting → syncing(快照) → live → reconnecting`。
- 每次进入 `connecting` 都先领票；`CONNECTION_TICKET_*` 视为可重试，退避 500ms→1s→2s→4s（上限 5s）。
- 收到 `room.snapshot` 时用快照整体替换（成员、消息、调用、话题、房间），`cursor = snapshot.cursor`，随后过滤 `sequence <= cursor`。
- 断线期间保留 UI（显示「重连中」），不做本地补发；重连成功后以快照为准。
- `room.closed` → 停止重连、清理状态、跳终结页。

### 3.4 消息归并

- 成员消息：`message.created` 按 `id` 去重，同时用 `clientRequestId` 认领本端「发送中」条目，避免重复。
- AI 回复：`started` 建条目（`status: streaming`）；`delta` 追加；`completed/failed/cancelled` 用 `reply.text` **覆盖**校准，并写入终态。
- 合并视图：成员消息按 `createdSequence`、回复按 `startedSequence` 排序；同一 `sequence` 前缀并列时按到达顺序兜底。
- 防御性可见性：`reply.startedSequence < self.joinedSequence` 的回复不渲染（正常情况下后端已过滤）。

### 3.5 多标签页

- `BroadcastChannel('tt:' + roomId)` 广播：`join-intent`（共享 bootstrap）、`left`（主动退出同步）、`closed`、`reconnected`。
- 收到 `left` 的其他标签页断开 WS、清状态、跳结束页。

### 3.6 房主掉线与成员掉线

- `room.updated` 的 `host_reconnecting` + `hostRecoveryExpiresAt`：顶部横幅显示房主恢复倒计时，暂停展示「AI 暂停」提示。
- `member.presence.changed` 的 `offline` + `recoveryExpiresAt`：成员条目显示「掉线，恢复中」并带倒计时；名额不释放，成员计数以 `occupiedSlots` 为准。

## 4. 里程碑

### M0 骨架（约 2 小时）

- Vite 工程、Tailwind、路由、`import type` 接契约、开发代理（`/api` → `http://127.0.0.1:4010`）。
- `shared/api`：`request()` 统一处理 `code/message/data/requestId`、错误归一为 `ApiError{code,status,fieldErrors,retryAfterMs}`、鉴权头注入。
- `GET /client-config` 启动即取，全局校验约束与 `contractVersion` 断言。
- 验收：`npm run dev` 起页；改 Mock 的样例能触发错误分支提示。

### M1 入房（约 3 小时）

- 创建页、入房页；表单校验用 `client-config`；`bootstrapToken`/`clientRequestId` 流程；凭证持久化与 `BroadcastChannel` 协调。
- 错误映射：`ROOM_FULL`、`NICKNAME_TAKEN`、`INVITATION_INVALID`、`ROOM_UNAVAILABLE`、`BOOTSTRAP_CONFLICT`、`VALIDATION_ERROR`。
- 验收：两个标签页同时点「加入」只产生一个成员；刷新不产生新成员。

### M2 房间状态机（约 4 小时）

- 领票 + 连接 + 快照 + 游标；reducer 覆盖全部 16 种 `ServerMessage`。
- 成员列表、话题卡、消息流、输入区、发送回执（含 `ai.status` 五种）、流式渲染。
- 验收：`host-stream`、`guest-reconnect`、`join-midstream`、`message_ignored`、`message_ai_limited` 五个场景回放，界面与 `expectedReplies` 一致。

### M3 房主能力与终态（约 3 小时）

- 移出、关闭房间、主动退出、资料编辑（PATCH 全房同步）、邀请弹层（复制链接 + 二维码，同一 `joinPath`）。
- 终态页：`room.closed`（含 `reason` 文案）、被移出、房间不可用、凭证失效、重连超时。
- 验收：`left`、`removed`、`queue-timeout-close`、`host-timeout`、`host-restored`、`member-updates`、`random-invitation` 七个场景通过。

### M4 打磨与验收（约 3 小时）

- 空态、加载态、错误态、限频冷却、断线重连提示、移动端布局、焦点与可访问性。
- 12 个场景的自动化回放（vitest）+ PRD 验收表逐项走查。

## 5. 测试策略

- `state/reducer` 纯函数：输入快照与事件序列，断言最终 `members`/`messages`/`replies`/`cursor`。
- 场景回放：读取 `contracts/examples/ws/*.json` 的 `frames`，按 `atMs` 顺序喂入 reducer，与 `expectedReplies` 比对文本与终态。
- 负例：重复 `sequence` 不重复插入、入房前回复不渲染、终态互斥（已完成后再收 delta 不追加）。
- 联调前用 Prism（HTTP）与 `mock-ws`（WS）覆盖，不依赖后端可用。

## 6. 风险与待决

| 风险 | 应对 |
| --- | --- |
| 后端未实现，Mock 不鉴权、不回推真实状态 | 全流程按契约与场景开发，联调时只换 baseURL |
| 视觉未定 | 先出 token（色板/字号/间距/圆角）与 2 个关键页面稿，确认后统一组件 |
| 契约字段调整 | 只改 `contracts/` 源，重跑 `check`/`types`，前端跟类型 |
| 时间与倒计时 | 统一用服务端 `*At` 字段与本地时钟差值渲染，不做本地推测 |
| 二维码依赖 | 选 `qrcode`（canvas 渲染），仅编码 `joinPath` 绝对地址 |

待确认（不阻塞 M0/M1）：视觉方向（暗色聊天室 / 明亮轻社交）、是否引入 shadcn/ui、二维码库、是否需要移动端优先布局。

## 7. 交付判定

- 三条路由可用，创建 → 邀请 → 多人聊天 → AI 流式 → 退出/关房全链路可在 Mock 上演示。
- 12 个 WS 场景回放通过，PRD 验收表前端相关行逐项通过。
- 无 `any` 逃逸、无跨层导入、`tsc --noEmit` 与 lint 通过。
