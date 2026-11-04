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
  pickSecret,
} from '../src/games/index.ts';
import { thisOrThat } from '../src/games/this-or-that.ts';
import { storyRelay } from '../src/games/story-relay.ts';
import { twentyQuestions } from '../src/games/twenty-questions.ts';
import { whatIf } from '../src/games/what-if.ts';
import { commonGround } from '../src/games/common-ground.ts';
import { threeWords } from '../src/games/three-words.ts';

test('注册表：六个游戏都能按 id 找到，元信息完整', () => {
  assert.equal(GAMES.length, 6);
  assert.deepEqual(
    GAMES.map((game) => game.id),
    ['this-or-that', 'story-relay', 'twenty-questions', 'what-if', 'common-ground', 'three-words'],
  );
  for (const game of GAMES) {
    assert.ok(game.name.length > 0);
    assert.ok(game.emoji.length > 0);
    assert.ok(game.totalRounds > 0);
    assert.equal(findGame(game.id), game);
  }
  assert.equal(findGame('not-a-game'), null);
});

test('开局指令：每个游戏的按钮文本都能被识别', () => {
  const cases: readonly [string, string][] = [
    ['@AI 来玩默契二选一', thisOrThat.id],
    ['@AI 来玩故事接龙', storyRelay.id],
    ['@AI 来玩二十问猜词', twentyQuestions.id],
    ['@AI 来玩如果…会怎样', whatIf.id],
    ['@AI 来玩原来我们都一样', commonGround.id],
    ['@AI 来玩三个词', threeWords.id],
  ];
  for (const [text, id] of cases) {
    assert.equal(detectGameCommand(text, null)?.game.id, id, text);
  }

  for (const text of ['@AI 帮我找个话题', '@AI 我们聊点别的', '@AI 你好']) {
    assert.equal(detectGameCommand(text, null), null, text);
  }
});

test('暗牌：只有需要猜词的玩法抽一张，抽到的必须在候选池里', () => {
  assert.equal(pickSecret(thisOrThat), null);
  assert.equal(pickSecret(storyRelay), null);

  for (let i = 0; i < 20; i += 1) {
    const secret = pickSecret(twentyQuestions);
    assert.ok(secret !== null);
    assert.ok(twentyQuestions.secretPool?.includes(secret), secret);
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

  for (const game of GAMES) {
    for (const phase of ['start', 'round', 'end'] as const) {
      const text = gameTask(game, { phase, round: 1, totalRounds: game.totalRounds });
      assert.ok(text.length > 10, `${game.id}/${phase} 任务文案为空`);
    }
  }
});

test('二十问：每一轮都带着同一个暗牌，并明确禁止说出来', () => {
  const state = { phase: 'round' as const, round: 3, totalRounds: 8, secret: '榴莲' };
  const round = gameTask(twentyQuestions, state);
  assert.ok(round.includes('榴莲'));
  assert.ok(round.includes('绝对不要说出'));

  const start = gameTask(twentyQuestions, {
    phase: 'start',
    round: 1,
    totalRounds: 8,
    secret: '榴莲',
  });
  assert.ok(start.includes('榴莲'));

  const end = gameTask(twentyQuestions, { phase: 'end', round: 8, totalRounds: 8, secret: '榴莲' });
  assert.ok(end.includes('榴莲'));
});
