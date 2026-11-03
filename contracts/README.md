# 并行开发接口基线 v0.1.0

前端和后端共同使用本目录的契约，不分别维护请求、响应和事件字段。
已执行的校验与本地 Mock 实测结果见 [验证记录](VALIDATION.md)。

| 文件 | 用途 |
| --- | --- |
| [openapi.json](openapi.json) | HTTP 路径、鉴权、入房标识、请求响应、状态码及错误分支 |
| [models.schema.json](models.schema.json) | 公共载荷和 HTTP 数据的唯一字段定义，JSON Schema Draft 2020-12 |
| [events.schema.json](events.schema.json) | 首帧快照及全部 WebSocket 事件，引用公共载荷 |
| [examples/http.json](examples/http.json) | OpenAPI 直接引用的成功、部分接收与业务错误样例 |
| [examples/ws/](examples/ws/) | 完整连接场景，包含快照、增量、终态及预期展示结果 |
| [协议说明](../docs/api/wire.md) | 前后端使用契约时必须遵守的交互和时序规则 |

## 启动与检查

在仓库根目录执行，本地契约工具使用 Node.js 24.18 或以上版本：

```bash
npm ci --prefix contracts
npm run check --prefix contracts
npm run types --prefix contracts
```

类型生成到 `contracts/generated/api.d.ts`，包含 HTTP `paths` 和 `components.schemas.ServerMessage`。生成产物可重复生成，不手动修改。
前端可据此实现客户端与事件状态归并；后端按同一 JSON Schema 实现及校验输出，使用支持 Draft 2020-12 的验证器。
两端应用分别以 `file:../contracts` 引入本地契约包，类型使用 `import type`，JSON Schema 使用包导出的子路径，不依赖另一端的业务代码。

```typescript
import type { components, paths } from '@talk-together/contracts';
type ServerMessage = components['schemas']['ServerMessage'];
type SendBody = paths['/api/v1/rooms/{roomId}/messages']['post']['requestBody']['content']['application/json'];
```

分别打开两个终端启动本地 Mock：

```bash
npm run mock:http --prefix contracts
```

```bash
npm run mock:ws --prefix contracts -- host-stream
```

HTTP Mock 使用 `http://127.0.0.1:4010`，WS 回放使用 `ws://127.0.0.1:4011/api/v1/rooms/room_demo/events`。它们是本地开发地址，不约束知乎平台部署。
HTTP 场景通过 Prism 的 `Prefer` 头选择，例如 `Prefer: code=201, example=message_ai_limited`；请求参数取对应 HTTP 样例。

```bash
curl http://127.0.0.1:4010/api/v1/client-config
```

Prism 根据 OpenAPI 校验请求并返回已定义示例；WS 工具按所选 JSON 场景回放并将日期平移到当前时间。
这些 Mock 是固定样例，不存储真实房间、不执行成员鉴权，也不把任意输入转换为真实业务结果；跨通道演练时使用场景的 `httpExamples` 对应固定输入。
HTTP 票据样例的远期日期仅便于本地回放，不代表产品的票据有效期。Prism 自身的无效请求错误不代替本契约定义的业务错误示例。

## WebSocket 场景

将命令中的 `host-stream` 换成以下文件名，不含 `.json`：

| 场景 | 验证内容 |
| --- | --- |
| `host-stream` | 房主提交、排队、流式增量、完整文本校准和话题更新 |
| `guest-reconnect` | 原成员以累计文本快照恢复，再追加新片段 |
| `join-midstream` | 新成员看不到旧回复，仍收到公开话题和新回复 |
| `queue-timeout-close` | 尚未开始的排队失败及关房取消部分回复 |
| `host-timeout` | 房主掉线后已受理队列继续，60 秒超时关房 |
| `host-restored` | 房主恢复，已有调用继续完成 |
| `member-updates` | 成员加入、资料修改、断线占位及超时释放 |
| `left` / `removed` | 主动退出或移出结束当前入房连接 |
| `message_ignored` | 普通成员提及仅作为聊天 |
| `message_ai_limited` | 文字成功、AI 未受理 |
| `random-invitation` | 随机邀答携带目标成员，不产生独占答题回合 |

`check` 校验公共模型、全部 HTTP 样例、请求结构、事件 Schema、场景中的串行执行、终态互斥、可见范围、快照后文本归并和关房结束顺序；还验证缺失必填、空兴趣标签、非法空值及旧回复泄漏会被拒绝。

## 两端工作边界

- 前端：先生成类型，使用 Mock 实现页面、角色控制、提交回执、排队展示及事件状态归并，不依赖真实后端或模型服务。
- 后端：实现 OpenAPI 中的操作与同一事件契约，内部存储、插件和模型适配保持分层；输出须通过同一 Schema 和场景检查。
- 双方：协议调整先更新此处的唯一源与样例，通过检查后一起采用，不在各端偷偷改字段。

未确认的 Q33–Q38 数值没有作为默认值写入契约。校验上限通过 `client-config` 声明；限频等待时间、队列和生成期限分别通过错误与运行状态返回。业务实现阈值由实现团队选择。
