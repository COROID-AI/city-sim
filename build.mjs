/**
 * esbuild-based build pipeline for the city-sim browser bundle.
 *
 * Scripts (package.json):
 *   - `build`      → bundle JS + copy HTML to dist/
 *   - `build:html` → copy only the HTML scaffold to dist/
 *   - `build:all`  → build + build:html
 *   - `dev`        → build then serve dist/ on a static server
 *
 * The output is a single self-contained `dist/bundle.js` plus
 * `dist/index.html`, loadable directly via `file://`.
 */

import * as esbuild from 'esbuild';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const SRC_ENTRY = resolve(ROOT, 'src', 'main.ts');
const HTML_SRC = resolve(ROOT, 'index.html');
const DIST_DIR = resolve(ROOT, 'dist');
const DIST_BUNDLE = resolve(DIST_DIR, 'bundle.js');
const DIST_HTML = resolve(DIST_DIR, 'index.html');

const args = new Set(process.argv.slice(2));
const htmlOnly = args.has('--html-only');
const serve = args.has('--serve');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function ensureDist() {
  if (!existsSync(DIST_DIR)) {
    mkdirSync(DIST_DIR, { recursive: true });
  }
}

function copyHtml() {
  ensureDist();
  copyFileSync(HTML_SRC, DIST_HTML);
  console.log('[html]  copied index.html → dist/index.html');
}

async function bundleJs() {
  ensureDist();
  await esbuild.build({
    entryPoints: [SRC_ENTRY],
    bundle: true,
    minify: !serve,
    sourcemap: true,
    format: 'iife',
    target: ['es2020'],
    outfile: DIST_BUNDLE,
    platform: 'browser',
    logLevel: 'info',
  });
  const sizeKb = (statSync(DIST_BUNDLE).size / 1024).toFixed(1);
  console.log(`[esbuild] bundled → dist/bundle.js (${sizeKb} KB)`);
}

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.map': 'application/json',
  '.css': 'text/css',
};

// ─── Static dev server ───────────────────────────────────────────────────────

function startStaticServer(port = 3000) {
  const server = createServer((req, res) => {
    const url = req.url === '/' ? '/index.html' : req.url;
    const filePath = resolve(DIST_DIR, url.slice(1));

    // Guard against path traversal.
    if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const mime = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(readFileSync(filePath));
  });

  server.listen(port, () => {
    console.log(`[dev]   serving dist/ at http://localhost:${port}`);
  });
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (htmlOnly) {
    copyHtml();
    return;
  }

  await bundleJs();
  copyHtml();

  if (serve) {
    startStaticServer(Number(process.env.PORT ?? 3000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
