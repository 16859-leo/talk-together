/**
 * 知乎内容基础设施。装配入口（app.ts）只需从这里导入。
 *
 * 密钥不在此处读取：zhihu-cli 自行从系统密钥链或 ZHIHU_ACCESS_SECRET 获取，
 * 本模块只传可执行文件路径。
 */

export { ZhihuCliClient } from './client.ts';
export type { ZhihuClientOptions } from './client.ts';
export { ZhihuTopicSource } from './topic-source.ts';
export type { TopicSourceOptions } from './topic-source.ts';
export { screenHotItems, isIcebreakingTitle } from './screening.ts';
export type { ScreenResult, ScreenedHotItem } from './screening.ts';
export { pickFallbackTopics, fallbackTopicCount } from './fallback.ts';
export { CapabilityError, isNonBlankText } from './types.ts';
export type {
  CapabilityErrorCode,
  TopicCandidate,
  ZhihuContentSource,
  ZhihuHotItem,
  ZhihuSearchItem,
} from './types.ts';
