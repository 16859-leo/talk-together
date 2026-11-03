# capabilities/topics —— 选题与破冰能力

实现后端 `application/capability.ts` 定义的 `Capability` 接口（定案见 Issue #4 第 3 节）。

## 装配

```ts
// backend/src/app.ts
import { createTopicsCapability } from './capabilities/topics/index.ts';

const capability = createTopicsCapability({
  deepseekApiKey: process.env.DEEPSEEK_API_KEY!,
  zhihuCliPath: process.env.ZHIHU_CLI_PATH!,
});
const app = await build({ config, capability });
```

密钥经环境变量注入，本模块不落盘、不记录、不转发。

## 结构

```
capabilities/topics/
├── topics-capability.ts   实现 Capability，转换上下文、映射草稿
└── index.ts               装配入口 createTopicsCapability

infrastructure/model/      DeepSeek 适配、工具编排、输出清洗（第 2 步）
infrastructure/zhihu/      知乎数据源、缓存、适宜性筛选、备用池（第 1 步）
```

## 行为

| `purpose` | 产出 |
|---|---|
| `topic` | `topic` 草稿（common/popular）+ `text` 话术 |
| `invitation` | 仅 `text`，目标取自 `context.invitedMember`，不调工具 |
| `reply` | `text`，按 `context.prompt` 回应房主 |

## 边界（遵循 #4）

- 只产 chunk，不发事件、不改房间、不选邀答对象
- 取消用 `context.signal`，由应用层触发
- 抛错即 failed，不自行重试整条回复
- 零文本抛 `AI_PROVIDER_ERROR`，不产占位文本（契约 `completed` 态 `text` 受 `NonBlankText` 约束）
- 只抛 `AI_UNAVAILABLE` / `AI_PROVIDER_ERROR` / `AI_TIMEOUT` / `AI_CANCELLED` / `AI_RATE_LIMITED`

## 测试

```bash
npm test --prefix backend          # 57 项离线，零额度
# 真实冒烟（消耗少量额度）
DEEPSEEK_API_KEY=... ZHIHU_CLI_PATH=... \
  node --experimental-strip-types test/smoke-capability.ts
```

## 待与后端核对

- `CapabilityTopicDraft` / `CapabilityTopicView` 字段：#4 只给了类型名未给字段，本模块按契约 `Topic` 去 `id`/`publishedAt` 推导，需与 2 号的 `application/capability.ts` 对齐
- 实际装配以后端导出的接口类型为准，本模块的 `application/capability.ts` 为同构复刻
