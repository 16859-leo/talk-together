import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomBytes } from 'node:crypto';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { build } from '../src/app.ts';
import { defaultConfig, type Config } from '../src/config.ts';
import type { FastifyInstance } from 'fastify';

const Ajv2020 = (Ajv2020Module as unknown as { default?: typeof Ajv2020Module }).default ?? Ajv2020Module;
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule;

const require = createRequire(import.meta.url);
const models = require('@talk-together/contracts/models.schema.json') as Record<string, unknown>;
const events = require('@talk-together/contracts/events.schema.json') as Record<string, unknown>;

const base = 'https://contracts.talk-together.test/';
const ajv = new (Ajv2020 as unknown as new (options: unknown) => any)({ allErrors: true, strict: false });
(addFormats as unknown as (instance: unknown) => void)(ajv);
ajv.addSchema(models, base + 'models.schema.json');
ajv.addSchema(events, base + 'events.schema.json');

/** 用契约的权威 Schema 校验后端真实输出。 */
export const validateModel = (name: string, value: unknown, label: string): void => {
  const validator = ajv.getSchema(base + 'models.schema.json#/$defs/' + name);
  assert(validator, `Unknown model: ${name}`);
  assert(validator(value), `${label}: ${ajv.errorsText(validator.errors, { separator: '\n' })}`);
};

export const validateServerMessage = (value: unknown, label: string): void => {
  const validator = ajv.getSchema(base + 'events.schema.json');
  assert(validator, 'Missing events schema');
  assert(validator(value), `${label}: ${ajv.errorsText(validator.errors, { separator: '\n' })}`);
};

export const secret = (): string => randomBytes(48).toString('base64url');
export const uuid = (): string => randomUUID();

export const testConfig = (overrides: Partial<Config> = {}): Config => ({
  ...defaultConfig,
  host: '127.0.0.1',
  port: 0,
  ...overrides,
});

export interface Harness {
  app: FastifyInstance;
  /** 发起 HTTP 请求并返回解析后的信封。 */
  call(options: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    body?: unknown;
    credential?: string;
    membershipId?: string;
  }): Promise<{ status: number; code: string; data: any; requestId: string }>;
  close(): Promise<void>;
}

export const harness = async (config: Config = testConfig(), capability?: Parameters<typeof build>[0]['capability']): Promise<Harness> => {
  const app = await build(capability ? { config, capability } : { config });
  await app.ready();

  const call: Harness['call'] = async ({ method, url, body, credential, membershipId }) => {
    const headers: Record<string, string> = {};
    if (credential) headers['authorization'] = `Bearer ${credential}`;
    if (membershipId) headers['x-membership-id'] = membershipId;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const response = await app.inject({
      method,
      url,
      headers,
      ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
    });
    const parsed = response.json() as { code: string; data: unknown; requestId: string };
    return { status: response.statusCode, code: parsed.code, data: parsed.data as any, requestId: parsed.requestId };
  };

  return { app, call, close: () => app.close() };
};

/** 建房并返回房主凭证与房间信息。 */
export const createHost = async (h: Harness, nickname = '小林') => {
  const result = await h.call({
    method: 'POST',
    url: '/api/v1/rooms',
    body: { clientRequestId: uuid(), bootstrapToken: secret(), profile: { nickname, interestTags: ['阅读'], bio: '' } },
  });
  assert.equal(result.status, 201, JSON.stringify(result));
  validateModel('RoomEntryData', result.data, 'createRoom');
  return {
    roomId: result.data.room.id as string,
    inviteCode: result.data.room.invitation.inviteCode as string,
    memberId: result.data.member.id as string,
    membershipId: result.data.member.membership.id as string,
    credential: result.data.memberCredential as string,
  };
};

/** 以匿名身份加入房间。 */
export const joinGuest = async (h: Harness, roomId: string, inviteCode: string, nickname: string) => {
  const result = await h.call({
    method: 'POST',
    url: `/api/v1/rooms/${roomId}/members`,
    body: { clientRequestId: uuid(), bootstrapToken: secret(), inviteCode, profile: { nickname, interestTags: ['旅行'], bio: '' } },
  });
  return result;
};
