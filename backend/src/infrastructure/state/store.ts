import type { RoomRecord } from '../../domain/room.ts';

/**
 * 房间状态存储接口。
 *
 * 架构文档要求"只有确有变化或外部依赖的地方才提取接口"。状态存储正是如此：
 * 本轮用进程内实现，后续换持久化只替换实现，应用层不动。
 *
 * 架构文档已声明本轮暂不考虑服务重启恢复，因此不在接口上承诺任何恢复语义；
 * 这也不等于已决定重启后结束房间。
 */

export interface BootstrapRecord {
  readonly fingerprint: string;
  readonly roomId: string;
  readonly memberId: string;
}

export interface TicketRecord {
  readonly roomId: string;
  readonly memberId: string;
  readonly membershipId: string;
  readonly expiresAt: number;
  used: boolean;
}

export interface CredentialRef {
  readonly roomId: string;
  readonly memberId: string;
}

export interface RoomStateStore {
  // 房间
  getRoom(roomId: string): RoomRecord | undefined;
  putRoom(room: RoomRecord): void;
  deleteRoom(roomId: string): void;

  // 成员凭证反查
  getCredential(credential: string): CredentialRef | undefined;
  putCredential(credential: string, ref: CredentialRef): void;
  deleteCredential(credential: string): void;

  // 邀请码 → 房间
  getInviteRoomId(inviteCode: string): string | undefined;
  putInvite(inviteCode: string, roomId: string): void;
  deleteInvite(inviteCode: string): void;

  // 引导凭证（首次提交幂等）
  getBootstrap(token: string): BootstrapRecord | undefined;
  putBootstrap(token: string, record: BootstrapRecord): void;

  // 一次性连接票据
  getTicket(ticket: string): TicketRecord | undefined;
  putTicket(ticket: string, record: TicketRecord): void;
  deleteTicket(ticket: string): void;

  // 消息限频窗口
  getRateWindow(memberId: string): number[];
  putRateWindow(memberId: string, timestamps: number[]): void;
}

/** 进程内实现。本轮够用，不承诺重启后保留任何状态。 */
export class MemoryRoomStateStore implements RoomStateStore {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly credentials = new Map<string, CredentialRef>();
  private readonly invites = new Map<string, string>();
  private readonly bootstraps = new Map<string, BootstrapRecord>();
  private readonly tickets = new Map<string, TicketRecord>();
  private readonly rateWindows = new Map<string, number[]>();

  getRoom(roomId: string): RoomRecord | undefined {
    return this.rooms.get(roomId);
  }

  putRoom(room: RoomRecord): void {
    this.rooms.set(room.id, room);
  }

  deleteRoom(roomId: string): void {
    this.rooms.delete(roomId);
  }

  getCredential(credential: string): CredentialRef | undefined {
    return this.credentials.get(credential);
  }

  putCredential(credential: string, ref: CredentialRef): void {
    this.credentials.set(credential, ref);
  }

  deleteCredential(credential: string): void {
    this.credentials.delete(credential);
  }

  getInviteRoomId(inviteCode: string): string | undefined {
    return this.invites.get(inviteCode);
  }

  putInvite(inviteCode: string, roomId: string): void {
    this.invites.set(inviteCode, roomId);
  }

  deleteInvite(inviteCode: string): void {
    this.invites.delete(inviteCode);
  }

  getBootstrap(token: string): BootstrapRecord | undefined {
    return this.bootstraps.get(token);
  }

  putBootstrap(token: string, record: BootstrapRecord): void {
    this.bootstraps.set(token, record);
  }

  getTicket(ticket: string): TicketRecord | undefined {
    return this.tickets.get(ticket);
  }

  putTicket(ticket: string, record: TicketRecord): void {
    this.tickets.set(ticket, record);
  }

  deleteTicket(ticket: string): void {
    this.tickets.delete(ticket);
  }

  getRateWindow(memberId: string): number[] {
    return this.rateWindows.get(memberId) ?? [];
  }

  putRateWindow(memberId: string, timestamps: number[]): void {
    this.rateWindows.set(memberId, timestamps);
  }
}
