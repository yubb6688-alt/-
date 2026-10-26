import { handleApi } from '../lib/api.mjs';
import { createRedisLimiter } from '../lib/redis-limiter.mjs';

const limiter = createRedisLimiter();

export default async function handler(req, res) {
  for (const [name, value] of Object.entries({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; media-src https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
  })) res.setHeader(name, value);

  try {
    const chunks = [];
    let size = 0;
    if (!['GET', 'HEAD'].includes(req.method)) {
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) {
          res.statusCode = 413;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: '请求内容过长。' }));
          return;
        }
        chunks.push(chunk);
      }
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
    }
    const request = new Request(new URL(req.url, `https://${req.headers.host || 'localhost'}`), {
      method: req.method,
      headers,
      ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}),
    });
    const forwarded = headers.get('x-forwarded-for')?.split(',')[0].trim();
    const ip = headers.get('x-real-ip') || forwarded || 'unknown';
    const response = await handleApi(request, { env: process.env, ip, limiter });
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: '服务暂时不可用。' }));
  }
}
