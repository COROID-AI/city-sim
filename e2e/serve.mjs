/**
 * Minimal static file server for the Playwright e2e tests.
 *
 * Serves the Next.js static export from `dist/` on port 4173 so that
 * Playwright can test the production build without a full Next.js server.
 * Uses only Node's built-in `http` and `fs` modules — no external deps.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const PORT = 4173;
const DIST_DIR = join(process.cwd(), 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
    let filePath = normalize(decodeURIComponent(url.pathname));

    // Prevent path traversal
    if (!filePath.startsWith('/')) {
      filePath = '/' + filePath;
    }

    let absPath = join(DIST_DIR, filePath);

    // If the path is a directory, try index.html
    try {
      const s = await stat(absPath);
      if (s.isDirectory()) {
        absPath = join(absPath, 'index.html');
      }
    } catch {
      // Not a directory or doesn't exist — try as file with .html extension
      if (!extname(absPath)) {
        absPath = absPath + '.html';
      }
    }

    const data = await readFile(absPath);
    const mime = MIME[extname(absPath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}`);
});
