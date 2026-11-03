import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { newId, type Config } from './config.ts';
import { AppError } from './domain/errors.ts';
import { RoomService } from './application/room.ts';
import type { Subscriber } from './application/bus.ts';
import { createStubCapability, type Capability } from './application/capability.ts';
import type { RoomStateStore } from './infrastructure/state/store.ts';

/** 统一响应信封：code / message / data / requestId。 */
const ok = (reply: FastifyReply, status: number, data: unknown, requestId: string): FastifyReply =>
  reply.status(status).send({ code: 'OK', message: '', data, requestId });

const bearer = (request: FastifyRequest): string | null => {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim() || null;
};

const membershipHeader = (request: FastifyRequest): string | null => {
  const header = request.headers['x-membership-id'];
  return typeof header === 'string' && header.length > 0 ? header : null;
};

export interface BuildOptions {
  readonly config: Config;
  readonly capability?: Capability;
  /** 可替换的状态存储实现；省略时使用进程内实现。 */
  readonly store?: RoomStateStore;
}

export const build = async ({ config, capability, store }: BuildOptions): Promise<FastifyInstance> => {
  const app = Fastify({ logger: false, genReqId: () => newId('req') });
  const service = store
    ? new RoomService(config, capability ?? createStubCapability(), store)
    : new RoomService(config, capability ?? createStubCapability());

  await app.register(cors, {
    origin: config.corsOrigins === true ? true : [...config.corsOrigins],
    // 前后端跨域开发时必须放行这三个请求头。
    allowedHeaders: ['Authorization', 'X-Membership-Id', 'Content-Type'],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(websocket);

  // 票据与关房等操作没有请求体；空 body 不应被当作格式错误。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, payload, done) => {
    const raw = typeof payload === 'string' ? payload.trim() : '';
    if (raw.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(raw));
    } catch {
      done(new AppError('VALIDATION_ERROR', '请求格式不正确'), undefined);
    }
  });

  // 领域错误 → HTTP 状态码 + 稳定业务 code。
  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.id);
    if (error instanceof AppError) {
      return reply.status(error.status).send({
        code: error.code,
        message: error.message,
        data: { fieldErrors: error.fieldErrors, retryAfterMs: error.retryAfterMs },
        requestId,
      });
    }
    if ((error as { statusCode?: number }).statusCode === 400) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求格式不正确',
        data: { fieldErrors: [], retryAfterMs: null },
        requestId,
      });
    }
    app.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: '服务内部错误',
      data: null,
      requestId,
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      code: 'ROOM_UNAVAILABLE',
      message: '资源不存在',
      data: { fieldErrors: [], retryAfterMs: null },
      requestId: String(request.id),
    }),
  );

  // ------------------------------------------------------------------ HTTP

  app.get('/api/v1/client-config', (request, reply) => ok(reply, 200, service.clientConfig(), String(request.id)));

  app.post('/api/v1/rooms', (request, reply) => {
    const result = service.createRoom(request.body as never);
    return ok(reply, result.status, result.data, String(request.id));
  });

  app.post<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/members', (request, reply) => {
    const result = service.joinRoom(request.params.roomId, bearer(request), request.body as never);
    return ok(reply, result.status, result.data, String(request.id));
  });

  app.get<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/members/me', (request, reply) =>
    ok(reply, 200, service.getSelf(request.params.roomId, bearer(request)), String(request.id)),
  );

  app.patch<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/members/me', (request, reply) =>
    ok(
      reply,
      200,
      service.updateSelf(request.params.roomId, bearer(request), membershipHeader(request), request.body as never),
      String(request.id),
    ),
  );

  app.delete<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/members/me', (request, reply) =>
    ok(reply, 200, service.leaveRoom(request.params.roomId, bearer(request), membershipHeader(request)), String(request.id)),
  );

  app.delete<{ Params: { roomId: string; memberId: string } }>(
    '/api/v1/rooms/:roomId/members/:memberId',
    (request, reply) =>
      ok(
        reply,
        200,
        service.removeMember(request.params.roomId, bearer(request), membershipHeader(request), request.params.memberId),
        String(request.id),
      ),
  );

  app.delete<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId', (request, reply) =>
    ok(reply, 200, service.closeRoom(request.params.roomId, bearer(request), membershipHeader(request)), String(request.id)),
  );

  app.post<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/messages', (request, reply) => {
    const result = service.sendMessage(
      request.params.roomId,
      bearer(request),
      membershipHeader(request),
      request.body as never,
    );
    return ok(reply, result.status, result.data, String(request.id));
  });

  app.post<{ Params: { roomId: string } }>('/api/v1/rooms/:roomId/connection-tickets', (request, reply) => {
    // 票据地址跟随实际请求的 Host，便于本地开发与多环境部署；
    // 显式配置 PUBLIC_WS_ORIGIN 时以配置为准。
    const host = request.headers.host;
    const scheme = request.protocol === 'https' ? 'wss' : 'ws';
    const wsOrigin = process.env['PUBLIC_WS_ORIGIN'] ?? (host ? `${scheme}://${host}` : config.publicWsOrigin);
    return ok(
      reply,
      201,
      service.createTicket(request.params.roomId, bearer(request), membershipHeader(request), wsOrigin),
      String(request.id),
    );
  });

  // -------------------------------------------------------------------- WS

  app.get<{ Params: { roomId: string }; Querystring: { ticket?: string } }>(
    '/api/v1/rooms/:roomId/events',
    { websocket: true },
    (socket, request) => {
      let identity;
      try {
        identity = service.consumeTicket(request.params.roomId, request.query.ticket ?? null);
      } catch (error) {
        // 认证失败不下发任何房间数据。
        const code = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
        socket.close(1008, code);
        return;
      }

      const membership = identity.member.membership!;
      const subscriber: Subscriber = {
        memberId: identity.member.id,
        membershipId: membership.id,
        joinedSequence: membership.joinedSequence,
        send: payload => {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
        },
        close: (closeCode, reason) => {
          if (socket.readyState === socket.OPEN) socket.close(closeCode, reason);
        },
      };

      // 首个业务消息必须是快照，且与后续事件在同一观察位置衔接。
      const snapshot = service.attach(identity, subscriber);
      subscriber.send(snapshot);

      socket.on('close', () => service.detach(identity, subscriber));
      socket.on('error', () => service.detach(identity, subscriber));
    },
  );

  app.decorate('roomService', service);
  return app;
};
