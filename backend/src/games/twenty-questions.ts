import type { GameHostState, GamePlugin } from './types.ts'

/**
 * 二十问猜词。
 *
 * 开局随机抽一张暗牌（电影/物品/地点/职业），只交给模型说「是/不是/接近」，
 * 每轮房主点「下一问」推进。暗牌存在房间的游戏状态里，所以模型中途换不了答案。
 */
export const twentyQuestions: GamePlugin = {
  id: 'twenty-questions',
  name: '二十问猜词',
  emoji: '🔍',
  tagline: '我只答是或不是，你们猜我藏了什么',
  totalRounds: 8,
  startPattern: /二十问|猜词/,
  secretPool: [
    '《千与千寻》',
    '《让子弹飞》',
    '消防员',
    '宇航员',
    '火锅',
    '榴莲',
    '长颈鹿',
    '金字塔',
    '冰箱',
    '共享单车',
    '马拉松',
    '地铁',
  ],
  task(state: GameHostState): string {
    const secret = state.secret ?? '某个东西'
    switch (state.phase) {
      case 'start':
        return (
          `你在主持「二十问猜词」第 1/${state.totalRounds} 轮。你心里想的词是「${secret}」。` +
          '先说明玩法：大家只能用「是/不是」的问题来猜，你回答「是」「不是」或「接近」。' +
          '然后给一个类别提示（是电影、物品、地点还是职业），但绝对不要说出这个词本身，也不要用谐音暗示。' +
          '总长 90 字以内。'
        )
      case 'round':
        return (
          `你在主持「二十问猜词」第 ${state.round}/${state.totalRounds} 轮。你心里想的词是「${secret}」，` +
          '绝对不要说出它，也不要用谐音或拆字暗示。' +
          '看最近发言里大家提的问题：用「是 / 不是 / 接近」回答还没回答过的问题（最多回答两个），' +
          '再给一句小提示，鼓励继续问。100 字以内。'
        )
      default:
        return (
          `时间到，公布答案：你心里想的词是「${secret}」。` +
          '用一句话说说为什么是它，再夸一句大家问得好，自然地说游戏结束。80 字以内。'
        )
    }
  },
}
