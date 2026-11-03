import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import { build } from '../src/app.ts';
import { createStubCapability } from '../src/application/capability.ts';
import { testConfig, uuid, secret } from './helpers.ts';
import type { Config } from '../src/config.ts';

/** P1-3 / P2-4：快照顺序与断开回调归属，需真实 WebSocket 连接验证。 */
const live = async (config: Config = testConfig(), delayMs = 10) => {
  const app = await build({ config, capability: createStubCapability({ delayMs }) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  const origin = `http://127.0.0.1:${port}`;

  const call = async (options: {
    method: string;
    path: string;
    body?: unknown;
    credential?: string;
    membershipId?: string;
  }) => {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.credential) headers['authorization'] = `Bearer ${options.credential}`;
    if (options.membershipId) headers['x-membership-id'] = options.membershipId;
    const response = await fetch(origin + options.path, {
      method: options.method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return { status: response.status, ...((await response.json()) as Record<string, unknown>) } as any;
  };

  const connect = async (roomId: string, credential: string, membershipId: string) => {
    const ticket = await call({
      method: 'POST',
      path: `/api/v1/rooms/${roomId}/connection-tickets`,
      credential,
      membershipId,
    });
    assert.equal(ticket.status, 201, JSON.stringify(ticket));
    const socket = new WebSocket(ticket.data.webSocketUrl);
    const frames: any[] = [];
    socket.on('message', raw => frames.push(JSON.parse(String(raw))));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return { socket, frames, close: () => socket.close() };
  };

  const host = async (nickname = '小林') => {
    const created = await call({
      method: 'POST',
      path: '/api/v1/rooms',
      body: { clientRequestId: uuid(), bootstrapToken: secret(), profile: { nickname, interestTags: ['阅读'], bio: '' } },
    });
    return {
      roomId: created.data.room.id as string,
      inviteCode: created.data.room.invitation.inviteCode as string,
      memberId: created.data.member.id as string,
      membershipId: created.data.member.membership.id as string,
      credential: created.data.memberCredential as string,
    };
  };

  const guest = async (roomId: string, inviteCode: string, nickname: string) => {
    const joined = await call({
      method: 'POST',
      path: `/api/v1/rooms/${roomId}/members`,
      body: {
        clientRequestId: uuid(),
        bootstrapToken: secret(),
        inviteCode,
        profile: { nickname, interestTags: ['旅行'], bio: '' },
      },
    });
    return {
      memberId: joined.data.member.id as string,
      membershipId: joined.data.member.membership.id as string,
      credential: joined.data.memberCredential as string,
    };
  };

  return { app, call, connect, host, guest, close: () => app.close() };
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// =================================================== P1-3 快照必须是首帧

test('[P1-3] 首帧必须是 room.snapshot，且 presence 已是 online', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await env.host();
  const client = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(200);

  assert.ok(client.frames.length > 0, '未收到任何帧');
  assert.equal(client.frames[0].type, 'room.snapshot', `首帧是 ${client.frames[0].type}，必须是快照`);

  // 快照里本人的在线状态应已更新，而不是 connecting 被后续事件覆盖。
  const self = client.frames[0].data.members.find((m: any) => m.id === host.memberId);
  assert.equal(self.membership.presence, 'online', '快照中的 presence 应已是 online');
  client.close();
});

test('[P1-3] 房主恢复时不会先收到 room.updated 再被旧快照覆盖', async t => {
  const env = await live(testConfig({ hostRecoveryMs: 3_000 }));
  t.after(() => env.close());

  const host = await env.host();
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  await env.connect(host.roomId, guest.credential, guest.membershipId);
  const first = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(120);

  first.close();
  await sleep(200);

  // 房主重连：首帧必须是快照，且快照内房间状态已回到 open。
  const restored = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(250);

  assert.equal(restored.frames[0].type, 'room.snapshot', `首帧是 ${restored.frames[0].type}`);
  assert.equal(restored.frames[0].data.room.status, 'open', '快照中的房间状态应已恢复为 open');
  assert.equal(restored.frames[0].data.room.hostRecoveryExpiresAt, null);
  restored.close();
});

test('[P1-3] 多标签页各自的首帧都是快照', async t => {
  const env = await live();
  t.after(() => env.close());

  const host = await env.host();
  const tabOne = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(120);
  const tabTwo = await env.connect(host.roomId, host.credential, host.membershipId);
  await sleep(200);

  assert.equal(tabOne.frames[0].type, 'room.snapshot');
  assert.equal(tabTwo.frames[0].type, 'room.snapshot');
  tabOne.close();
  tabTwo.close();
});

// ============================== P2-4 旧入房与重复断开回调不影响当前入房

test('[P2-4] 旧连接的迟到关闭回调不会把新入房标为离线', async t => {
  const env = await live(testConfig({ recoveryMs: 800 }));
  t.after(() => env.close());

  const host = await env.host();
  const hostClient = await env.connect(host.roomId, host.credential, host.membershipId);
  const guest = await env.guest(host.roomId, host.inviteCode, '小周');
  const oldClient = await env.connect(host.roomId, guest.credential, guest.membershipId);
  await sleep(150);

  // 成员主动退出，旧连接随之结束。
  await env.call({
    method: 'DELETE',
    path: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.credential,
    membershipId: guest.membershipId,
  });
  await sleep(200);

  // 以原身份重新加入，形成新的一次入房并建立新连接。
  const rejoined = await env.call({
    method: 'POST',
    path: `/api/v1/rooms/${host.roomId}/members`,
    credential: guest.credential,
    body: {
      clientRequestId: uuid(),
      inviteCode: host.inviteCode,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
  });
  const newMembershipId = rejoined.data.member.membership.id as string;
  assert.notEqual(newMembershipId, guest.membershipId);
  const newClient = await env.connect(host.roomId, guest.credential, newMembershipId);

  // 再次触发旧 socket 的关闭回调。
  oldClient.close();
  await sleep(400);

  // 新入房必须仍然在线，且不得被恢复定时器踢出。
  const offlineForNew = hostClient.frames.filter(
    frame =>
      frame.type === 'member.presence.changed' &&
      frame.data.membershipId === newMembershipId &&
      frame.data.presence === 'offline',
  );
  assert.equal(offlineForNew.length, 0, '新入房被旧回调误标为 offline');

  const leftNew = hostClient.frames.filter(
    frame => frame.type === 'member.left' && frame.data.membershipId === newMembershipId,
  );
  assert.equal(leftNew.length, 0, '新入房被恢复定时器误踢出');

  const self = await env.call({
    method: 'GET',
    path: `/api/v1/rooms/${host.roomId}/members/me`,
    credential: guest.credential,
  });
  assert.equal(self.data.member.membership.id, newMembershipId);
  assert.equal(self.data.member.membership.presence, 'online');

  hostClient.close();
  newClient.close();
});
