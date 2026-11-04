/**
 * 游戏插件与房主指令识别（纯逻辑，不碰模型）。
 *
 * 规则层要保证：只有明确说法才触发、没有游戏时「下一题」不误触发、
 * 最后一轮点「下一题」等价于收尾。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  GAMES,
  detectGameCommand,
  findGame,
  gameTask,
} from '../src/games/index.ts';
import { thisOrThat } from '../src/games/this-or-that.ts';
import { storyRelay } from '../src/games/story-relay.ts';

test('注册表：两个游戏都能按 id 找到，元信息完整', () => {
  assert.equal(GAMES.length, 2);
  for (const game of GAMES) {
    assert.ok(game.name.length > 0);
    assert.ok(game.emoji.length > 0);
    assert.ok(game.totalRounds > 0);
    assert.equal(findGame(game.id), game);
  }
  assert.equal(findGame('not-a-game'), null);
});

test('开局指令：点名游戏才触发，普通聊天不触发', () => {
  const start = detectGameCommand('@AI 来玩默契二选一', null);
  assert.equal(start?.game.id, thisOrThat.id);
  assert.equal(start?.action, 'start');

  const relay = detectGameCommand('@AI 故事接龙走起', null);
  assert.equal(relay?.game.id, storyRelay.id);

  for (const text of ['@AI 帮我找个话题', '@AI 我们聊点别的', '@AI 你好']) {
    assert.equal(detectGameCommand(text, null), null, text);
  }
});

test('没有进行中的游戏时，「下一题」不是指令', () => {
  assert.equal(detectGameCommand('@AI 下一题', null), null);
  assert.equal(detectGameCommand('@AI 结束游戏', null), null);
});

test('进行中：「下一题」推进轮次，最后一轮变成收尾', () => {
  const active = { gameId: thisOrThat.id, round: 1, totalRounds: thisOrThat.totalRounds };
  assert.equal(detectGameCommand('@AI 下一题', active)?.action, 'next');
  assert.equal(detectGameCommand('@AI 继续', active)?.action, 'next');

  const last = {
    gameId: thisOrThat.id,
    round: thisOrThat.totalRounds,
    totalRounds: thisOrThat.totalRounds,
  };
  assert.equal(detectGameCommand('@AI 下一题', last)?.action, 'end');
});

test('进行中：「结束」随时收尾', () => {
  const active = { gameId: storyRelay.id, round: 2, totalRounds: storyRelay.totalRounds };
  assert.equal(detectGameCommand('@AI 结束游戏', active)?.action, 'end');
  assert.equal(detectGameCommand('@AI 先到这吧', active)?.action, 'end');
});

test('游戏任务：开局/轮次/收尾都带上轮次信息', () => {
  const start = gameTask(thisOrThat, { phase: 'start', round: 1, totalRounds: 5 });
  assert.ok(start.includes('第 1/5 轮'));
  assert.ok(start.includes('二选一'));

  const mid = gameTask(storyRelay, { phase: 'round', round: 3, totalRounds: 4 });
  assert.ok(mid.includes('第 3/4 轮'));

  const end = gameTask(thisOrThat, { phase: 'end', round: 5, totalRounds: 5 });
  assert.ok(end.includes('收尾'));
});
