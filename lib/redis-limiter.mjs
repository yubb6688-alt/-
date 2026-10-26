import { createHash, randomUUID } from 'node:crypto';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_STARTS = 6;
const SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local cutoff = now - tonumber(ARGV[2])
local member = ARGV[3]
local max = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', key, '-inf', cutoff)
local count = redis.call('ZCARD', key)
if count >= max then
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = math.max(1, math.ceil((tonumber(oldest[2]) + tonumber(ARGV[2]) - now) / 1000))
  return {0, retry}
end
redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, tonumber(ARGV[2]))
return {1, 0}
`;

export function createRedisLimiter({ env = process.env, fetcher = fetch, now = Date.now, makeId = randomUUID } = {}) {
  return {
    async take(ip) {
      const baseUrl = env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
      const token = env.UPSTASH_REDIS_REST_TOKEN;
      if (!baseUrl || !token) throw new Error('Redis rate limiter is not configured.');

      const ipHash = createHash('sha256').update(String(ip)).digest('hex');
      const response = await fetcher(baseUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['EVAL', SCRIPT, 1, `seed:start:${ipHash}`, now(), WINDOW_MS, `${now()}:${makeId()}`, MAX_STARTS]),
      });
      if (!response.ok) throw new Error('Redis rate limiter request failed.');
      const payload = await response.json();
      const result = payload?.result;
      if (!Array.isArray(result) || result.length < 2) throw new Error('Redis rate limiter response was invalid.');
      return result[0] === 1 || result[0] === '1'
        ? { allowed: true }
        : { allowed: false, retryAfter: Math.max(1, Number(result[1]) || 1) };
    },
  };
}
