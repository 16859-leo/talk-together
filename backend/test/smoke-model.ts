/**
 * 模型层真实调用冒烟。消耗少量 token，不随单测运行。
 *
 * 运行：
 *   DEEPSEEK_API_KEY=... ZHIHU_CLI_PATH=... node --experimental-strip-types test/smoke-model.ts
 */

import { ZhihuCliClient } from '../src/infrastructure/zhihu/client.ts';
import { ZhihuTopicSource } from '../src/infrastructure/zhihu/topic-source.ts';
import { DeepSeekTextGenerator } from '../src/infrastructure/model/deepseek-generator.ts';
import type { GenerationChunk, GenerationRequest, MemberView } from '../src/infrastructure/model/types.ts';

const apiKey = process.env['DEEPSEEK_API_KEY'];
const cliPath = process.env['ZHIHU_CLI_PATH'];
if (apiKey === undefined || cliPath === undefined) {
  console.error('需要 DEEPSEEK_API_KEY 与 ZHIHU_CLI_PATH');
  process.exit(2);
}

const topics = new ZhihuTopicSource(new ZhihuCliClient({ binaryPath: cliPath }));
const generator = new DeepSeekTextGenerator(topics, { apiKey });

const sharedInterest: MemberView[] = [
  { memberId: 'a', nickname: '小林', interestTags: ['摄影', '露营'], bio: '' },
  { memberId: 'b', nickname: '阿哲', interestTags: ['摄影', '咖啡'], bio: '' },
];
const noOverlap: MemberView[] = [
  { memberId: 'a', nickname: '小林', interestTags: ['金融'], bio: '' },
  { memberId: 'b', nickname: '阿哲', interestTags: ['二次元'], bio: '' },
  { memberId: 'c', nickname: 'Momo', interestTags: ['健身'], bio: '' },
];

function base(overrides: Partial<GenerationRequest>): GenerationRequest {
  return {
    purpose: 'topic',
    members: sharedInterest,
    recentMessages: [],
    currentTopic: null,
    prompt: null,
    caller: null,
    invitedMember: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

const cases: { readonly name: string; readonly request: GenerationRequest }[] = [
  { name: 'topic · 有共同兴趣（应走 search）', request: base({}) },
  { name: 'topic · 无共同兴趣（应走热榜）', request: base({ members: noOverlap }) },
  {
    name: 'invitation · 只生成话术（不调工具）',
    request: base({
      purpose: 'invitation',
      invitedMember: sharedInterest[1] ?? null,
      currentTopic: { title: '你们都在哪儿拍过最满意的照片？', content: '' },
    }),
  },
  {
    name: 'reply · 房主主动调用',
    request: base({
      purpose: 'reply',
      caller: sharedInterest[0] ?? null,
      prompt: '帮我们找个轻松点的话题',
    }),
  },
];

for (const { name, request } of cases) {
  const started = Date.now();
  const chunks: GenerationChunk[] = [];
  try {
    for await (const chunk of generator.generate(request)) chunks.push(chunk);
  } catch (error) {
    console.log(`[${name}] 失败：${(error as Error).message}`);
    continue;
  }
  const topic = chunks.find((c) => c.kind === 'topic');
  const text = chunks.find((c) => c.kind === 'text');
  console.log(`[${name}] ${Date.now() - started}ms`);
  if (topic?.kind === 'topic') {
    console.log(`  话题(${topic.topic.kind})：${topic.topic.title}`);
    console.log(`  来源：${topic.topic.sourceLabel ?? '备用池'}`);
  }
  if (text?.kind === 'text') {
    console.log(`  发言(${text.delta.length}字)：${text.delta}`);
  }
}

console.log(`\n知乎上游调用：热榜 ${topics.stats.hotCalls} 次，搜索 ${topics.stats.searchCalls} 次`);
