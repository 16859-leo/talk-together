import { isoTime, newId, type Config } from '../config.ts';
import { AppError, toFailure, type ErrorCode } from '../domain/errors.ts';
import {
  activeMembers,
  nextSequence,
  type AIReplyRecord,
  type InvocationRecord,
  type MemberMessageRecord,
  type MemberRecord,
  type ReplyPurpose,
  type RoomRecord,
} from '../domain/room.ts';
import { wireInvocation, wireReply, wireRoom, wireTopic } from '../transport/wire.ts';
import type { RoomBus } from './bus.ts';
import type { Capability, CapabilityContext, CapabilityMemberView } from './capability.ts';

/** HTTP 回执的 AI 部分，对应契约的 AiReceipt。 */
export type AiReceipt =
  | { status: 'not_requested' | 'ignored' }
  | { status: 'queued' | 'running'; invocationId: string }
  | { status: 'rejected'; error: { code: ErrorCode; message: string; retryAfterMs: number | null } };

interface EnqueueInput {
  readonly source: 'host' | 'automatic';
  readonly purpose: ReplyPurpose;
  readonly callerMemberId: string | null;
  readonly invitedMemberId: string | null;
  readonly triggerMessageId: string | null;
  readonly clientRequestId: string | null;
  readonly prompt: string | null;
}

/**
 * 单个房间的 AI 执行域。
 *
 * 不变量：
 * - 同房间同时最多一个 running 调用。
 * - 房主调用按受理顺序 FIFO 排队；自动触发遇忙直接跳过，不入队。
 * - completed / failed / cancelled 互斥，一次调用只进入其中一个。
 * - 失败或取消保留已输出文字，不自动重跑。
 */
export class AiService {
  private autoPaused = false;
  private pumping = false;
  private idleTimer: NodeJS.Timeout | null = null;
  /** 排队阶段的提示词，按 invocationId 暂存。 */
  private readonly prompts = new Map<string, string | null>();

  constructor(
    config: Config,
    room: RoomRecord,
    bus: RoomBus,
    capability: Capability,
  ) {
    this.config = config;
    this.room = room;
    this.bus = bus;
    this.capability = capability;
  }

  private readonly config: Config;
  private readonly room: RoomRecord;
  private readonly bus: RoomBus;
  private readonly capability: Capability;

  /** 房主掉线恢复期内暂停新的自动话题与邀答。 */
  setAutoPaused(paused: boolean): void {
    this.autoPaused = paused;
  }

  /**
   * 启动冷场调度。
   *
   * 判据只看成员消息的静默时长：先尝试自动选题，选题后若继续静默，再发起一次
   * 随机邀答。每个话题最多邀答一次，这个状态由后端自己记录，不下发给插件。
   */
  startIdleScheduler(): void {
    if (this.idleTimer !== null) return;
    const timer = setInterval(() => this.tickIdle(), this.config.idle.tickMs);
    timer.unref?.();
    this.idleTimer = timer;
  }

  stopIdleScheduler(): void {
    if (this.idleTimer === null) return;
    clearInterval(this.idleTimer);
    this.idleTimer = null;
  }

  /** 成员发言时重置冷场计时；AI 自身发言不调用这里。 */
  noteMemberActivity(): void {
    this.room.lastMemberMessageAt = Date.now();
  }

  /** 冷场判定的一次轮询。返回实际发起的调用，便于测试断言。 */
  tickIdle(now: number = Date.now()): InvocationRecord | null {
    if (this.autoPaused || this.room.closed) return null;
    // 遇忙跳过：不入队，之后重新判断。
    if (this.room.running !== null || this.room.queue.length > 0) return null;
    // PRD 5.2 要求只有房主一人时也可发起随机邀答，因此不设人数门槛。
    if (activeMembers(this.room).length === 0) return null;

    const silentFor = now - this.room.lastMemberMessageAt;
    if (silentFor < this.config.idle.topicMs) return null;

    const sinceAuto = now - this.room.lastAutoAt;

    // 一级：仍无当前话题时选题。这里同样要检查冷却，否则首次选题失败后
    // 每轮轮询都会立刻重试，持续产生失败事件与模型请求。
    if (this.room.currentTopic === null) {
      if (this.room.lastAutoAt > 0 && sinceAuto < this.config.idle.topicMs) return null;
      return this.fireAutomatic('topic', null, now);
    }

    // 二级：随机邀答按 CONTEXT.md 与 PRD 5.2 限定在「热门话题发出后持续冷场」，
    // 共同话题不进入邀答分支，继续等待成员围绕共同兴趣自行交流。
    const isPopularTopic = this.room.currentTopic.kind === 'popular';
    if (isPopularTopic && !this.room.invitedForCurrentTopic && sinceAuto >= this.config.idle.invitationMs) {
      const target = this.pickInvitee();
      if (target === null) return null;
      this.room.invitedForCurrentTopic = true;
      return this.fireAutomatic('invitation', target.id, now);
    }

    // 已邀答过、或当前是共同话题，持续冷场则换一个新话题。
    if ((this.room.invitedForCurrentTopic || !isPopularTopic) && sinceAuto >= this.config.idle.topicMs) {
      return this.fireAutomatic('topic', null, now);
    }
    return null;
  }

  private fireAutomatic(purpose: 'topic' | 'invitation', invitedMemberId: string | null, now: number): InvocationRecord | null {
    // 先按入队时间占位，避免同一轮重复触发；真正的冷却起点在输出结束后重设，
    // 否则生成耗时会被算进等待期，话题刚发布就立刻邀答。
    this.room.lastAutoAt = now;
    try {
      return this.enqueue({
        source: 'automatic',
        purpose,
        callerMemberId: null,
        invitedMemberId,
        triggerMessageId: null,
        clientRequestId: null,
        prompt: null,
      });
    } catch {
      // 自动触发失败不对外报错，下次轮询重新判断。
      return null;
    }
  }

  /**
   * 随机选择一名在线成员作为邀答目标，房主也在候选内。
   *
   * 目标选择依赖在线状态与成员列表，属于房间状态判定，因此留在应用层；
   * 插件只通过 context.invitedMember 得知目标并生成话术。
   */
  private pickInvitee(): MemberRecord | null {
    const candidates = activeMembers(this.room).filter(
      member => member.membership?.presence === 'online',
    );
    if (candidates.length === 0) return null;
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index] ?? null;
  }

  receiptFor(invocation: InvocationRecord | undefined): AiReceipt {
    if (!invocation) return { status: 'not_requested' };
    if (invocation.status === 'queued') return { status: 'queued', invocationId: invocation.id };
    if (invocation.status === 'running') return { status: 'running', invocationId: invocation.id };
    // 幂等重放命中已结束的调用时，不再次入队，按原状态回执。
    return invocation.error === null
      ? { status: 'running', invocationId: invocation.id }
      : { status: 'rejected', error: invocation.error };
  }

  /**
   * 处理一次消息提交中的 AI 提及。
   *
   * 普通成员的提及直接忽略；房主的调用进入 FIFO 队列。AI 未受理时聊天已经
   * 发布，这里只返回未受理原因，不回滚合法聊天。
   */
  handleMention(input: {
    mentionsAi: boolean;
    member: MemberRecord;
    message: MemberMessageRecord;
    clientRequestId: string;
  }): AiReceipt {
    if (!input.mentionsAi) return { status: 'not_requested' };
    if (input.member.role !== 'host') return { status: 'ignored' };

    try {
      const invocation = this.enqueue({
        source: 'host',
        purpose: 'reply',
        callerMemberId: input.member.id,
        invitedMemberId: null,
        triggerMessageId: input.message.id,
        clientRequestId: input.clientRequestId,
        prompt: input.message.text,
      });
      return invocation.status === 'running'
        ? { status: 'running', invocationId: invocation.id }
        : { status: 'queued', invocationId: invocation.id };
    } catch (error) {
      return { status: 'rejected', error: toFailure(error) };
    }
  }

  /** 自动触发：遇忙直接跳过，不进入等待队列。 */
  triggerAutomatic(purpose: 'topic' | 'invitation', invitedMemberId: string | null = null): InvocationRecord | null {
    if (this.autoPaused || this.room.closed) return null;
    if (this.room.running !== null || this.room.queue.length > 0) return null;
    return this.fireAutomatic(purpose, invitedMemberId, Date.now());
  }

  private enqueue(input: EnqueueInput): InvocationRecord {
    if (this.room.closed) throw new AppError('ROOM_UNAVAILABLE', '房间已关闭');
    if (this.room.queue.length >= this.config.aiQueueLimit) {
      throw new AppError('AI_QUEUE_FULL', 'AI 排队已满，请稍后再试');
    }

    const invocation: InvocationRecord = {
      id: newId('inv'),
      source: input.source,
      callerMemberId: input.callerMemberId,
      triggerMessageId: input.triggerMessageId,
      clientRequestId: input.clientRequestId,
      status: 'queued',
      queuePosition: null,
      replyId: null,
      purpose: input.purpose,
      invitedMemberId: input.invitedMemberId,
      createdAt: isoTime(),
      createdSequence: nextSequence(this.room),
      startedAt: null,
      finishedAt: null,
      expiresAt: null,
      error: null,
    };
    this.room.invocations.set(invocation.id, invocation);
    this.prompts.set(invocation.id, input.prompt);
    this.room.queue.push(invocation.id);
    invocation.queuePosition = this.room.queue.length;

    // 排队等待超时：尚未开始的调用直接进入 failed，用 invocation.updated 表达。
    const waitTimer = setTimeout(() => {
      if (invocation.status !== 'queued') return;
      this.room.queue = this.room.queue.filter(id => id !== invocation.id);
      this.finishQueued(invocation, 'failed', 'AI_QUEUE_TIMEOUT', '排队等待超时');
      this.reindexQueue();
    }, this.config.aiQueueWaitMs);
    waitTimer.unref?.();
    invocation.queueTimer = waitTimer;

    this.bus.publishAt(invocation.createdSequence, 'ai.invocation.updated', {
      invocation: wireInvocation(this.room, invocation),
    }, invocation.createdSequence);

    void this.pump();
    return invocation;
  }

  /** 串行消费队列：同一时刻只有一个调用在执行。 */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.room.closed && this.room.running === null) {
        const next = this.room.queue.shift();
        if (next === undefined) break;
        const invocation = this.room.invocations.get(next);
        if (!invocation || invocation.status !== 'queued') continue;
        this.reindexQueue();
        await this.execute(invocation);
      }
    } finally {
      this.pumping = false;
    }
  }

  private reindexQueue(): void {
    this.room.queue.forEach((id, index) => {
      const invocation = this.room.invocations.get(id);
      if (!invocation) return;
      invocation.queuePosition = index + 1;
      this.bus.publish('ai.invocation.updated', { invocation: wireInvocation(this.room, invocation) }, invocation.createdSequence);
    });
  }

  private async execute(invocation: InvocationRecord): Promise<void> {
    if (invocation.queueTimer) {
      clearTimeout(invocation.queueTimer);
      delete invocation.queueTimer;
    }

    const controller = new AbortController();
    invocation.controller = controller;
    const runTimer = setTimeout(() => controller.abort(new AppError('AI_TIMEOUT', '生成超时')), this.config.aiRunMs);
    runTimer.unref?.();

    this.room.running = invocation.id;
    invocation.status = 'running';
    invocation.queuePosition = null;
    invocation.startedAt = isoTime();
    invocation.expiresAt = isoTime(Date.now() + this.config.aiRunMs);

    // 开始生成才产生 replyId 与 started 事件。
    const reply: AIReplyRecord = {
      kind: 'ai',
      id: newId('reply'),
      invocationId: invocation.id,
      callerMemberId: invocation.callerMemberId,
      triggerMessageId: invocation.triggerMessageId,
      purpose: invocation.purpose,
      invitedMemberId: invocation.invitedMemberId,
      text: '',
      status: 'streaming',
      startedSequence: nextSequence(this.room),
      createdAt: isoTime(),
      updatedAt: isoTime(),
      error: null,
    };
    invocation.replyId = reply.id;
    this.room.replies.set(reply.id, reply);

    this.bus.publishAt(reply.startedSequence, 'ai.reply.started', {
      reply: wireReply(this.room, reply),
      invocation: wireInvocation(this.room, invocation),
    }, reply.startedSequence);

    let topicDraft: { title: string; content: string; kind: 'common' | 'popular'; sourceLabel?: string | null; sourceUrl?: string | null } | null = null;

    try {
      for await (const chunk of this.capability.run(this.buildContext(invocation, controller.signal))) {
        if (this.room.closed) break;
        // 插件可能响应 AbortSignal 后正常结束迭代而不抛异常，因此每片都要检查。
        if (controller.signal.aborted) break;
        if (chunk.kind === 'text') {
          reply.text += chunk.delta;
          reply.updatedAt = isoTime();
          this.bus.publish('ai.reply.delta', {
            replyId: reply.id,
            invocationId: invocation.id,
            textDelta: chunk.delta,
          }, reply.startedSequence);
        } else {
          // 选题结果只是草稿，由应用层在成功完成后决定是否更新当前话题。
          topicDraft = chunk.topic;
        }
      }
      clearTimeout(runTimer);

      // 流正常结束也可能是因为插件响应了取消；不能只靠 catch 判断。
      if (controller.signal.aborted) {
        const failure = toFailure(controller.signal.reason);
        this.terminate(invocation, reply, failure.code === 'AI_CANCELLED' ? 'cancelled' : 'failed', failure);
        return;
      }

      // 契约要求 completed 的 text 匹配 NonBlankText 的 \S，纯空白同样不能算成功。
      if (!/\S/.test(reply.text)) {
        this.terminate(invocation, reply, 'failed', {
          code: 'AI_PROVIDER_ERROR',
          message: 'AI 没有产出内容',
          retryAfterMs: null,
        });
        return;
      }
      this.terminate(invocation, reply, 'completed', null);
      // 只有选题调用的草稿才能生效；普通回复与邀答不改当前话题。
      if (topicDraft !== null && invocation.purpose === 'topic') {
        this.publishTopic(topicDraft);
      }
    } catch (error) {
      clearTimeout(runTimer);
      const aborted = controller.signal.aborted;
      const failure = toFailure(aborted ? (controller.signal.reason ?? error) : error);
      this.terminate(invocation, reply, failure.code === 'AI_CANCELLED' ? 'cancelled' : 'failed', failure);
    } finally {
      delete invocation.controller;
      if (this.room.running === invocation.id) this.room.running = null;
    }
  }

  private buildContext(invocation: InvocationRecord, signal: AbortSignal): CapabilityContext {
    const view = (member: MemberRecord): CapabilityMemberView => ({
      memberId: member.id,
      nickname: member.profile.nickname,
      interestTags: [...member.profile.interestTags],
      bio: member.profile.bio,
    });
    const caller = invocation.callerMemberId === null ? null : this.room.members.get(invocation.callerMemberId);
    const invited = invocation.invitedMemberId === null ? null : this.room.members.get(invocation.invitedMemberId);

    return {
      roomId: this.room.id,
      purpose: invocation.purpose,
      caller: caller ? view(caller) : null,
      invitedMember: invited ? view(invited) : null,
      members: activeMembers(this.room).map(view),
      recentMessages: this.room.messages.slice(-20).map(message => ({
        authorId: message.authorId,
        nickname: this.room.members.get(message.authorId)?.profile.nickname ?? message.authorId,
        text: message.text,
        createdAt: message.createdAt,
      })),
      currentTopic: this.room.currentTopic === null
        ? null
        : {
            title: this.room.currentTopic.title,
            content: this.room.currentTopic.content,
            kind: this.room.currentTopic.kind,
          },
      prompt: this.prompts.get(invocation.id) ?? null,
      signal,
    };
  }

  /** 已开始回复的终态事件同时携带最终 Invocation 与 AIReply。 */
  private terminate(
    invocation: InvocationRecord,
    reply: AIReplyRecord,
    status: 'completed' | 'failed' | 'cancelled',
    failure: { code: ErrorCode; message: string; retryAfterMs: number | null } | null,
  ): void {
    if (reply.status !== 'streaming') return;
    reply.status = status;
    reply.updatedAt = isoTime();
    reply.error = failure;
    invocation.status = status;
    invocation.finishedAt = isoTime();
    invocation.error = failure;
    // 契约要求终态不再携带运行期限。
    invocation.expiresAt = null;
    invocation.queuePosition = null;
    this.prompts.delete(invocation.id);

    // 自动发话的后续冷却从输出真正结束时开始计算，
    // 否则生成耗时会被算进等待期，成员没有实际回应时间。
    if (invocation.source === 'automatic') {
      this.room.lastAutoAt = Date.now();
    }
    const type = status === 'completed' ? 'ai.reply.completed' : status === 'failed' ? 'ai.reply.failed' : 'ai.reply.cancelled';
    this.bus.publish(type, {
      reply: wireReply(this.room, reply),
      invocation: wireInvocation(this.room, invocation),
    }, reply.startedSequence);
  }

  /** 尚未开始的调用用 invocation.updated 表达终态，replyId 为空。 */
  private finishQueued(
    invocation: InvocationRecord,
    status: 'failed' | 'cancelled',
    code: ErrorCode,
    message: string,
  ): void {
    if (invocation.status !== 'queued') return;
    if (invocation.queueTimer) {
      clearTimeout(invocation.queueTimer);
      delete invocation.queueTimer;
    }
    invocation.status = status;
    invocation.queuePosition = null;
    invocation.finishedAt = isoTime();
    invocation.error = { code, message, retryAfterMs: null };
    this.prompts.delete(invocation.id);
    this.bus.publish('ai.invocation.updated', { invocation: wireInvocation(this.room, invocation) }, invocation.createdSequence);
  }

  private publishTopic(draft: { title: string; content: string; kind: 'common' | 'popular'; sourceLabel?: string | null; sourceUrl?: string | null }): void {
    if (this.room.closed) return;
    this.room.currentTopic = {
      id: newId('topic'),
      title: draft.title,
      content: draft.content,
      kind: draft.kind,
      sourceLabel: draft.sourceLabel ?? null,
      sourceUrl: draft.sourceUrl ?? null,
      publishedAt: isoTime(),
    };
    // 新话题开始，重置本话题的邀答额度。
    this.room.invitedForCurrentTopic = false;
    // 后续冷却以话题公开时刻为起点，给成员留下实际回应时间。
    this.room.lastAutoAt = Date.now();
    // 当前话题按 PRD 单独公开，不做入房前可见性过滤。
    this.bus.publish('topic.changed', { topic: wireTopic(this.room.currentTopic) });
  }

  /**
   * 关房前终结全部已受理调用：先结掉未开始的排队项，再中断正在生成的回复。
   * 调用返回后房间内不应再有 queued 或 running 状态。
   */
  terminateAll(code: ErrorCode, message: string): void {
    const queued = [...this.room.queue];
    this.room.queue = [];
    for (const id of queued) {
      const invocation = this.room.invocations.get(id);
      if (invocation) this.finishQueued(invocation, 'cancelled', code, message);
    }

    const runningId = this.room.running;
    if (runningId !== null) {
      const invocation = this.room.invocations.get(runningId);
      const reply = invocation?.replyId === null || invocation?.replyId === undefined
        ? undefined
        : this.room.replies.get(invocation.replyId);
      if (invocation && reply) {
        // 保留已输出文字，同步标记取消，确保 room.closed 之前没有 running。
        this.terminate(invocation, reply, 'cancelled', { code, message, retryAfterMs: null });
      }
      invocation?.controller?.abort(new AppError(code, message));
      this.room.running = null;
    }
  }
}
