import test from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, readRunId, validate, PRODUCTS, WANTS } from '../lib/api.mjs';
import { createLimiter } from '../lib/limiter.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const body = { product: PRODUCTS[0], campaign: '双 11', audience: '养猫的上班族', want: WANTS[0], shot: '' };
const env = { ACCESS_CODE: 'test-only-code', DIFY_API_KEY: 'test-only-key' };
function request(path = '/api/start', data = body, code = env.ACCESS_CODE) {
  return new Request(`http://localhost${path}`, { method: path.startsWith('/api/start') ? 'POST' : 'GET', headers: { 'X-Access-Code': code, 'Content-Type': 'application/json' }, ...(path.startsWith('/api/start') ? { body: JSON.stringify(data) } : {}) });
}
function context(fetcher) { return { env, ip: '192.0.2.1', limiter: { take: () => ({ allowed: true }) }, fetcher }; }

test('accepts exactly the five products and three output choices; trims/defaults values', () => {
  for (const product of PRODUCTS) for (const want of WANTS) assert.equal(validate({ ...body, product, want }).product, product);
  assert.equal(validate({ ...body, campaign: ' ', audience: ' 小户型 ' }).campaign, '双 11');
  assert.equal(validate({ ...body, audience: ' 小户型 ' }).audience, '小户型');
});
test('rejects unknown enums, empty audience, wrong types and overlong inputs', () => {
  for (const patch of [{ product: 'unknown' }, { want: 'unknown' }, { audience: '  ' }, { audience: [] }, { audience: '人'.repeat(61) }, { shot: '镜'.repeat(501) }, { campaign: 'x'.repeat(101) }]) assert.throws(() => validate({ ...body, ...patch }));
  assert.throws(() => validate(null));
  assert.equal(validate({ ...body, audience: '猫'.repeat(60), shot: '镜'.repeat(500) }).shot.length, 500);
});
test('both endpoints reject a bad access code before calling Dify', async () => {
  for (const path of ['/api/start', '/api/status?id=run-1']) {
    const response = await handleApi(request(path, body, 'wrong'), context(() => assert.fail('must not call Dify')));
    assert.equal(response.status, 401);
  }
});
test('missing runtime credentials fail closed', async () => {
  for (const missing of ['ACCESS_CODE', 'DIFY_API_KEY']) {
    const response = await handleApi(request(), { ...context(), env: { ...env, [missing]: '' } });
    assert.equal(response.status, 503);
  }
});
test('SSE tolerates split UTF-8, comments, pings and CRLF; cancels immediately after ID', async () => {
  let cancelled = false;
  const bytes = new TextEncoder().encode(': heartbeat\r\n\r\ndata: {"event":"ping"}\r\n\r\ndata: {"event":"workflow_started","name":"中文","workflow_run_id":"run-123"}\r\n\r\n');
  const stream = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); }, cancel() { cancelled = true; } });
  assert.equal(await readRunId(new Response(stream)), 'run-123');
  assert.equal(cancelled, true);
});
test('SSE reports missing ID and error events', async () => {
  await assert.rejects(readRunId(new Response('data: {"event":"ping"}\n\n')));
  await assert.rejects(readRunId(new Response('data: {"event":"error"}\n\n')));
  await assert.rejects(readRunId(new Response('data: invalid-json\n\n')));
});
test('start sends exact Dify contract and exposes only run ID', async () => {
  let upstream;
  const response = await handleApi(request(), context(async (url, options) => {
    upstream = { url, options };
    return new Response('data: {"workflow_run_id":"run-42"}\n\n');
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { id: 'run-42' });
  assert.equal(upstream.url, 'https://api.dify.ai/v1/workflows/run');
  assert.equal(upstream.options.headers.Authorization, 'Bearer test-only-key');
  assert.deepEqual(JSON.parse(upstream.options.body), { inputs: body, response_mode: 'streaming', user: 'web-192.0.2.1' });
  assert.equal(upstream.options.signal.aborted, true);
});
test('status maps elapsed_time and forwards outputs without evaluating result', async () => {
  const outputs = { result: '{"xhs":{"title":"<script>bad</script>"}}' };
  const response = await handleApi(request('/api/status?id=run-42'), context(async url => {
    assert.equal(url, 'https://api.dify.ai/v1/workflows/run/run-42');
    return Response.json({ status: 'succeeded', elapsed_time: 13.5, outputs });
  }));
  assert.deepEqual(await response.json(), { status: 'succeeded', elapsed: 13.5, error: null, outputs });
});
test('invalid IDs cannot alter upstream paths', async () => {
  for (const id of ['', '../private', 'a/b', 'x?y', 'a'.repeat(201)]) {
    const response = await handleApi(request(`/api/status?id=${encodeURIComponent(id)}`), context(() => assert.fail()));
    assert.equal(response.status, 400);
  }
});
test('upstream failures return a safe error without echoing upstream secrets', async () => {
  const response = await handleApi(request(), context(async () => new Response(env.DIFY_API_KEY, { status: 500 })));
  assert.equal(response.status, 502);
  assert.equal((await response.text()).includes(env.DIFY_API_KEY), false);
});
test('SQLite sliding window allows six, isolates IPs, survives reopen and expires exactly at ten minutes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zhongcao-test-'));
  let time = 1000000;
  let limiter = createLimiter(join(dir, 'limit.sqlite'), () => time);
  try {
    for (let i = 0; i < 6; i++) assert.equal(limiter.take('ip-a').allowed, true);
    assert.deepEqual(limiter.take('ip-a'), { allowed: false, retryAfter: 600 });
    assert.equal(limiter.take('ip-b').allowed, true);
    limiter.close(); limiter = createLimiter(join(dir, 'limit.sqlite'), () => time);
    assert.equal(limiter.take('ip-a').allowed, false);
    time += 599999; assert.equal(limiter.take('ip-a').allowed, false);
    time += 1; assert.equal(limiter.take('ip-a').allowed, true);
  } finally { limiter.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('seventh start gets 429 and Retry-After without an upstream call', async () => {
  const limiter = createLimiter(); let calls = 0;
  try {
    const ctx = { ...context(async () => { calls++; return new Response('data: {"workflow_run_id":"run-1"}\n\n'); }), limiter };
    for (let i = 0; i < 6; i++) assert.equal((await handleApi(request(), ctx)).status, 200);
    const response = await handleApi(request(), ctx);
    assert.equal(response.status, 429); assert.ok(Number(response.headers.get('Retry-After')) > 0); assert.equal(calls, 6);
  } finally { limiter.close(); }
});
