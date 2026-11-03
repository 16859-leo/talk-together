/**
 * infrastructure/zhihu 离线测试。
 * 全部使用假数据源与本地 fixture，不消耗任何外部额度。
 *
 * 运行：npm test --prefix backend
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { screenHotItems, isIcebreakingTitle } from '../src/infrastructure/zhihu/screening.ts';
import { pickFallbackTopics, fallbackTopicCount } from '../src/infrastructure/zhihu/fallback.ts';
import { ZhihuTopicSource } from '../src/infrastructure/zhihu/topic-source.ts';
import { CapabilityError, isNonBlankText } from '../src/infrastructure/zhihu/types.ts';
import type {
  ZhihuContentSource,
  ZhihuHotItem,
  ZhihuSearchItem,
} from '../src/infrastructure/zhihu/types.ts';

const here = dirname(fileURLToPath(import.meta.url));

interface RawHot {
  readonly Data: { readonly Items: readonly { Title: string; Summary: string; Url: string }[] };
}

/** 真实热榜样本（2026-11-03 抓取的 30 条），用于回归筛选规则。 */
function loadHotFixture(): readonly ZhihuHotItem[] {
  const raw = JSON.parse(
    readFileSync(join(here, 'fixtures', 'hot-sample.json'), 'utf8'),
  ) as RawHot;
  return raw.Data.Items.map((i) => ({ title: i.Title, summary: i.Summary, url: i.Url }));
}

class FakeSource implements ZhihuContentSource {
  hotCalls = 0;
  searchCalls = 0;
  readonly #hot: readonly ZhihuHotItem[];
  readonly #search: readonly ZhihuSearchItem[];
  readonly #failure: CapabilityError | null;

  constructor(
    hot: readonly ZhihuHotItem[] = [],
    search: readonly ZhihuSearchItem[] = [],
    failure: CapabilityError | null = null,
  ) {
    this.#hot = hot;
    this.#search = search;
    this.#failure = failure;
  }

  async searchZhihu(): Promise<readonly ZhihuSearchItem[]> {
    this.searchCalls += 1;
    if (this.#failure !== null) throw this.#failure;
    return this.#search;
  }

  async getHotList(): Promise<readonly ZhihuHotItem[]> {
    this.hotCalls += 1;
    if (this.#failure !== null) throw this.#failure;
    return this.#hot;
  }
}

// ---------- 适宜性筛选 ----------

test('筛选：真实 30 条热榜样本不会选出争议性话题', () => {
  const items = loadHotFixture();
  const { accepted, rejected } = screenHotItems(items);

  assert.equal(items.length, 30);
  assert.ok(accepted.length >= 1, '应至少保留一条可用话题');
  assert.equal(accepted.length + rejected.length, 30);

  const titles = accepted.map((a) => a.item.title).join(' | ');
  // 这些是样本中的真实争议/垂直条目，必须被排除
  assert.ok(!titles.includes('九寨沟'), '冲突类话题应被排除');
  assert.ok(!titles.includes('中期选举'), '时政类话题应被排除');
  assert.ok(!titles.includes('彩票'), '诉讼类话题应被排除');
  assert.ok(!titles.includes('销量'), '行业数据类话题应被排除');
  assert.ok(!titles.includes('论文'), '造假类话题应被排除');
});

test('筛选：最适合破冰的条目排在首位', () => {
  const { accepted } = screenHotItems(loadHotFixture());
  const first = accepted[0];
  assert.ok(first !== undefined);
  // 样本中唯一的经历分享类话题
  assert.ok(first.item.title.includes('遗憾'), `首位应为经历分享类，实际：${first.item.title}`);
});

test('筛选：与破冰无关的话题即使不涉敏也被排除', () => {
  const { accepted, rejected } = screenHotItems([
    { title: '如何评价某款显卡的架构设计？', summary: '', url: 'https://example.com/1' },
    { title: '你小时候最喜欢玩什么？', summary: '', url: 'https://example.com/2' },
  ]);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0]?.item.title, '你小时候最喜欢玩什么？');
  assert.equal(rejected[0]?.reason, 'vertical');
});

test('筛选：空白标题被排除', () => {
  const { accepted, rejected } = screenHotItems([
    { title: '   ', summary: '', url: 'https://example.com/1' },
  ]);
  assert.equal(accepted.length, 0);
  assert.equal(rejected[0]?.reason, 'blank_title');
});

test('筛选：资料贴被排除（真实缺陷回归）', () => {
  // 搜索「摄影」实际返回过这条课程讲义
  const cases = [
    'UCB CS180/280A 计算机视觉与计算摄影 第三讲 捕捉光线 眼睛与机器',
    '全球八大知名帐篷品牌及其产品，野外露营的最佳选择',
    '野外露营需要准备哪些东西？2026年户外露营装备攻略',
  ];
  for (const title of cases) {
    assert.equal(isIcebreakingTitle(title).ok, false, `应被排除：${title}`);
  }
});

test('筛选：可聊的提问不受资料贴规则误伤', () => {
  const cases = [
    '你们都在哪儿拍过最满意的照片？',
    '秋季带娃露营，有没有什么好去处可以分享？',
    '长大以后，你弥补了哪些小时候的遗憾？',
  ];
  for (const title of cases) {
    assert.equal(isIcebreakingTitle(title).ok, true, `不应被排除：${title}`);
  }
});

// ---------- 备用话题池 ----------

test('备用池：按兴趣标签匹配并标记为 common', () => {
  const topics = pickFallbackTopics(['电影', '音乐'], 3);
  assert.equal(topics.length, 3);
  assert.equal(topics[0]?.kind, 'common');
  assert.ok(topics.some((t) => /电影|音乐|听/.test(t.title)));
});

test('备用池：无兴趣标签时返回通用话题', () => {
  const topics = pickFallbackTopics([], 2);
  assert.equal(topics.length, 2);
  assert.equal(topics[0]?.kind, 'popular');
});

test('备用池：所有话题满足契约 NonBlankText 约束', () => {
  const topics = pickFallbackTopics([], fallbackTopicCount);
  assert.equal(topics.length, fallbackTopicCount);
  for (const topic of topics) {
    assert.ok(isNonBlankText(topic.title), `title 必须非空白：${topic.title}`);
    assert.ok(isNonBlankText(topic.content), `content 必须非空白：${topic.title}`);
  }
});

// ---------- 缓存与额度保护 ----------

test('缓存：热榜在 TTL 内只调用上游一次', async () => {
  const fake = new FakeSource(loadHotFixture());
  let clock = 1_000;
  const source = new ZhihuTopicSource(fake, { hotCacheTtlMs: 60_000, now: () => clock });

  await source.getPopularTopics();
  clock += 30_000;
  await source.getPopularTopics();

  assert.equal(fake.hotCalls, 1, 'TTL 内不应重复调用上游');
  assert.equal(source.stats.hotCalls, 1);
});

test('缓存：TTL 过期后重新取用', async () => {
  const fake = new FakeSource(loadHotFixture());
  let clock = 1_000;
  const source = new ZhihuTopicSource(fake, { hotCacheTtlMs: 60_000, now: () => clock });

  await source.getPopularTopics();
  clock += 61_000;
  await source.getPopularTopics();

  assert.equal(fake.hotCalls, 2);
});

test('并发去重：同时请求热榜只打一次上游', async () => {
  const fake = new FakeSource(loadHotFixture());
  const source = new ZhihuTopicSource(fake);

  await Promise.all([
    source.getPopularTopics(),
    source.getPopularTopics(),
    source.getPopularTopics(),
  ]);

  assert.equal(fake.hotCalls, 1, '并发请求应合并为一次调用');
});

// ---------- 降级 ----------

test('降级：知乎不可用时回落备用池，不抛错', async () => {
  const fake = new FakeSource([], [], new CapabilityError('AI_UNAVAILABLE', '模拟不可用'));
  const source = new ZhihuTopicSource(fake);

  const topics = await source.getPopularTopics({ interestTags: ['电影'] });
  assert.ok(topics.length > 0, '必须回落备用话题，保证基础聊天不受影响');
  assert.equal(topics[0]?.sourceUrl, null);
});

test('降级：热榜筛选后为空时回落备用池', async () => {
  const fake = new FakeSource([
    { title: '网传某地发生冲突，警方通报情况', summary: '', url: 'https://example.com/1' },
  ]);
  const source = new ZhihuTopicSource(fake);

  const topics = await source.getPopularTopics();
  assert.ok(topics.length > 0);
  assert.equal(topics[0]?.sourceLabel, null, '应来自备用池');
});

test('降级：搜索无结果时回落备用池', async () => {
  const fake = new FakeSource([], []);
  const source = new ZhihuTopicSource(fake);

  const topics = await source.searchCommonTopics('露营', { interestTags: ['露营'] });
  assert.ok(topics.length > 0);
});

test('取消：AI_CANCELLED 向上抛出，不被降级吞掉', async () => {
  const fake = new FakeSource([], [], new CapabilityError('AI_CANCELLED', '已取消'));
  const source = new ZhihuTopicSource(fake);

  await assert.rejects(
    () => source.getPopularTopics(),
    (error: unknown) => error instanceof CapabilityError && error.code === 'AI_CANCELLED',
  );
});

// ---------- 产出结构 ----------

test('产出：搜索结果标记为 common 并带知乎来源', async () => {
  const fake = new FakeSource([], [
    {
      title: '有什么适合周末去的露营地？',
      contentText: '推荐几个交通方便、设施齐全的营地。',
      url: 'https://www.zhihu.com/question/1',
      authorName: '某用户',
    },
  ]);
  const source = new ZhihuTopicSource(fake);

  const topics = await source.searchCommonTopics('露营');
  assert.equal(topics.length, 1);
  assert.equal(topics[0]?.kind, 'common');
  assert.equal(topics[0]?.sourceLabel, '知乎 · 某用户');
  assert.equal(topics[0]?.sourceUrl, 'https://www.zhihu.com/question/1');
});

test('产出：热榜结果标记为 popular 且字段满足 NonBlankText', async () => {
  const fake = new FakeSource(loadHotFixture());
  const source = new ZhihuTopicSource(fake);

  const topics = await source.getPopularTopics();
  for (const topic of topics) {
    assert.equal(topic.kind, 'popular');
    assert.ok(isNonBlankText(topic.title));
    assert.ok(isNonBlankText(topic.content));
    assert.equal(topic.sourceLabel, '知乎热榜');
  }
});

test('产出：空关键词直接回落，不调用上游', async () => {
  const fake = new FakeSource();
  const source = new ZhihuTopicSource(fake);

  const topics = await source.searchCommonTopics('   ', { interestTags: ['读书'] });
  assert.ok(topics.length > 0);
  assert.equal(fake.searchCalls, 0, '空关键词不应浪费额度');
});
