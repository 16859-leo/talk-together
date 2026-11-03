/**
 * 能力插件统一接口。
 *
 * 签名照搬后端实施计划 #4 第 3 节「定案签名」，不作改动。
 * 本文件由 3 号按定案复刻，实际装配时应以后端 application/capability.ts
 * 导出的类型为准（同构，便于两侧独立开发后对接）。
 *
 * #4 未给出 CapabilityTopicDraft 与 CapabilityTopicView 的字段定义，
 * 此处按契约 Topic 去除应用层负责生成的 id 与 publishedAt 推导，
 * 并在第 3 节注明待与 2 号核对。
 */

export interface CapabilityMemberView {
  readonly memberId: string;
  readonly nickname: string;
  readonly interestTags: readonly string[];
  readonly bio: string;
}

export interface CapabilityMessageView {
  readonly authorId: string;
  readonly nickname: string;
  readonly text: string;
  readonly createdAt: string;
}

/** 当前话题的只读视图。 */
export interface CapabilityTopicView {
  readonly title: string;
  readonly content: string;
}

/**
 * 话题草稿。对应契约 Topic 去掉 id 与 publishedAt——
 * 那两项由应用层在发布 topic.changed 时生成。
 *
 * title 与 content 必须满足契约 NonBlankText（minLength 1 + pattern "\S"），
 * 本模块在产出前已校验。
 */
export interface CapabilityTopicDraft {
  readonly title: string;
  readonly content: string;
  readonly kind: 'common' | 'popular';
  readonly sourceLabel: string | null;
  readonly sourceUrl: string | null;
}

export interface CapabilityContext {
  readonly roomId: string;
  readonly purpose: 'reply' | 'topic' | 'invitation';
  /** automatic 时为 null。 */
  readonly caller: CapabilityMemberView | null;
  /** 仅 invitation 非空，目标由应用层选定。 */
  readonly invitedMember: CapabilityMemberView | null;
  readonly members: readonly CapabilityMemberView[];
  readonly recentMessages: readonly CapabilityMessageView[];
  readonly currentTopic: CapabilityTopicView | null;
  /** 房主调用时的聊天正文。 */
  readonly prompt: string | null;
  readonly signal: AbortSignal;
}

export type CapabilityChunk =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'topic'; readonly topic: CapabilityTopicDraft };

export interface Capability {
  readonly name: string;
  run(context: CapabilityContext): AsyncIterable<CapabilityChunk>;
}
