import test from 'node:test';
import assert from 'node:assert/strict';
import { createNetlifyHandler } from '../lib/netlify-handler.mjs';
import { config } from '../netlify/functions/seed-api.mjs';

const env = { ACCESS_CODE: 'fixture-code', DIFY_API_KEY: 'fixture-key' };
const input = { product: 'T20 Pro 月白', audience: '养猫的上班族', want: '只要文案' };
const request = (path, body, code = env.ACCESS_CODE) => new Request(`https://fixture.netlify.app${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'X-Access-Code': code, 'Content-Type': 'application/json', 'X-Forwarded-For': 'spoofed-address' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('Netlify start uses trusted client IP and status preserves the same run ID', async () => {
  let starts = 0;
  const handler = createNetlifyHandler({ env,
    limiter: { take(ip) { assert.equal(ip, '192.0.2.8'); return { allowed: true }; } },
    fetcher: async (url, options) => {
      if (options.method === 'POST') {
        starts++;
        assert.equal(JSON.parse(options.body).user, 'web-192.0.2.8');
        return new Response('data: {"workflow_run_id":"fixture-run"}\n\n');
      }
      assert.equal(url, 'https://api.dify.ai/v1/workflows/run/fixture-run');
      return Response.json({ status: 'succeeded', outputs: { result: 'fixture result' } });
    },
  });
  assert.deepEqual(config.path, ['/api/start', '/api/status']);
  const start = await handler(request('/api/start', input), { ip: '192.0.2.8' });
  assert.deepEqual(await start.json(), { id: 'fixture-run' });
  const status = await handler(request('/api/status?id=fixture-run'), { ip: '192.0.2.8' });
  assert.equal((await status.json()).status, 'succeeded');
  assert.equal(starts, 1);
  assert.equal(status.headers.get('Cache-Control'), 'no-store');
  assert.equal(status.headers.get('X-Content-Type-Options'), 'nosniff');
});

test('Netlify rejects unauthorized and oversized requests without starting a task', async () => {
  const handler = createNetlifyHandler({ env,
    limiter: { take() { assert.fail('must not call limiter'); } },
    fetcher() { assert.fail('must not call Dify'); },
  });
  for (const path of config.path) {
    const response = await handler(request(path, path.endsWith('start') ? input : undefined, 'wrong'), { ip: '192.0.2.8' });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  }
  const oversized = await handler(request('/api/start', { audience: '人'.repeat(3000) }), { ip: '192.0.2.8' });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get('Cache-Control'), 'no-store');
});
