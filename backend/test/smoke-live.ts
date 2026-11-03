/**
 * 真实调用冒烟验证。消耗少量外部额度，不随单测运行。
 *
 * 运行：node --experimental-strip-types test/smoke-live.ts
 * 前提：zhihu-cli 已安装且凭证已配置（系统密钥链或 ZHIHU_ACCESS_SECRET）。
 */

import { ZhihuCliClient } from '../src/infrastructure/zhihu/client.ts';
import { ZhihuTopicSource } from '../src/infrastructure/zhihu/topic-source.ts';

const binaryPath = process.env['ZHIHU_CLI_PATH'];
if (binaryPath === undefined || binaryPath.length === 0) {
  console.error('需要设置 ZHIHU_CLI_PATH 指向 zhihu-cli 可执行文件');
  process.exit(2);
}

const source = new ZhihuTopicSource(new ZhihuCliClient({ binaryPath }));

const common = await source.searchCommonTopics('露营', { count: 3 });
console.log(`[common] ${common.length} 条，上游调用 ${source.stats.searchCalls} 次`);
for (const topic of common) {
  console.log(`  - ${topic.title}  <${topic.sourceLabel ?? '备用池'}>`);
}

const popular = await source.getPopularTopics({ limit: 3 });
console.log(`[popular] ${popular.length} 条，上游调用 ${source.stats.hotCalls} 次`);
for (const topic of popular) {
  console.log(`  - ${topic.title}  <${topic.sourceLabel ?? '备用池'}>`);
}

// 验证缓存：再取一次不应增加上游调用
await source.getPopularTopics({ limit: 3 });
console.log(`[cache] 二次取用后热榜上游调用仍为 ${source.stats.hotCalls} 次`);
