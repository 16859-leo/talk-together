import { isoTime, newId, newSecret, type Config } from '../config.ts';
import { AppError } from '../domain/errors.ts';
import {
  assertNicknameAvailable,
  assertNotFull,
  createMembership,
  createRoomRecord,
  nextSequence,
  normalizeNickname,
  occupiedSlots,
  type MemberRecord,
  type Profile,
  type RoomRecord,
} from '../domain/room.ts';
import { wireMember, wireMessage, wireRoom } from '../transport/wire.ts';
import { RoomBus, type Subscriber } from './bus.ts';
import { AiService } from './ai.ts';
import type { Capability } from './capability.ts';
import { MemoryRoomStateStore, type BootstrapRecord, type RoomStateStore } from '../infrastructure/state/store.ts';

export interface Identity {
  readonly room: RoomRecord;
  readonly member: MemberRecord;
}

/** 房间、成员、消息与连接的应用服务。AI 调度委托给 AiService。 */
export class RoomService {
  /** 进程内的活跃运行时对象，不属于可持久化状态。 */
  private readonly buses = new Map<string, RoomBus>();
  private readonly ai = new Map<string, AiService>();

  constructor(
    config: Config,
    capability: Capability,
    store: RoomStateStore = new MemoryRoomStateStore(),
  ) {
    this.config = config;
    this.capability = capability;
    this.store = store;
  }

  private readonly config: Config;
  private readonly capability: Capability;
  /** 状态读写统一经过该接口，便于后续替换为持久化实现。 */
  private readonly store: RoomStateStore;

  // ---------------------------------------------------------------- 查询辅助

  bus(roomId: string): RoomBus {
    const bus = this.buses.get(roomId);
    if (!bus) throw new AppError('ROOM_UNAVAILABLE', '房间不存在或已关闭');
    return bus;
  }

  aiService(roomId: string): AiService {
    const service = this.ai.get(roomId);
    if (!service) throw new AppError('ROOM_UNAVAILABLE', '房间不存在或已关闭');
    return service;
  }

  private requireRoom(roomId: string): RoomRecord {
    const room = this.store.getRoom(roomId);
    if (!room || room.closed) throw new AppError('ROOM_UNAVAILABLE', '房间不存在或已关闭');
    return room;
  }

  /** 校验 Bearer 凭证，返回房间与成员；不检查当前入房。 */
  authenticate(roomId: string, credential: string | null): Identity {
    const room = this.requireRoom(roomId);
    if (!credential) throw new AppError('MEMBER_CREDENTIAL_INVALID', '缺少成员凭证');
    const found = this.store.getCredential(credential);
    if (!found || found.roomId !== roomId) {
      throw new AppError('MEMBER_CREDENTIAL_INVALID', '成员凭证无效');
    }
    const member = room.members.get(found.memberId);
    if (!member) throw new AppError('MEMBER_CREDENTIAL_INVALID', '成员凭证无效');
    if (member.removed) throw new AppError('MEMBER_REMOVED', '该成员已被移出房间');
    return { room, member };
  }

  /** 在 authenticate 之上追加当前入房校验，用于需要活跃 membership 的操作。 */
  requireMembership(roomId: string, credential: string | null, membershipId: string | null): Identity {
    const identity = this.authenticate(roomId, credential);
    const membership = identity.member.membership;
    if (membership === null) throw new AppError('MEMBERSHIP_INACTIVE', '当前入房已结束');
    if (!membershipId) throw new AppError('MEMBERSHIP_INACTIVE', '缺少入房标识');
    if (membership.id !== membershipId) {
      throw new AppError('MEMBERSHIP_CHANGED', '入房标识已变化，请刷新后重试');
    }
    return identity;
  }

  requireHost(identity: Identity): void {
    if (identity.member.role !== 'host') {
      throw new AppError('HOST_REQUIRED', '该操作仅房主可用');
    }
  }

  // ---------------------------------------------------------------- 资料校验

  private validateProfile(input: { nickname?: string; interestTags?: string[]; bio?: string }, prefix = '/profile'): void {
    const policy = this.config.validation;
    const fieldErrors: { path: string; message: string }[] = [];

    if (input.nickname !== undefined) {
      const nickname = normalizeNickname(input.nickname);
      if (nickname.length < policy.nickname.minLength) {
        fieldErrors.push({ path: `${prefix}/nickname`, message: '昵称不能为空' });
      } else if (policy.nickname.maxLength !== null && nickname.length > policy.nickname.maxLength) {
        fieldErrors.push({ path: `${prefix}/nickname`, message: `昵称不能超过 ${policy.nickname.maxLength} 个字` });
      }
    }

    if (input.interestTags !== undefined) {
      const tags = input.interestTags;
      if (tags.length < policy.interestTags.minItems) {
        fieldErrors.push({ path: `${prefix}/interestTags`, message: '请至少填写一个兴趣标签' });
      } else if (policy.interestTags.maxItems !== null && tags.length > policy.interestTags.maxItems) {
        fieldErrors.push({ path: `${prefix}/interestTags`, message: `兴趣标签最多 ${policy.interestTags.maxItems} 个` });
      }
      tags.forEach((tag, index) => {
        if (tag.trim().length < policy.interestTag.minLength) {
          fieldErrors.push({ path: `${prefix}/interestTags/${index}`, message: '兴趣标签不能为空' });
        } else if (policy.interestTag.maxLength !== null && tag.length > policy.interestTag.maxLength) {
          fieldErrors.push({ path: `${prefix}/interestTags/${index}`, message: `单个标签不能超过 ${policy.interestTag.maxLength} 个字` });
        }
      });
      // 归一化后可能出现重复（如 "travel" 与 " travel "），而公共模型要求
      // uniqueItems，必须在此拦下，否则返回的资料会违反契约。
      const normalized = tags.map(tag => tag.trim());
      if (new Set(normalized).size !== normalized.length) {
        fieldErrors.push({ path: `${prefix}/interestTags`, message: '兴趣标签不能重复' });
      }
    }

    if (input.bio !== undefined && policy.bio.maxLength !== null && input.bio.length > policy.bio.maxLength) {
      fieldErrors.push({ path: `${prefix}/bio`, message: `简介不能超过 ${policy.bio.maxLength} 个字` });
    }

    if (fieldErrors.length > 0) {
      throw new AppError('VALIDATION_ERROR', '资料不符合要求', { fieldErrors });
    }
  }

  private toProfile(input: { nickname: string; interestTags: string[]; bio?: string }): Profile {
    return {
      nickname: normalizeNickname(input.nickname),
      interestTags: input.interestTags.map(tag => tag.trim()),
      bio: input.bio ?? '',
    };
  }

  // ---------------------------------------------------------------- 引导幂等

  /**
   * 引导凭证只用于恢复首次提交。相同凭证 + 相同请求内容返回原资源；
   * 相同凭证绑定不同内容或意图时冲突。
   */
  private checkBootstrap(token: string, fingerprint: string): BootstrapRecord | null {
    const existing = this.store.getBootstrap(token);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) {
      throw new AppError('BOOTSTRAP_CONFLICT', '引导凭证已绑定其他请求');
    }
    return existing;
  }

  // ---------------------------------------------------------------- 建房

  createRoom(body: { clientRequestId: string; bootstrapToken: string; profile: { nickname: string; interestTags: string[]; bio?: string } }): {
    status: number;
    data: unknown;
  } {
    const fingerprint = JSON.stringify(['createRoom', body.clientRequestId, body.profile]);
    const replay = this.checkBootstrap(body.bootstrapToken, fingerprint);
    if (replay) {
      const room = this.requireRoom(replay.roomId);
      const member = room.members.get(replay.memberId)!;
      return { status: 201, data: { room: wireRoom(room), member: wireMember(member), memberCredential: member.credential } };
    }

    this.validateProfile(body.profile);
    const inviteCode = newSecret();
    const room = createRoomRecord(this.config, inviteCode);
    const member: MemberRecord = {
      id: newId('member'),
      role: 'host',
      profile: this.toProfile(body.profile),
      membership: null,
      credential: newSecret(),
      removed: false,
    };
    room.hostMemberId = member.id;
    member.membership = createMembership(room);
    room.members.set(member.id, member);

    this.store.putRoom(room);
    const bus = new RoomBus(room);
    this.buses.set(room.id, bus);
    const aiService = new AiService(this.config, room, bus, this.capability);
    this.ai.set(room.id, aiService);
    aiService.startIdleScheduler();
    this.store.putCredential(member.credential, { roomId: room.id, memberId: member.id });
    this.store.putInvite(inviteCode, room.id);
    this.store.putBootstrap(body.bootstrapToken, { fingerprint, roomId: room.id, memberId: member.id });

    return { status: 201, data: { room: wireRoom(room), member: wireMember(member), memberCredential: member.credential } };
  }

  // ---------------------------------------------------------------- 入房

  joinRoom(
    roomId: string,
    credential: string | null,
    body: { clientRequestId: string; bootstrapToken?: string; inviteCode: string; profile: { nickname: string; interestTags: string[]; bio?: string } },
  ): { status: number; data: unknown } {
    const room = this.requireRoom(roomId);
    if (this.store.getInviteRoomId(body.inviteCode) !== roomId) {
      throw new AppError('INVITATION_INVALID', '邀请链接无效');
    }

    // 已持有成员凭证：复用当前入房或以原身份重新加入。
    if (credential) {
      const identity = this.authenticate(roomId, credential);
      const member = identity.member;
      if (member.membership !== null) {
        return { status: 200, data: { room: wireRoom(room), member: wireMember(member), memberCredential: member.credential } };
      }
      this.validateProfile(body.profile);
      assertNotFull(room);
      assertNicknameAvailable(room, body.profile.nickname, member.id);
      member.profile = this.toProfile(body.profile);
      member.membership = createMembership(room);
      this.announceJoin(room, member);
      return { status: 201, data: { room: wireRoom(room), member: wireMember(member), memberCredential: member.credential } };
    }

    // 匿名首次加入必须携带引导凭证。
    if (!body.bootstrapToken) {
      throw new AppError('VALIDATION_ERROR', '匿名加入需要引导凭证', {
        fieldErrors: [{ path: '/bootstrapToken', message: '缺少引导凭证' }],
      });
    }
    const fingerprint = JSON.stringify(['joinRoom', roomId, body.clientRequestId, body.profile]);
    const replay = this.checkBootstrap(body.bootstrapToken, fingerprint);
    if (replay) {
      const member = room.members.get(replay.memberId)!;
      return { status: 201, data: { room: wireRoom(room), member: wireMember(member), memberCredential: member.credential } };
    }

    this.validateProfile(body.profile);
    assertNotFull(room);
    assertNicknameAvailable(room, body.profile.nickname);

    const member: MemberRecord = {
      id: newId('member'),
      role: 'member',
      profile: this.toProfile(body.profile),
      membership: null,
      credential: newSecret(),
      removed: false,
    };
    member.membership = createMembership(room);
    room.members.set(member.id, member);
    this.store.putCredential(member.credential, { roomId: room.id, memberId: member.id });
    this.store.putBootstrap(body.bootstrapToken, { fingerprint, roomId: room.id, memberId: member.id });
    this.announceJoin(room, member);

    return { status: 201, data: { room: wireRoom(room), member: wireMember(member), memberCredential: member.credential } };
  }

  private announceJoin(room: RoomRecord, member: MemberRecord): void {
    this.bus(room.id).publish('member.joined', { member: wireMember(member) });
  }

  // ---------------------------------------------------------------- 自身资料

  /** getSelf 只要求身份凭证；已退出身份返回 membership: null。 */
  getSelf(roomId: string, credential: string | null): unknown {
    const identity = this.authenticate(roomId, credential);
    return { member: wireMember(identity.member) };
  }

  updateSelf(
    roomId: string,
    credential: string | null,
    membershipId: string | null,
    patch: { nickname?: string; interestTags?: string[]; bio?: string },
  ): unknown {
    const identity = this.requireMembership(roomId, credential, membershipId);
    this.validateProfile(patch, '');
    if (patch.nickname !== undefined) {
      assertNicknameAvailable(identity.room, patch.nickname, identity.member.id);
    }
    const member = identity.member;
    // PATCH 缺省字段保持原值；`bio: ""` 清空，不接收 null。
    if (patch.nickname !== undefined) member.profile.nickname = normalizeNickname(patch.nickname);
    if (patch.interestTags !== undefined) member.profile.interestTags = patch.interestTags.map(tag => tag.trim());
    if (patch.bio !== undefined) member.profile.bio = patch.bio;

    this.bus(roomId).publish('member.updated', { member: wireMember(member) });
    return { member: wireMember(member) };
  }

  // ---------------------------------------------------------------- 终止路径

  leaveRoom(roomId: string, credential: string | null, membershipId: string | null): unknown {
    const identity = this.requireMembership(roomId, credential, membershipId);
    const { room, member } = identity;
    const leavingMembershipId = member.membership!.id;

    if (member.role === 'host') {
      this.closeRoomInternal(room, 'host_left');
      return { memberId: member.id, membershipId: leavingMembershipId, roomClosed: true };
    }
    this.endMembership(room, member, 'member.left', 1000, 'left');
    return { memberId: member.id, membershipId: leavingMembershipId, roomClosed: false };
  }

  removeMember(roomId: string, credential: string | null, membershipId: string | null, targetId: string): unknown {
    const identity = this.requireMembership(roomId, credential, membershipId);
    this.requireHost(identity);
    const { room } = identity;
    if (targetId === room.hostMemberId) {
      throw new AppError('HOST_PROTECTED', '不能移出房主');
    }
    const target = room.members.get(targetId);
    if (!target || target.membership === null) {
      throw new AppError('MEMBER_NOT_FOUND', '成员不存在或已离开');
    }
    const removedMembershipId = target.membership.id;
    target.removed = true;
    this.endMembership(room, target, 'member.removed', 1008, 'left');
    return { memberId: targetId, membershipId: removedMembershipId, removed: true };
  }

  closeRoom(roomId: string, credential: string | null, membershipId: string | null): unknown {
    const identity = this.requireMembership(roomId, credential, membershipId);
    this.requireHost(identity);
    const roomRef = identity.room;
    this.closeRoomInternal(roomRef, 'host_closed');
    return { roomId, reason: 'host_closed', closedAt: isoTime() };
  }

  private endMembership(
    room: RoomRecord,
    member: MemberRecord,
    event: 'member.left' | 'member.removed',
    code: number,
    reason: 'left' | 'timeout',
  ): void {
    const membership = member.membership;
    if (membership === null) return;
    const timer = room.recoveryTimers.get(membership.id);
    if (timer) {
      clearTimeout(timer);
      room.recoveryTimers.delete(membership.id);
    }
    member.membership = null;
    const bus = this.bus(room.id);
    if (event === 'member.left') {
      bus.publish('member.left', { memberId: member.id, membershipId: membership.id, reason });
      bus.closeMembership(membership.id, code, reason);
    } else {
      bus.publish('member.removed', { memberId: member.id, membershipId: membership.id });
      bus.closeMembership(membership.id, code, 'removed');
    }
  }

  /**
   * 关房顺序：终结在途与排队调用 → 置关闭标志 → 发布 room.closed
   * → 停止业务事件并清理数据。
   */
  private closeRoomInternal(room: RoomRecord, reason: 'host_left' | 'host_closed' | 'host_timeout'): void {
    if (room.closed) return;

    const aiService = this.aiService(room.id);
    aiService.stopIdleScheduler();
    aiService.terminateAll('AI_CANCELLED', '房间已关闭');
    room.closed = true;

    const bus = this.bus(room.id);
    bus.publish('room.closed', { roomId: room.id, closedAt: isoTime(), reason });
    bus.closeAll(1000, 'room_closed');

    for (const member of room.members.values()) {
      this.store.deleteCredential(member.credential);
      member.membership = null;
      // 关房后清理本产品保存的聊天与公开资料。
      member.profile = { nickname: member.profile.nickname, interestTags: [], bio: '' };
    }
    for (const timer of room.recoveryTimers.values()) clearTimeout(timer);
    room.recoveryTimers.clear();
    room.messages.length = 0;
    room.replies.clear();
    room.invocations.clear();
    this.store.deleteInvite(room.inviteCode);
    // 引导记录的 fingerprint 含资料原文，关房必须一并清理。
    this.store.deleteBootstrapsByRoom(room.id);
    this.store.deleteRoom(room.id);
    this.buses.delete(room.id);
    this.ai.delete(room.id);
  }

  // ---------------------------------------------------------------- 聊天

  sendMessage(
    roomId: string,
    credential: string | null,
    membershipId: string | null,
    body: { clientRequestId: string; text: string; mentions?: string[] },
  ): { status: number; data: unknown } {
    const identity = this.requireMembership(roomId, credential, membershipId);
    const { room, member } = identity;

    // 同身份同内容幂等：返回原接收结果，不重复发布也不再次入队。
    const previous = room.messages.find(
      message => message.clientRequestId === body.clientRequestId && message.authorId === member.id,
    );
    if (previous) {
      // 原请求属于旧入房时不重放旧消息正文，提示上下文已失效。
      if (previous.membershipId !== member.membership!.id) {
        throw new AppError('IDEMPOTENCY_CONTEXT_EXPIRED', '原请求属于已结束的入房，请使用新的请求标识');
      }
      if (previous.text !== body.text) {
        throw new AppError('IDEMPOTENCY_CONFLICT', '相同请求标识携带了不同内容');
      }
      // 提及与否决定是否创建 AI 调用，属于提交语义的一部分，必须纳入比较。
      const mentionsAi = (body.mentions ?? []).includes('ai');
      if (previous.mentionsAi !== mentionsAi) {
        throw new AppError('IDEMPOTENCY_CONFLICT', '相同请求标识携带了不同的 AI 提及');
      }
      // 契约要求返回原接收结果，因此回放首次保存的回执，不按当前调用状态重建。
      return {
        status: 201,
        data: {
          message: wireMessage(room, previous),
          ai: previous.receipt,
        },
      };
    }

    const text = body.text;
    const policy = this.config.validation.message;
    if (text.trim().length < policy.minLength) {
      throw new AppError('VALIDATION_ERROR', '消息内容不能为空', {
        fieldErrors: [{ path: '/text', message: '消息内容不能为空' }],
      });
    }
    if (policy.maxLength !== null && text.length > policy.maxLength) {
      throw new AppError('VALIDATION_ERROR', '消息过长', {
        fieldErrors: [{ path: '/text', message: `消息不能超过 ${policy.maxLength} 个字` }],
      });
    }

    // 普通聊天本身触发限频时整次提交失败。
    const retryAfterMs = this.checkRate(member.id);
    if (retryAfterMs !== null) {
      throw new AppError('MESSAGE_RATE_LIMITED', '发送过于频繁，请稍后再试', { retryAfterMs });
    }

    // 契约的 mentions 是字符串数组（const "ai"），不是对象数组。
    const mentionsAi = (body.mentions ?? []).includes('ai');
    const message = {
      kind: 'member' as const,
      id: newId('msg'),
      authorId: member.id,
      membershipId: member.membership!.id,
      text,
      clientRequestId: body.clientRequestId,
      mentionsAi,
      receipt: { status: 'not_requested' } as unknown,
      createdAt: isoTime(),
      createdSequence: nextSequence(room),
    };
    room.messages.push(message);
    // 成员发言重置冷场计时；AI 自身发言不重置。
    this.aiService(roomId).noteMemberActivity();
    this.bus(roomId).publishAt(
      message.createdSequence,
      'message.created',
      { message: wireMessage(room, message) },
      message.createdSequence,
    );

    const ai = this.aiService(roomId).handleMention({
      mentionsAi,
      member,
      message,
      clientRequestId: body.clientRequestId,
    });
    // 保存首次回执原文，供后续幂等重试原样回放。
    message.receipt = ai;

    return { status: 201, data: { message: wireMessage(room, message), ai } };
  }

  private checkRate(memberId: string): number | null {
    const now = Date.now();
    const { windowMs, max } = this.config.messageRate;
    const window = this.store.getRateWindow(memberId).filter(at => now - at < windowMs);
    if (window.length >= max) {
      const oldest = window[0] ?? now;
      this.store.putRateWindow(memberId, window);
      return Math.max(0, windowMs - (now - oldest));
    }
    window.push(now);
    this.store.putRateWindow(memberId, window);
    return null;
  }

  // ---------------------------------------------------------------- 连接票据

  createTicket(roomId: string, credential: string | null, membershipId: string | null, wsOrigin?: string): unknown {
    const identity = this.requireMembership(roomId, credential, membershipId);
    const membership = identity.member.membership!;
    const ticket = newSecret();
    const expiresAt = Date.now() + this.config.ticketMs;
    this.store.putTicket(ticket, {
      roomId,
      memberId: identity.member.id,
      membershipId: membership.id,
      expiresAt,
      used: false,
    });
    const origin = wsOrigin ?? this.config.publicWsOrigin;
    return {
      roomId,
      memberId: identity.member.id,
      membershipId: membership.id,
      ticket,
      expiresAt: isoTime(expiresAt),
      webSocketUrl: `${origin}/api/v1/rooms/${roomId}/events?ticket=${ticket}`,
    };
  }

  /** 握手时消费票据并二次校验成员与入房资格。 */
  consumeTicket(roomId: string, ticket: string | null): Identity {
    if (!ticket) throw new AppError('CONNECTION_TICKET_INVALID', '缺少连接票据');
    const record = this.store.getTicket(ticket);
    if (!record || record.roomId !== roomId) {
      throw new AppError('CONNECTION_TICKET_INVALID', '连接票据无效');
    }
    if (record.used) throw new AppError('CONNECTION_TICKET_USED', '连接票据已被使用');
    if (record.expiresAt < Date.now()) {
      this.store.deleteTicket(ticket);
      throw new AppError('CONNECTION_TICKET_EXPIRED', '连接票据已过期');
    }
    record.used = true;
    this.store.deleteTicket(ticket);

    const room = this.requireRoom(roomId);
    const member = room.members.get(record.memberId);
    if (!member) throw new AppError('CONNECTION_TICKET_INVALID', '连接票据无效');
    if (member.removed) throw new AppError('MEMBER_REMOVED', '该成员已被移出房间');
    if (member.membership === null) throw new AppError('MEMBERSHIP_INACTIVE', '当前入房已结束');
    if (member.membership.id !== record.membershipId) {
      throw new AppError('MEMBERSHIP_CHANGED', '入房标识已变化，请重新取票');
    }
    return { room, member };
  }

  /** 供协议层读取对外声明的校验约束。 */
  clientConfig(): unknown {
    return {
      contractVersion: '0.1.0',
      validation: {
        nickname: { ...this.config.validation.nickname },
        interestTag: { ...this.config.validation.interestTag },
        bio: { ...this.config.validation.bio },
        message: { ...this.config.validation.message },
        interestTags: { ...this.config.validation.interestTags },
      },
    };
  }

  // ---------------------------------------------------------------- 在线状态

  /**
   * 连接建立。
   *
   * 顺序必须是：先更新状态 → 再注册订阅并立即发送快照 → 最后广播状态变更事件。
   *
   * 若先注册再改状态，markOnline 的广播会抢在快照之前到达，违反「首个业务消息是
   * 快照」的契约；而且快照会带着尚未更新的 presence，被后续事件覆盖出错序。
   */
  attach(identity: Identity, subscriber: Subscriber): unknown {
    const bus = this.bus(identity.room.id);
    const isFirst = bus.connectionCount(subscriber.membershipId) === 0;

    // 第一步：状态先就位，这样快照里的 presence 已是 online。
    const pending = isFirst ? this.applyOnline(identity) : [];

    // 第二步：注册订阅并同步取回快照，由调用方立即发送。
    const { snapshot } = bus.attach(subscriber);
    subscriber.send(snapshot);

    // 第三步：快照已送达，再广播状态变更，本连接收到的顺序才正确。
    for (const event of pending) {
      bus.publish(event.type, event.data);
    }
    return snapshot;
  }

  /** 连接断开：该 membership 全部连接断开后才进入掉线恢复期。 */
  detach(identity: Identity, subscriber: Subscriber): void {
    const bus = this.buses.get(identity.room.id);
    if (!bus) return;
    // 旧入房的迟到关闭回调不得影响当前入房：先核对归属。
    const current = identity.member.membership;
    const stale = current === null || current.id !== subscriber.membershipId;
    const last = bus.detach(subscriber);
    if (last && !stale) this.markOffline(identity);
  }

  /**
   * 更新为在线并返回待广播的事件，由 attach 在发送快照之后再发布。
   */
  private applyOnline(identity: Identity): { type: string; data: Record<string, unknown> }[] {
    const { room, member } = identity;
    const membership = member.membership;
    if (membership === null) return [];
    const timer = room.recoveryTimers.get(membership.id);
    if (timer) {
      clearTimeout(timer);
      room.recoveryTimers.delete(membership.id);
    }
    membership.presence = 'online';
    membership.recoveryExpiresAt = null;

    const events: { type: string; data: Record<string, unknown> }[] = [
      {
        type: 'member.presence.changed',
        data: {
          memberId: member.id,
          membershipId: membership.id,
          presence: 'online',
          recoveryExpiresAt: null,
        },
      },
    ];

    if (member.role === 'host' && room.status === 'host_reconnecting') {
      room.status = 'open';
      room.hostRecoveryExpiresAt = null;
      this.aiService(room.id).setAutoPaused(false);
      events.push({
        type: 'room.updated',
        data: { status: room.status, hostRecoveryExpiresAt: room.hostRecoveryExpiresAt },
      });
    }
    return events;
  }

  private markOffline(identity: Identity): void {
    const { room, member } = identity;
    const membership = member.membership;
    if (membership === null || room.closed) return;
    const isHost = member.role === 'host';
    const recoveryMs = isHost ? this.config.hostRecoveryMs : this.config.recoveryMs;
    const expiresAt = Date.now() + recoveryMs;

    membership.presence = 'offline';
    membership.recoveryExpiresAt = isoTime(expiresAt);
    const bus = this.bus(room.id);
    bus.publish('member.presence.changed', {
      memberId: member.id,
      membershipId: membership.id,
      presence: 'offline',
      recoveryExpiresAt: membership.recoveryExpiresAt,
    });

    if (isHost) {
      room.status = 'host_reconnecting';
      room.hostRecoveryExpiresAt = isoTime(expiresAt);
      // 房主掉线期间暂停新的自动话题与邀答，已受理调用继续。
      this.aiService(room.id).setAutoPaused(true);
      bus.publish('room.updated', { status: room.status, hostRecoveryExpiresAt: room.hostRecoveryExpiresAt });
    }

    const timer = setTimeout(() => {
      room.recoveryTimers.delete(membership.id);
      if (room.closed) return;
      if (isHost) {
        this.closeRoomInternal(room, 'host_timeout');
      } else {
        this.endMembership(room, member, 'member.left', 1000, 'timeout');
      }
    }, recoveryMs);
    timer.unref?.();
    room.recoveryTimers.set(membership.id, timer);
  }
}
