/**
 * 选题与破冰能力插件。
 *
 * 实现后端定案的 Capability 接口（application/capability.ts），
 * 内部委托 infrastructure/model 的 TextGenerator 完成生成。
 *
 * 职责边界（后端计划 #4）：
 *   - 只产出 text / topic chunk，不发事件、不改房间、不选邀答对象
 *   - 取消用 context.signal，由应用层触发
 *   - 抛错即 failed，不自行重试整条回复（重试在生成器内按 maxRetries 处理）
 *   - topic chunk 只是草稿，是否发布 topic.changed 由应用层决定
 */

import type {
  Capability,
  CapabilityChunk,
  CapabilityContext,
  CapabilityMemberView,
} from '../../application/capability.ts';
import type {
  GenerationRequest,
  MemberView,
  MessageView,
  TextGenerator,
  TopicView,
} from '../../infrastructure/model/types.ts';
import { isNonBlankText } from '../../infrastructure/zhihu/types.ts';
import { CapabilityError } from '../../infrastructure/zhihu/types.ts';
import { AppError } from '../../domain/errors.ts';

function toMemberView(member: CapabilityMemberView): MemberView {
  return {
    memberId: member.memberId,
    nickname: member.nickname,
    interestTags: member.interestTags,
    bio: member.bio,
  };
}

export class TopicsCapability implements Capability {
  readonly name = 'topics';
  readonly #generator: TextGenerator;

  constructor(generator: TextGenerator) {
    this.#generator = generator;
  }

  async *run(context: CapabilityContext): AsyncIterable<CapabilityChunk> {
    const currentTopic: TopicView | null =
      context.currentTopic === null
        ? null
        : { title: context.currentTopic.title, content: context.currentTopic.content };

    const request: GenerationRequest = {
      purpose: context.purpose,
      members: context.members.map(toMemberView),
      recentMessages: context.recentMessages.map(
        (message): MessageView => ({
          authorId: message.authorId,
          nickname: message.nickname,
          text: message.text,
          createdAt: message.createdAt,
        }),
      ),
      currentTopic,
      prompt: context.prompt,
      caller: context.caller === null ? null : toMemberView(context.caller),
      invitedMember: context.invitedMember === null ? null : toMemberView(context.invitedMember),
      signal: context.signal,
    };

    try {
      for await (const chunk of this.#generator.generate(request)) {
        if (chunk.kind === 'topic') {
          const { title, content, kind, sourceLabel, sourceUrl } = chunk.topic;
          // 契约 NonBlankText 兜底：生成器已保证，这里再防一道，
          // 不合格则跳过草稿但不影响文本输出（话题不是每次都必须有）。
          if (!isNonBlankText(title) || !isNonBlankText(content)) continue;
          yield { kind: 'topic', topic: { title, content, kind, sourceLabel, sourceUrl } };
        } else {
          yield { kind: 'text', delta: chunk.delta };
        }
      }
    } catch (error) {
      // 应用层用 AppError 识别失败原因；插件内部抛的是 CapabilityError。
      // 不在这里转换的话，toFailure 会把任何非 AppError 统一降级成
      // AI_UNAVAILABLE，导致 AI_PROVIDER_ERROR / AI_RATE_LIMITED / AI_TIMEOUT
      // 等契约错误码在事件里丢失。
      if (error instanceof CapabilityError) {
        throw new AppError(error.code, error.message, { retryAfterMs: error.retryAfterMs });
      }
      throw error;
    }
  }
}

export { CapabilityError };
