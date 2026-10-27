import { handleApi } from './api.mjs';
import { createRedisLimiter } from './redis-limiter.mjs';

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; media-src https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'",
};

export function createNetlifyHandler({ env = process.env, limiter = createRedisLimiter({ env }), fetcher = fetch } = {}) {
  return async function handler(request, context) {
    let response;
    try {
      // Netlify bounds the full payload; retain our stricter 8 KiB API limit.
      if (!['GET', 'HEAD'].includes(request.method)) {
        const body = await request.arrayBuffer();
        if (body.byteLength > 8192) {
          response = Response.json({ error: '请求内容过长。' }, { status: 413 });
        } else {
          request = new Request(request.url, { method: request.method, headers: request.headers, body });
        }
      }
      // Use the platform's client address, never a caller-supplied forwarding header.
      response ??= await handleApi(request, { env, ip: context.ip || 'unknown', limiter, fetcher });
    } catch {
      response = Response.json({ error: '服务暂时不可用。' }, { status: 500 });
    }
    for (const [name, value] of Object.entries(securityHeaders)) response.headers.set(name, value);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}
