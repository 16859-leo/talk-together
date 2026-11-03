# 后端模块实施计划（2 号）· 定案

本文件为后端侧的 Implementation Plan，按仓库规则（`docs/api/handoff.md` 末条）在跨模块编码前提交评审。

依据：PRD #1（定稿）、`docs/architecture.md`、`docs/api.md`、`docs/api/wire.md`、`contracts/` v0.1.0。

**本文所有事项均为定案**，不含待讨论项。涉及 3 号的接口与分工边界已在第 3、4 节给出最终结论，3 号可直接按此开工；若要变更，按产品需求变更流程处理，不在实现阶段反复协商。

验证状态（本文所有结论均有对应检查支撑）：

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 契约自检 | `npm run check --prefix contracts` | 通过：11 接口 / 49 模型 / 43 HTTP 样例 / 12 WS 场景 |
| 类型检查 | `npx tsc --noEmit` | 通过（strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`） |
| 后端测试 | `node --test test/*.test.ts` | **92 / 92 通过** |
| 错误码盘点 | `test/error-codes.test.ts` | 契约 29 个：**22 个有真实触发路径，7 个显式说明未覆盖原因，无遗漏** |

本计划未修改契约任何字段。

---

## 1. 交付物定位

按 `docs/architecture.md`，后端为分层的模块化单体。本模块交付 `backend/` 全部应用代码：

| 目录 | 职责 | 状态 |
| --- | --- | --- |
| `src/transport/` | HTTP 路由、WS 网关、鉴权提取、错误映射、线上载荷序列化 | 已完成 |
| `src/application/` | 房间与聊天用例、权限判定、事件序号与发布、AI 串行队列与流式生命周期、冷场调度、能力插件统一接口 | 已完成 |
| `src/domain/` | 房间、成员、消息、话题的状态与不变量 | 已完成 |
| `src/infrastructure/state/` | 房间状态存储接口与进程内实现 | 已完成 |
| `src/config.ts` | 全部运行阈值的单一收口处 | 已完成 |
| `src/app.ts` | 装配入口：创建实现、注入依赖、注册插件 | 已完成 |

### 与架构文档目录规划的差异

架构文档第 97–121 行给出的是**逻辑目录**，并注明"按需创建文件"。实际落地有三处差异，均为有意选择：

| 文档规划 | 实际 | 原因 |
| --- | --- | --- |
| `transport/http/`、`transport/ws/` 两个子目录 | `transport/wire.ts` + 路由与网关集中在 `app.ts` | 当前路由与网关合计约 200 行，拆成两级目录只增加跳转成本；超出一屏时再拆 |
| `domain/` 下 `room/member/message/topic` 四个文件 | `domain/room.ts` 承载四类记录与不变量 | 这四类状态同属房间聚合、互相引用紧密，强行拆分会产生循环依赖 |
| `capabilities/topics/`、`infrastructure/model/`、`infrastructure/zhihu/` | 未创建 | **归 3 号交付**，由其按第 3 节接口自行组织 |

`infrastructure/state/` 已按文档创建，不属于差异。

**不交付，归 3 号**：`infrastructure/model/`（AI SDK Core 适配）、`infrastructure/zhihu/`（内容获取与备用话题池）、`capabilities/topics/`（选题与邀答能力实现）、提示词与话题适宜性筛选。后端只定义统一接口并在 `app.ts` 装配。

**不交付，归 4 号**：任何页面、交互与前端状态归并。后端只保证输出符合事件契约。

### 职责边界

3 号计划第 1 节声明以下事项归后端应用层，本计划确认承接并已实现：

- 同房间 AI 串行执行、房主调用 FIFO 队列、自动触发遇忙跳过
- 限频、权限校验、事件发布、`replyId` 与 `sequence` 生成
- 插件只拿只读上下文，不直接修改房间，不持有 WebSocket 连接

后端额外承接三项（3 号计划未列，现明确归属）：

- **选题是否生效**：插件产出的只是 `TopicDraft`，是否更新当前话题、何时发布 `topic.changed`，由应用层决定。
- **邀答目标选择**：涉及在线状态与成员列表，属房间状态判定，留在应用层。
- **冷场判定与调度**：静默计时、阈值判断、每话题邀答额度，全部在应用层，见第 4 节。

---

## 2. 与契约的对应关系

后端对外可观察行为完全由 v0.1.0 契约定义，不新增、不省略字段。

| 契约项 | 实现位置与行为 |
| --- | --- |
| 11 个 HTTP 操作 | `transport/http`，统一信封 `code/message/data/requestId` |
| `room.snapshot` + 16 类事件 | `application/bus.ts` 统一发布，**17 类全部覆盖** |
| `Invocation.status` 五态 | `queued → running → completed/failed/cancelled`；未开始可由 queued 直接 failed/cancelled |
| `AIReply.status` 四态 | `streaming → completed/failed/cancelled`，三终态互斥 |
| `AiReceipt` 五态 | `not_requested` / `ignored` / `queued` / `running` / `rejected` |
| `membershipId` | 恢复期内保持；退出或超时后重新加入时更新 |
| `joinedSequence` | 可见性起点，成员消息看 `createdSequence`，AI 回复看 `startedSequence` |
| 29 个错误码 | `domain/errors.ts` 单一映射表，与契约枚举完全一致 |

### 三处契约隐含约束（实现中发现，已落实）

这三条写在 Schema 的 `allOf` / `const` 里，容易漏掉，**3 号的插件实现会受第 2 条直接影响**：

1. **终态必须清空 `expiresAt` 与 `queuePosition`**。`Invocation` 进入三终态时这两个字段必须为 `null`，否则 Schema 校验失败。
2. **`completed` 的 `text` 必须非空**（受 `NonBlankText` 约束）。因此**零文本输出不能标记为完成**。后端处理为：插件正常结束但一字未产出时，终态落 `failed` + `AI_PROVIDER_ERROR`。
   > 对 3 号的影响：空响应重试后仍为空，直接抛错即可，**不要产占位文本凑数**。已有测试覆盖该路径。
3. **`Room.capacity` 是常量 5**，不是可配置上限。后端已把配置类型收紧为字面量 `5`，防止误改后产生不符合契约的输出。

### 错误码口径（定案）

3 号计划第 2 节列出的五个错误码 `AI_UNAVAILABLE`、`AI_PROVIDER_ERROR`、`AI_TIMEOUT`、`AI_CANCELLED`、`AI_RATE_LIMITED` **均存在于契约枚举，可直接使用**。

下列三个由后端产出，**插件不要抛**：

| 错误码 | 含义 |
| --- | --- |
| `AI_QUEUE_FULL` | 队列已满，调用未受理，回执 `rejected` |
| `AI_QUEUE_TIMEOUT` | 排队等待超时，调用从未开始，用 `invocation.updated` 表达 |
| `AI_CANCELLED` | 关房或超时触发取消 |

契约枚举中**没有** `AI_BUSY`。自动触发遇忙的处理是**静默跳过、不创建调用、不产生错误码**。

---

## 3. 能力插件接口（定案）

3 号计划第 3 节的提议形态已采纳，有两处调整，均已实现并测试。

### 定案签名

```ts
export interface Capability {
  readonly name: string;
  run(context: CapabilityContext): AsyncIterable<CapabilityChunk>;
}

export interface CapabilityContext {
  readonly roomId: string;
  readonly purpose: 'reply' | 'topic' | 'invitation';
  readonly caller: CapabilityMemberView | null;        // automatic 时为 null
  readonly invitedMember: CapabilityMemberView | null; // 仅 invitation 非空
  readonly members: readonly CapabilityMemberView[];
  readonly recentMessages: readonly CapabilityMessageView[];
  readonly currentTopic: CapabilityTopicView | null;
  readonly prompt: string | null;                      // 房主调用时的聊天正文
  readonly signal: AbortSignal;
}

export type CapabilityChunk =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'topic'; readonly topic: CapabilityTopicDraft };

export interface CapabilityMemberView {
  readonly memberId: string;
  readonly nickname: string;
  readonly interestTags: readonly string[];
  readonly bio: string;
}

export interface CapabilityMessageView {
  readonly authorId: string;
  readonly nickname: string;
  readonly text: string;
  readonly createdAt: string;
}
```

### 调整一：`signal` 并入 `context`

3 号提议 `run(ctx, signal)`，定案为 `run(context)`，signal 作为 `context.signal`。语义完全不变，仍是 `AsyncIterable` + `AbortSignal`。理由：取消语义与上下文同生命周期，合并后插件只接一个参数，后端也无需在两处保持一致。**3 号侧改动量是一行解构**。

### 调整二：不接收 `invite` chunk

3 号提议插件产出 `{ type: "invite", memberId }` 指定邀答对象。**定案为不接收**：邀答目标选择依赖成员在线状态与名额，属房间状态判定，按 `docs/architecture.md` 第 66 行应留在应用层。

改为：应用层先随机选定在线成员（房主也在候选内），再以 `purpose: 'invitation'` 发起调用，通过 `context.invitedMember` 把目标告知插件；**插件只负责生成邀请话术**。这样 `AIReply.invitedMember` 的值由后端保证符合契约条件约束（`purpose === 'invitation'` 时必须是 `Author`，否则必须为 `null`）。

### 调整三：不注入 `invitedOnceForCurrentTopic`

3 号要求注入此字段以保证每话题最多邀答一次（PRD 5.2）。**定案为不下发**：这是房间状态，由后端自行记录并直接决定是否发起邀答调用。插件被调用时，额度已经判过，无需知晓。已有测试覆盖"同一话题不重复邀答、换话题后重置"。

### 字段对应关系

| 3 号提议 | 定案 | 说明 |
| --- | --- | --- |
| `type: "text"` | `kind: 'text'` | 与内部记录字段统一 |
| `source: host/automatic` | `purpose` + `caller` | `caller === null` 即 automatic，信息无损 |
| `triggerText` | `prompt` | 同义 |
| `{ type: "invite" }` | `purpose: 'invitation'` + `context.invitedMember` | 见调整二 |
| `invitedOnceForCurrentTopic` | 不注入 | 见调整三 |

### 四条硬约束

1. 上下文只读，插件不持有房间对象，不改房间状态。
2. 取消用 `context.signal`，关房与超时由后端触发，插件必须响应。
3. 抛错即 failed，后端保留已输出文字并发布失败事件，插件不自行重试整条回复。
4. 选题结果只是草稿，`topic.changed` 由后端在成功完成后发布；失败或取消保留原话题。

### 装配方式

```ts
// app.ts
const app = await build({ config, capability: new TopicsCapability(deps) });
```

3 号只需导出一个满足 `Capability` 的实现。开发期后端提供 `createStubCapability()`——按固定节奏逐字输出、不接任何模型，用于在真实实现就绪前测稳队列与取消，并长期保留作回归，不消耗外部额度。

---

## 4. 阈值定档（定案）

契约明确 Q33–Q38 的建议数值不是产品默认值，这些由后端选定，并**必须通过协议对外声明**，前端不预设。全部收口在 `src/config.ts`。

### 资料与消息

| 参数 | 取值 | 对外出口 |
| --- | --- | --- |
| 昵称长度 | 1–20 | `client-config.validation.nickname` |
| 兴趣标签 | 1–8 个，单个 1–12 字 | `client-config.validation.interestTag(s)` |
| 简介 | 0–200 | `client-config.validation.bio` |
| 消息长度 | 1–500 | `client-config.validation.message` |
| 消息限频 | 10 条 / 10 秒 / 成员 | `MESSAGE_RATE_LIMITED` + `retryAfterMs` |

### AI 执行

| 参数 | 取值 | 对外出口 |
| --- | --- | --- |
| 队列长度 | 3 | `AI_QUEUE_FULL`，回执 `rejected` |
| 单次生成期限 | 30 秒 | `Invocation.expiresAt` |
| 排队等待上限 | 60 秒 | `AI_QUEUE_TIMEOUT`，`invocation.updated` |

### 连接与恢复

| 参数 | 取值 | 对外出口 |
| --- | --- | --- |
| 连接票据有效期 | 30 秒 | `ConnectionTicketData.expiresAt` |
| 成员掉线恢复 | 60 秒（PRD 固定） | `membership.recoveryExpiresAt` |
| 房主掉线关房 | 60 秒（PRD 固定） | `room.hostRecoveryExpiresAt` |
| 每房人数 | 5（契约常量） | `Room.capacity` |

### 冷场判定（定案）

**判据：房间内最后一条「成员消息」之后的静默时长。AI 自身发言不重置计时。**

理由：AI 补话的目的正是引出成员发言；若 AI 发言也重置计时，冷场会被 AI 自己掩盖，导致补话一次后长期沉默。

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| 一级冷场（自动选题） | 45 秒 | 静默达此时长且无当前话题 → 自动选题 |
| 二级冷场（随机邀答） | 距上次自动补话 30 秒 | 已有话题仍冷场 → 随机邀答，每话题最多一次 |
| 换话题 | 已邀答过且再冷场 45 秒 | 发起新一轮选题 |
| 轮询间隔 | 5 秒 | 调度器 tick |
| 最少在线成员 | 无门槛 | PRD 5.2 要求单人房间也可邀答房主，不额外设人数限制 |

三条附加规则：

- **房主掉线恢复期内暂停**新的自动话题与邀答（已受理调用继续）。
- **遇忙直接跳过**，不入队，下次轮询重新判断。
- **随机邀答不建立等待回合**，目标成员不作答不阻塞任何流程（PRD 5.2、契约 `random-invitation` 场景）。

调度判定实现为可注入时间戳的纯函数 `tickIdle(now)`，测试不依赖真实等待。

---

## 5. 实施顺序（垂直切片）

不按模块各写各的再合并，每个切片都打穿 `transport → application → domain`，前端可立即连。

| 切片 | 内容 | 状态 |
| --- | --- | --- |
| 0 | 骨架、统一信封、错误映射、CORS、`client-config` | 已完成 |
| 1 | 建房、入房、`getSelf`、资料 PATCH、凭证与引导幂等 | 已完成 |
| 2 | 连接票据、WS 升级、快照、事件总线与可见性过滤 | 已完成 |
| 3 | 聊天提交与幂等、成员事件、多标签页、掉线恢复 | 已完成 |
| 4 | AI 队列、FIFO、串行、流式六事件（假插件驱动） | 已完成 |
| 5 | 退出、移出、关房、终止顺序与数据清理 | 已完成 |
| 6 | 冷场调度、自动选题与随机邀答 | 已完成 |
| 7 | 换装 3 号真实能力实现，跑 handoff 九条场景 | 待 3 号交付实现 |

切片 7 不阻塞 3 号开工：接口已定案，3 号可按第 3 节签名独立开发并用自己的 mock 验证；装配只需在 `app.ts` 换一行。

### 补测阶段修掉的实现缺陷

补写掉线恢复测试时发现一处真实缺陷：消息幂等原本只按 `clientRequestId + authorId` 匹配，**跨入房会错误重放旧入房的消息正文**。`docs/api/wire.md` 第 48 行明确要求此时返回 `IDEMPOTENCY_CONTEXT_EXPIRED` 而非重放。

已修：`MemberMessageRecord` 增加 `membershipId` 字段，幂等命中时先比对入房归属，不一致则返回 `IDEMPOTENCY_CONTEXT_EXPIRED`。已有测试覆盖。

---

## 6. 验证方案

后端真实输出全部用 `contracts/models.schema.json` 与 `events.schema.json` 做 Draft 2020-12 校验，不自写一套断言。

### 已通过（92 项）

**身份与入房（11 项，`test/http.test.ts`）**

- `client-config` 对外声明校验约束
- 建房返回房主身份与邀请入口
- 引导凭证重试返回原房间；内容变更返回 `BOOTSTRAP_CONFLICT`
- 邀请码校验、昵称唯一、5 人上限（`INVITATION_INVALID` / `NICKNAME_TAKEN` / `ROOM_FULL`）
- 资料校验与 PATCH 语义（缺省保持原值、`bio: ""` 清空）
- 权限：`HOST_REQUIRED`、`HOST_PROTECTED`、`MEMBERSHIP_CHANGED`、`MEMBER_CREDENTIAL_INVALID`
- 消息幂等、`IDEMPOTENCY_CONFLICT`、限频整次失败、空消息拒绝
- 普通成员提及返回 `ignored`，文字仍正常发布
- 连接票据绑定当前入房
- 关房后资源返回 `ROOM_UNAVAILABLE`
- 房主退出即关房，普通成员退出只释放名额

**实时与流式（8 项，`test/ws.test.ts`）**

- 首帧为快照，结构、`cursor`、`occupiedSlots` 与成员数一致
- 流式增量拼接等于终态全文
- **三次并发房主调用严格 FIFO，且 started/completed 严格交替（同时只有一个 running）**
- **中途加入成员的快照与后续事件均不含入房前回复的 ID 与文本**
- 多标签页：关闭一个页不触发 offline
- 关房：取消事件先于 `room.closed`，`room.closed` 为最后一个事件，部分文本保留
- 移出：关闭码 1008，之后访问返回 `MEMBER_REMOVED`
- 票据一次性，重复使用被拒

**冷场调度与边界（12 项，`test/idle.test.ts`）**

- 人数不足不自动补话
- 冷场达阈值自动选题，自动调用的 `caller` / `clientRequestId` / `triggerMessageId` 均为 null
- 自动触发遇忙跳过，队列长度不变
- 每话题最多一次邀答，换话题后重置
- 房主掉线暂停自动触发，恢复后继续
- 成员发言重置计时
- **零文本输出落 `failed` + `AI_PROVIDER_ERROR`，且终态清空 `expiresAt` / `queuePosition`**
- 队列满返回 `AI_QUEUE_FULL`，但合法聊天照常发布
- 并发抢最后一个名额只成功一人
- 同 `clientRequestId` 并发 5 次只产生一条消息
- 重新加入换 `membershipId`、`memberId` 稳定
- 旧 `membershipId` 操作返回 `MEMBERSHIP_CHANGED`

**掉线恢复与超时关房（6 项，`test/recovery.test.ts`）**

恢复期压缩到百毫秒级驱动真实定时器，不改动生产逻辑。

- 普通成员掉线广播 `offline` 并带 `recoveryExpiresAt`，恢复期内不释放名额
- 期限内重连恢复 `online`，快照中 `membershipId` 不变
- 恢复超时释放名额，`member.left` 的 `reason` 为 `timeout`，身份保留但 `membership` 为 `null`
- 房主掉线广播 `room.updated` → `host_reconnecting`，期间公共聊天继续可用
- 房主恢复后回到 `open`、`hostRecoveryExpiresAt` 置空，沿用原 `membership`
- 房主掉线期间已受理的 AI 调用继续完成
- 房主恢复超时关房：`reason` 为 `host_timeout`，取消先于 `room.closed`，`room.closed` 为最后事件，已开始的回复全部进入终态
- 旧入房的消息重试返回 `IDEMPOTENCY_CONTEXT_EXPIRED` 且不重放旧正文，换新标识可正常发送

**错误码触发路径盘点（20 项，`test/error-codes.test.ts`）**

逐个错误码构造真实触发路径，并用一条汇总测试断言「已触发 ∪ 显式未覆盖 = 契约枚举」，不允许静默遗漏。

22 个有真实触发路径：`VALIDATION_ERROR`、`MEMBER_CREDENTIAL_INVALID`、`MEMBERSHIP_INACTIVE`、`MEMBERSHIP_CHANGED`、`MEMBER_REMOVED`、`HOST_REQUIRED`、`HOST_PROTECTED`、`ROOM_UNAVAILABLE`、`MEMBER_NOT_FOUND`、`INVITATION_INVALID`、`ROOM_FULL`、`NICKNAME_TAKEN`、`IDEMPOTENCY_CONFLICT`、`IDEMPOTENCY_CONTEXT_EXPIRED`、`BOOTSTRAP_CONFLICT`、`MESSAGE_RATE_LIMITED`、`AI_QUEUE_FULL`、`AI_QUEUE_TIMEOUT`、`AI_PROVIDER_ERROR`、`AI_CANCELLED`、`CONNECTION_TICKET_INVALID`、`CONNECTION_TICKET_USED`。

7 个显式未覆盖及原因：

| 错误码 | 未覆盖原因 |
| --- | --- |
| `IP_RATE_LIMITED` | 按 IP 维度限频属部署层策略，本轮未实现（架构文档已将部署列为暂缓） |
| `SERVICE_UNAVAILABLE` | 服务整体不可用由运行环境产生，无法在进程内集成测试中稳定构造 |
| `INTERNAL_ERROR` | 兜底错误，由未预期异常触发；人为制造会污染实现，已由错误处理器统一覆盖 |
| `AI_RATE_LIMITED` | 模型侧限频由 3 号在 `infrastructure/model` 内映射后抛出，后端只透传 |
| `AI_UNAVAILABLE` | 模型服务不可用由 3 号的适配层抛出，后端只透传 |
| `AI_TIMEOUT` | 单次生成超时需等待完整生成期限，实现已接通 `AbortSignal`，留待联调验证 |
| `CONNECTION_TICKET_EXPIRED` | 需等待票据有效期自然过期，留待联调验证 |

> 这张表就是 5 号验收时要核对的清单；表中任何一项若在联调中出现，说明实现与盘点不一致，应回头修正。

**状态存储可替换性（1 项，`test/store.test.ts`）**

注入一个带调用计数的装饰实现，跑完建房 → 入房 → 发消息 → 取票 → 关房全链路，断言业务行为不变且读写确实流经注入实现。这是"换持久化只改一个实现"的可执行证据，而非口头承诺。

**review 回归（24 项，`test/review-p1.test.ts` / `review-snapshot.test.ts` / `review-p2.test.ts`）**

PR #7 的 12 项 review 问题逐项对应失败路径用例，详见第 10 节。
其中快照顺序三项已验证：临时还原旧逻辑后必然失败，修复后通过。

### 待补

无。第 6 节原列的三项（房主掉线超时关房与恢复、旧入房重试 `IDEMPOTENCY_CONTEXT_EXPIRED`、错误码盘点）均已完成。

剩余工作全部依赖外部交付：切片 7 需要 3 号的真实能力实现，联调九条场景需要 4 号的前端。

### 联调场景

按 `docs/api/handoff.md` 九条执行，与 3 号计划第 8 节的联调清单重合，由 2 / 3 / 4 / 5 号共同跑。

---

## 7. 安全

- 成员凭证、引导凭证、连接票据均为 `randomBytes(48).toString('base64url')`，满足契约 `Secret` 的 `^[A-Za-z0-9_-]{32,}$`。
- 凭证不出现在任何事件载荷、日志或错误信息中；WS 握手失败只回关闭码与业务 code，不下发房间数据。
- 票据短效一次性，绑定 room + member + membership，握手时二次校验资格，不因持有旧票据绕过移出与关房限制。
- 关房后清理本产品保存的聊天与公开资料，并失效全部成员凭证与邀请码。
- 后端不接触模型与知乎的任何密钥。密钥经环境变量注入 `infrastructure/`，由 `app.ts` 装配，后端不读取、不记录、不转发。赛事提交检查第 6 条由 3 号在 `infrastructure/` 内落实。

---

## 8. 已知限制

- 状态为进程内实现，未做持久化。架构文档已声明"本轮暂不考虑服务重启恢复"，但这不等于已决定重启后结束房间，因此**不对外承诺重启行为**。状态读写已收口在 `infrastructure/state/store.ts` 的 `RoomStateStore` 接口后，`build({ store })` 可注入替换实现，已有测试验证可替换性。
- 容量目标与压测按架构文档暂缓，PRD 的每房 5 人上限有效。
- 冷场阈值为首版取值，上线后可按实际对话节奏调整；调整只改 `config.ts`，不触碰契约。
- `transport/` 与 `domain/` 的文件划分比架构文档的逻辑目录更扁平，理由见第 1 节差异表；代码量增长后可按原规划拆分，不影响对外行为。

---

## 9. 对分工表的更正建议（致 1 号）

认同 3 号第 7 节意见。分工表对 3 号的描述（追问、观点搭桥、私密接话）沿用原始 PRD 口径，而 PRD #1 第 9 节已调整为"真人主持、AI 辅助"并移除这几项。

对 2 号的描述"创建房间、加入房间、实时聊天、消息存储"与定稿一致，无需更正；但建议补上**冷场自动调度**，这部分实际由后端承担，分工表未体现。

建议分工表同步更新，否则 5 号按旧表写验收用例会测到已移除的功能。

---

## 10. PR #7 review 修复记录

review 提出 12 项（3 项 P1、9 项 P2），均有实测复现，全部已修并补回归测试。
测试从 58 项增至 82 项（第二轮后为 92 项）。

### P1

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | 路由无运行时校验，`as never` 不验证请求；省略 `bootstrapToken`／`clientRequestId` 仍返回 201 并共享 `undefined` 引导键；`bio: null` 返回 500 | 新增 `transport/validate.ts`，用契约 `models.schema.json` 做 Ajv 运行时校验，覆盖必填、类型、Secret 格式与 `additionalProperties`；四个写接口全部接入，删除所有 `as never` |
| 2 | `mentions` 契约是 `["ai"]` 字符串数组，实现却读 `mention.type`，导致合规提及返回 `not_requested`；原测试用了契约不允许的 `[{type:"ai"}]` 所以没发现 | 实现改为 `includes('ai')`；同步修正全部测试与 `demo.mjs` 的请求格式 |
| 3 | `bus.attach()` 先注册订阅，`markOnline()` 随即广播，抢在快照之前；实测首帧是 `member.presence.changed`，快照里还带着 `connecting`；房主恢复时先收 `room.updated` 再被旧快照覆盖 | `attach()` 改为三步：先更新状态 → 再注册并立即发送快照 → 最后广播变更事件。`applyOnline()` 返回待发事件而不直接广播 |

### P2

| # | 问题 | 修复 |
| --- | --- | --- |
| 4 | 旧 socket 的迟到关闭回调持有同一 `MemberRecord`，`detach()` 对已删除订阅返回 true，`markOffline()` 却操作新 membership，导致新入房被标离线并被定时器踢出 | `detach()` 按 `membershipId` 核对归属，不匹配则不触发离线转换；`bus.detach()` 对未知或重复订阅返回 false |
| 5 | 重试时按当前 invocation 重建回执，丢失首次结果：`rejected/AI_QUEUE_FULL` 退化为 `not_requested`，`ignored` 丢失，已受理后失败的被误报未受理 | `MemberMessageRecord` 新增 `receipt`，保存首次 `AiReceipt` 原文，幂等命中时原样回放 |
| 6 | 幂等只比较正文，不比较 `mentions`；先发普通消息再以同 ID 同正文加提及会返回成功而不是冲突 | 新增 `mentionsAi` 字段并纳入幂等比较，语义不同即返回 `IDEMPOTENCY_CONFLICT` |
| 7 | 插件可响应 `AbortSignal` 后正常结束迭代而不抛异常，该调用被标为 `completed` 而非 `failed/AI_TIMEOUT`；超时的话题草稿还会生效 | 消费每个分片前检查 `signal.aborted`；流正常结束后进入成功终态前再检查一次 |
| 8 | 引导记录的 fingerprint 含完整资料 JSON，关房只删房间、凭证与邀请码，资料原文驻留至进程结束 | `RoomStateStore` 新增 `deleteBootstrapsByRoom()`，关房时清理该房间全部引导记录 |
| 9 | `minMembers: 2` 使单人房间永不邀答，与 PRD 5.2「只有房主一人时也可邀答、不设人数门槛」冲突 | 移除该配置项与门槛判断，仅保留房间无人时跳过；对应测试按 PRD 重写 |
| 10 | 只检查字符串长度，纯空白输出仍标 `completed`，而契约要求 completed 的 text 匹配 `NonBlankText` 的 `\S` | 改用 `/\S/.test()` 判定 |
| 11 | 任何 purpose 的调用收到 topic chunk 都会改当前话题，违反「普通回复不改话题」 | 仅 `invocation.purpose === 'topic'` 时草稿可生效 |
| 12 | `["travel", " travel "]` 符合输入 Schema，trim 后重复，返回资料违反公共模型的 `uniqueItems` | 归一化后校验唯一性，重复返回 `VALIDATION_ERROR`；建房、入房与 PATCH 共用同一校验 |

### 验证

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `node --test test/*.test.ts` | **82 / 82 通过**（原 58 + 新增 24；第二轮后 92 项） |
| `npm run check --prefix contracts` | 通过，契约未改动 |
| `npm run demo` | 28 步全部达成，无未达预期项 |

快照顺序（P1-3）的三项用例做了反向验证：临时还原为旧逻辑后必然失败，
确认用例确实覆盖该失败路径，而非恒真断言。

---

## 11. PR #7 第二轮 review 修复记录

第二轮提出 5 项 P2，均有实测复现，全部已修并补回归测试。测试从 82 项增至 92 项。

| # | 问题 | 修复 |
| --- | --- | --- |
| 1 | 持有 Bearer 的重入分支完全不使用 `clientRequestId`，退出后重试旧请求会再次返回 201 并创建新 membership，迟到的网络重试能撤销用户刚完成的退出 | 新增 `rejoinRequests` 索引（`memberCredential + clientRequestId` → membershipId），旧请求重入返回 `IDEMPOTENCY_CONTEXT_EXPIRED`；关房时随凭证一并清理 |
| 2 | 匿名 bootstrap 重放不检查资格：成员已退出或被移出时仍返回 201，但 `member.membership` 为 null，无法通过 `RoomEntryData`（要求 `ActiveMember`），客户端取票也会失败 | 新增 `assertReplayable()`，重放前检查移出状态与当前入房；已退出返回 `IDEMPOTENCY_CONTEXT_EXPIRED`，被移出返回 `MEMBER_REMOVED` |
| 3 | 指纹用 `JSON.stringify(body.profile)`，把 JSON 属性排列顺序当成请求内容；仅调换 `profile` 字段顺序就从 201 变成 `409/BOOTSTRAP_CONFLICT` | 新增 `fingerprintOf()`，按固定字段顺序构造指纹（昵称归一化、标签 trim、bio 缺省为 `""`）；建房与入房共用 |
| 4 | 只检查是否已有话题，不区分类型；共同话题（`kind: 'common'`）发布后也会进入邀答分支，不符合 CONTEXT.md:37 与 PRD 5.2 对「热门话题发出后持续冷场」的限定 | 邀答分支限定 `currentTopic.kind === 'popular'`；共同话题持续冷场改为换话题 |
| 5 | `lastAutoAt` 在入队时设置，生成耗时被算进后续等待期；实测邀答等待 70ms、生成约 50ms，话题发布仅 24ms 后就触发邀答 | 自动调用的终态与话题发布处重设 `lastAutoAt`，冷却以输出完成／话题公开时刻为起点 |

### 验证

| 检查 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | 通过 |
| `node --test test/*.test.ts` | **92 / 92 通过**（新增 `test/review-round2.test.ts` 10 项） |
| `npm run check --prefix contracts` | 通过，契约未改动 |
| `npm run demo` | 28 步全部达成，无未达预期项 |

第 4、5 项做了反向验证：临时还原旧逻辑后对应用例必然失败，确认覆盖真实失败路径。

### 受影响的既有用例

`test/idle.test.ts` 的「每个话题最多一次随机邀答」原先用 `kind: 'common'`
构造当前话题，按新语义已改为 `popular`——邀答只在热门话题之后发起。
