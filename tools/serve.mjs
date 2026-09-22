#!/usr/bin/env node
/**
 * tools/serve.mjs — dependency-free static server for the single-file deliverable.
 *
 * DEV-ONLY. Not part of the product. `rocket-launch.html` is a standalone file that also works when
 * opened straight from disk (file://); this server only exists so that automated live/browser
 * verification harnesses (which need an HTTP origin) can load and screenshot the very same file
 * without installing anything. Node builtins only: no package manager, no framework, no network.
 *
 * Usage:
 *   node tools/serve.mjs                 # serve the repository root on 127.0.0.1:8080
 *   PORT=5200 node tools/serve.mjs       # the harness-owned port is honoured when provided
 *   node tools/serve.mjs --port 5200     # explicit port
 *   node tools/serve.mjs --root <dir>    # serve another directory (must contain rocket-launch.html)
 *
 * Routes:
 *   /                      -> rocket-launch.html
 *   /rocket-launch.html    -> rocket-launch.html (query strings such as ?t0=8&nofx=1 pass through)
 *
 * Behaviour:
 *   * binds loopback only (127.0.0.1) — never 0.0.0.0/::;
 *   * read-only, path-traversal safe, `no-store` responses so every probe sees a fresh page;
 *   * prints one `ROCKET_SERVE_READY http://...` line once it is listening (readiness signal);
 *   * exits cleanly on SIGINT/SIGTERM (and with `--once-exit-ms` for a bounded self-test).
 */

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..');

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const ENTRY = 'rocket-launch.html';
const PORT = Number(argValue('--port') || process.env.PORT || 8080);
const HOST = argValue('--host') || '127.0.0.1';
const ROOT = path.resolve(argValue('--root') || REPO_ROOT);
const EXIT_AFTER_MS = Number(argValue('--once-exit-ms') || 0);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function resolveTarget(pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = `/${ENTRY}`;
  // strip any traversal segments before joining with the served root
  rel = rel.replace(/\\/g, '/').split('/').filter((seg) => seg && seg !== '.' && seg !== '..').join('/');
  const target = path.join(ROOT, rel);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return null;
  return target;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    res.end('method not allowed\n');
    return;
  }
  let url;
  try {
    url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request\n');
    return;
  }
  if (url.pathname === '/favicon.ico') {
    // no favicon in a single-file product: answer 204 so probes never log a 404 console error
    res.writeHead(204, { 'cache-control': 'no-store' });
    res.end();
    return;
  }
  const target = resolveTarget(url.pathname);
  const stat = target ? statSync(target, { throwIfNoEntry: false }) : null;
  if (!target || !stat || !stat.isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`not found: ${url.pathname}\n`);
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  const stream = createReadStream(target);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
});

server.on('error', (err) => {
  console.error(`ROCKET_SERVE_ERROR ${err.code || err.message}`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`ROCKET_SERVE_READY http://${HOST}:${port}/${ENTRY} (root ${ROOT})`);
});

if (EXIT_AFTER_MS > 0) setTimeout(() => server.close(() => process.exit(0)), EXIT_AFTER_MS);

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
