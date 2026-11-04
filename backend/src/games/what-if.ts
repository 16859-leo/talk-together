import type { GameHostState, GamePlugin } from './types.ts'

/**
 * 如果…会怎样。
 *
 * AI 每轮抛一个具体的假设，成员随便接；下一轮 AI 点出最有意思的回答、加自己的版本，
 * 再抛下一个假设。纯脑洞，不需要判定和记分。
 */
export const whatIf: GamePlugin = {
  id: 'what-if',
  name: '如果…会怎样',
  emoji: '🌀',
  tagline: '一个离谱假设，看谁接得最飞',
  totalRounds: 4,
  startPattern: /如果.*会怎样|脑洞/,
  task(state: GameHostState): string {
    switch (state.phase) {
      case 'start':
        return (
          `你在主持「如果…会怎样」第 1/${state.totalRounds} 轮。` +
          '先出第一个假设：具体、有点离谱但不吓人，所有人都能接（比如「如果你明天醒来会一种新技能」）。' +
          '一句话说清假设，再补一句你自己的想法当示范。90 字以内。'
        )
      case 'round':
        return (
          `你在主持「如果…会怎样」第 ${state.round}/${state.totalRounds} 轮。` +
          '看最近发言：挑一个最有意思的回答点出来（可以点成员名），再补一句你的版本，' +
          '然后抛出下一个「如果…」。不要挨个点评，也不要重复上一轮的假设。100 字以内。'
        )
      default:
        return (
          '「如果…会怎样」到收尾了。挑一两个最妙的回答夸一下，说一句这个房间脑洞很大，' +
          '自然地说游戏结束。80 字以内。'
        )
    }
  },
}
