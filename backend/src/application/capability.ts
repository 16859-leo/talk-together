/**
 * 能力插件统一接口，供应用层与 TopicsCapability 共用。
 *
 * 四条硬约束：
 * 1. 上下文只读：插件不持有房间对象，也不能改房间状态。
 * 2. 取消用 `AbortSignal`：关房与超时由应用层触发，插件必须响应。
 * 3. 抛错即 failed：应用层保留已输出文字并发布失败事件，插件不自行重试。
 * 4. 选题结果只是草稿：是否更新当前话题由应用层在成功完成后决定。
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

export interface CapabilityTopicView {
  readonly title: string;
  readonly content: string;
  readonly kind: 'common' | 'popular';
}

/**
 * 插件式游戏的当前轮次。
 *
 * `instruction` 由游戏插件给出，能力层只负责照着它生成主持话术；
 * 轮次推进、开局收尾由应用层按房主指令决定，模型不参与。
 */
export interface CapabilityGameView {
  readonly gameId: string;
  readonly name: string;
  readonly emoji: string;
  readonly phase: 'start' | 'round' | 'end';
  readonly round: number;
  readonly totalRounds: number;
  readonly instruction: string;
}

export interface CapabilityContext {
  readonly roomId: string;
  /** 调用用途：普通回复、选题或随机邀答。 */
  readonly purpose: 'reply' | 'topic' | 'invitation';
  /** 房主主动调用时为调用者，自动触发时为 null。 */
  readonly caller: CapabilityMemberView | null;
  /** 随机邀答的目标成员，其余用途为 null。 */
  readonly invitedMember: CapabilityMemberView | null;
  readonly members: readonly CapabilityMemberView[];
  readonly recentMessages: readonly CapabilityMessageView[];
  readonly currentTopic: CapabilityTopicView | null;
  /** 房主提及时附带的文本。 */
  readonly prompt: string | null;
  /** 这一轮在主持游戏时才有；普通回复/选题/邀答为 null。 */
  readonly game?: CapabilityGameView | null;
  readonly signal: AbortSignal;
}

export type CapabilityChunk =
  | { readonly kind: 'text'; readonly delta: string }
  | { readonly kind: 'topic'; readonly topic: CapabilityTopicDraft };

export interface CapabilityTopicDraft {
  readonly title: string;
  readonly content: string;
  readonly kind: 'common' | 'popular';
  readonly sourceLabel?: string | null;
  readonly sourceUrl?: string | null;
}

export interface Capability {
  readonly name: string;
  run(context: CapabilityContext): AsyncIterable<CapabilityChunk>;
}

/**
 * 假插件：按固定节奏逐字输出，不接入任何模型。
 *
 * 默认用于本地运行、demo 和离线回归，验证队列、串行、取消与终态互斥。
 */
export const createStubCapability = (options: { delayMs?: number } = {}): Capability => {
  const delayMs = options.delayMs ?? 30;
  const wait = (ms: number, signal: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason ?? new Error('aborted'));
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });

  return {
    name: 'stub',
    async *run(context: CapabilityContext): AsyncIterable<CapabilityChunk> {
      const text =
        context.purpose === 'topic'
          ? '最近大家看过什么好电影？'
          : context.purpose === 'invitation'
            ? `${context.invitedMember?.nickname ?? '这位朋友'}，如果愿意，可以聊聊最近看过的电影。`
            : '我在，想聊什么都可以说。';

      for (const character of text) {
        await wait(delayMs, context.signal);
        yield { kind: 'text', delta: character };
      }

      if (context.purpose === 'topic') {
        yield {
          kind: 'topic',
          topic: { title: '最近看过的电影', content: text, kind: 'common', sourceLabel: null, sourceUrl: null },
        };
      }
    },
  };
};
