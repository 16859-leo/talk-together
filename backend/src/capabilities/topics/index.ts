/**
 * 选题能力的装配入口。
 *
 * app.ts 只需调用 createTopicsCapability(env) 得到一个 Capability，
 * 无需了解 DeepSeek 与知乎的任何细节。
 *
 * 密钥经环境变量注入，本模块不落盘、不记录、不转发（赛事提交检查第 6 条）。
 */

import type { Capability } from '../../application/capability.ts';
import { ZhihuCliClient } from '../../infrastructure/zhihu/client.ts';
import { ZhihuTopicSource } from '../../infrastructure/zhihu/topic-source.ts';
import { DeepSeekTextGenerator } from '../../infrastructure/model/deepseek-generator.ts';
import type { TextGenerator } from '../../infrastructure/model/types.ts';
import { TopicsCapability } from './topics-capability.ts';

export interface TopicsCapabilityEnv {
  /** DeepSeek API Key，经环境变量注入。 */
  readonly deepseekApiKey: string;
  /** zhihu-cli 可执行文件绝对路径。 */
  readonly zhihuCliPath: string;
  readonly model?: string;
}

/** 组装真实能力：DeepSeek 生成器 + 知乎数据源。 */
export function createTopicsCapability(env: TopicsCapabilityEnv): Capability {
  const source = new ZhihuTopicSource(new ZhihuCliClient({ binaryPath: env.zhihuCliPath }));
  const generator = new DeepSeekTextGenerator(source, {
    apiKey: env.deepseekApiKey,
    ...(env.model === undefined ? {} : { model: env.model }),
  });
  return new TopicsCapability(generator);
}

/** 允许注入自定义生成器，用于测试或接别的模型。 */
export function createTopicsCapabilityWith(generator: TextGenerator): Capability {
  return new TopicsCapability(generator);
}
