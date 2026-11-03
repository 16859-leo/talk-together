# 前后端协议 v0.1.0

字段与类型以 [OpenAPI](../../contracts/openapi.json)、[公共模型](../../contracts/models.schema.json) 和 [事件 Schema](../../contracts/events.schema.json) 为准。本页定义这些字段的交互语义；[业务约定](../api.md) 中已确认的权限和生命周期继续有效。

## HTTP 资源与响应

| Method | 路径 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/client-config` | 入房前取得客户端校验约束 |
| POST | `/api/v1/rooms` | 创建房间及房主身份 |
| POST | `/api/v1/rooms/{roomId}/members` | 首次加入、复用当前入房或重新加入 |
| GET | `/api/v1/rooms/{roomId}/members/me` | 恢复本人身份与当前入房状态 |
| PATCH | `/api/v1/rooms/{roomId}/members/me` | 修改本人资料 |
| DELETE | `/api/v1/rooms/{roomId}/members/me` | 主动退出，房主退出同时关房 |
| DELETE | `/api/v1/rooms/{roomId}/members/{memberId}` | 房主移出成员 |
| DELETE | `/api/v1/rooms/{roomId}` | 房主关闭房间 |
| POST | `/api/v1/rooms/{roomId}/messages` | 提交聊天及结构化 AI 提及 |
| POST | `/api/v1/rooms/{roomId}/connection-tickets` | 为单个 WS 连接取得一次性票据 |
| GET | `/api/v1/rooms/{roomId}/events?ticket=...` | WS 升级，首个业务消息为快照 |

响应统一包含 `code`、`message`、`data`、`requestId`。成功使用 `OK`；失败按 HTTP 状态和稳定的业务 code 分支，`message` 只用于提示。
`fieldErrors.path` 使用请求体的 JSON Pointer 路径，例如 `/profile/nickname`；根级错误为空字符串，非请求体字段错误使用顶层 code 与 message。
必填、可空和可省略字段均由 Schema 明确：返回对象不随意省字段；`null` 表示没有对应值，不与空字符串或空数组混用。
简介在创建或加入时缺省为 `""`；PATCH 缺省字段保持原值，`bio: ""` 清空，不接收 `bio: null`。

普通聊天已创建时返回 `201`，`data.ai` 分别为 `not_requested`、`ignored`、`queued`、`running` 或 `rejected`。
其中 `queued/running` 携带调用 ID，`rejected` 携带 AI 错误而不撤销聊天。普通成员提及返回 `ignored`，不产生调用。
聊天本身无效或受限时整次提交失败，返回 `400/429` 等整体错误。房主管理操作的越权为 `403/HOST_REQUIRED`，不用于普通成员的聊天提及。

HTTP 回执只确认提交及资源标识。公开房间状态以 WS 快照和事件为准；前端不能用迟到的 HTTP 回执把已完成调用改回排队，也不能用 HTTP 回执推进 WS 游标。

## 身份、入房与首次提交

`memberId` 在当前房间内稳定，`membershipId` 标识本次入房：恢复期限内重连不改变；退出或超时后重新加入会改变。
需要当前入房的操作携带 Bearer 凭证及 `X-Membership-Id`。后端拒绝旧入房标识，返回 `MEMBERSHIP_CHANGED`，避免旧标签页操作新入房。
`getSelf` 只要求身份凭证，已退出身份返回 `membership: null`；界面不能因此自动重新加入。被移出返回 `MEMBER_REMOVED`。

首次创建或加入前，浏览器保存本次操作的随机 `bootstrapToken` 和 `clientRequestId`；匿名加入必须提供引导凭证。
同一引导凭证与相同请求重试返回原房间或成员，不新增资源；相同凭证绑定不同请求内容或意图时返回冲突。
引导凭证仅用于恢复该次首次提交，不能作为成员 API 凭证。取得成员凭证后，后续加入或恢复使用 Bearer，客户端不再携带引导凭证。
这些凭证按房间保存并在标签页间协调，房间关闭后清理；不得仅凭公开请求 ID 取回成员凭证。
首次加入同一房间的并行标签页须共用同一份待提交引导凭证、请求 ID 和请求内容，直到取得成员凭证，不能分别匿名创建身份；跨标签页的协调机制由前端实现。

已在房间的身份再次加入时复用原 membership、原资料和消息范围，返回 `200`；资料修改单独 PATCH。
已退出身份重新加入需要新请求 ID、有效邀请和入房资料，重新检查容量、昵称与移出限制，成功返回 `201` 和新 membership。
首次入房但尚未建连的成员使用 `connecting`；在线为 `online`，失联恢复期为 `offline`，期限使用服务端返回的 `recoveryExpiresAt`。

消息发送的 `clientRequestId` 对同身份同内容幂等。原请求属于旧入房时，不重放旧消息正文，返回 `IDEMPOTENCY_CONTEXT_EXPIRED`。
真正再次发送或重新调用必须使用新 ID；普通幂等重试不创建新消息、不再次入队。

## 校验与运行参数

`client-config.validation` 声明昵称、标签、简介及消息的长度与数量约束，前端按返回结果进行提示，后端仍校验。
`maxLength/maxItems: null` 表示未向客户端声明固定上限；本契约不采用上一轮未确认的建议数值。名称归一化和唯一性以服务端返回资料及 `NICKNAME_TAKEN` 为准。
队列长度、上下文选取、生成期限、限频和自动调度阈值由后端实现设计；前端消费 `queuePosition`、`expiresAt` 和错误中的 `retryAfterMs`，这些字段可为空，不自行猜测默认值。
公共模型采用 JSON Schema Draft 2020-12，后端验证器须支持该版本。
前后端跨域开发时，后端须为前端来源允许 `Authorization`、`X-Membership-Id` 和 `Content-Type` 请求头；本地 HTTP Mock 的预检已验证。

## WebSocket 建连与快照

每个标签页、每次重连分别领取票据，使用服务端返回的 `webSocketUrl`。票据绑定 room、member 和 membership，短效且只能消费一次；有效期以 `expiresAt` 为准。
握手再次校验成员及入房资格。连接失败时通过 REST 取票据或 `getSelf` 得到可读的资格错误，不依赖浏览器读取升级失败的 HTTP 正文。
认证失败不下发房间数据；原成员已退出、被移出或房间不存在时停止自动恢复当前入房。

首个业务消息为 `room.snapshot`，包含本人身份、本次入房位置、房间、占位成员、可见消息及调用状态，带 `cursor` 和 `capturedAt`。
后端在同一观察位置捕获快照并衔接事件，保证快照前的状态已包含，之后的变化不会丢失。
随后只发送 `sequence > cursor` 的事件。前端只用本连接快照和已处理 WS 事件推进游标，不根据 HTTP 响应或时间戳推进。
事件经可见性过滤后可能跳号；跳号本身不代表丢失。相同序号重复到达不重复应用。

恢复时用快照替换旧累计状态，再追加后续片段。`memberId` 相同但 `membershipId` 改变时清空旧入房状态，不带入旧消息和幂等回执。
占位数与当前成员列表长度一致；加入、退出和移出更新成员列表及占位数，单纯离线在恢复期限内不释放名额。

## 消息与 AI 事件

所有增量信封包含 `type`、`eventId`、`roomId`、`sequence`、`occurredAt` 和 `data`，各事件的具体字段见事件 Schema。

| 事件 | 状态处理 |
| --- | --- |
| `member.joined/updated` | 更新该成员资料与本次入房信息 |
| `member.presence.changed` | 更新对应 membership 的在线状态及恢复期限 |
| `member.left/removed` | 结束指定入房；本人身份的当前连接随之结束 |
| `message.created` | 按消息 ID 与 clientRequestId 合并，不重复插入 |
| `ai.invocation.updated` | 排队位置与调用状态；未开始的调用可直接失败或取消 |
| `ai.reply.started` | 建立一条回复，同时取得对应 running 调用状态 |
| `ai.reply.delta` | 向指定 replyId 追加 textDelta |
| `ai.reply.completed/failed/cancelled` | 使用完整或部分累计文本和调用终态校准 |
| `topic.changed` | 成功选题后替换独立公开话题 |
| `room.updated` | 更新房主掉线恢复状态 |
| `room.closed` | 最终事件，离房并清理数据，不继续接收业务事件 |

一次调用可经历 `queued → running → completed/failed/cancelled`；未开始时可从 queued 直接 failed/cancelled。
queued 阶段没有回复；开始生成才产生 `replyId` 和 started 事件，零文本失败也保留对应状态。
同房间同时最多一个 running 调用；房主调用 FIFO，自动触发遇忙不入队。
已开始回复的终态事件同时携带最终 Invocation 与 AIReply，不再另发一个冲突的调用终态；尚未开始的终态用 invocation.updated，replyId 为空。
普通调用的 caller 对应房主，自动调用为空；随机邀答的 purpose 为 invitation，并携带 invitedMember，不建立等待目标作答的回合。

完成、失败和取消互斥。失败或取消保留已输出文字；最终文本由终态载荷校准，不自动重跑。成功选题随后发布 topic.changed，普通回复不改话题。
源消息不可见时仍可展示调用者和回复，不为关联 ID 自动补取入房前聊天。

## 可见范围与终止顺序

成员本次入房的 `joinedSequence` 是消息范围起点。成员消息依据 createdSequence、AI 回复依据 startedSequence 过滤；恢复期限内原入房保持这个起点。
入房前已开始的 AI 回复整条不可见，后续 delta、终态、快照和调用状态不得夹带它的文本。新成员仍可接收独立的当前话题。
入房前受理、入房后开始的回复可见，源聊天可能不可见；调用状态只提供必要标识和状态，不含隐藏提示原文。

主动退出同步所有标签页，关闭单页仅断开该连接。本人 left/removed 后的连接结束，旧 membership 的迟到事件不影响新入房。
房主离线恢复期内已受理调用继续，包括排队项；新的自动话题和邀答暂停。恢复后沿用原 membership，超时关房。
关房开始后不再受理新请求。先终结正在生成的回复及未开始调用，再发布 room.closed，之后停止业务事件并清理聊天与公开资料。
Mock 的退出或关房连接使用正常关闭码 1000，移出使用 1008；生产资格判定以业务事件和 REST 结果为准，不只依赖关闭码。

## 并行开发与变更

前端可立即使用 [本地 Mock 与类型生成命令](../../contracts/README.md) 完成请求封装和全部 UI 状态，后端按同一契约独立实现。
协议字段变更先更新 `contracts/` 的唯一源、样例和类型，通过校验后两端共同采用；内部算法和阈值调整只要仍符合契约，无需重新向用户逐项讨论。
