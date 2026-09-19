import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { ROOT, pairingToken, cacheDir, reportPath } from './config.mjs';

function equalSecret(a, b) { const left = Buffer.from(a || ''); const right = Buffer.from(b || ''); return left.length === right.length && timingSafeEqual(left, right); }
const staticFiles = {
  '/': ['web/index.html', 'text/html'], '/demo': ['web/index.html', 'text/html'],
  '/demo.js': ['web/demo.js', 'text/javascript'], '/demo.css': ['web/demo.css', 'text/css'],
  '/review-ui.js': ['extension/review-ui.js', 'text/javascript'], '/review-ui.css': ['extension/review-ui.css', 'text/css'],
};
export async function startServer({ port = 4731, token, directory = cacheDir(), demoPath = join(ROOT, 'demo/report.json') } = {}) {
  token ||= await pairingToken();
  const server = http.createServer(async (request, response) => {
    const actualPort = server.address()?.port;
    const allowedHost = `127.0.0.1:${actualPort}`;
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; object-src 'none'");
    const reply = (status, body) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.headers.host !== allowedHost) return reply(403, { error: 'Unrecognized local host.' });
    const origin = request.headers.origin;
    if (origin && origin !== `http://${allowedHost}` && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return reply(403, { error: 'Origin not permitted.' });
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Methods', 'GET');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization');
      response.writeHead(204); response.end(); return;
    }
    if (request.method !== 'GET') return reply(405, { error: 'Read-only service.' });
    const path = new URL(request.url, `http://${allowedHost}`).pathname;
    try {
      if (path === '/health') return reply(200, { status: 'ok', app: 'jev-reviewer' });
      if (path === '/api/demo') return reply(200, { ...JSON.parse(await readFile(demoPath, 'utf8')), mode: 'replay' });
      if (staticFiles[path]) {
        const [file, type] = staticFiles[path];
        const data = await readFile(join(ROOT, file));
        response.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); response.end(data); return;
      }
      if (path.startsWith('/api/')) {
        if (!equalSecret(request.headers.authorization, `Bearer ${token}`)) return reply(401, { error: 'Pair the extension using jev-reviewer token.' });
        const match = /^\/api\/reviews\/([\w.-]+)\/([\w.-]+)\/([1-9]\d*)$/.exec(path);
        if (!match) return reply(404, { error: 'Unknown endpoint.' });
        const expectedRepository = `${match[1]}/${match[2]}`;
        const expectedPullRequest = Number(match[3]);
        const report = JSON.parse(await readFile(reportPath(expectedRepository, expectedPullRequest, directory), 'utf8'));
        if (
          !report || typeof report !== 'object' || Array.isArray(report) ||
          String(report.repository || '').toLowerCase() !== expectedRepository.toLowerCase() ||
          Number(report.pullRequest) !== expectedPullRequest
        ) throw new Error('Cached report identity mismatch.');
        return reply(200, report);
      }
      reply(404, { error: 'Not found.' });
    } catch (error) {
      reply(error.code === 'ENOENT' ? 404 : 500, { error: error.code === 'ENOENT' ? 'No report yet. The coding agent must finish the review step.' : 'Could not load the local report.' });
    }
  });
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', accept); });
  return server;
}
