/**
 * 真实能力启动入口。
 *
 * 默认的 `main.ts` 使用假插件（固定文本、不接模型），用于本地运行与 demo；
 * 这个入口把真实的 `TopicsCapability`（DeepSeek + 知乎）接进应用层，用于联调与验收。
 *
 * 用法：
 *   $env:DEEPSEEK_API_KEY="..."          # 必需
 *   $env:ZHIHU_ACCESS_SECRET="..."       # 可选，直连知乎开放平台
 *   $env:ZHIHU_CLI_PATH="..."            # 可选，回退到本地 CLI
 *   npm run start:ai
 *
 * 也可以把这些写进 backend/.env（已 gitignore）。
 * 密钥只经环境变量传入，不落盘、不记录、不转发。
 */
import { build } from './app.ts';
import { defaultConfig } from './config.ts';
import {
  createTopicsCapability,
  pickZhihuSource,
  type ZhihuSourceKind,
} from './capabilities/topics/index.ts';

const deepseekApiKey = process.env['DEEPSEEK_API_KEY'];
if (deepseekApiKey === undefined || deepseekApiKey.length === 0) {
  console.error('启用真实能力需要 DEEPSEEK_API_KEY');
  process.exit(2);
}

const zhihuAccessSecret = process.env['ZHIHU_ACCESS_SECRET'] ?? '';
const zhihuApiBase = process.env['ZHIHU_API_BASE'] ?? '';
const zhihuCliPath = process.env['ZHIHU_CLI_PATH'] ?? '';
const rawSource = process.env['ZHIHU_SOURCE'] ?? '';
const zhihuSource: ZhihuSourceKind | undefined =
  rawSource === 'http' || rawSource === 'cli' || rawSource === 'offline' ? rawSource : undefined;

const env = {
  deepseekApiKey,
  ...(zhihuAccessSecret.length === 0 ? {} : { zhihuAccessSecret }),
  ...(zhihuApiBase.length === 0 ? {} : { zhihuApiBase }),
  ...(zhihuCliPath.length === 0 ? {} : { zhihuCliPath }),
  ...(zhihuSource === undefined ? {} : { zhihuSource }),
};

const resolved = pickZhihuSource(env);
if (resolved === 'offline') {
  console.warn('[ai] 未配置知乎凭证，话题来源使用内置话题池（不联网）');
} else if (resolved === 'http') {
  console.log(`[ai] 知乎数据源：HTTP 开放平台${zhihuApiBase.length > 0 ? `（${zhihuApiBase}）` : ''}`);
} else {
  console.log('[ai] 知乎数据源：本地 zhihu-cli');
}

const port = Number(process.env['PORT'] ?? defaultConfig.port);
const host = process.env['HOST'] ?? defaultConfig.host;
const config = {
  ...defaultConfig,
  port,
  host,
  publicWsOrigin: process.env['PUBLIC_WS_ORIGIN'] ?? `ws://${host}:${port}`,
};

const capability = createTopicsCapability(env);
const app = await build({ config, capability });
await app.listen({ host: config.host, port: config.port });
console.log(`talk-together backend (topics capability) listening on http://${config.host}:${config.port}`);
