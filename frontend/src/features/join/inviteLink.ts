/**
 * 邀请链接解析。
 *
 * 房主发出去的是完整地址（`/join/<roomId>?inviteCode=...`），用户也可能只贴路径，
 * 甚至带着首尾空格。这里统一解析成站内可跳转的 join 路径；不合法就返回 null，
 * 由页面给出明确提示，而不是跳到一个必然 404 的地址。
 */
export function parseInviteLink(input: string, origin: string): string | null {
  const raw = input.trim()
  if (raw.length === 0) return null

  let url: URL
  try {
    url = new URL(raw, origin)
  } catch {
    return null
  }

  // 只认 join 路径；房间页 `/rooms/...` 不能直接进（没有邀请码）。
  const match = /^\/join\/([^/]+)\/?$/.exec(url.pathname)
  if (!match) return null

  const inviteCode = url.searchParams.get('inviteCode')
  if (!inviteCode || inviteCode.trim().length === 0) return null

  const query = url.searchParams.toString()
  return `${url.pathname.replace(/\/$/, '')}?${query}`
}
