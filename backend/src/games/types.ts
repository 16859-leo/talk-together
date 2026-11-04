/**
 * 插件式游戏的定义。
 *
 * 分工：
 *   - 应用层（本模块的调用方）决定「什么时候进入哪一轮」——只认房主的按钮指令，
 *     规则确定、可测试，不依赖模型。
 *   - AI 只负责「这一轮该说什么」：任务文案由插件给出，模型照着主持。
 *     模型输出不合格只会让这一轮话术失败，不会卡住游戏流程。
 *
 * 加一个新游戏 = 新建一个 GamePlugin 文件 + 在 index.ts 的 GAMES 里注册
 * + 前端 catalog 里加一条按钮（只对房主显示）。
 */

export type GamePhase = 'start' | 'round' | 'end'

export interface GameHostState {
  readonly phase: GamePhase
  readonly round: number
  readonly totalRounds: number
  /** 这一局抽到的暗牌（只有「二十问」这类玩法有）；每轮都带给模型，别让它中途换答案。 */
  readonly secret?: string
  /** 收尾原因：有人猜中（自动收尾）还是房主手动结束。 */
  readonly endReason?: 'guessed' | 'manual'
  /** 猜中的成员昵称，收尾时用来点名。 */
  readonly guesserName?: string
}

export interface GamePlugin {
  readonly id: string
  /** 显示名，和前端按钮一致。 */
  readonly name: string
  readonly emoji: string
  readonly tagline: string
  readonly totalRounds: number
  /** 房主 @AI 的文本是否在要求开这个游戏。 */
  readonly startPattern: RegExp
  /**
   * 需要暗牌的玩法在这里给候选池：开局时随机抽一个，存进房间的这局游戏里，
   * 之后每一轮的任务都带着它，保证模型不会中途改答案。
   */
  readonly secretPool?: readonly string[]
  /** 这一轮要 AI 主持什么，直接作为提示词任务交给模型。 */
  task(state: GameHostState): string
}
