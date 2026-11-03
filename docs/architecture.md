# 架构与技术选型

产品依据：[V0.1 PRD #1](https://github.com/jasper0507/talk-together/issues/1)。
前后端共同约定见 [联调契约](api.md)。本页记录已确认架构与目录规划，实现细节交由前后端共同设计；本页不作为编码批准。

## 已确认的讨论边界

- 部署由知乎平台提供，本轮跳过部署讨论；不预设 Linux 主机、Docker Compose 或具体运行时兼容性。
- 暂不设房间数和在线人数的容量验证目标，具体能力待压测后另定；PRD 的每房最多 5 人仍有效。
- 本轮暂不考虑服务重启恢复等生产运行问题；这不等于已决定重启后结束房间，也不等于承诺能够恢复。
- 能力插件通过统一接口接入，要求高内聚、低耦合；具体注册与加载方式由后续实现设计确定。
- 技术选型以敏捷开发和 AI 适配为优先，不以协作规则中的 Go、Gin、MySQL 等建议作为选型前提。
- 接口文档须为前后端提供共同的联调依据，覆盖线上协议与可观察行为。

## 已确认的技术选型

| 用途 | 选择 | 项目内的取舍理由 |
| --- | --- | --- |
| 语言与后端 | TypeScript、Node.js、Fastify | 前后端使用同一语言；利用 Schema 校验和类型推导维护请求、响应约定 |
| 前端 | React、TypeScript、Vite，按需使用 Tailwind 和 shadcn/ui | 当前是交互式聊天室，可从客户端应用起步，不增加服务端渲染职责 |
| 实时传输 | 原生 WebSocket、`@fastify/websocket` | 延续 REST 提交与 WebSocket 推送的已确认分工 |
| 模型接入 | AI SDK Core | 使用统一模型调用接口；具体供应商、模型及功能兼容性另行确认 |
| HTTP 契约 | OpenAPI，与运行时请求、响应 Schema 保持一致 | 为前后端提供可检查、可生成类型和 Mock 的共同定义 |
| 实时契约 | 事件 Schema 与时序说明 | HTTP 契约不替代 WebSocket 事件的结构和行为定义 |

本项目当前以聊天室和外部模型调用为主，尚无本地模型训练或 Python 专用算法依赖。用户已确认使用 TypeScript 统一开发语言。线上契约使用 JSON Schema Draft 2020-12 与 OpenAPI 3.1；具体存储、模型供应商和运行阈值由后续实现设计选择。

官方能力依据：

- [Fastify Schema 校验与序列化](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)、[Type Providers](https://fastify.dev/docs/latest/Reference/Type-Providers/)。
- [Fastify WebSocket 插件](https://github.com/fastify/fastify-websocket)、[OpenAPI 插件](https://github.com/fastify/fastify-swagger)。
- [AI SDK Core 与多供应商接入](https://ai-sdk.dev/docs/introduction)、[普通 Node.js 使用方式](https://ai-sdk.dev/docs/getting-started/nodejs)。
- [Vite 静态构建与部署](https://vite.dev/guide/static-deploy.html)、[FastAPI 的 OpenAPI 与数据校验能力](https://fastapi.tiangolo.com/features/)。

## 已确认的架构

项目采用前后端分离结构：根级 `frontend/` 和 `backend/` 分别维护代码、依赖、配置和开发构建入口，通过 HTTP 与 WebSocket 通信。
独立的 `contracts/` 提供双方共同使用的线上契约，不包含前端界面或后端业务实现。
后端采用模块化单体，在一个后端应用中划分房间、成员、聊天和能力插件的职责，并采用分层架构保证可维护性。
HTTP 与 WebSocket 处理层负责协议转换；房间模块管理成员权限、生命周期、消息可见范围和事件发布。
插件通过小而明确的统一接口接收调用上下文、返回能力结果；模型服务和知乎内容获取封装在各自实现中。
插件不直接修改房间内部状态，也不自行绕过聊天室规则广播消息。
AI 回复采用流式输出，由后端将模型输出转换为本项目的 WebSocket 事件，向具有消息可见权限的房间成员推送。
插件接口需要支持渐进输出；具体接口方法、取消和错误语义由后端设计，并将前端可观察行为同步到联调契约。
架构与语言选择的原因见 [ADR 0002](adr/0002-typescript-modular-monolith.md)。

### 前端职责与依赖方向

- `app`：初始化、路由与全局依赖装配。
- `pages`：组合房间、聊天和 AI 功能，处理页面级交互。
- `features`：按房间管理、聊天和 AI 交互组织界面及相关逻辑。普通成员仍可查看 AI 流式回复，主动调用入口仅向房主提供。
- `state`：集中维护当前房间、成员、消息与 AI 回复状态，将 HTTP 返回和 WebSocket 事件归并为一致视图。
- `shared/api` 与 `shared/realtime`：负责请求、连接、事件解码和契约校验，向状态逻辑交付已解析的数据。
- `shared/ui`：按需复用的界面元素，不承担房间权限或 AI 调用规则。

页面组合功能，功能读取状态并提交操作；原始网络事件统一进入状态处理逻辑，避免各组件自行拼接同一条 AI 回复。
前端使用契约类型，不导入 `backend/` 内部代码。界面按角色展示操作，后端仍独立校验调用者权限。

### 后端分层职责与依赖方向

| 层或模块 | 职责 | 依赖约束 |
| --- | --- | --- |
| 协议层 `transport` | HTTP 与 WebSocket 接入、鉴权信息提取、契约校验、错误映射及事件序列化 | 调用应用层；不自行决定成员权限、房间状态或 AI 行为 |
| 应用层 `application` | 协调用例、身份与权限检查、调用插件、管理调用生命周期、统一提交房间变化和发布事件 | 依赖领域规则及实际需要的外部能力接口，不依赖 Fastify、AI SDK 或具体存储实现 |
| 领域层 `domain` | 房间、成员、消息、话题及其状态和不变量 | 保持普通 TypeScript 逻辑，不依赖网络、框架、存储或线上的 DTO |
| 能力插件 `capabilities` | 封装选题、提示生成等能力，按统一接口输出结果 | 使用只读上下文和注入的依赖；不直接修改房间或持有 WebSocket 连接 |
| 基础设施层 `infrastructure` | 接入模型、知乎内容和具体状态存储；把外部错误转换为应用可处理的错误 | 满足应用需要的接口，将供应商与库的细节留在实现内部 |
| 装配入口 `app.ts` | 创建实现、注册插件、连接各层依赖 | 集中处理具体实现的选择，避免业务逻辑自行创建外部客户端 |

主要调用方向为 `transport → application → domain`。插件和外部实现经装配入口接入应用层。
应用层拥有插件所需的统一接口，插件只依赖该接口和必要的领域类型，不反向调用应用用例。
统一接口既定义输入输出，也要明确错误、取消、流结束及调用期间允许的行为；这些语义由前后端在实现设计中补全。
只有确有变化或外部依赖的地方才提取接口，不为每个函数增加一层转发或预建通用插件引擎。

### 目录结构设计

以下是整体逻辑目录。`contracts/` 已提供可用基线与开发工具；前后端业务骨架仍按职责分别实现，按需创建文件。

```text
talk-together/
├── frontend/
│   ├── package.json              # 前端依赖及开发、构建、检查入口
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── src/
│       ├── app/                  # 初始化与路由
│       ├── pages/                # 创建、加入与房间页面装配
│       ├── features/
│       │   ├── room/             # 邀请、资料和房主管理
│       │   ├── chat/             # 消息输入与展示
│       │   └── ai/               # 房主调用入口与全房可见的流式回复
│       ├── state/                # 房间视图、消息归并与 AI 流状态
│       └── shared/
│           ├── api/              # HTTP 调用
│           ├── realtime/         # WebSocket 连接与事件解析
│           └── ui/               # 通用 UI
├── backend/
│   ├── package.json              # 后端依赖及开发、构建、检查入口
│   ├── tsconfig.json
│   └── src/
│       ├── main.ts               # 进程入口
│       ├── app.ts                # Fastify 创建、依赖装配和插件注册
│       ├── transport/
│       │   ├── http/             # REST 路由、契约与应用用例适配
│       │   └── ws/               # 连接管理与房间事件推送
│       ├── application/
│       │   ├── room.ts           # 房间、成员和资料管理用例
│       │   ├── chat.ts           # 聊天提交与消息可见性协调
│       │   ├── ai.ts             # 房主权限、调用与流式结果生命周期
│       │   └── capability.ts     # 统一能力接口及其内部上下文、结果类型
│       ├── domain/
│       │   ├── room.ts           # 房间状态与规则
│       │   ├── member.ts         # 成员身份、资料与权限规则
│       │   ├── message.ts        # 消息及 AI 回复状态
│       │   └── topic.ts          # 当前话题与随机邀答规则
│       ├── capabilities/
│       │   └── topics/           # 共同话题、热榜话题等已确认能力
│       └── infrastructure/
│           ├── model/            # AI SDK Core 适配
│           ├── zhihu/            # 知乎内容获取与备用内容
│           └── state/            # 房间状态的具体保存实现
├── contracts/
│   ├── package.json              # 契约检查、Mock 和类型生成入口
│   ├── models.schema.json        # 公共载荷、请求响应与错误的唯一字段定义
│   ├── openapi.json              # HTTP 资源，引用公共模型与样例
│   ├── events.schema.json        # WS 首帧快照和事件，引用公共模型
│   ├── check.mjs                 # 样例及场景一致性检查
│   ├── mock-ws.mjs               # 本地 WS 固定场景回放
│   ├── generated/api.d.ts        # 生成的 HTTP 与 WS TypeScript 类型
│   └── examples/                 # HTTP 成功错误样例与 WS 场景
└── docs/
    ├── api.md                    # 联调流程、权限、错误和时序说明
    ├── architecture.md           # 分层、依赖方向与目录设计
    └── adr/                      # 架构选择及原因
```

前后端共同依赖 `contracts/` 中的线上契约，前端不导入服务端应用层、领域层或基础设施代码，后端不导入前端代码。
契约包不依赖 Fastify、React 或模型 SDK；协议层负责在线上载荷与内部类型之间转换。
两端可分别开发、构建和检查，不要求后端运行才能构建前端。前端使用契约样例或 Mock 开发，后端按同一契约校验输入输出。
对外事件发布统一经过应用层和协议层，避免不同插件各自维护一套广播规则。
契约、样例、类型生成及本地 Mock 已验证；前后端应用的依赖方向与真实业务行为仍须在实现阶段验证。

## 已确认的联调契约维护方式

先确认契约，再分别实现前端和后端。HTTP 使用 OpenAPI；WebSocket 独立定义事件 Schema、生命周期和时序。
请求、响应及事件载荷各自只维护一份权威 Schema，类型和 Mock 从权威定义派生，避免前后端各自手写一套。
公共字段以 `contracts/models.schema.json` 为源，HTTP 和事件 Schema 引用同一模型；TypeScript 类型由 OpenAPI 的统一入口生成，包含 ServerMessage 联合类型。检查和使用方式见 [契约目录](../contracts/README.md)。

## 实现职责与联调交接

- 已确认行为见 [联调契约](api.md)：房主调用、流式生命周期、同房间串行、掉线与关房规则、主动退出同步、快照恢复和 Bearer 凭证加连接票据。
- 后端应用层统一管理同房间 AI 串行执行状态与房主调用 FIFO 队列；自动触发遇忙跳过，之后重新判断，不能由插件各自决定。
- 协议层验证房间级身份与一次性连接票据，建立连接后按成员本次入房的可见范围提供快照和事件。
- 前端状态层按 `clientRequestId` 关联提交结果，按快照游标与事件序号归并增量，具体字段以共享契约为准。
- 协议层按回复开始事件与成员本次入房位置控制可见性，完成全文、失败状态和快照采用同一规则，避免通过终态消息补发入房前回复。
- 选题成功后由应用层更新当前话题；普通 AI 回复不改话题，AI 未受理不回滚合法聊天。
- 队列等待、执行上下文、超时、自动话题与邀答调度、校验及限频参数，由前后端自行设计并记录，不继续向用户逐项追问。
- 具体交付物和联调场景见 [设计交接](api/handoff.md)；未确认的 Q33–Q38 建议不构成默认配置。
