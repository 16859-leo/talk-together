export interface PersonColor {
  c1: string
  c2: string
  c3: string
}

const KNOWN: Record<string, PersonColor> = {
  member_host: { c1: '#4f8f82', c2: '#e4f0ea', c3: '#2f5f56' },
  member_zhou: { c1: '#4e9aa6', c2: '#e2eff1', c3: '#2c5b64' },
  member_lan: { c1: '#b16f84', c2: '#f5e6ea', c3: '#6d3b4a' },
  member_chen: { c1: '#c07f50', c2: '#f6e9db', c3: '#74492a' },
  member_mi: { c1: '#cfa152', c2: '#f8eed7', c3: '#7a5a20' },
}

const PALETTE: PersonColor[] = [
  { c1: '#4f8f82', c2: '#e4f0ea', c3: '#2f5f56' },
  { c1: '#4e9aa6', c2: '#e2eff1', c3: '#2c5b64' },
  { c1: '#b16f84', c2: '#f5e6ea', c3: '#6d3b4a' },
  { c1: '#c07f50', c2: '#f6e9db', c3: '#74492a' },
  { c1: '#cfa152', c2: '#f8eed7', c3: '#7a5a20' },
]

/** 每个成员固定一个颜色：已知演示成员用设计稿配色，其余按 id 稳定散列。 */
export function personColor(memberId: string): PersonColor {
  const known = KNOWN[memberId]
  if (known) return known
  let hash = 0
  for (let i = 0; i < memberId.length; i += 1) {
    hash = (hash * 31 + memberId.charCodeAt(i)) % 997
  }
  return PALETTE[hash % PALETTE.length]
}
