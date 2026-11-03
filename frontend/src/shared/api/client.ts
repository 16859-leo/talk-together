import type {
  ClientConfigData,
  ErrorCode,
  FieldError,
} from './types'

const BASE = '/api/v1'

interface Envelope<T> {
  code: string
  message: string
  data: T
  requestId: string
}

export class ApiError extends Error {
  readonly code: ErrorCode | string
  readonly status: number
  readonly fieldErrors: FieldError[]
  readonly retryAfterMs: number | null
  readonly requestId: string | null

  constructor(params: {
    code: string
    status: number
    message: string
    fieldErrors?: FieldError[]
    retryAfterMs?: number | null
    requestId?: string | null
  }) {
    super(params.message)
    this.name = 'ApiError'
    this.code = params.code
    this.status = params.status
    this.fieldErrors = params.fieldErrors ?? []
    this.retryAfterMs = params.retryAfterMs ?? null
    this.requestId = params.requestId ?? null
  }

  fieldError(path: string): string | undefined {
    return this.fieldErrors.find((e) => e.path === path)?.message
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  credential?: string
  membershipId?: string
  signal?: AbortSignal
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.credential) headers['Authorization'] = `Bearer ${options.credential}`
  if (options.membershipId) headers['X-Membership-Id'] = options.membershipId

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })
  } catch (error) {
    throw new ApiError({
      code: 'NETWORK',
      status: 0,
      message: '网络好像不太稳，稍后再试',
    })
  }

  const raw = (await response.json().catch(() => null)) as Envelope<T> | null

  if (!response.ok || !raw || raw.code !== 'OK') {
    const data = raw?.data as
      | { fieldErrors?: FieldError[]; retryAfterMs?: number | null }
      | undefined
    throw new ApiError({
      code: raw?.code ?? 'INTERNAL_ERROR',
      status: response.status,
      message: raw?.message || '请求没有完成',
      fieldErrors: data?.fieldErrors,
      retryAfterMs: data?.retryAfterMs,
      requestId: raw?.requestId,
    })
  }

  return raw.data
}

/** 入房前拉取一次校验约束；失败时用保守默认值，界面不因此卡住。 */
export async function getClientConfig(): Promise<ClientConfigData> {
  try {
    return await request<ClientConfigData>('/client-config')
  } catch {
    return {
      contractVersion: '0.1.0',
      validation: {
        nickname: { minLength: 1, maxLength: null },
        interestTag: { minLength: 1, maxLength: null },
        bio: { minLength: 0, maxLength: null },
        message: { minLength: 1, maxLength: null },
        interestTags: { minItems: 1, maxItems: null },
      },
    }
  }
}
