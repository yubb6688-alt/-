import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { handleApi } from './lib/api.mjs';
import { createLimiter } from './lib/limiter.mjs';

await mkdir(new URL('./.data/', import.meta.url), { recursive: true });
const limiter = createLimiter(fileURLToPath(new URL('./.data/limits.sqlite', import.meta.url)));
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/select-menu.js', ['select-menu.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ['/metal.css', ['metal.css', 'text/css; charset=utf-8']],
  ['/liquid-metal.js', ['liquid-metal.js', 'text/javascript; charset=utf-8']],
  ['/hero-liquid-reference.png', ['hero-liquid-reference.png', 'image/png']],
  ['/hero-liquid-cover.webp', ['hero-liquid-cover.webp', 'image/webp']],
  ['/hero-liquid-cover.jpg', ['hero-liquid-cover.jpg', 'image/jpeg']],
  ['/logo.svg', ['logo.svg', 'image/svg+xml']],
  ['/sprout.svg', ['sprout.svg', 'image/svg+xml']],
]);
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; media-src https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'; form-action 'self'");
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      let ip = req.socket.remoteAddress || 'unknown';
      if (process.env.TRUST_PROXY === 'true') {
        const forwarded = req.headers['x-forwarded-for']?.split(',')[0].trim();
        if (forwarded && isIP(forwarded)) ip = forwarded;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8192) { res.writeHead(413, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: '请求内容过长。' })); return; }
        chunks.push(chunk);
      }
      const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, ...(!['GET', 'HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await handleApi(request, { env: process.env, ip, limiter });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const asset = assets.get(path);
    if (!asset || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end('Not found'); return; }
    const data = await readFile(new URL(`./public/${asset[0]}`, import.meta.url));
    res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: '服务暂时不可用。' }));
  }
});
server.requestTimeout = 45000;
server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => console.log(`Local: http://localhost:${process.env.PORT || 3000}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { limiter.close(); process.exit(0); }));
