/**
 * 真实能力启动入口。
 *
 * 默认的 `main.ts` 使用假插件（固定文本、不接模型），用于本地运行与 demo；
 * 这个入口把真实的 `TopicsCapability`（DeepSeek + 知乎）接进应用层，用于联调与验收。
 *
 * 用法：
 *   $env:DEEPSEEK_API_KEY="..."; $env:ZHIHU_CLI_PATH="..."; npm run start:ai
 *
 * 密钥只经环境变量传入，不落盘、不记录、不转发。
 */
import { build } from './app.ts';
import { defaultConfig } from './config.ts';
import { createTopicsCapability } from './capabilities/topics/index.ts';

const deepseekApiKey = process.env['DEEPSEEK_API_KEY'];
const zhihuCliPath = process.env['ZHIHU_CLI_PATH'];
if (deepseekApiKey === undefined || deepseekApiKey.length === 0) {
  console.error('启用真实能力需要 DEEPSEEK_API_KEY');
  process.exit(2);
}
if (zhihuCliPath === undefined || zhihuCliPath.length === 0) {
  console.error('启用真实能力需要 ZHIHU_CLI_PATH');
  process.exit(2);
}

const port = Number(process.env['PORT'] ?? defaultConfig.port);
const host = process.env['HOST'] ?? defaultConfig.host;
const config = {
  ...defaultConfig,
  port,
  host,
  publicWsOrigin: process.env['PUBLIC_WS_ORIGIN'] ?? `ws://${host}:${port}`,
};

const capability = createTopicsCapability({ deepseekApiKey, zhihuCliPath });
const app = await build({ config, capability });
await app.listen({ host: config.host, port: config.port });
console.log(`talk-together backend (topics capability) listening on http://${config.host}:${config.port}`);
