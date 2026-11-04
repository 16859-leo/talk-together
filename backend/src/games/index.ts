/**
 * 游戏注册表与房主指令识别。
 *
 * 指令只认「房主 @AI」的消息（应用层 handleMention 已限制房主），
 * 且只有轮次按钮会用到这些说法；普通聊天不会误触发。
 */

import type { GamePlugin, GameHostState } from './types.ts'
import { thisOrThat } from './this-or-that.ts'
import { storyRelay } from './story-relay.ts'
import { twentyQuestions } from './twenty-questions.ts'
import { whatIf } from './what-if.ts'
import { commonGround } from './common-ground.ts'
import { threeWords } from './three-words.ts'

export type { GameHostState, GamePhase, GamePlugin } from './types.ts'

/** 新游戏在这里注册即可被按钮和指令识别。 */
export const GAMES: readonly GamePlugin[] = [
  thisOrThat,
  storyRelay,
  twentyQuestions,
  whatIf,
  commonGround,
  threeWords,
]

export function findGame(id: string): GamePlugin | null {
  return GAMES.find((game) => game.id === id) ?? null
}

/** 需要暗牌的玩法（二十问）：开局随机抽一张，整局固定。 */
export function pickSecret(game: GamePlugin): string | null {
  const pool = game.secretPool
  if (pool === undefined || pool.length === 0) return null
  return pool[Math.floor(Math.random() * pool.length)] ?? null
}

export type GameAction = 'start' | 'next' | 'end'

export interface GameCommand {
  readonly game: GamePlugin
  readonly action: GameAction
}

/** 「下一题/下一轮/下一句/下一问/继续/再来一个/接着来」——只在游戏进行中才当指令。 */
const NEXT_PATTERN = /下一[题轮个句问]|继续|再来一[题轮个句问]|接着来|往下走/
/** 收尾。 */
const STOP_PATTERN = /结束|收尾|不玩了|到此为止|先到这/

export interface ActiveGameView {
  readonly gameId: string
  readonly round: number
  readonly totalRounds: number
}

/**
 * 从房主的提及文本里识别游戏指令。
 *
 * 优先级：开局 > 收尾 > 下一轮。
 * - 没有进行中的游戏时，只说「下一题」不算指令（避免日常聊天误触发）；
 * - 轮次已经到最后一轮时，「下一题」等价于收尾。
 */
export function detectGameCommand(
  text: string,
  active: ActiveGameView | null,
): GameCommand | null {
  for (const game of GAMES) {
    if (game.startPattern.test(text)) return { game, action: 'start' }
  }

  if (active === null) return null;
  const game = findGame(active.gameId);
  if (game === null) return null;

  if (STOP_PATTERN.test(text)) return { game, action: 'end' };
  if (NEXT_PATTERN.test(text)) {
    return { game, action: active.round >= game.totalRounds ? 'end' : 'next' };
  }
  return null;
}

/** 把「这一轮」整理成交给模型的任务描述。 */
export function gameTask(game: GamePlugin, state: GameHostState): string {
  return game.task(state);
}
