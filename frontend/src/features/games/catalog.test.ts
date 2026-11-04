import { describe, expect, it } from 'vitest'
import {
  GAMES,
  findGame,
  isGameCommandText,
  isGuessedEnding,
  loadActiveGame,
  saveActiveGame,
} from './catalog'

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value)
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
  }
}

describe('游戏目录', () => {
  it('id 与后端注册表一致，按钮文本能带着游戏名开局', () => {
    expect(GAMES.map((game) => game.id)).toEqual([
      'this-or-that',
      'story-relay',
      'twenty-questions',
      'what-if',
      'common-ground',
      'three-words',
    ])
    for (const game of GAMES) {
      expect(game.startText).toContain(game.name)
      expect(game.startText).toContain('@AI')
      expect(game.nextText).toContain('@AI')
      expect(game.stopText).toContain('@AI')
      expect(game.nextLabel.length).toBeGreaterThan(0)
      expect(game.totalRounds).toBeGreaterThan(0)
    }
  })

  it('按 id 查找，未知 id 返回 null', () => {
    expect(findGame('this-or-that')?.name).toBe('默契二选一')
    expect(findGame('story-relay')?.name).toBe('故事接龙')
    expect(findGame('missing')).toBeNull()
  })
})

describe('按钮指令与聊天内容', () => {
  it('按钮发出的指令按「操作」处理，普通聊天不会', () => {
    for (const game of GAMES) {
      expect(isGameCommandText(game.startText)).toBe(true)
      expect(isGameCommandText(game.nextText)).toBe(true)
      expect(isGameCommandText(game.stopText)).toBe(true)
    }
    expect(isGameCommandText('@AI 帮我找个话题')).toBe(false)
    expect(isGameCommandText('小美最近在忙什么')).toBe(false)
  })

  it('只有二十问的「猜对了」收尾才把进行中卡片收起来', () => {
    expect(isGuessedEnding('猜对了！答案是千与千寻。')).toBe(true)
    expect(isGuessedEnding(' 猜对了，就是它。')).toBe(true)
    expect(isGuessedEnding('时间到，答案是千与千寻。')).toBe(false)
    expect(isGuessedEnding('')).toBe(false)
  })
})

describe('房主的游戏状态（按房间存会话存储）', () => {
  it('保存后读回同一局（含轮次）；清掉后为空', () => {
    const storage = memoryStorage()
    saveActiveGame('room_1', { gameId: 'this-or-that', round: 3 }, storage)
    expect(loadActiveGame('room_1', storage)).toEqual({ gameId: 'this-or-that', round: 3 })

    saveActiveGame('room_1', null, storage)
    expect(loadActiveGame('room_1', storage)).toBeNull()
  })

  it('不同房间互不影响', () => {
    const storage = memoryStorage()
    saveActiveGame('room_1', { gameId: 'this-or-that', round: 1 }, storage)
    expect(loadActiveGame('room_2', storage)).toBeNull()
  })

  it('存储里是未知游戏 id 或坏 JSON 时按没有游戏处理', () => {
    const storage = memoryStorage()
    storage.setItem('talk-together.game.room_1', JSON.stringify({ gameId: 'not-a-game' }))
    expect(loadActiveGame('room_1', storage)).toBeNull()

    storage.setItem('talk-together.game.room_2', '{oops')
    expect(loadActiveGame('room_2', storage)).toBeNull()
  })

  it('旧数据没有轮次或轮次非法时按第 1 轮处理', () => {
    const storage = memoryStorage()
    storage.setItem('talk-together.game.room_1', JSON.stringify({ gameId: 'this-or-that' }))
    expect(loadActiveGame('room_1', storage)).toEqual({ gameId: 'this-or-that', round: 1 })

    storage.setItem(
      'talk-together.game.room_2',
      JSON.stringify({ gameId: 'this-or-that', round: -2 }),
    )
    expect(loadActiveGame('room_2', storage)).toEqual({ gameId: 'this-or-that', round: 1 })
  })

  it('没有房间 id 时不读写', () => {
    const storage = memoryStorage()
    saveActiveGame('', { gameId: 'this-or-that', round: 1 }, storage)
    expect(storage.map.size).toBe(0)
    expect(loadActiveGame('', storage)).toBeNull()
  })
})
