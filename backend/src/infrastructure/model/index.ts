/**
 * 模型适配层。装配入口（app.ts）从这里导入。
 *
 * 密钥经环境变量注入，本层不落盘、不记录、不转发。
 */

export { DeepSeekTextGenerator } from './deepseek-generator.ts';
export type { DeepSeekGeneratorOptions } from './deepseek-generator.ts';
export { SYSTEM_PROMPT, buildUserPrompt, commonInterestTags } from './prompts.ts';
export { cleanOutput, rejectOutput } from './sanitize.ts';
export type { RejectReason } from './sanitize.ts';
export type {
  GenerationChunk,
  GenerationPurpose,
  GenerationRequest,
  MemberView,
  MessageView,
  TextGenerator,
  TopicView,
} from './types.ts';
