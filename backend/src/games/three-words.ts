import type { GameHostState, GamePlugin } from './types.ts'

/**
 * 三个词。
 *
 * 每轮 AI 给三个不相干的词，大家用这三个词写一句话（越离谱越好）；
 * 下一轮 AI 点评最妙的一句，换三个新词继续。
 */
export const threeWords: GamePlugin = {
  id: 'three-words',
  name: '三个词',
  emoji: '🔤',
  tagline: '三个不相干的词，拼一句话',
  totalRounds: 4,
  startPattern: /三个词|三词/,
  task(state: GameHostState): string {
    switch (state.phase) {
      case 'start':
        return (
          `你在主持「三个词」第 1/${state.totalRounds} 轮。` +
          '给出三个毫不相干的词（用「、」隔开），让大家用这三个词写一句话，写得越离谱越好。' +
          '你自己先造一句当例子。90 字以内。'
        )
      case 'round':
        return (
          `你在主持「三个词」第 ${state.round}/${state.totalRounds} 轮。` +
          '看最近发言：点出谁造得最妙或最离谱（可以点成员名，也可以复述一小句关键词），' +
          '然后给出一组新的三个词，继续下一轮。100 字以内。'
        )
      default:
        return (
          '「三个词」到收尾了。挑最喜欢的一句夸一下，说游戏结束、想继续玩可以再来。80 字以内。'
        )
    }
  },
}
