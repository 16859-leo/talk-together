import type { GameHostState, GamePlugin } from './types.ts'

/**
 * 原来我们都一样。
 *
 * 每轮 AI 给一个方向（这周做过的小事、去过的城市、爱吃的东西），
 * 大家各说各的；下一轮 AI 找出撞上的共同点，再换方向。破冰不用查户口。
 */
export const commonGround: GamePlugin = {
  id: 'common-ground',
  name: '原来我们都一样',
  emoji: '🤝',
  tagline: '各说各的，看看谁和谁撞上',
  totalRounds: 4,
  startPattern: /原来我们都一样|共同点/,
  task(state: GameHostState): string {
    switch (state.phase) {
      case 'start':
        return (
          `你在主持「原来我们都一样」第 1/${state.totalRounds} 轮。` +
          '先说明玩法：每一轮给一个方向，大家各说自己的答案，看看谁和谁撞上。' +
          '然后给出第一个方向，要具体、容易回答（比如「这周做过的一件小事」）。90 字以内。'
        )
      case 'round':
        return (
          `你在主持「原来我们都一样」第 ${state.round}/${state.totalRounds} 轮。` +
          '看最近发言：找出两三个人共同提到或都做过的点，明确点出来（例如「小林和阿哲都…」）；' +
          '如果一个都没撞上，就说「目前还没撞上」，不要硬编。' +
          '然后用一句话抛下一个方向。100 字以内。'
        )
      default:
        return (
          '「原来我们都一样」到收尾了。说这个房间最意外的一个共同点，' +
          '夸一句大家的共同点比想象中多，自然地说游戏结束。80 字以内。'
        )
    }
  },
}
