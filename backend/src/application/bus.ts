import { isoTime, newId } from '../config.ts';
import type { RoomRecord } from '../domain/room.ts';
import { activeMembers, nextSequence } from '../domain/room.ts';
import { wireInvocation, wireMember, wireMessage, wireReply, wireRoom } from '../transport/wire.ts';

/** 一个已连接的订阅者。可见性按其本次入房位置判定。 */
export interface Subscriber {
  readonly memberId: string;
  readonly membershipId: string;
  /** 本次入房的起点序号，决定消息可见范围。 */
  readonly joinedSequence: number;
  send(payload: unknown): void;
  close(code: number, reason: string): void;
}

interface Envelope {
  type: string;
  eventId: string;
  roomId: string;
  sequence: number;
  occurredAt: string;
  data: Record<string, unknown>;
}

/**
 * 房间事件总线。
 *
 * 两条不变量由本模块独占保证：
 * 1. 可见性过滤只在此处实现：成员消息看 `createdSequence`，AI 回复看
 *    `startedSequence`，入房前已开始的回复整条不下发。
 * 2. 快照与订阅在同一同步块内完成，既不漏事件也不重复。
 */
export class RoomBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>();
  private readonly room: RoomRecord;

  constructor(room: RoomRecord) {
    this.room = room;
  }

  /** 该 membership 当前的连接数；为 0 时视为掉线。 */
  connectionCount(membershipId: string): number {
    return this.subscribers.get(membershipId)?.size ?? 0;
  }

  /**
   * 原子地拍快照并注册订阅。
   *
   * 这是同步方法且中间不 await，因此在它返回前不会有新事件产生：快照之前的
   * 状态必然已包含，之后的变化必然经由本订阅送达。
   */
  attach(subscriber: Subscriber): { snapshot: unknown; firstConnection: boolean } {
    const set = this.subscribers.get(subscriber.membershipId) ?? new Set<Subscriber>();
    const firstConnection = set.size === 0;
    set.add(subscriber);
    this.subscribers.set(subscriber.membershipId, set);
    return { snapshot: this.snapshot(subscriber), firstConnection };
  }

  /** 返回该 membership 是否已无连接。 */
  detach(subscriber: Subscriber): boolean {
    const set = this.subscribers.get(subscriber.membershipId);
    if (!set) return true;
    set.delete(subscriber);
    if (set.size === 0) {
      this.subscribers.delete(subscriber.membershipId);
      return true;
    }
    return false;
  }

  /** 结束某个 membership 的全部连接，用于退出、移出与关房。 */
  closeMembership(membershipId: string, code: number, reason: string): void {
    for (const subscriber of this.subscribers.get(membershipId) ?? []) {
      subscriber.close(code, reason);
    }
    this.subscribers.delete(membershipId);
  }

  closeAll(code: number, reason: string): void {
    for (const set of this.subscribers.values()) {
      for (const subscriber of set) subscriber.close(code, reason);
    }
    this.subscribers.clear();
  }

  /**
   * 发布事件：先取号，再按可见性逐个下发。
   *
   * `visibleFrom` 为该事件所属内容的起点序号；订阅者的 `joinedSequence`
   * 大于它时不可见，此时该订阅者会出现序号跳号，这是契约允许的。
   */
  publish(type: string, data: Record<string, unknown>, visibleFrom?: number): number {
    const sequence = nextSequence(this.room);
    const envelope: Envelope = {
      type,
      eventId: newId('evt'),
      roomId: this.room.id,
      sequence,
      occurredAt: isoTime(),
      data,
    };
    for (const set of this.subscribers.values()) {
      for (const subscriber of set) {
        if (visibleFrom !== undefined && subscriber.joinedSequence > visibleFrom) continue;
        subscriber.send(envelope);
      }
    }
    return sequence;
  }

  /** 以给定序号发布，用于状态变更已经取号的场景。 */
  publishAt(sequence: number, type: string, data: Record<string, unknown>, visibleFrom?: number): void {
    const envelope: Envelope = {
      type,
      eventId: newId('evt'),
      roomId: this.room.id,
      sequence,
      occurredAt: isoTime(),
      data,
    };
    for (const set of this.subscribers.values()) {
      for (const subscriber of set) {
        if (visibleFrom !== undefined && subscriber.joinedSequence > visibleFrom) continue;
        subscriber.send(envelope);
      }
    }
  }

  /** 按订阅者的入房位置构造首帧快照。 */
  snapshot(subscriber: Subscriber): unknown {
    const room = this.room;
    const joined = subscriber.joinedSequence;
    const self = room.members.get(subscriber.memberId);
    const messages: unknown[] = [];

    for (const message of room.messages) {
      if (message.createdSequence >= joined) messages.push(wireMessage(room, message));
    }
    for (const reply of room.replies.values()) {
      // 入房前已开始的回复整条不可见，累计文本也不得夹带。
      if (reply.startedSequence >= joined) messages.push(wireReply(room, reply));
    }
    messages.sort((left, right) => {
      const key = (item: unknown): number => {
        const value = item as { createdSequence?: number; startedSequence?: number };
        return value.createdSequence ?? value.startedSequence ?? 0;
      };
      return key(left) - key(right);
    });

    const invocations = [...room.invocations.values()]
      .filter(invocation => {
        if (invocation.replyId === null) return invocation.createdSequence >= joined;
        const reply = room.replies.get(invocation.replyId);
        return reply !== undefined && reply.startedSequence >= joined;
      })
      .map(invocation => wireInvocation(room, invocation));

    return {
      type: 'room.snapshot',
      roomId: room.id,
      cursor: room.sequence,
      capturedAt: isoTime(),
      data: {
        self: {
          memberId: subscriber.memberId,
          membershipId: subscriber.membershipId,
          role: self?.role ?? 'member',
          joinedSequence: joined,
        },
        room: wireRoom(room),
        members: activeMembers(room).map(wireMember),
        messages,
        invocations,
      },
    };
  }
}
