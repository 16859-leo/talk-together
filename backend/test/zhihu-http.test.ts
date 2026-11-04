import assert from 'node:assert/strict';
import test from 'node:test';
import { ZhihuHttpClient } from '../src/infrastructure/zhihu/http-client.ts';
import { CapabilityError } from '../src/infrastructure/zhihu/types.ts';

interface Captured {
  url: string;
  headers: Record<string, string>;
}

function fakeFetch(
  envelope: unknown,
  options: { status?: number; capture?: Captured[] } = {},
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    options.capture?.push({ url, headers });
    return new Response(JSON.stringify(envelope), {
      status: options.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

test('搜索：查询参数与鉴权头正确，字段映射到内部结构', async () => {
  const captured: Captured[] = [];
  const client = new ZhihuHttpClient({
    accessSecret: 'secret-1',
    fetchImpl: fakeFetch(
      {
        Code: 0,
        Data: {
          Items: [
            { Title: ' 电影推荐 ', ContentText: ' 摘要 ', Url: ' https://zhihu.com/a ', AuthorName: ' 小周 ' },
            { Title: '', ContentText: 'x', Url: 'https://zhihu.com/b' },
          ],
        },
      },
      { capture: captured },
    ),
  });

  const items = await client.searchZhihu('电影', 99);

  assert.equal(items.length, 1);
  assert.deepEqual(items[0], {
    title: '电影推荐',
    contentText: '摘要',
    url: 'https://zhihu.com/a',
    authorName: '小周',
  });

  const request = captured[0];
  assert.ok(request !== undefined);
  assert.match(request.url, /\/api\/v1\/content\/zhihu_search\?/);
  assert.match(request.url, /Query=%E7%94%B5%E5%BD%B1/);
  assert.match(request.url, /Count=10/); // 服务端上限 10，超出被截断
  assert.equal(request.headers['authorization'], 'Bearer secret-1');
  assert.match(request.headers['x-request-timestamp'] ?? '', /^\d+$/);
});

test('热榜：Limit 上限 30，映射为 title/summary/url', async () => {
  const captured: Captured[] = [];
  const client = new ZhihuHttpClient({
    accessSecret: 'secret-1',
    fetchImpl: fakeFetch(
      {
        Code: 0,
        Data: { Items: [{ Title: '热搜', Summary: '摘要', Url: 'https://zhihu.com/hot' }] },
      },
      { capture: captured },
    ),
  });

  const items = await client.getHotList(100);
  assert.deepEqual(items, [{ title: '热搜', summary: '摘要', url: 'https://zhihu.com/hot' }]);
  assert.match(captured[0]?.url ?? '', /\/hot_list\?/);
  assert.match(captured[0]?.url ?? '', /Limit=30/);
});

test('频率限制映射为 AI_RATE_LIMITED 并带 retryAfterMs', async () => {
  const client = new ZhihuHttpClient({
    accessSecret: 'secret-1',
    fetchImpl: fakeFetch({ Code: 30001, Message: 'rate limited' }),
  });

  await assert.rejects(
    () => client.getHotList(5),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.code, 'AI_RATE_LIMITED');
      assert.equal(error.retryAfterMs, 60_000);
      return true;
    },
  );
});

test('鉴权失败映射为 AI_UNAVAILABLE', async () => {
  const client = new ZhihuHttpClient({
    accessSecret: 'bad',
    fetchImpl: fakeFetch({ Code: 20001, Message: 'auth failed' }),
  });

  await assert.rejects(
    () => client.searchZhihu('x', 1),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.code, 'AI_UNAVAILABLE');
      return true;
    },
  );
});

test('HTTP 非 2xx 不抛原始异常，包装成 CapabilityError', async () => {
  const client = new ZhihuHttpClient({
    accessSecret: 'secret-1',
    fetchImpl: fakeFetch({}, { status: 502 }),
  });

  await assert.rejects(
    () => client.getHotList(3),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.code, 'AI_UNAVAILABLE');
      return true;
    },
  );
});

test('已取消的 signal 直接抛 AI_CANCELLED，不发请求', async () => {
  let called = false;
  const client = new ZhihuHttpClient({
    accessSecret: 'secret-1',
    fetchImpl: (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch,
  });

  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => client.getHotList(3, controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof CapabilityError);
      assert.equal(error.code, 'AI_CANCELLED');
      return true;
    },
  );
  assert.equal(called, false);
});
