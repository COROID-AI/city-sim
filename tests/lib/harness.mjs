/* ===========================================================================
   Dependency-free verification harness.

   Node builtins only (node:child_process/http/fs/path/net/os/url plus the
   global fetch/WebSocket of Node >= 18). Provides:
     - a tiny static file server for the http:// origin check
     - a headless Chromium launcher talking raw Chrome DevTools Protocol
     - helpers for viewport control, evaluation, navigation and screenshots
     - in-page PNG pixel statistics (luminance / saturation / sky / density)
     - assert + report utilities that exit non-zero on failure
   =========================================================================== */

import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEX_PATH = path.join(ROOT, 'index.html');
export const INDEX_FILE_URL = pathToFileURL(INDEX_PATH).href;

export const CHROMIUM_BIN = process.env.CHROMIUM_BIN || 'chromium';
export const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';
export const THREE_FALLBACK = 'https://unpkg.com/three@0.160.0/build/three.module.js';
export const THREE_HOSTS = ['cdn.jsdelivr.net', 'unpkg.com'];

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------------------------------------------------------------------
   Assertions / reporting
   --------------------------------------------------------------------------- */
export class Verifier {
  constructor(name) {
    this.name = name;
    this.passed = 0;
    this.failures = [];
    this.log = [];
  }
  ok(label, condition, detail) {
    if (condition) { this.passed++; this.log.push(`  PASS  ${label}`); }
    else {
      this.failures.push({ label, detail: detail === undefined ? '' : String(detail) });
      this.log.push(`  FAIL  ${label}${detail === undefined ? '' : '  ->  ' + detail}`);
    }
    return !!condition;
  }
  near(label, actual, expected, tol) {
    const good = Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
    return this.ok(label, good, `actual ${fmt(actual)} expected ${fmt(expected)} +/- ${tol}`);
  }
  below(label, actual, limit) {
    return this.ok(label, Number.isFinite(actual) && actual < limit, `actual ${fmt(actual)} limit < ${limit}`);
  }
  above(label, actual, limit) {
    return this.ok(label, Number.isFinite(actual) && actual > limit, `actual ${fmt(actual)} limit > ${limit}`);
  }
  info(msg) { this.log.push('  ----  ' + msg); }
  report() {
    const head = `[${this.name}] ${this.passed} passed, ${this.failures.length} failed`;
    console.log('\n' + head);
    console.log(this.log.join('\n'));
    if (this.failures.length) {
      console.log('\nFAILURES:');
      for (const f of this.failures) console.log(`  * ${f.label}  ${f.detail}`);
    }
    return this.failures.length === 0;
  }
  finish() {
    const ok = this.report();
    process.exit(ok ? 0 : 1);
  }
}
export function fmt(v) {
  if (typeof v !== 'number') return String(v);
  return Number.isInteger(v) ? String(v) : v.toFixed(4);
}

/* ---------------------------------------------------------------------------
   Small utilities
   --------------------------------------------------------------------------- */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
  });
}

export async function waitFor(label, fn, { timeout = 20000, interval = 120 } = {}) {
  const start = Date.now();
  let lastErr = null;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) { lastErr = err; }
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor(${label}) timed out after ${timeout}ms${lastErr ? ' :: ' + lastErr.message : ''}`);
    }
    await sleep(interval);
  }
}

/* ---------------------------------------------------------------------------
   Static file server (http://127.0.0.1 origin)
   --------------------------------------------------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'
};
export async function startServer(root = ROOT) {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const target = path.join(root, urlPath === '/' ? '/index.html' : urlPath);
    if (!target.startsWith(root)) { res.writeHead(403); res.end('forbidden'); return; }
    fs.readFile(target, (err, buf) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    server, port,
    url: `http://127.0.0.1:${port}/index.html`,
    close: () => new Promise(r => server.close(() => r()))
  };
}

/* ---------------------------------------------------------------------------
   Minimal CDP client over the built-in WebSocket
   --------------------------------------------------------------------------- */
class CDPConnection {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); }
      catch (e) { return; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          if (msg.error) p.reject(new Error(`${msg.error.message || 'CDP error'} (code ${msg.error.code})`));
          else p.resolve(msg.result);
        }
      } else if (msg.method) {
        const arr = this.listeners.get(msg.method);
        if (arr) for (const fn of arr) { try { fn(msg.params, msg.sessionId); } catch (e) { /* listener errors are non-fatal */ } }
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }
      }, 120000).unref?.();
    });
  }
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

export async function launchChromium({ width = 1280, height = 720, extraArgs = [] } = {}) {
  const port = await freePort();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coroid-chrome-'));
  const args = [
    '--headless=new',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu-sandbox',
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--remote-allow-origins=*',
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${width},${height}`,
    `--user-data-dir=${userDataDir}`,
    'about:blank',
    ...extraArgs
  ];
  const proc = spawn(CHROMIUM_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d.toString(); });
  const base = `http://127.0.0.1:${port}`;
  const version = await waitFor('chromium /json/version', async () => {
    const r = await fetch(`${base}/json/version`);
    if (!r.ok) return null;
    return r.json();
  }, { timeout: 30000 }).catch(err => { throw new Error(`${err.message}\nchromium stderr:\n${stderr.slice(-2000)}`); });
  return {
    proc, port, base, version,
    userDataDir,
    stderr: () => stderr,
    async targets() {
      const r = await fetch(`${base}/json/list`);
      return r.json();
    },
    async newPage() {
      const list = await (await fetch(`${base}/json/list`)).json();
      const page = list.find(t => t.type === 'page');
      if (!page) throw new Error('no page target available');
      return connect(page.webSocketDebuggerUrl);
    },
    close() {
      try { proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
      try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  };
}

export async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('WebSocket connect timeout')), 20000);
    ws.addEventListener('open', () => { clearTimeout(to); resolve(); });
    ws.addEventListener('error', e => { clearTimeout(to); reject(new Error('WebSocket error: ' + (e.message || 'unknown'))); });
  });
  const cdp = new CDPConnection(ws);
  cdp.errors = [];
  cdp.exceptions = [];
  cdp.requests = [];
  cdp.responses = [];
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable').catch(() => {});
  cdp.on('Runtime.consoleAPICalled', p => {
    if (p.type === 'error' || p.type === 'assert') {
      cdp.errors.push((p.args || []).map(a => a.value !== undefined ? a.value : a.description).join(' '));
    }
  });
  cdp.on('Runtime.exceptionThrown', p => {
    const d = p.exceptionDetails || {};
    cdp.exceptions.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'exception');
  });
  cdp.on('Log.entryAdded', p => {
    const e = p.entry || {};
    const txt = `${e.url || ''} ${e.text || ''}`;
    if (e.level === 'error' && !/favicon/i.test(txt)) cdp.errors.push(txt.trim());
  });
  cdp.on('Network.requestWillBeSent', p => {
    cdp.requests.push({ url: p.request.url, type: p.type, method: p.request.method });
  });
  cdp.on('Network.responseReceived', p => {
    cdp.responses.push({ url: p.response.url, status: p.response.status });
  });
  return cdp;
}

/* ---------------------------------------------------------------------------
   Page helpers
   --------------------------------------------------------------------------- */
export async function setViewport(cdp, width, height, scale = 1) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: scale, mobile: false
  });
}
export async function clearViewport(cdp) {
  await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
}
export async function navigate(cdp, url) {
  cdp.requests.length = 0;
  cdp.responses.length = 0;
  cdp.errors.length = 0;
  cdp.exceptions.length = 0;
  await cdp.send('Page.navigate', { url });
}
export async function evaluate(cdp, expression, { awaitPromise = false } = {}) {
  const res = await cdp.send('Runtime.evaluate', {
    expression, returnByValue: true, awaitPromise
  });
  if (res.exceptionDetails) {
    const d = res.exceptionDetails;
    throw new Error('evaluate threw: ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text));
  }
  return res.result.value;
}
export async function screenshot(cdp) {
  const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
  return res.data;
}
export async function waitForLaunch(cdp, timeout = 60000) {
  return waitFor('__LAUNCH__.ready', () => evaluate(cdp, '!!(window.__LAUNCH__ && window.__LAUNCH__.ready)', {}), { timeout });
}

/* ---------------------------------------------------------------------------
   In-page PNG pixel statistics
   --------------------------------------------------------------------------- */
export async function pixelStats(cdp, base64, region) {
  const regionExpr = region
    ? `{x0:${region.x0},y0:${region.y0},x1:${region.x1},y1:${region.y1}}`
    : 'null';
  const expr = `(async () => {
    const b64 = ${JSON.stringify(base64)};
    const region = ${regionExpr};
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const W = img.width, H = img.height;
    let ctx = null;
    if (typeof OffscreenCanvas !== 'undefined') {
      try { const oc = new OffscreenCanvas(W, H); ctx = oc.getContext('2d', { willReadFrequently: true }); } catch (e) { ctx = null; }
    }
    if (!ctx) { const c = document.createElement('canvas'); c.width = W; c.height = H; ctx = c.getContext('2d', { willReadFrequently: true }); }
    ctx.drawImage(img, 0, 0);
    const x0 = region ? Math.max(0, Math.floor(region.x0 * W)) : 0;
    const y0 = region ? Math.max(0, Math.floor(region.y0 * H)) : 0;
    const x1 = region ? Math.min(W, Math.ceil(region.x1 * W)) : W;
    const y1 = region ? Math.min(H, Math.ceil(region.y1 * H)) : H;
    const rw = Math.max(1, x1 - x0), rh = Math.max(1, y1 - y0);
    const data = ctx.getImageData(x0, y0, rw, rh).data;
    let lum = 0, sat = 0, blue = 0, bright = 0, n = 0;
    let grad = 0, edges = 0;
    const hist = new Array(16).fill(0);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum += L;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += mx === 0 ? 0 : (mx - mn) / mx;
      if (b > r * 1.08 && b > g * 1.03 && L > 55) blue++;
      if (L > 150) bright++;
      hist[Math.min(15, Math.floor(L / 16))]++;
      n++;
    }
    // luminance gradient (scene detail / visual density)
    const px = (xx, yy) => {
      const o = (yy * rw + xx) * 4;
      return 0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2];
    };
    for (let yy = 0; yy < rh - 1; yy++) {
      for (let xx = 0; xx < rw - 1; xx++) {
        const c = px(xx, yy);
        const d = Math.abs(px(xx + 1, yy) - c) + Math.abs(px(xx, yy + 1) - c);
        grad += d;
        if (d > 14) edges++;
      }
    }
    const gn = Math.max(1, (rh - 1) * (rw - 1));
    let mean = lum / n, variance = 0;
    return {
      width: rw, height: rh, pixels: n,
      meanLuminance: mean,
      meanSaturation: sat / n,
      blueSkyFraction: blue / n,
      nonSkyContentFraction: 1 - blue / n,
      brightFraction: bright / n,
      meanGradient: grad / gn,
      edgeFraction: edges / gn,
      histogram: hist.map(v => v / n)
    };
  })()`;
  return evaluate(cdp, expr, { awaitPromise: true });
}

/* ---------------------------------------------------------------------------
   CDN reachability probe (bounded retries, capped backoff)
   --------------------------------------------------------------------------- */
export async function probeCdn(urls = [THREE_CDN, THREE_FALLBACK], attempts = 3) {
  const tried = [];
  for (let i = 0; i < attempts; i++) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { method: 'GET', cache: 'no-store' });
        if (res.ok) {
          const text = await res.text();
          return { url, ok: true, bytes: text.length, attempts: i + 1 };
        }
        tried.push(`${url} -> HTTP ${res.status}`);
      } catch (err) {
        tried.push(`${url} -> ${err.message}`);
      }
    }
    if (i < attempts - 1) await sleep(Math.min(4000, 500 * Math.pow(3, i)));
  }
  return { ok: false, tried, attempts };
}
