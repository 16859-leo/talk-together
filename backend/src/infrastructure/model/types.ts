/**
 * 模型适配层的类型定义。
 *
 * 职责边界（后端计划 #4 第 1、3 节）：
 *   本层只负责「调模型 + 编排工具 + 产出增量」，
 *   不判断调用时机、不管队列、不发事件、不选邀答对象。
 */

import type { TopicCandidate } from '../zhihu/types.ts';

/** 与 Capability 对齐的三种用途。 */
export type GenerationPurpose = 'reply' | 'topic' | 'invitation';

/** 生成过程中向上产出的增量。 */
export type GenerationChunk =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'topic'; readonly topic: TopicCandidate };

export interface MemberView {
  readonly memberId: string;
  readonly nickname: string;
  readonly interestTags: readonly string[];
  readonly bio: string;
}

export interface MessageView {
  readonly authorId: string;
  readonly nickname: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface TopicView {
  readonly title: string;
  readonly content: string;
}

/** 一次生成请求。字段取自 CapabilityContext，但不含 roomId 等编排无关项。 */
export interface GenerationRequest {
  readonly purpose: GenerationPurpose;
  readonly members: readonly MemberView[];
  readonly recentMessages: readonly MessageView[];
  readonly currentTopic: TopicView | null;
  /** 房主主动调用时的聊天正文；自动触发为 null。 */
  readonly prompt: string | null;
  /** 房主；自动触发为 null。 */
  readonly caller: MemberView | null;
  /** 仅 invitation 非空，目标由应用层选定。 */
  readonly invitedMember: MemberView | null;
  readonly signal: AbortSignal;
}

/** 文本生成器接口。便于测试注入假实现，不碰真实模型。 */
export interface TextGenerator {
  generate(request: GenerationRequest): AsyncIterable<GenerationChunk>;
}
