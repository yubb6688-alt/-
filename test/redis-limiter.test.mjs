import test from 'node:test';
import assert from 'node:assert/strict';
import { createRedisLimiter } from '../lib/redis-limiter.mjs';

test('Redis limiter sends an atomic per-IP window script and allows the first request', async () => {
  let request;
  const limiter = createRedisLimiter({
    env: { UPSTASH_REDIS_REST_URL: 'https://redis.example/', UPSTASH_REDIS_REST_TOKEN: 'secret' },
    now: () => 1_000_000,
    makeId: () => 'fixed-id',
    fetcher: async (url, options) => {
      request = { url, options };
      return Response.json({ result: [1, 0] });
    },
  });

  assert.deepEqual(await limiter.take('203.0.113.4'), { allowed: true });
  assert.equal(request.url, 'https://redis.example');
  assert.equal(request.options.headers.Authorization, 'Bearer secret');
  const command = JSON.parse(request.options.body);
  assert.equal(command[0], 'EVAL');
  assert.equal(command[2], 1);
  assert.match(command[3], /^seed:start:[a-f0-9]{64}$/);
  assert.equal(command[4], 1_000_000);
  assert.equal(command[5], 600_000);
  assert.equal(command[6], '1000000:fixed-id');
  assert.equal(command[7], 6);
});

test('Redis limiter returns the retry time when the rolling window is full', async () => {
  const limiter = createRedisLimiter({
    env: { UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 'secret' },
    fetcher: async () => Response.json({ result: [0, 147] }),
  });

  assert.deepEqual(await limiter.take('203.0.113.4'), { allowed: false, retryAfter: 147 });
});

test('Redis limiter rejects missing configuration and failed upstream responses', async () => {
  await assert.rejects(createRedisLimiter({ env: {} }).take('203.0.113.4'), /not configured/);
  await assert.rejects(createRedisLimiter({
    env: { UPSTASH_REDIS_REST_URL: 'https://redis.example', UPSTASH_REDIS_REST_TOKEN: 'secret' },
    fetcher: async () => new Response('', { status: 500 }),
  }).take('203.0.113.4'), /request failed/);
});
