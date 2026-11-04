import type { GameHostState, GamePlugin } from './types.ts'

/**
 * 故事接龙。
 *
 * AI 起个头并点出接龙顺序，成员一人接一句；房主点「下一句」，AI 把最近的
 * 接龙顺成故事进展、点出最妙的一句，再推一个转折、点下一位。
 */
export const storyRelay: GamePlugin = {
  id: 'story-relay',
  name: '故事接龙',
  emoji: '📖',
  tagline: '一人一句，把故事越接越离谱',
  totalRounds: 4,
  startPattern: /故事接龙|接龙/,
  task(state: GameHostState): string {
    switch (state.phase) {
      case 'start':
        return (
          `你在主持「故事接龙」第 1/${state.totalRounds} 轮。` +
          '先给一个一句话的日常故事开头（要有具体人物和场景），' +
          '再点出接龙顺序：按房间成员列表的顺序，一人接一句。' +
          '总长 90 字以内，不要分点。'
        )
      case 'round':
        return (
          `你在主持「故事接龙」第 ${state.round}/${state.totalRounds} 轮。` +
          '把最近大家接的句子顺成一句故事进展，点出最意外或最妙的一句，' +
          '再补一句转折，点名下一位继续接。不要复述成员原话，100 字以内。'
        )
      default:
        return (
          '「故事接龙」到收尾了。给这个故事一个简短结尾（一到两句），' +
          '再夸一句大家接得好的地方，自然地说游戏结束。80 字以内。'
        )
    }
  },
}
