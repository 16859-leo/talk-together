# Agent 模块实施计划（3 号）

本 Issue 为 Agent 侧的 Implementation Plan，按仓库规则在编码前提交评审。完整版见分支文件 `agent/IMPLEMENTATION_PLAN.md`。

依据：PRD #1（定稿）、`docs/architecture.md`、`docs/api.md`、`docs/api/wire.md`、`contracts/` v0.1.0。
契约自检已通过：`cd contracts && npm run check` → 11 接口 / 49 模型 / 43 HTTP 样例 / 12 WS 场景。

## 1. 交付物定位

按 `docs/architecture.md`，后端为模块化单体，Agent 能力位于 `backend/src/capabilities/`。因此本模块交付：

- `backend/src/capabilities/topics/`：选题与邀答能力插件
- `backend/src/infrastructure/model/`：AI SDK Core 适配、工具编排
- `backend/src/infrastructure/zhihu/`：知乎内容获取、缓存、备用话题池

**不交付**对外 HTTP/SSE 接口。以下明确归后端应用层，插件不自行实现：

- 同房间 AI 串行执行、房主调用 FIFO 队列、自动触发遇忙跳过（`docs/api.md` 第 152 行）
- 限频、权限校验、事件发布、`replyId` / `sequence` 生成
- 插件「使用只读上下文和注入的依赖；不直接修改房间或持有 WebSocket 连接」（`docs/architecture.md` 第 66 行）

## 2. 与契约的对应关系

| 契约字段 | 插件行为 |
|---|---|
| `Topic.kind = "common"` | 成员兴趣标签有交集 → 按共同关键词检索知乎话题 |
| `Topic.kind = "popular"` | 兴趣差异大 → 取热榜高排名且适合破冰的话题 |
| `Topic.sourceLabel` / `sourceUrl` | 标注知乎来源 |
| `AIReply.purpose = "reply"` | 房主主动调用的普通回复 |
| `AIReply.purpose = "topic"` | 选题产物，由应用层发布 `topic.changed` |
| `AIReply.purpose = "invitation"` | 随机邀答，携带 `invitedMember`，不建立等待回合 |
| `Invocation.source = "host" / "automatic"` | 区分房主调用与冷场自动触发 |

外部失败一律映射到契约已定义的错误码，不自造：
`AI_UNAVAILABLE`、`AI_PROVIDER_ERROR`、`AI_TIMEOUT`、`AI_CANCELLED`、`AI_RATE_LIMITED`。

## 3. 插件接口（提议，待后端确认）

`docs/architecture.md` 第 72 行将接口方法、取消与流结束语义交由后端设计。提议形态：

```ts
interface Capability {
  name: string;
  run(ctx: CapabilityContext, signal: AbortSignal): AsyncIterable<CapabilityChunk>;
}

type CapabilityChunk =
  | { type: "text"; delta: string }        // → ai.reply.delta
  | { type: "topic"; topic: TopicDraft }   // → 应用层发布 topic.changed
  | { type: "invite"; memberId: string };  // → purpose: invitation
```

`AsyncIterable` + `AbortSignal` 用于满足「支持渐进输出」与取消语义；取消时停止产出，已输出文本由应用层保留。

需应用层注入的只读上下文：

- `source`：`host` / `automatic`
- `triggerText`：房主调用时的聊天正文
- `members[]`：`nickname` / `interestTags` / `bio`（选题依据，PRD 5.3）
- `recentMessages[]`
- `currentTopic`
- `invitedOnceForCurrentTopic`：保证每话题最多邀答一次（PRD 5.2）

## 4. 外部依赖实测结果

PRD #1 第 7 节记「实际应用的接口权限、凭证和额度尚未验证」，现已验证：

| 依赖 | 实测结果 |
|---|---|
| 知乎 站内搜索 | 5000 次/天 |
| 知乎 热榜 | 100 次/天 → 需房间间共享缓存，建议 TTL ≥ 15 分钟 |
| 知乎 问题发现 | 100 次/天 |
| 知乎 直答 | 100 次/天；**连续 3 次快速调用即 429**，恢复约 17s；无 Tool Calls；要求 JSON 输出 10 次全部失败 |
| DeepSeek flash | 并发 2500；Tool Calls 与 JSON Output 可用；延迟 0.7–1.4s |

据此建议：**知乎开放平台仅作内容数据源，不作主模型**；主模型经 AI SDK Core 接入，建议 DeepSeek flash（供应商选择按架构文档「另行确认」）。

两项实现注意事项：

1. 工具定义每次请求全量计入 input token（实测 3 个工具约 550 tokens，输出仅 4–75）。system prompt 与 tools 需固定在 messages 最前且保持字节稳定以命中 prompt cache。
2. DeepSeek 官方承认存在循环工具调用与空响应风险。插件内置：工具轮次 ≤ 3、按 `name + 规范化 arguments` 哈希去重、空响应重试一次后降级、不使用 `tool_choice` 强制指定工具。

## 5. 话题适宜性筛选

实测某日 30 条热榜中，适合陌生人破冰的不足 5 条，其余为时政冲突、垂直门槛、行业数据类。PRD 5.3 要求「排名较高**且适合破冰**」「不刻意制造争论」，故热榜取用内置适宜性筛选，筛后不足时回落备用话题池。

说明：此处为**选题适宜性**，与 PRD 第 6 节「不建设内容审核」管辖的**用户消息审核**是不同对象，不冲突。

## 6. 降级

```
主模型 ──失败──> 备用精选话题池 ──无──> 返回映射后的错误码
```

插件不静默吞错，由应用层决定表达为 `ai.reply.failed` 或 `ai.invocation.updated`。满足 PRD 第 8 节「知乎接口或大模型服务不可用时，基础聊天不受影响」。

## 7. 需要确认的事项

### 与后端负责人（2 号）—— 开工前

1. `Capability` 接口最终签名（本文第 3 节为提议）
2. 代码落位与仓库骨架、依赖、构建入口对齐
3. 第 3 节所列上下文字段由应用层注入

可并行确定：冷场判定阈值 / 生成超时 / 队列长度（`docs/api.md` 第 120 行要求前后端共同记录并同步）、模型供应商与密钥注入方式、备用话题池存放位置。

### 与文档负责人（1 号）—— 分工表口径

分工表对 3 号的描述为「AI 主动破冰、**追问**、**观点搭桥**、冷场救场、**私密接话**、**主动退场**」，这是原始 PRD 的口径。PRD #1 第 9 节已调整：

- 「AI 自动主持调整为真人主持、AI 辅助」
- 「**不再要求** AI 自动完成渐进追问、观点搭桥和转场流程；保留上下文选题与冷场补话」
- 「**移除**选项回答、**私密接话助手**、手动暂停／恢复 AI……」

即分工表点名的「追问、观点搭桥、私密接话」三项已不在定稿范围；「主动退场」对应 PRD 5.2「正常交流期间不主动插话」。

本计划以 PRD #1 定稿为准。建议确认分工表是否同步更新 —— 5 号按 PRD 编写验收用例，若沿用旧分工表会测到已移除的功能。

## 8. 验证方案

离线（不消耗外部额度）：

- 插件单测：mock 模型响应覆盖 tool_calls → tool 结果 → 文本输出全链路
- 取消语义：`AbortSignal` 触发后停止产出且无未处理异常
- 循环防护：重复调用、超轮次、空响应
- 话题筛选：用已落盘的真实 30 条热榜样本断言过滤结果
- 输出清洗与质量闸门：已有 17 项用例（拦截元话语、转录式复述、Markdown 残留）
- 产出 `Topic` 用 `contracts/models.schema.json` 校验（Draft 2020-12）

需真实调用：工具选择准确率（现有探针 4/4）、流式分片映射。

联调（依赖后端应用层，对应 `docs/api/handoff.md`）：

- 房主调用 FIFO 串行，自动触发遇忙跳过；AI 未受理时合法聊天仍成功
- 流式增量归并为同一条回复，完成/失败/取消互斥，部分输出不丢失
- 中途加入不接收入房前已开始回复的片段
- 房主掉线后已受理调用继续，新自动触发暂停；超时关房取消剩余调用

## 9. 实施顺序（垂直切片）

1. `infrastructure/zhihu/`：搜索、热榜（含缓存与适宜性筛选）、备用话题池
2. `infrastructure/model/`：AI SDK Core 适配 + 工具编排 + 循环防护
3. `capabilities/topics/`：实现 `Capability` 接口，产出 text / topic / invite
4. 迁移清洗与质量闸门测试
5. 后端应用层就绪后联调第 8 节场景

第 1–2 步不依赖后端应用层，接口对齐后即可独立验证。插件接口与 2 号确认后，优先交付「冷场 → 选题 → 产出 Topic」最小链路，再补邀答与普通回复，不等整模块完成再合并。

## 10. 安全

- `DEEPSEEK_API_KEY`、`ZHIHU_ACCESS_SECRET` 仅经环境变量注入 `infrastructure/`，不入仓库
- 凭据不出现在任何对外响应、事件载荷或日志中
- 对应赛事提交检查第 6 条
