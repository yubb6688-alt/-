export const PRODUCTS = ['T20 Pro 月白', 'T20 Pro 曜石黑', 'T10 月白', 'S1 Max 标准版', 'S1 Max 上下水版'];
export const WANTS = ['文案 + 配图 + 视频', '文案 + 配图', '只要文案'];
const BASE = 'https://api.dify.ai/v1';
const json = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...extra } });

export function validate(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('请输入完整的生成需求。');
  const { product, want } = body;
  if (!PRODUCTS.includes(product)) throw new Error('请选择列表中的商品。');
  if (!WANTS.includes(want)) throw new Error('请选择有效的生成内容。');
  const field = (key, max, fallback = '') => {
    const value = body[key] ?? fallback;
    if (typeof value !== 'string' || [...value.trim()].length > max) throw new Error(`${key === 'audience' ? '目标人群' : key === 'shot' ? '视频镜头要求' : '活动'}最多 ${max} 字。`);
    return value.trim();
  };
  const audience = field('audience', 60);
  if (!audience) throw new Error('请填写目标人群。');
  return { product, campaign: field('campaign', 100, '双 11') || '双 11', audience, want, shot: field('shot', 500) };
}

// A complete SSE frame may span chunks, contain comments, or use CRLF line endings.
export async function readRunId(response) {
  if (!response.body) throw new Error('Dify 没有返回事件流。');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 1024 * 1024) throw new Error('Dify 事件流异常。');
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event;
        try { event = JSON.parse(data); } catch { throw new Error('Dify 返回了无效事件。'); }
        const id = event.workflow_run_id;
        if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(id)) return id;
        if (event.event === 'error') throw new Error('Dify 启动失败，请检查工作流配置。');
      }
      if (done) throw new Error('Dify 没有返回任务 ID。');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function handleApi(request, { env, ip, limiter, fetcher = fetch }) {
  const url = new URL(request.url);
  if (!['/api/start', '/api/status'].includes(url.pathname)) return json({ error: '接口不存在。' }, 404);
  if (!env.ACCESS_CODE) return json({ error: '服务尚未配置访问口令。' }, 503);
  if (request.headers.get('X-Access-Code') !== env.ACCESS_CODE) return json({ error: '口令不正确，请重新输入。' }, 401);
  const method = url.pathname === '/api/start' ? 'POST' : 'GET';
  if (request.method !== method) return json({ error: '请求方法不正确。' }, 405, { Allow: method });
  if (!env.DIFY_API_KEY) return json({ error: '服务尚未配置 Dify API Key，请联系管理员。' }, 503);
  let inputs;
  if (method === 'POST') {
    if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: '请使用 JSON 请求。' }, 415);
    // Apply the limit before parsing so malformed authenticated attempts also count.
    const limit = await limiter.take(ip);
    if (!limit.allowed) return json({ error: '操作有点频繁，同一 IP 每 10 分钟最多生成 6 次，请稍后再试。' }, 429, { 'Retry-After': String(limit.retryAfter) });
    try {
      const raw = await request.text();
      if (new TextEncoder().encode(raw).length > 8192) return json({ error: '请求内容过长。' }, 413);
      inputs = validate(JSON.parse(raw));
    } catch (error) { return json({ error: error instanceof SyntaxError ? '请求 JSON 格式不正确。' : error.message }, 400); }
  } else if (!/^[a-zA-Z0-9_-]{1,200}$/.test(url.searchParams.get('id') || '')) {
    return json({ error: '任务 ID 不正确。' }, 400);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), method === 'POST' ? 30000 : 15000);
  try {
    const upstream = await fetcher(method === 'POST' ? `${BASE}/workflows/run` : `${BASE}/workflows/run/${encodeURIComponent(url.searchParams.get('id'))}`, {
      method,
      headers: { Authorization: `Bearer ${env.DIFY_API_KEY}`, 'Content-Type': 'application/json' },
      ...(inputs ? { body: JSON.stringify({ inputs, response_mode: 'streaming', user: `web-${ip}` }) } : {}),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      await upstream.body?.cancel();
      return json({ error: upstream.status === 404 ? '未找到该生成任务。' : 'Dify 服务请求失败，请稍后重试或检查服务端配置。' }, upstream.status === 404 ? 404 : 502);
    }
    if (method === 'POST') {
      const id = await readRunId(upstream);
      controller.abort();
      return json({ id });
    }
    const data = await upstream.json();
    return json({ status: data.status, elapsed: data.elapsed_time ?? data.elapsed ?? 0, error: data.error ?? null, outputs: data.outputs ?? null });
  } catch (error) {
    return json({ error: controller.signal.aborted ? 'Dify 请求超时，请稍后重试。' : 'Dify 服务暂时不可用，请检查工作流配置后重试。' }, controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); }
}
