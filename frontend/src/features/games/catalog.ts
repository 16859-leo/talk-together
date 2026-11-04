/**
 * 前端的游戏目录。
 *
 * 必须与后端 `backend/src/games/` 的 id 和按钮文本保持一致：
 * 按钮点击就是发一条房主 @AI 的消息，后端按同一套说法识别轮次指令。
 * 加游戏时两边一起加（后端插件 + 这里一条按钮）。
 */

export interface GameDefinition {
  readonly id: string
  readonly name: string
  readonly emoji: string
  readonly tagline: string
  readonly totalRounds: number
  /** 开局发言，按钮点击时原样发送 */
  readonly startText: string
  /** 推进到下一轮的发言 */
  readonly nextText: string
  /** 下一轮按钮上的文案 */
  readonly nextLabel: string
  /** 收尾发言 */
  readonly stopText: string
}

export const GAMES: readonly GameDefinition[] = [
  {
    id: 'this-or-that',
    name: '默契二选一',
    emoji: '⚖️',
    tagline: '抛一个二选一，看看谁和谁默契',
    totalRounds: 5,
    startText: '@AI 来玩默契二选一',
    nextText: '@AI 下一题',
    nextLabel: '下一题',
    stopText: '@AI 结束游戏',
  },
  {
    id: 'story-relay',
    name: '故事接龙',
    emoji: '📖',
    tagline: '一人一句，把故事越接越离谱',
    totalRounds: 4,
    startText: '@AI 来玩故事接龙',
    nextText: '@AI 下一句',
    nextLabel: '下一句',
    stopText: '@AI 结束游戏',
  },
  {
    id: 'twenty-questions',
    name: '二十问猜词',
    emoji: '🔍',
    tagline: '我只答是或不是，你们猜我藏了什么',
    totalRounds: 8,
    startText: '@AI 来玩二十问猜词',
    nextText: '@AI 下一问',
    nextLabel: '下一问',
    stopText: '@AI 结束游戏',
  },
  {
    id: 'what-if',
    name: '如果…会怎样',
    emoji: '🌀',
    tagline: '一个离谱假设，看谁接得最飞',
    totalRounds: 4,
    startText: '@AI 来玩如果…会怎样',
    nextText: '@AI 接着来',
    nextLabel: '接着来',
    stopText: '@AI 结束游戏',
  },
  {
    id: 'common-ground',
    name: '原来我们都一样',
    emoji: '🤝',
    tagline: '各说各的，看看谁和谁撞上',
    totalRounds: 4,
    startText: '@AI 来玩原来我们都一样',
    nextText: '@AI 下一轮',
    nextLabel: '下一轮',
    stopText: '@AI 结束游戏',
  },
  {
    id: 'three-words',
    name: '三个词',
    emoji: '🔤',
    tagline: '三个不相干的词，拼一句话',
    totalRounds: 4,
    startText: '@AI 来玩三个词',
    nextText: '@AI 下一轮',
    nextLabel: '下一轮',
    stopText: '@AI 结束游戏',
  },
]

export function findGame(id: string): GameDefinition | null {
  return GAMES.find((game) => game.id === id) ?? null
}

export interface ActiveGame {
  readonly gameId: string
}

const storageKey = (roomId: string): string => `talk-together.game.${roomId}`

/** 房主刷新页面后还能看到「下一题/结束」，游戏状态按房间记在会话存储里。 */
export function loadActiveGame(
  roomId: string | undefined,
  storage: Pick<Storage, 'getItem'> = window.sessionStorage,
): ActiveGame | null {
  if (roomId === undefined || roomId.length === 0) return null
  try {
    const raw = storage.getItem(storageKey(roomId))
    if (raw === null) return null
    const parsed = JSON.parse(raw) as { gameId?: unknown }
    return typeof parsed.gameId === 'string' && findGame(parsed.gameId) !== null
      ? { gameId: parsed.gameId }
      : null
  } catch {
    return null
  }
}

export function saveActiveGame(
  roomId: string | undefined,
  game: ActiveGame | null,
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = window.sessionStorage,
): void {
  if (roomId === undefined || roomId.length === 0) return
  try {
    if (game === null) storage.removeItem(storageKey(roomId))
    else storage.setItem(storageKey(roomId), JSON.stringify(game))
  } catch {
    // 会话存储不可用（隐私模式等）不影响游戏本身
  }
}
