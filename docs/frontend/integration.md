# 前端联调交接

前端已按 `contracts/` v0.1.0 实现完毕，**只对 Mock 验证过**。这份文档写给后端：需要你按同一契约提供接口，双方按下面顺序联调。
协议细节以 [docs/api.md](../api.md)、[docs/api/wire.md](../api/wire.md) 与 `contracts/` 为准，本页只列前端实际用到的东西。

## 1. 前端消费的接口

| 方法 | 路径 | 前端用途 | 用到响应里的字段 |
| --- | --- | --- | --- |
| GET | `/api/v1/client-config` | 入房/创建/改资料的长度与数量约束 | `validation.*` |
| POST | `/api/v1/rooms` | 开房 | `room`、`member`、`memberCredential` |
| POST | `/api/v1/rooms/{roomId}/members` | 入房（首次 / 复用 / 重新加入） | 同上 |
| GET | `/api/v1/rooms/{roomId}/members/me` | 进房前恢复身份 | `member.membership` 是否为 `null` |
| PATCH | `/api/v1/rooms/{roomId}/members/me` | 改昵称 / 标签 / 简介 | `member` |
| DELETE | `/api/v1/rooms/{roomId}/members/me` | 成员退出 | `code` |
| DELETE | `/api/v1/rooms/{roomId}/members/{memberId}` | 房主移出 | `code` |
| DELETE | `/api/v1/rooms/{roomId}` | 房主关房 | `code` |
| POST | `/api/v1/rooms/{roomId}/messages` | 发消息 / 房主 @AI | `message`、`ai` |
| POST | `/api/v1/rooms/{roomId}/connection-tickets` | 换 WS 票据 | `webSocketUrl`、`expiresAt` |
| GET | `/api/v1/rooms/{roomId}/events?ticket=` | WS 升级 | 首帧 `room.snapshot`，之后增量事件 |

## 2. 请求端的硬要求

- 身份：`Authorization: Bearer <memberCredential>`；本次入房相关的操作再带 `X-Membership-Id: <membershipId>`。
- 幂等：发消息、入房、开房都带 `clientRequestId`（UUID）。前端在**重试时复用同一个 ID**，所以：
  - 同 ID + 同内容 → 返回原结果，不重复入队/插消息；
  - 同 ID + 不同内容 → `IDEMPOTENCY_CONFLICT`。
- 引导凭证：`POST /rooms` 与首次 `POST /rooms/{id}/members` 带 `bootstrapToken`（64 位十六进制）。前端把它存在 localStorage，重试与并行标签页复用，成功后立刻丢弃。
- 错误信封：`{ code, message, data, requestId }`。字段错误放 `data.fieldErrors[].path`，路径是 **JSON Pointer**（如 `/profile/nickname`），前端按它标红输入框。
- 限频：`429` 时请给 `data.retryAfterMs`，前端据此倒计时并禁用发送。

## 3. 响应头的 CORS 要求（否则前端直接失败）

后端需要允许：

```
Access-Control-Allow-Origin: <前端来源>
Access-Control-Allow-Headers: Authorization, X-Membership-Id, Content-Type
Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS
Access-Control-Expose-Headers: X-Contract-Version
```

`X-Contract-Version` 建议回 `0.1.0`，前端在开发态发现不一致会在控制台警告。

## 4. 前端依赖的响应语义

1. **快照**：`room.snapshot` 必须带 `cursor`，且快照里已经包含此前所有应可见的状态；前端会**整体替换**本地状态，然后只接受 `sequence > cursor` 的事件。
2. **事件序号**：`sequence` 单调递增即可，允许跳号（可见性过滤造成），前端不把跳号当丢包。
3. **agent 可见范围**：入房前已开始的 AI 回复，`startedSequence < joinedSequence` 的必须**整条不下发**（含 delta、终态、快照文本）。用户要求这条必须由后端保证。
4. **AI 回执**：`POST /messages` 的 `data.ai.status` 取 `not_requested | ignored | queued | running | rejected`；`rejected` 要带 `error.code` 和可选 `retryAfterMs`，前端只提示、不撤销已发出的聊天。
5. **成员列表**：`members[].membership.presence` 与 `recoveryExpiresAt` 驱动掉线倒计时；`occupiedSlots` 必须等于占位人数（含恢复期内的掉线者）。
6. **关房顺序**：先终结在途调用，再发 `room.closed`；前端收到它就把页面切成终态并清掉本地凭证。

## 5. 前端自己负责、后端不用管的

- 连接断开后的退避重连（0.5s→5s，每次重连重新领票）；
- 游标去重、重复事件丢弃；
- 发送失败后复用 `clientRequestId` 重试（用户手动再发同一条）；
- 本地即时反馈：移出成员、改资料、关房后立刻更新界面，最终以事件为准；
- 多标签页：同一房间共用一个 `BroadcastChannel`，任一标签页退出/关房会同步结束其他标签页。

## 6. 联调步骤

```bash
# 1. 起后端（监听 8787 之类），确认 client-config 可访问
# 2. 前端指向真实后端
cd frontend
echo "VITE_API_BASE=http://127.0.0.1:8787/api/v1" > .env.local
npm run dev
```

然后按 [设计交接](../api/handoff.md) 的 9 个场景走：

1. 创建 → 邀请 → 加入：身份复用、人数上限、必填资料、昵称冲突、重复提交；
2. HTTP 回执与 WS 事件任意先后到达；
3. 房主 FIFO 串行、自动触发遇忙跳过；
4. 流式增量归并成一条回复，完成/失败/取消互斥；
5. 中途加入看不到入房前已开始的回复，但能看到当前话题；
6. 原成员重连先拿快照再衔接增量；
7. 多标签页共享身份与名额；
8. 房主掉线后已受理调用继续、新的自动触发暂停、超时关房；
9. 被移出与关房后不再接收数据。

## 7. 已知前端未覆盖、需要你确认的点

| 项 | 现状 |
| --- | --- |
| 昵称归一化规则 | 前端只做长度校验，唯一性与归一化完全依赖服务端与 `NICKNAME_TAKEN` |
| 限频数值 | 前端不预设阈值，只消费 `retryAfterMs` |
| 队列长度、生成期限、冷场判定 | 同上，前端只展示 `queuePosition` / `expiresAt` |
| 历史消息分页 | 契约里没有分页，前端一次显示快照里的全部消息；如果后端要限制条数需要先改契约 |
| 房间创建时间 | `Room` 没有 createdAt，前端已把「开始于」去掉了 |
| 服务重启恢复 | 明确暂缓，前端不做本地补发 |

## 8. 当前不能用真实数据验证的部分

`design/app-*.png` 里的截图都来自 `contracts` 的 Mock，所以会出现「房间永远两个人」「消息正文是固定示例」这类现象。这些不是前端 bug：Mock 不存状态、不认身份。真实后端起来后，同样操作会反映真实数据。
