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
import { ZhihuHttpClient } from '../../infrastructure/zhihu/http-client.ts';
import { OfflineContentSource } from '../../infrastructure/zhihu/offline-source.ts';
import { ZhihuTopicSource } from '../../infrastructure/zhihu/topic-source.ts';
import type { ZhihuContentSource } from '../../infrastructure/zhihu/types.ts';
import { DeepSeekTextGenerator } from '../../infrastructure/model/deepseek-generator.ts';
import type { TextGenerator } from '../../infrastructure/model/types.ts';
import { TopicsCapability } from './topics-capability.ts';

/** 知乎数据来源：http 直连开放平台、cli 调用本地可执行文件、offline 内置话题池。 */
export type ZhihuSourceKind = 'http' | 'cli' | 'offline';

export interface TopicsCapabilityEnv {
  /** DeepSeek API Key，经环境变量注入。 */
  readonly deepseekApiKey: string;
  /** 知乎开放平台的 Access Secret；有它就可以直接走 HTTP。 */
  readonly zhihuAccessSecret?: string;
  /** 接口域名，默认 https://developer.zhihu.com */
  readonly zhihuApiBase?: string;
  /** zhihu-cli 可执行文件绝对路径（回退方案）。 */
  readonly zhihuCliPath?: string;
  /** 显式指定来源；不填则按可用凭证自动选择。 */
  readonly zhihuSource?: ZhihuSourceKind;
  readonly model?: string;
}

/** 按配置挑选数据源：显式指定优先，否则 http → cli → offline。 */
export function pickZhihuSource(env: TopicsCapabilityEnv): ZhihuSourceKind {
  if (env.zhihuSource !== undefined) return env.zhihuSource;
  if (env.zhihuAccessSecret !== undefined && env.zhihuAccessSecret.length > 0) return 'http';
  if (env.zhihuCliPath !== undefined && env.zhihuCliPath.length > 0) return 'cli';
  return 'offline';
}

function buildContentSource(env: TopicsCapabilityEnv): ZhihuContentSource {
  const kind = pickZhihuSource(env);
  if (kind === 'http') {
    if (env.zhihuAccessSecret === undefined || env.zhihuAccessSecret.length === 0) {
      throw new Error('ZHIHU_SOURCE=http 需要 ZHIHU_ACCESS_SECRET');
    }
    return new ZhihuHttpClient({
      accessSecret: env.zhihuAccessSecret,
      ...(env.zhihuApiBase === undefined ? {} : { baseUrl: env.zhihuApiBase }),
    });
  }
  if (kind === 'cli') {
    if (env.zhihuCliPath === undefined || env.zhihuCliPath.length === 0) {
      throw new Error('ZHIHU_SOURCE=cli 需要 ZHIHU_CLI_PATH');
    }
    return new ZhihuCliClient({ binaryPath: env.zhihuCliPath });
  }
  return new OfflineContentSource();
}

/** 组装真实能力：DeepSeek 生成器 + 知乎数据源。 */
export function createTopicsCapability(env: TopicsCapabilityEnv): Capability {
  const source = new ZhihuTopicSource(buildContentSource(env));
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
