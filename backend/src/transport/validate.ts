import { createRequire } from 'node:module';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { AppError, type FieldError } from '../domain/errors.ts';

/**
 * 契约请求校验。
 *
 * 协议层必须在访问应用服务之前按契约验证请求体：必填字段、类型、Secret 格式等。
 * 不能依赖 `as never` 之类的类型断言——它在运行时不做任何检查。
 */

const require = createRequire(import.meta.url);
const models = require('@talk-together/contracts/models.schema.json') as Record<string, unknown>;

const Ajv2020 = (Ajv2020Module as unknown as { default?: typeof Ajv2020Module }).default ?? Ajv2020Module;
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule;

const base = 'https://contracts.talk-together.test/models.schema.json';
// allErrors 便于一次返回全部字段错误；coerceTypes 必须关闭，否则 "1" 会被当成 1。
const ajv = new (Ajv2020 as unknown as new (options: unknown) => any)({
  allErrors: true,
  strict: false,
  coerceTypes: false,
});
(addFormats as unknown as (instance: unknown) => void)(ajv);
ajv.addSchema(models, base);

export type RequestModel =
  | 'CreateRoomRequest'
  | 'JoinRoomRequest'
  | 'SendMessageRequest'
  | 'ProfilePatch';

const validators = new Map<string, (value: unknown) => boolean>();

const validatorFor = (model: RequestModel): ((value: unknown) => boolean) => {
  const cached = validators.get(model);
  if (cached) return cached;
  const validator = ajv.getSchema(`${base}#/$defs/${model}`);
  if (!validator) throw new Error(`Unknown request model: ${model}`);
  validators.set(model, validator);
  return validator;
};

/** Ajv 错误转契约要求的 fieldErrors：path 用请求体的 JSON Pointer，根级为空字符串。 */
const toFieldErrors = (errors: readonly any[]): FieldError[] =>
  errors.map(error => {
    const pointer = String(error.instancePath ?? '');
    const missing = error.keyword === 'required' ? String(error.params?.missingProperty ?? '') : '';
    const path = missing ? `${pointer}/${missing}` : pointer;
    return { path, message: String(error.message ?? '字段不符合要求') };
  });

/**
 * 按契约模型校验请求体，失败抛 VALIDATION_ERROR。
 *
 * 返回值带上目标类型，调用方无需再做断言。
 */
export const validateRequest = <T>(model: RequestModel, body: unknown): T => {
  if (body === undefined || body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('VALIDATION_ERROR', '请求体必须是 JSON 对象', {
      fieldErrors: [{ path: '', message: '缺少请求体' }],
    });
  }
  const validator = validatorFor(model);
  if (!validator(body)) {
    const errors = (validator as unknown as { errors?: readonly any[] }).errors ?? [];
    throw new AppError('VALIDATION_ERROR', '请求不符合要求', { fieldErrors: toFieldErrors(errors) });
  }
  return body as T;
};
