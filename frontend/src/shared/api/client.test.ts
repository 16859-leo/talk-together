import { describe, expect, it } from 'vitest'
import { normalizeApiBase } from './client'

describe('normalizeApiBase', () => {
  it('去掉末尾斜杠，避免拼出 //rooms', () => {
    expect(normalizeApiBase('http://127.0.0.1:4123/api/v1/')).toBe('http://127.0.0.1:4123/api/v1')
    expect(normalizeApiBase('http://127.0.0.1:4123/api/v1///')).toBe('http://127.0.0.1:4123/api/v1')
  })

  it('没有配置时回落到同源路径', () => {
    expect(normalizeApiBase(undefined)).toBe('/api/v1')
    expect(normalizeApiBase('')).toBe('/api/v1')
    expect(normalizeApiBase('   ')).toBe('/api/v1')
    expect(normalizeApiBase('/')).toBe('/api/v1')
  })

  it('正常值原样保留', () => {
    expect(normalizeApiBase('http://127.0.0.1:4123/api/v1')).toBe('http://127.0.0.1:4123/api/v1')
    expect(normalizeApiBase('/api/v1')).toBe('/api/v1')
  })
})
