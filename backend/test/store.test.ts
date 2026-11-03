import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from '../src/app.ts';
import { defaultConfig } from '../src/config.ts';
import { createStubCapability } from '../src/application/capability.ts';
import { MemoryRoomStateStore, type RoomStateStore } from '../src/infrastructure/state/store.ts';
import { secret, uuid } from './helpers.ts';

/**
 * 验证状态存储确实位于接口之后：换一个带调用计数的装饰实现，
 * 业务行为不变。这是"后续换持久化只改一个实现"的可执行证据。
 */
const counting = (inner: RoomStateStore) => {
  const calls: Record<string, number> = {};
  const bump = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  const store: RoomStateStore = {
    getRoom: id => (bump('getRoom'), inner.getRoom(id)),
    putRoom: room => (bump('putRoom'), inner.putRoom(room)),
    deleteRoom: id => (bump('deleteRoom'), inner.deleteRoom(id)),
    getCredential: c => (bump('getCredential'), inner.getCredential(c)),
    putCredential: (c, r) => (bump('putCredential'), inner.putCredential(c, r)),
    deleteCredential: c => (bump('deleteCredential'), inner.deleteCredential(c)),
    getInviteRoomId: c => (bump('getInviteRoomId'), inner.getInviteRoomId(c)),
    putInvite: (c, r) => (bump('putInvite'), inner.putInvite(c, r)),
    deleteInvite: c => (bump('deleteInvite'), inner.deleteInvite(c)),
    getBootstrap: t => (bump('getBootstrap'), inner.getBootstrap(t)),
    putBootstrap: (t, r) => (bump('putBootstrap'), inner.putBootstrap(t, r)),
    getTicket: t => (bump('getTicket'), inner.getTicket(t)),
    putTicket: (t, r) => (bump('putTicket'), inner.putTicket(t, r)),
    deleteTicket: t => (bump('deleteTicket'), inner.deleteTicket(t)),
    getRateWindow: m => (bump('getRateWindow'), inner.getRateWindow(m)),
    putRateWindow: (m, v) => (bump('putRateWindow'), inner.putRateWindow(m, v)),
  };
  return { store, calls };
};

test('替换状态存储实现后业务行为不变', async t => {
  const { store, calls } = counting(new MemoryRoomStateStore());
  const app = await build({
    config: { ...defaultConfig, port: 0 },
    capability: createStubCapability({ delayMs: 5 }),
    store,
  });
  await app.ready();
  t.after(() => app.close());

  const call = async (options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    body?: unknown;
    credential?: string;
    membershipId?: string;
  }) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.credential) headers['authorization'] = `Bearer ${options.credential}`;
    if (options.membershipId) headers['x-membership-id'] = options.membershipId;
    const response = await app.inject({
      method: options.method,
      url: options.url,
      headers,
      ...(options.body === undefined ? {} : { payload: JSON.stringify(options.body) }),
    });
    return { status: response.statusCode, ...(response.json() as Record<string, unknown>) } as any;
  };

  // 建房 → 入房 → 发消息 → 取票 → 关房，全链路走自定义存储。
  const created = await call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { clientRequestId: uuid(), bootstrapToken: secret(), profile: { nickname: '小林', interestTags: ['阅读'], bio: '' } },
  });
  assert.equal(created.status, 201);
  const roomId = created.data.room.id as string;
  const credential = created.data.memberCredential as string;
  const membershipId = created.data.member.membership.id as string;
  const inviteCode = created.data.room.invitation.inviteCode as string;

  const joined = await call({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/members`,
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  assert.equal(joined.status, 201);

  const sent = await call({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/messages`,
    credential,
    membershipId,
    body: { clientRequestId: uuid(), text: '换了存储也能聊' },
  });
  assert.equal(sent.status, 201);

  const ticket = await call({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/connection-tickets`,
    credential,
    membershipId,
  });
  assert.equal(ticket.status, 201);

  const closed = await call({ method: 'DELETE', url: `/api/v1/rooms/${roomId}`, credential, membershipId });
  assert.equal(closed.status, 200);

  const after = await call({ method: 'GET', url: `/api/v1/rooms/${roomId}/members/me`, credential });
  assert.equal(after.status, 404);

  // 证明读写确实流经注入的实现，而不是绕过接口。
  for (const name of ['putRoom', 'getRoom', 'putCredential', 'putInvite', 'putTicket', 'deleteRoom']) {
    assert.ok((calls[name] ?? 0) > 0, `${name} 未经由注入的存储实现`);
  }
});
