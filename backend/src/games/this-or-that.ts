import type { GameHostState, GamePlugin } from './types.ts'

/**
 * 默契二选一。
 *
 * 每轮 AI 抛一个二选一，成员在聊天里各选一边并说理由；房主点「下一题」，
 * AI 看最近的回答点评票型，再抛下一题。规则完全由房主的轮次按钮推进，
 * 模型只负责出题和点评。
 */
export const thisOrThat: GamePlugin = {
  id: 'this-or-that',
  name: '默契二选一',
  emoji: '⚖️',
  tagline: '抛一个二选一，看看谁和谁默契',
  totalRounds: 5,
  startPattern: /默契二选一|二选一/,
  task(state: GameHostState): string {
    switch (state.phase) {
      case 'start':
        return (
          `你在主持破冰游戏「默契二选一」第 1/${state.totalRounds} 轮。` +
          '先用一句话说明怎么玩（大家各选一个，可以说理由），紧接着出第一道二选一：' +
          '两个选项都要具体、能马上选，比如「早起」还是「熬夜」。' +
          '总长 80 字以内，不要分点、不要解释规则细节。'
        )
      case 'round':
        return (
          `你在主持「默契二选一」第 ${state.round}/${state.totalRounds} 轮。` +
          '先看最近发言里大家分别选了哪边：用一句话点评票型（谁和谁一致、谁反着来），' +
          '紧接着出下一道二选一。如果有人的选择还没出现，不要点名催促，正常出下一题即可。' +
          '总长 100 字以内，不要分点。'
        )
      default:
        return (
          '「默契二选一」到收尾了。用一到两句说说这个房间的默契点' +
          '（谁总跟谁选一边、哪题分歧最大），然后自然地说游戏结束、想接着聊就继续。' +
          '不要逐题复盘，80 字以内。'
        )
    }
  },
}
