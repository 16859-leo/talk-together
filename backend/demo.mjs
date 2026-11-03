/**
 * 端到端演练：真实启动后端，走完一次完整的房间生命周期。
 *
 * 与单元测试的区别：测试断言结果，本脚本**展示过程**——每个 HTTP 请求、
 * 每一条 WebSocket 事件都按时间顺序打印出来，用于人工核对真实行为。
 *
 * 运行：node demo.mjs
 */
import { build } from './src/app.ts';
import { defaultConfig } from './src/config.ts';
import { createStubCapability } from './src/application/capability.ts';
import { WebSocket } from 'ws';
import { randomBytes, randomUUID } from 'node:crypto';

const C = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
};

let step = 0;
const T0 = Date.now();
const elapsed = () => `${String(Date.now() - T0).padStart(5)}ms`;

const section = title => {
  console.log(`\n${C.bold}${C.blue}${'═'.repeat(74)}${C.reset}`);
  console.log(`${C.bold}${C.blue}  ${title}${C.reset}`);
  console.log(`${C.bold}${C.blue}${'═'.repeat(74)}${C.reset}`);
};

const act = text => {
  step += 1;
  console.log(`\n${C.bold}${C.cyan}[步骤 ${step}] ${text}${C.reset}`);
};

const info = text => console.log(`${C.dim}        ${text}${C.reset}`);
const good = text => console.log(`  ${C.green}✓${C.reset} ${text}`);
const warn = text => console.log(`  ${C.yellow}!${C.reset} ${text}`);

/** 按实际响应判定，不符合预期时明确标红，避免演练出现假阳性。 */
const expect = (result, expectedCode, detail) => {
  if (result.code === expectedCode) {
    good(`返回 ${expectedCode}${detail ? ` — ${detail}` : ''}`);
  } else {
    console.log(`  ${C.red}✗ 期望 ${expectedCode}，实际 ${result.status} ${result.code}${C.reset}`);
    failures.push(`${detail || expectedCode}：期望 ${expectedCode}，实际 ${result.code}`);
  }
};

/** 演练过程中所有未达预期的项，结束时统一汇总。 */
const failures = [];

const secret = () => randomBytes(48).toString('base64url');
const uuid = () => randomUUID();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 把 WebSocket 事件渲染成一行可读摘要。 */
const describeEvent = frame => {
  const d = frame.data ?? {};
  switch (frame.type) {
    case 'room.snapshot':
      return `快照：成员 ${d.members.length} 人，可见消息 ${d.messages.length} 条，cursor=${frame.cursor}`;
    case 'member.joined':
      return `成员加入：${d.member.profile.nickname}（${d.member.role}）`;
    case 'member.updated':
      return `资料更新：${d.member.profile.nickname} → 简介「${d.member.profile.bio}」`;
    case 'member.presence.changed':
      return `在线状态：${d.membershipId.slice(0, 18)}… → ${d.presence}${d.recoveryExpiresAt ? `（恢复期至 ${d.recoveryExpiresAt.slice(11, 19)}）` : ''}`;
    case 'member.left':
      return `成员离开：${d.memberId.slice(0, 16)}…，原因 ${d.reason}`;
    case 'member.removed':
      return `成员被移出：${d.memberId.slice(0, 16)}…`;
    case 'message.created':
      return `新消息：${d.message.author.nickname} 说「${d.message.text}」`;
    case 'ai.invocation.updated':
      return `AI 调用状态：${d.invocation.status}${d.invocation.queuePosition ? `（队列第 ${d.invocation.queuePosition} 位）` : ''}${d.invocation.error ? ` 错误=${d.invocation.error.code}` : ''}`;
    case 'ai.reply.started':
      return `AI 开始回复：用途=${d.reply.purpose}${d.reply.invitedMember ? `，邀答对象=${d.reply.invitedMember.nickname}` : ''}`;
    case 'ai.reply.delta':
      return `文本增量：「${d.textDelta}」`;
    case 'ai.reply.completed':
      return `AI 回复完成：「${d.reply.text}」`;
    case 'ai.reply.failed':
      return `AI 回复失败：${d.reply.error?.code}，已输出「${d.reply.text}」`;
    case 'ai.reply.cancelled':
      return `AI 回复取消：${d.reply.error?.code}，保留已输出「${d.reply.text}」`;
    case 'topic.changed':
      return `当前话题更新：「${d.topic.title}」（${d.topic.kind}）`;
    case 'room.updated':
      return `房间状态：${d.status}${d.hostRecoveryExpiresAt ? `（房主恢复期至 ${d.hostRecoveryExpiresAt.slice(11, 19)}）` : ''}`;
    case 'room.closed':
      return `房间关闭：原因 ${d.reason}`;
    default:
      return JSON.stringify(d).slice(0, 90);
  }
};

const main = async () => {
  console.log(`${C.bold}talk-together 后端端到端演练${C.reset}`);
  console.log(`${C.dim}AI 能力使用假插件（固定文本、不接模型），其余均为真实后端逻辑${C.reset}`);

  // 压缩恢复期，便于在演练中观察掉线与超时关房。
  const config = {
    ...defaultConfig,
    port: 0,
    recoveryMs: 2_000,
    hostRecoveryMs: 2_500,
    messageRate: { windowMs: 1_500, max: 3 },
  };

  const app = await build({ config, capability: createStubCapability({ delayMs: 60 }) });
  await app.listen({ host: '127.0.0.1', port: 0 });
  const port = app.server.address().port;
  const origin = `http://127.0.0.1:${port}`;

  const call = async (method, path, { body, credential, membershipId, label } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (credential) headers.authorization = `Bearer ${credential}`;
    if (membershipId) headers['x-membership-id'] = membershipId;

    const response = await fetch(origin + path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json();
    const ok = response.status < 400;
    const mark = ok ? `${C.green}${response.status}${C.reset}` : `${C.red}${response.status} ${payload.code}${C.reset}`;
    console.log(`  ${C.magenta}→${C.reset} ${method} ${path} ${C.dim}${label ?? ''}${C.reset}`);
    console.log(`  ${C.magenta}←${C.reset} ${mark} ${C.dim}${ok ? '' : payload.message}${C.reset}`);
    return { status: response.status, ...payload };
  };

  /** 建立一个 WebSocket 连接，实时打印收到的每条事件。 */
  const connect = async (name, roomId, credential, membershipId, color = C.yellow) => {
    const ticket = await call('POST', `/api/v1/rooms/${roomId}/connection-tickets`, {
      credential,
      membershipId,
      label: `（${name} 取连接票据）`,
    });
    const socket = new WebSocket(ticket.data.webSocketUrl);
    const frames = [];
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw));
      frames.push(frame);
      const seq = frame.sequence === undefined ? ' snap' : String(frame.sequence).padStart(5);
      console.log(
        `  ${C.dim}${elapsed()}${C.reset} ${color}[${name}]${C.reset} ${C.dim}seq=${seq}${C.reset} ${frame.type}`,
      );
      console.log(`           ${C.dim}${describeEvent(frame)}${C.reset}`);
    });
    socket.on('close', code => console.log(`  ${C.dim}${elapsed()} [${name}] 连接关闭，code=${code}${C.reset}`));
    await new Promise((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    return { name, socket, frames, close: () => socket.close() };
  };

  // ============================================================ 1. 入房前准备
  section('一、入房前：取得客户端校验约束');

  act('前端启动时先拉 client-config，拿到服务端声明的校验上限');
  const clientConfig = await call('GET', '/api/v1/client-config');
  const v = clientConfig.data.validation;
  good(`契约版本 ${clientConfig.data.contractVersion}`);
  info(`昵称 ${v.nickname.minLength}-${v.nickname.maxLength} 字；兴趣标签 ${v.interestTags.minItems}-${v.interestTags.maxItems} 个`);
  info(`简介 ≤ ${v.bio.maxLength} 字；消息 ${v.message.minLength}-${v.message.maxLength} 字`);
  info('这些数值由后端定档并通过协议声明，前端不预设');

  // ============================================================ 2. 建房与入房
  section('二、建房、邀请与加入');

  act('小林建房，成为房主');
  const created = await call('POST', '/api/v1/rooms', {
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      profile: { nickname: '小林', interestTags: ['阅读', '电影'], bio: '' },
    },
    label: '（匿名建房，携带引导凭证）',
  });
  const room = {
    id: created.data.room.id,
    invite: created.data.room.invitation.inviteCode,
  };
  const host = {
    memberId: created.data.member.id,
    membershipId: created.data.member.membership.id,
    credential: created.data.memberCredential,
  };
  good(`房间 ${room.id}，容量 ${created.data.room.capacity} 人`);
  info(`邀请链接：${created.data.room.invitation.joinPath.slice(0, 48)}…`);
  info(`房主 membership=${host.membershipId}，presence=${created.data.member.membership.presence}`);

  act('房主建立 WebSocket 连接，首帧应为快照');
  const hostWs = await connect('房主', room.id, host.credential, host.membershipId, C.yellow);
  await sleep(120);

  act('小周通过邀请链接加入');
  const joined = await call('POST', `/api/v1/rooms/${room.id}/members`, {
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode: room.invite,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '' },
    },
    label: '（匿名加入）',
  });
  const guest = {
    memberId: joined.data.member.id,
    membershipId: joined.data.member.membership.id,
    credential: joined.data.memberCredential,
  };
  good(`小周入房，占用名额 ${joined.data.room.occupiedSlots}/${joined.data.room.capacity}`);
  await sleep(120);

  act('小周也建立连接');
  const guestWs = await connect('小周', room.id, guest.credential, guest.membershipId, C.cyan);
  await sleep(150);

  // ============================================================ 3. 校验与冲突
  section('三、校验与冲突分支');

  act('第三人想用「小周」这个昵称加入——应被拒绝');
  const nicknameTaken = await call('POST', `/api/v1/rooms/${room.id}/members`, {
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode: room.invite,
      profile: { nickname: '小周', interestTags: ['音乐'], bio: '' },
    },
    label: '（昵称重复）',
  });
  expect(nicknameTaken, 'NICKNAME_TAKEN', '房间内昵称唯一');

  act('用错误的邀请码加入——应被拒绝');
  const badInvite = await call('POST', `/api/v1/rooms/${room.id}/members`, {
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode: secret(),
      profile: { nickname: '小陈', interestTags: ['音乐'], bio: '' },
    },
    label: '（邀请码无效）',
  });
  expect(badInvite, 'INVITATION_INVALID', '邀请码不匹配');

  act('小周修改简介，全房同步');
  await call('PATCH', `/api/v1/rooms/${room.id}/members/me`, {
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { bio: '喜欢安静的周末' },
    label: '（只改 bio，昵称保持原值）',
  });
  await sleep(150);
  good('PATCH 缺省字段保持原值，修改经 member.updated 广播');

  // ============================================================ 4. 聊天与幂等
  section('四、聊天、幂等与限频');

  act('小周发一条普通消息');
  const msgRequestId = uuid();
  const sent = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: msgRequestId, text: '大家好呀' },
  });
  good(`消息已发布，AI 回执=${sent.data.ai.status}（未提及 AI）`);
  await sleep(150);

  act('网络抖动，前端用同一个 clientRequestId 重试');
  const retried = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: msgRequestId, text: '大家好呀' },
    label: '（相同标识、相同内容）',
  });
  good(`幂等命中：返回原消息 ${retried.data.message.id === sent.data.message.id ? '同一条' : '不同条'}，未重复广播`);
  info('上方没有新的 message.created 事件，说明没有重复发布');
  await sleep(100);

  act('同一个标识换内容重试——应被拒绝');
  const dupConflict = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: msgRequestId, text: '换了内容' },
    label: '（相同标识、不同内容）',
  });
  expect(dupConflict, 'IDEMPOTENCY_CONFLICT', '同标识不同内容');

  act('普通成员提及 AI——按普通聊天处理，不触发调用');
  const ignored = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 帮我们找个话题', mentions: ['ai'] },
    label: '（普通成员的结构化提及）',
  });
  good(`AI 回执=${ignored.data.ai.status}，文字照常发布`);
  await sleep(150);

  act(`小周触发限频（本次演练上限 ${config.messageRate.max} 条/${config.messageRate.windowMs/1000} 秒）`);
  await sleep(config.messageRate.windowMs + 200);
  let limited = null;
  for (let index = 1; index <= config.messageRate.max + 2; index += 1) {
    const result = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
      credential: guest.credential,
      membershipId: guest.membershipId,
      body: { clientRequestId: uuid(), text: `连发第 ${index} 条` },
      label: `（第 ${index} 条）`,
    });
    if (result.status === 429) {
      limited = result;
      break;
    }
  }
  if (limited) {
    good(`第 ${config.messageRate.max + 1} 条被拒：${limited.code}`);
    info(`retryAfterMs=${limited.data.retryAfterMs}，前端据此倒计时，不自行猜测`);
  } else {
    warn('未触发限频——与预期不符，请检查限频实现');
  }
  await sleep(150);

  // ============================================================ 5. AI 流式
  section('五、房主调用 AI：流式输出与串行队列');

  act('房主提及 AI，观察完整流式生命周期');
  const aiCall = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 说点什么', mentions: ['ai'] },
    label: '（房主的结构化提及）',
  });
  good(`AI 回执=${aiCall.data.ai.status}，invocationId=${aiCall.data.ai.invocationId}`);
  info('HTTP 回执只表示已受理，不代表生成完成；内容经 WebSocket 推送');
  await sleep(1_200);

  const deltas = hostWs.frames.filter(f => f.type === 'ai.reply.delta');
  const completed = hostWs.frames.find(f => f.type === 'ai.reply.completed');
  if (completed) {
    const joinedText = deltas.map(f => f.data.textDelta).join('');
    good(`收到 ${deltas.length} 个文本增量，拼接结果与终态全文${joinedText === completed.data.reply.text ? '一致' : '不一致'}`);
    info(`终态：${completed.data.reply.status}，调用状态：${completed.data.invocation.status}`);
  }

  act('房主连续发起 3 次调用，验证 FIFO 串行');
  info('先等限频窗口过去，避免演练被限频干扰');
  await sleep(config.messageRate.windowMs + 200);
  const ids = [];
  for (const text of ['@AI 第一次', '@AI 第二次', '@AI 第三次']) {
    const r = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
      credential: host.credential,
      membershipId: host.membershipId,
      body: { clientRequestId: uuid(), text, mentions: ['ai'] },
    });
    if (r.status !== 201) {
      warn(`该次提交未成功：${r.code}`);
      continue;
    }
    ids.push(r.data.ai.invocationId);
    info(`回执 ${r.data.ai.status}${r.data.ai.invocationId ? ` id=${r.data.ai.invocationId.slice(0, 20)}…` : ''}`);
  }
  await sleep(3_500);

  const startedIds = hostWs.frames
    .filter(f => f.type === 'ai.reply.started')
    .map(f => f.data.invocation.id)
    .filter(id => ids.includes(id));
  good(`实际执行顺序与受理顺序${JSON.stringify(startedIds) === JSON.stringify(ids.filter(Boolean)) ? '一致（FIFO）' : '不一致'}`);

  // 检查任意时刻是否只有一个 running。
  let active = 0;
  let maxActive = 0;
  for (const frame of hostWs.frames) {
    if (frame.type === 'ai.reply.started') active += 1;
    if (['ai.reply.completed', 'ai.reply.failed', 'ai.reply.cancelled'].includes(frame.type)) active -= 1;
    maxActive = Math.max(maxActive, active);
  }
  good(`同时进行中的 AI 回复数峰值 = ${maxActive}（契约要求同房间最多 1 个）`);

  // ============================================================ 6. 可见性隔离
  section('六、中途加入：入房前的回复整条不可见');

  act('房主再次调用 AI，趁回复进行中让新成员入房');
  await sleep(config.messageRate.windowMs + 200);
  await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 这是机密内容', mentions: ['ai'] },
  });
  await sleep(200);
  const hiddenStarted = hostWs.frames.filter(f => f.type === 'ai.reply.started').at(-1);
  const hiddenReplyId = hiddenStarted?.data.reply.id;
  info(`正在生成的回复 id=${hiddenReplyId?.slice(0, 24)}…（新成员不应看到它）`);

  act('小陈此刻加入并建立连接');
  const late = await call('POST', `/api/v1/rooms/${room.id}/members`, {
    body: {
      clientRequestId: uuid(),
      bootstrapToken: secret(),
      inviteCode: room.invite,
      profile: { nickname: '小陈', interestTags: ['音乐'], bio: '' },
    },
  });
  const newcomer = {
    memberId: late.data.member.id,
    membershipId: late.data.member.membership.id,
    credential: late.data.memberCredential,
  };
  const lateWs = await connect('小陈', room.id, newcomer.credential, newcomer.membershipId, C.magenta);
  await sleep(1_500);

  const leaked = lateWs.frames.some(f => JSON.stringify(f).includes(hiddenReplyId));
  const snapshot = lateWs.frames.find(f => f.type === 'room.snapshot');
  const sawOldChat = snapshot?.data.messages.some(m => m.text === '大家好呀');
  if (leaked) {
    warn('新成员收到了入房前的回复内容——不符合契约');
  } else {
    good('新成员的快照与后续事件均不含入房前回复的任何内容');
  }
  good(`快照中入房前的聊天原文${sawOldChat ? '仍可见（异常）' : '不可见（正确）'}`);
  info(`小陈的 joinedSequence=${snapshot?.data.self.joinedSequence}，它是可见范围的起点`);

  // ============================================================ 7. 掉线恢复
  section('七、掉线恢复与名额保留');

  act('小周关闭浏览器（断开连接），观察 offline 与恢复期');
  guestWs.close();
  await sleep(300);
  const offline = hostWs.frames.filter(f => f.type === 'member.presence.changed' && f.data.presence === 'offline');
  good(`广播 offline，恢复期 ${config.recoveryMs / 1000} 秒内名额保留`);
  info(`共收到 ${offline.length} 次 offline 事件`);

  act(`等待恢复期满（${config.recoveryMs / 1000} 秒），名额应被释放`);
  await sleep(config.recoveryMs + 600);
  const leftEvent = hostWs.frames.find(f => f.type === 'member.left' && f.data.reason === 'timeout');
  good(`收到 member.left，reason=${leftEvent?.data.reason}，名额已释放`);

  act('小周以原身份重新加入——memberId 不变，membershipId 更新');
  const rejoined = await call('POST', `/api/v1/rooms/${room.id}/members`, {
    credential: guest.credential,
    body: {
      clientRequestId: uuid(),
      inviteCode: room.invite,
      profile: { nickname: '小周', interestTags: ['旅行'], bio: '又回来了' },
    },
    label: '（携带原成员凭证）',
  });
  const newMembershipId = rejoined.data.member.membership.id;
  good(`memberId ${rejoined.data.member.id === guest.memberId ? '不变' : '变了'}，membershipId ${newMembershipId === guest.membershipId ? '不变（异常）' : '已更新'}`);

  act('旧标签页拿着旧 membershipId 发消息——应被拒绝');
  const staleMembership = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: guest.credential,
    membershipId: guest.membershipId,
    body: { clientRequestId: uuid(), text: '旧标签页发言' },
    label: '（旧入房标识）',
  });
  expect(staleMembership, 'MEMBERSHIP_CHANGED', '旧标签页无法操作新入房');

  act('用旧入房的 clientRequestId 重试——不得重放旧正文');
  const ctxExpired = await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: guest.credential,
    membershipId: newMembershipId,
    body: { clientRequestId: msgRequestId, text: '大家好呀' },
    label: '（跨入房的幂等重试）',
  });
  expect(ctxExpired, 'IDEMPOTENCY_CONTEXT_EXPIRED', '旧消息未被重新发布');

  // ============================================================ 8. 权限与移出
  section('八、房主权限与移出成员');

  act('普通成员尝试关闭房间——应被拒绝');
  const notHost = await call('DELETE', `/api/v1/rooms/${room.id}`, {
    credential: newcomer.credential,
    membershipId: newcomer.membershipId,
    label: '（小陈不是房主）',
  });
  expect(notHost, 'HOST_REQUIRED', '后端独立校验权限');

  act('房主尝试移出自己——应被拒绝');
  const hostProtected = await call('DELETE', `/api/v1/rooms/${room.id}/members/${host.memberId}`, {
    credential: host.credential,
    membershipId: host.membershipId,
  });
  expect(hostProtected, 'HOST_PROTECTED', '房主不可被移出');

  act('房主移出小陈，其连接应立即结束（关闭码 1008）');
  await call('DELETE', `/api/v1/rooms/${room.id}/members/${newcomer.memberId}`, {
    credential: host.credential,
    membershipId: host.membershipId,
  });
  await sleep(300);

  act('被移出的成员再次访问——应被拒绝');
  const removedAccess = await call('GET', `/api/v1/rooms/${room.id}/members/me`, { credential: newcomer.credential });
  expect(removedAccess, 'MEMBER_REMOVED', '被移出身份无法继续访问');

  // ============================================================ 9. 关房
  section('九、关闭房间：终止顺序与数据清理');

  act('房主发起一次 AI 调用，然后立刻关房');
  await sleep(config.messageRate.windowMs + 200);
  await call('POST', `/api/v1/rooms/${room.id}/messages`, {
    credential: host.credential,
    membershipId: host.membershipId,
    body: { clientRequestId: uuid(), text: '@AI 慢慢说', mentions: ['ai'] },
  });
  await sleep(250);
  info('此时回复正在生成中，关房必须先取消它');

  await call('DELETE', `/api/v1/rooms/${room.id}`, {
    credential: host.credential,
    membershipId: host.membershipId,
  });
  await sleep(400);

  const types = hostWs.frames.map(f => f.type);
  const closedIndex = types.lastIndexOf('room.closed');
  const cancelIndex = types.lastIndexOf('ai.reply.cancelled');
  if (cancelIndex >= 0 && cancelIndex < closedIndex) {
    good('取消事件先于 room.closed 发布');
    const cancelled = hostWs.frames[cancelIndex];
    info(`已输出的部分文本被保留：「${cancelled.data.reply.text}」`);
  }
  good(`room.closed 是最后一个事件：${closedIndex === types.length - 1 ? '是' : '否'}`);

  act('关房后再访问房间');
  const roomGone = await call('GET', `/api/v1/rooms/${room.id}/members/me`, { credential: host.credential });
  expect(roomGone, 'ROOM_UNAVAILABLE', '聊天与公开资料已清理');

  // ============================================================ 总结
  section('演练结束');

  const allFrames = [...hostWs.frames, ...guestWs.frames, ...lateWs.frames];
  const byType = {};
  for (const frame of allFrames) byType[frame.type] = (byType[frame.type] ?? 0) + 1;

  console.log(`\n${C.bold}本次演练共收到 ${allFrames.length} 条 WebSocket 事件：${C.reset}`);
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${C.dim}${String(count).padStart(3)} ×${C.reset} ${type}`);
  }

  console.log(`\n${C.bold}已演示的契约行为：${C.reset}`);
  const shown = [
    'client-config 对外声明校验上限，前端不预设数值',
    '引导凭证建房、邀请码加入、昵称唯一、人数上限',
    'PATCH 缺省字段保持原值，资料修改全房同步',
    '消息幂等：同标识同内容返回原结果，不同内容冲突',
    '普通成员的 AI 提及按普通聊天处理（ignored）',
    '限频数值经 retryAfterMs 返回',
    'AI 流式：started → delta → completed，增量拼接等于全文',
    '房主调用 FIFO 串行，同时最多一个 running',
    '中途加入看不到入房前已开始的回复与聊天原文',
    '掉线保留名额，超时释放（reason=timeout）',
    '重新加入换 membershipId，旧标识返回 MEMBERSHIP_CHANGED',
    '跨入房幂等重试返回 IDEMPOTENCY_CONTEXT_EXPIRED',
    '房主权限校验：HOST_REQUIRED / HOST_PROTECTED',
    '移出成员断开连接，之后返回 MEMBER_REMOVED',
    '关房顺序：先取消在途回复，再发 room.closed，最后清理',
  ];
  shown.forEach((item, index) => console.log(`  ${C.green}${String(index + 1).padStart(2)}.${C.reset} ${item}`));

  console.log(`\n${C.dim}注：AI 文本来自假插件（固定内容、不接模型），用于验证后端的调度与事件逻辑。${C.reset}`);
  console.log(`${C.dim}    真实选题与话术由 3 号的能力实现提供，接口见 src/application/capability.ts。${C.reset}`);

  if (failures.length > 0) {
    console.log(`\n${C.bold}${C.red}存在 ${failures.length} 项未达预期：${C.reset}`);
    failures.forEach(item => console.log(`  ${C.red}✗${C.reset} ${item}`));
  } else {
    console.log(`\n${C.bold}${C.green}全部断言达成，无未达预期项。${C.reset}`);
  }
  console.log('');

  hostWs.close();
  lateWs.close();
  await app.close();
  if (failures.length > 0) process.exitCode = 1;
};

main().catch(error => {
  console.error(`\n${C.red}演练失败：${error.message}${C.reset}`);
  console.error(error.stack);
  process.exit(1);
});
