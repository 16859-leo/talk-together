# 前端需求对齐（V0.1）

本页把已定稿的产品与协议收敛成前端视角的需求基线，供前端实现、联调和验收使用。
事实来源：PRD [#1](https://github.com/jasper0507/talk-together/issues/1)、[联调契约](../api.md)、[协议说明](../api/wire.md)、[架构与目录](../architecture.md)、`contracts/` 中的 v0.1.0 契约。
冲突时以 PRD 与 `contracts/` 为准，本页只做摘要，不新增产品规则。

## 1. 产品与角色

「搭个话 TalkTogether」：真人房主主持、AI 辅助的线上陌生人破冰 Web 聊天室。
每房最多 5 人，无最低人数，创建即开始；大厅无账号体系，使用房间内临时身份。

| 能力 | 房主 | 普通成员 |
| --- | --- | --- |
| 聊天、看本次入房后可见消息、修改本人资料 | 允许 | 允许 |
| 查看 AI 提示与流式回复 | 允许 | 允许 |
| 主动调用 AI（结构化提及） | 允许 | 不允许，提及被忽略但文字照发 |
| 移出成员、关闭房间 | 允许 | 不允许 |

前端按 `role` 收口入口，后端仍独立校验；隐藏入口不替代权限判断。

## 2. 页面与路由

| 路由 | 页面 | 关键内容 |
| --- | --- | --- |
| `/` | 创建房间 | 昵称、兴趣标签（必填）、个人简介（可选，空时展示模板占位而非已填内容） |
| `/join/:roomId?inviteCode=...` | 入房资料 | 同一表单；满员、昵称占用、邀请失效、房间已关闭分别提示 |
| `/rooms/:roomId` | 房间 | 话题卡、成员列表、消息流、输入区、邀请弹层、房主管理、本人资料编辑 |
| `/rooms/:roomId` 同路由内状态 | 终态 | 房间已关闭、被移出、房间不可用、凭证失效、掉线恢复倒计时 |

`joinPath` 由服务端下发（`/join/{roomId}?inviteCode=...`），二维码与复制链接必须使用同一出处，不前端拼接第二种入口。

## 3. 前端状态模型

单一 `state` 层归并 HTTP 回执与 WS 事件，组件只读状态、只发命令。字段与 `contracts/generated/api.d.ts` 一致。

| 切片 | 字段来源 | 说明 |
| --- | --- | --- |
| `self` | 快照 `data.self` | `memberId`、`membershipId`、`role`、`joinedSequence` |
| `room` | 快照 `data.room`、`room.updated`、`topic.changed` | `status`（`open`/`host_reconnecting`）、`occupiedSlots`、`hostRecoveryExpiresAt`、`currentTopic`、`invitation` |
| `members` | 快照、`member.joined/updated/presence.changed/left/removed` | 按 `memberId` 索引，`membership.presence` 为 `connecting`/`online`/`offline` |
| `messages` | 快照、`message.created` | 按 `id` 与 `clientRequestId` 双键去重 |
| `replies` | `ai.reply.*` | 按 `replyId` 索引，一条回复只有一条展示记录 |
| `invocations` | 快照、`ai.invocation.updated`、`ai.reply.started/终态` | `queued`/`running`/`completed`/`failed`/`cancelled`，含 `queuePosition`、`expiresAt` |
| `cursor` | 快照 `cursor`、事件 `sequence` | 只增；跳号正常，重复序号不重复应用 |

消息流是 `messages` 与 `replies` 按创建顺序（成员消息用 `createdSequence`，AI 回复用 `startedSequence`）的合并视图。

## 4. 前端必须遵守的行为规则

F1 提交走 REST、房间变化走 WS；HTTP 回执与广播任意先后到达。
F2 `clientRequestId` 每次发送生成一次，重试复用；改内容必须换新 ID。回执不得推进 WS 游标，也不得把已完成的调用改回排队。
F3 建连前先 `POST /connection-tickets` 领取一次性票据，用返回的 `webSocketUrl`；每个标签页、每次重连各自领票。连接失败回 REST 取可读错误，不依赖关闭码。
F4 首个业务事件是 `room.snapshot`（含 `cursor`）；恢复重连时以快照替换累计状态，之后只处理 `sequence > cursor`。
F5 可见范围以 `joinedSequence` 与回复 `startedSequence` 为界：入房前已开始的回复整条不展示（增量、终态、快照文本都一样），当前话题仍单独公开。前端保留过滤作为防御，不依赖过滤来纠正后端。
F6 `ai.reply.started` 建一条回复，`delta` 追加到同一 `replyId`，`completed/failed/cancelled` 用终态载荷校准文本；三态互斥。
F7 失败或取消保留已输出文字并标记未完成，不自动重跑。
F8 AI 未受理不影响聊天：`data.ai.status` 为 `not_requested`/`ignored`/`queued`/`running`/`rejected`；`rejected` 带 `error.code` 与 `retryAfterMs`，在消息旁提示原因。
F9 只有房主提供明确的「@AI」操作，产生 `mentions: ["ai"]`；普通文本里的 `@AI` 不触发调用。普通成员不展示该入口。
F10 多标签页共享身份、一个名额与限频额度：凭证、`bootstrapToken`、待提交的 `clientRequestId` 需跨标签页复用；主动退出同步全部标签页（广播通知），关闭单页只断该连接。
F11 首次加入使用 `bootstrapToken` + `clientRequestId`，成功后保存 `memberCredential`，此后不再携带引导凭证；凭证按房间保存，关房或退出后清理。
F12 需要本次入房的请求带 `Authorization: Bearer <memberCredential>` 与 `X-Membership-Id <membershipId>`；`getSelf` 只带 Bearer，`membership` 为 `null` 时不自动重新加入。
F13 校验上限从 `GET /client-config` 的 `validation` 读取，`null`/缺省表示服务端未声明上限，前端不硬编码数值；`fieldErrors.path` 是 JSON Pointer（如 `/profile/nickname`）。
F14 限频与冷却只用服务端返回的 `retryAfterMs`/`presence.recoveryExpiresAt`/`expiresAt` 计时，不猜默认值。
F15 房间关闭（`room.closed`）是最终事件：停止接收业务事件、清理本地房间状态与凭证、进入结束页，不提供历史恢复。
F16 成员被动结束（被移出、超时退出、房间关闭）时结束本次入房；`MEMBERSHIP_CHANGED`/`MEMBERSHIP_INACTIVE` 只结束当前入房，不静默重建。

## 5. 错误码与前端反应

| code | HTTP | 前端处理 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 400 | 按 `fieldErrors` 标到具体输入项 |
| `MEMBER_CREDENTIAL_INVALID` | 401 | 清凭证，回入房页并提示重新加入 |
| `MEMBERSHIP_INACTIVE` / `MEMBERSHIP_CHANGED` | 403 / 409 | 结束本次入房，不清除成员身份 |
| `MEMBER_REMOVED` | 403 | 被移出终态 |
| `HOST_REQUIRED` / `HOST_PROTECTED` | 403 | 不展示的入口出现时视为 UI 缺陷，降级为提示 |
| `ROOM_UNAVAILABLE` / `INVITATION_INVALID` | 404 | 房间不可用 / 邀请失效终态 |
| `ROOM_FULL` / `NICKNAME_TAKEN` | 409 | 入房表单就地提示 |
| `IDEMPOTENCY_CONFLICT` | 409 | 报错并提示刷新，不自动换 ID 重发 |
| `IDEMPOTENCY_CONTEXT_EXPIRED` | 409 | 提示上次发送已失效，需重新发送 |
| `BOOTSTRAP_CONFLICT` | 409 | 放弃待提交引导凭证，回到入房表单 |
| `MESSAGE_RATE_LIMITED` / `IP_RATE_LIMITED` | 429 | 输入区按 `retryAfterMs` 冷却并显示剩余时间 |
| `CONNECTION_TICKET_INVALID` / `_EXPIRED` / `_USED` | 401 | 重新领取票据后重连，不弹终态 |
| `AI_RATE_LIMITED` / `AI_QUEUE_FULL` / `AI_UNAVAILABLE` / `AI_QUEUE_TIMEOUT` / `AI_TIMEOUT` / `AI_PROVIDER_ERROR` / `AI_CANCELLED` | 随 `ai.error` 或调用终态返回 | 聊天保留，仅在 AI 区域提示；不自动重跑 |
| `SERVICE_UNAVAILABLE` | 503 | 可重试提示 |
| `INTERNAL_ERROR` | 500 | 通用失败提示，带 `requestId` 便于排查 |

## 6. 明确不做

小游戏玩法、AI 自动主持/渐进追问/观点搭桥/私密接话、选项回答、手动暂停或恢复 AI、内容审核与自动拦截、账号与好友、自动匹配、语音、跨房间历史与用户画像、房主转让、审批或密码入房、更换邀请链接、部署与容量指标。
房间关闭后不提供聊天与公开资料恢复。

## 7. 前端验收要点（对应 PRD 验收表）

- 链接与二维码进入同一房间，昵称与兴趣标签缺失时不能入房，昵称重复有明确提示，简介可为空。
- 5 人上限、创建即开始、成员减少不触发等待。
- 房主一次发送完成聊天与 AI 调用；普通成员提及只发聊天。
- AI 回复在一条消息内流式追加，完成后以全文校准；失败保留部分文字。
- 中途入房看不到入房前已开始的回复，但能看到当前话题。
- 重连先拿到有权限的快照，再衔接后续增量，不重复拼接。
- 多标签页共享身份与名额；主动退出同步所有标签页，关单页不影响其他标签页。
- 房主掉线期间聊天继续、已受理调用继续、不触发新的自动话题；恢复或 60 秒后关房。
- 被移出、房间关闭后客户端不再展示可操作界面，本地不留可恢复的聊天与资料。
