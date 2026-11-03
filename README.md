# talk-together

一款由真人主持、AI 辅助的线上陌生人破冰平台。房主组织多人讨论并可主动调用 AI，成员共同参与聊天，冷场时 AI 适度补话；游戏和 AI 能力采用可扩展插件形式。

- 产品规格：[V0.1 PRD](https://github.com/jasper0507/talk-together/issues/1)
- 领域术语：[CONTEXT.md](CONTEXT.md)
- 前后端联调约定：[docs/api.md](docs/api.md)
- 前后端设计交接：[docs/api/handoff.md](docs/api/handoff.md)
- 并行开发契约、类型与 Mock：[contracts/README.md](contracts/README.md)
- 架构、技术选型与目录设计：[docs/architecture.md](docs/architecture.md)

## 后端

后端实现位于 [backend/](backend/)，按 v0.1.0 契约提供 11 个 HTTP 操作与 17 类 WebSocket 事件。

- 实施计划与接口定案：[backend/IMPLEMENTATION_PLAN.md](backend/IMPLEMENTATION_PLAN.md)
- 运行与验证方法：[backend/HOW_TO_RUN.md](backend/HOW_TO_RUN.md)

```bash
npm ci --prefix contracts     # 契约依赖
npm ci --prefix backend       # 后端依赖

cd backend
npm run demo   # 端到端演练：28 步，实时打印每个请求与事件
npm test       # 197 项离线测试，包含后端与 Agent
```

默认启动和 demo 使用假插件（固定文本、不接模型），用于验证调度与事件逻辑。
真实选题与话术的 Agent 实现已合入，与应用层共用 `backend/src/application/capability.ts`；
启用真实模型需显式注入能力并配置环境变量，见 [插件装配说明](backend/src/capabilities/topics/README.md)。
