/**
 * 完整 Capability 真实调用冒烟：走 createTopicsCapability 装配入口，
 * 模拟应用层调用方式。消耗少量额度，不随单测运行。
 *
 * 运行：
 *   DEEPSEEK_API_KEY=... ZHIHU_CLI_PATH=... node --experimental-strip-types test/smoke-capability.ts
 */

import { createTopicsCapability } from '../src/capabilities/topics/index.ts';
import type {
  CapabilityChunk,
  CapabilityContext,
  CapabilityMemberView,
} from '../src/application/capability.ts';

const deepseekApiKey = process.env['DEEPSEEK_API_KEY'];
const zhihuCliPath = process.env['ZHIHU_CLI_PATH'];
if (deepseekApiKey === undefined || zhihuCliPath === undefined) {
  console.error('需要 DEEPSEEK_API_KEY 与 ZHIHU_CLI_PATH');
  process.exit(2);
}

const capability = createTopicsCapability({ deepseekApiKey, zhihuCliPath });

const members: CapabilityMemberView[] = [
  { memberId: 'a', nickname: '小林', interestTags: ['摄影', '露营'], bio: '' },
  { memberId: 'b', nickname: '阿哲', interestTags: ['摄影', '咖啡'], bio: '' },
];

function ctx(over: Partial<CapabilityContext>): CapabilityContext {
  return {
    roomId: 'room-smoke',
    purpose: 'topic',
    caller: null,
    invitedMember: null,
    members,
    recentMessages: [],
    currentTopic: null,
    prompt: null,
    signal: new AbortController().signal,
    ...over,
  };
}

const cases: { readonly name: string; readonly context: CapabilityContext }[] = [
  { name: 'topic', context: ctx({}) },
  {
    name: 'invitation',
    context: ctx({
      purpose: 'invitation',
      invitedMember: members[1] ?? null,
      currentTopic: { title: '你拍过最满意的照片是在哪儿？', content: '', kind: 'popular' },
    }),
  },
];

for (const { name, context } of cases) {
  const chunks: CapabilityChunk[] = [];
  const started = Date.now();
  try {
    for await (const chunk of capability.run(context)) chunks.push(chunk);
  } catch (error) {
    console.log(`[${name}] 失败：${(error as Error).message}`);
    continue;
  }
  const topic = chunks.find((c) => c.kind === 'topic');
  const speech = chunks.filter((c) => c.kind === 'text').map((c) => (c.kind === 'text' ? c.delta : '')).join('');
  console.log(`[${name}] ${Date.now() - started}ms  chunks=${chunks.length}`);
  if (topic?.kind === 'topic') {
    console.log(`  草稿(${topic.topic.kind})：${topic.topic.title}  <${topic.topic.sourceLabel ?? '备用池'}>`);
  }
  if (speech.length > 0) console.log(`  发言：${speech}`);
}

// 取消：abort 后应抛 AI_CANCELLED
const controller = new AbortController();
controller.abort();
try {
  for await (const _ of capability.run(ctx({ signal: controller.signal }))) void _;
  console.log('[cancel] 未抛错（异常）');
} catch (error) {
  console.log(`[cancel] 正确抛出：${(error as Error).message}`);
}
