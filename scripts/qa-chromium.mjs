/**
 * qa-chromium.mjs — real-browser QA driver (no bundler, no build step).
 *
 * Serves the repository over HTTP (ES modules same-origin), launches the
 * system Chromium in headless mode, loads index.html, and returns a handle
 * for asserting the briefed acceptance surface and capturing screenshots.
 *
 * The child chromium is driven over its DevTools protocol (--remote-debugging-
 * port), so no npm dependency is required: node + any chromium binary is all
 * that is needed. Usage is internal to the repository QA scripts only.
 */

import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { statSync, createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

let portCounter = 8760;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Detect an installed Chromium binary. */
function findChromium() {
  for (const bin of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'chrome']) {
    try {
      const p = execSync(`command -v ${bin}`).toString().trim();
      if (p) return p;
    } catch {
      // Keep looking.
    }
  }
  return '/usr/bin/chromium';
}

/**
 * Start a tiny static file server rooted at the repository.
 * @returns {Promise<{url: string, port: number, close: () => void}>}
 */
export async function startStaticServer() {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  const server = createServer((req, res) => {
    try {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let filePath = normalize(join(ROOT, urlPath));
      if (!filePath.startsWith(ROOT)) {
        res.writeHead(403);
        res.end('forbidden');
        return;
      }
      let st = statSync(filePath);
      if (st.isDirectory()) {
        filePath = join(filePath, 'index.html');
        st = statSync(filePath);
      }
      const ext = extname(filePath).toLowerCase();
      res.writeHead(200, {
        'content-type': mime[ext] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      createReadStream(filePath).pipe(res);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  return { url: `http://127.0.0.1:${port}/index.html`, port, close: () => server.close() };
}

/**
 * Launch the system Chromium headless and return a CDP client bound to the
 * first page target.
 * @returns {Promise<{browser: object, port: number, page: QaPage, close: () => Promise<void>}>}
 */
export async function launchChromium(opts = {}) {
  const bin = opts.bin || process.env.CHROMIUM_BIN || findChromium();
  const port = ++portCounter;
  const userData = join(tmpdir(), `qa-chrome-${Date.now()}`);
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--disable-extensions',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    'about:blank',
  ];
  const browser = spawn(bin, args, { stdio: ['ignore', 'ignore', 'inherit'] });

  // Poll for the CDP endpoint.
  let version = null;
  for (let i = 0; i < 100 && !version; i++) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
      version = await resp.json();
    } catch {
      await sleep(100);
    }
  }
  if (!version) {
    browser.kill('SIGKILL');
    throw new Error(`Chromium did not start (${bin}). Is it installed?`);
  }

  const client = await cdpNewPage(port);
  const page = new QaPage(client);
  await page.start();

  return {
    browser,
    port,
    page,
    async close() {
      try { await page.client.close(); } catch {}
      try { browser.kill('SIGKILL'); } catch {}
    },
  };
}

/** Create a new CDP target and return a promise-based CDP client. */
async function cdpNewPage(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === 'page') || list[0];
  if (!target) throw new Error('No CDP page target');
  return new CdpClient(target.webSocketDebuggerUrl);
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.listeners = {};
    this.ready = false;
  }

  async open() {
    if (this.ready) return;
    await new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });
    this.ws.onmessage = (ev) => this._onMessage(ev);
    this.ready = true;
  }

  _onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method && this.listeners[msg.method]) {
      for (const fn of this.listeners[msg.method]) fn(msg.params || {});
    }
  }

  async send(method, params = {}) {
    await this.open();
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, fn) {
    (this.listeners[method] = this.listeners[method] || []).push(fn);
  }

  async close() {
    try { this.ws.close(); } catch {}
  }
}

/** High-level browser automation helpers for the QA scripts. */
export class QaPage {
  constructor(client) {
    this.client = client;
  }

  async start() {
    await this.client.open();
    await Promise.all([
      this.client.send('Page.enable'),
      this.client.send('Runtime.enable'),
      this.client.send('Log.enable'),
      this.client.send('Network.enable'),
    ]);
    return this;
  }

  async goto(url, waitMs = 2000) {
    await this.client.send('Page.navigate', { url });
    await sleep(waitMs);
    return this;
  }

  async eval(expression) {
    const result = await this.client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'eval error';
      throw new Error('Page eval failed: ' + desc);
    }
    return result.result?.value;
  }

  async evalBody(fn, args = []) {
    const argStr = args.map((a) => JSON.stringify(a)).join(', ');
    return this.eval(`(${fn})(${argStr})`);
  }

  async innerHTML(id) {
    return this.eval(`document.getElementById(${JSON.stringify(id)})?.innerHTML || ''`);
  }

  async clickAt(x, y) {
    return this.eval(`(() => {
      const el = document.elementFromPoint(${x}, ${y});
      const target = el || document.body;
      const opts = { bubbles: true, cancelable: true, clientX: ${x}, clientY: ${y}, button: 0 };
      target.dispatchEvent(new MouseEvent('pointerdown', opts));
      target.dispatchEvent(new MouseEvent('mousedown', opts));
      target.dispatchEvent(new MouseEvent('mouseup', opts));
      target.dispatchEvent(new MouseEvent('click', opts));
      return true;
    })()`);
  }

  async screenshot(path, { clip } = {}) {
    const res = await this.client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      ...(clip ? { clip } : {}),
    });
    const p = resolve(path);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, Buffer.from(res.data, 'base64'));
    return p;
  }
}

export { ROOT };