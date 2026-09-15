#!/usr/bin/env node
/**
 * Browser screenshot evidence capture for the café timelapse.
 *
 * For every era this script drives the *running page* — the same dev server build
 * a visitor loads — to a fixed camera pose and captures:
 *
 *   tests/evidence/<year>/default.png         fixed default pose (comparable across years)
 *   tests/evidence/<year>/closeup-menu.png    close-up: menu board hotspot
 *   tests/evidence/<year>/closeup-music.png   close-up: music source hotspot
 *   tests/evidence/<year>/closeup-counter.png close-up: service counter hotspot
 *   tests/evidence/<year>/capture.json        what the page reported while capturing
 *
 * It uses the Chromium DevTools Protocol directly over the built-in WebSocket, so
 * the verification suite needs **no added dependency** (no Playwright, no
 * Puppeteer). Chromium itself is provided by the environment.
 *
 * Usage:
 *   # terminal 1
 *   npm run dev
 *   # terminal 2
 *   node tests/evidence/capture.mjs --url http://localhost:5173/ --out tests/evidence
 *
 * Options:
 *   --url <url>        page to capture (default http://localhost:5173/)
 *   --out <dir>        evidence root (default tests/evidence)
 *   --chromium <path>  chromium binary (default $CHROMIUM or `chromium`)
 *   --port <n>         DevTools port for the spawned browser (default 9333)
 *   --width/--height   viewport in CSS pixels (default 1280x720)
 *   --years <list>     comma-separated subset (e.g. `--years 1985,2025`)
 *   --keep-open        leave the browser running for manual inspection
 *   --debug            print page diagnostics on failure
 *
 * Implementation note: headless SwiftShader renders this scene at roughly a
 * second per frame, and Chromium throttles request-animation-frame while nothing
 * is being captured. The script therefore advances the composition in a few large
 * deterministic steps (`CafeComposition.tick`) at the low render quality to settle
 * a year, then switches back to the production `high` quality and renders one
 * frame per screenshot. Animation state (era geometry, materials, lighting, patron
 * poses) is identical; only intermediate frames are cheaper.
 */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const YEAR_IDS = ['1945', '1965', '1985', '2005', '2025'];
const HOTSPOTS = [
  { key: 'menu', id: 'anchor-menu-board', label: 'menu board' },
  { key: 'music', id: 'anchor-music-source', label: 'music source' },
  { key: 'counter', id: 'anchor-service-counter', label: 'service counter' },
];
/** Scene time advanced per driven frame, seconds (the engine caps steps at 0.25). */
const STEP_SECONDS = 0.2;

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const options = {
    url: 'http://localhost:5173/',
    out: HERE,
    chromium: process.env.CHROMIUM ?? 'chromium',
    port: 9333,
    width: 1280,
    height: 720,
    keepOpen: false,
    debug: false,
    years: YEAR_IDS,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--url' && value) options.url = value;
    else if (flag === '--out' && value) options.out = resolve(value);
    else if (flag === '--chromium' && value) options.chromium = value;
    else if (flag === '--port' && value) options.port = Number.parseInt(value, 10);
    else if (flag === '--width' && value) options.width = Number.parseInt(value, 10);
    else if (flag === '--height' && value) options.height = Number.parseInt(value, 10);
    else if (flag === '--years' && value) {
      const requested = value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => YEAR_IDS.includes(entry));
      if (requested.length === 0) throw new Error(`--years must list some of ${YEAR_IDS.join(', ')}`);
      options.years = requested;
    } else if (flag === '--keep-open') options.keepOpen = true;
    else if (flag === '--debug') options.debug = true;
    else if (flag.startsWith('--')) throw new Error(`Unknown option ${flag}`);
  }
  return options;
}

/* -------------------------------------------------------------------------- */
/* Minimal DevTools-protocol client                                           */
/* -------------------------------------------------------------------------- */

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitForHttp(url, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label} at ${url} (${lastError}).`);
}

class Devtools {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #events = new Map();

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(typeof event.data === 'string' ? event.data : '');
      if (message.id === undefined) {
        const listeners = this.#events.get(message.method);
        if (listeners) for (const listener of listeners) listener(message.params ?? {});
        return;
      }
      const entry = this.#pending.get(message.id);
      if (!entry) return;
      this.#pending.delete(message.id);
      if (message.error) entry.reject(new Error(`${message.error.message} (${message.error.code})`));
      else entry.resolve(message.result ?? {});
    });
  }

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((done, fail) => {
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => fail(new Error(`Cannot open ${webSocketUrl}`)), {
        once: true,
      });
    });
    return new Devtools(socket);
  }

  send(method, params = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.#events.get(method) ?? new Set();
    listeners.add(listener);
    this.#events.set(method, listeners);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Page evaluation failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`,
      );
    }
    return result.result?.value;
  }

  close() {
    this.#socket.close();
  }
}

async function retry(task, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'unknown';
  while (Date.now() < deadline) {
    try {
      return await task();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(250);
    }
  }
  throw new Error(`Timed out waiting for ${label}: ${lastError}`);
}

/* -------------------------------------------------------------------------- */
/* Page helpers                                                               */
/* -------------------------------------------------------------------------- */

const APP_READY = 'Boolean(window.cafeComposition && window.cafeComposition.kernel)';

/** Scene statistics computed inside the page, matching the headless perf suite. */
const SCENE_STATS = `(() => {
  const world = window.cafeComposition.kernel.world;
  const geometries = new Set(); const materials = new Set(); const textures = new Set();
  let drawCalls = 0; let triangles = 0; let nodes = 0;
  const visit = (object, parentVisible) => {
    nodes += 1;
    const visible = parentVisible && object.visible;
    if (visible && object.isMesh === true) {
      const instances = object.isInstancedMesh === true ? object.count : 1;
      drawCalls += instances;
      const geometry = object.geometry;
      if (geometry) {
        geometries.add(geometry);
        const index = geometry.getIndex();
        const position = geometry.getAttribute('position');
        triangles += (index ? index.count / 3 : position ? position.count / 3 : 0) * instances;
      }
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (!material) continue;
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value && value.isTexture === true) textures.add(value);
        }
      }
    }
    for (const child of object.children) visit(child, visible);
  };
  visit(world, true);
  return {
    nodes, drawCalls, triangles: Math.round(triangles),
    geometries: geometries.size, materials: materials.size, textures: textures.size,
    year: window.cafeComposition.year,
    headless: window.cafeComposition.kernel.headless,
    renderer: window.cafeComposition.kernel.renderer !== null,
    musicNodes: (() => { const names = []; world.traverse((o) => { if (o.name.startsWith('music:')) names.push(o.name); }); return names; })(),
  };
})()`;

/**
 * Advances the composed page deterministically at the cheap render quality. The
 * page's own request-animation-frame loop is throttled while headless Chromium is
 * not producing frames, so the capture drives the same frame pipeline the loop
 * drives (`CafeComposition.tick` -> `Kernel.update`: transition, audio, modules).
 */
async function pump(devtools, ticks, seconds = STEP_SECONDS, quality = 'low') {
  const result = await devtools.evaluate(`(() => {
    const c = window.cafeComposition;
    c.setQuality('${quality}');
    try {
      for (let tick = 0; tick < ${ticks}; tick += 1) c.tick(${seconds});
      return { ok: true, year: c.year, transitioning: c.transition.isTransitioning };
    } catch (error) {
      window.__lastTickError = String(error && error.message ? error.message : error);
      return { ok: false, error: window.__lastTickError };
    }
  })()`);
  if (result && result.ok === false) console.warn(`Frame pump failed: ${result.error}`);
  return result;
}

async function activateApp(devtools) {
  /* A real gesture on the enter-café control: audio unlock and the removal of the
   * gate overlay, so the captured frames show the scene rather than the gate. */
  await devtools.evaluate(`(() => {
    const button = document.querySelector('[data-part="enter-cafe"]');
    if (button) button.click();
    return true;
  })()`);
  await pump(devtools, 10);
}

async function waitForYear(devtools, year) {
  const deadline = Date.now() + 180_000;
  let last = null;
  while (Date.now() < deadline) {
    await pump(devtools, 24);
    const state = await devtools.evaluate(`(() => {
      const c = window.cafeComposition;
      return { year: c.year, transitioning: c.transition.isTransitioning, settled: c.transition.settledYear };
    })()`);
    last = state;
    if (state.year === year && state.transitioning === false && state.settled === year) return state;
  }
  const diagnostics = await devtools
    .evaluate(`(() => {
      const c = window.cafeComposition;
      return {
        target: c.transition.targetYear,
        status: c.transition.status,
        phase: c.transition.phase,
        progress: c.transition.progress,
        fromYear: c.transition.fromYear,
        kernelYear: c.kernel.year,
        kernelFrame: c.kernel.frame,
        kernelRunning: c.kernel.isRunning,
        audioState: c.audio.state,
        modules: c.transition.modules.map((state) => state.reportedYear).join(','),
        tickError: window.__lastTickError ?? null,
      };
    })()`)
    .catch((failure) => ({ evaluationFailed: String(failure) }));
  throw new Error(
    `The page never settled on ${year}. last=${JSON.stringify(last)} state=${JSON.stringify(diagnostics)}`,
  );
}

async function selectYear(devtools, year) {
  await devtools.evaluate(`(() => {
    const c = window.cafeComposition;
    if (c.slider) c.slider.select('${year}');
    else c.selectYear('${year}');
    return true;
  })()`);
  return waitForYear(devtools, year);
}

async function restoreDefaultPose(devtools) {
  await devtools.evaluate(`(() => {
    const c = window.cafeComposition;
    if (!window.__evidencePose) window.__evidencePose = c.navigation.savePose();
    c.navigation.restorePose(window.__evidencePose);
    return true;
  })()`);
  await pump(devtools, 14);
}

async function frameHotspot(devtools, hotspotId, year) {
  const opened = await devtools.evaluate(`(() => {
    const c = window.cafeComposition;
    if (!c.inspectMode) return false;
    c.inspectMode.open('${hotspotId}', '${year}');
    return c.inspectMode.isOpen;
  })()`);
  await pump(devtools, 16);
  return opened;
}

async function closeHotspot(devtools) {
  await devtools.evaluate(`(() => { window.cafeComposition.inspectMode?.close(); return true; })()`);
  await pump(devtools, 4);
}

/** Renders one production-quality frame and writes it to `file`. */
async function capture(devtools, file) {
  await devtools.evaluate(`(() => { window.cafeComposition.render(); return true; })()`).catch(
    () => undefined,
  );
  await pump(devtools, 2, 1 / 60, 'high');
  await devtools.evaluate(`(() => { window.cafeComposition.render(); return true; })()`).catch(
    () => undefined,
  );
  await sleep(250);
  const shot = await devtools.send('Page.captureScreenshot', { format: 'png' });
  const data = shot.data;
  if (typeof data !== 'string' || data.length < 1_000) {
    throw new Error(`The browser returned an empty screenshot for ${file}.`);
  }
  const bytes = Buffer.from(data, 'base64');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, bytes);
  return bytes.length;
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */

async function main() {
  const options = parseArgs(process.argv.slice(2));
  console.log(`Launching ${options.chromium} on port ${options.port} for ${options.url}`);

  const browser = spawn(
    options.chromium,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu-sandbox',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      `--window-size=${options.width},${options.height}`,
      `--remote-debugging-port=${options.port}`,
      '--user-data-dir=/tmp/cafe-evidence-profile',
      'about:blank',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  browser.stderr.on('data', (chunk) => {
    const text = String(chunk);
    if (/error|fail/i.test(text) && !/dbus|OOM score|Fontconfig|vulkan|gcm|on_device_model|crashpad/i.test(text)) {
      process.stderr.write(`[chromium] ${text}`);
    }
  });

  let devtools = null;
  try {
    const version = await waitForHttp(
      `http://127.0.0.1:${options.port}/json/version`,
      30_000,
      'the DevTools endpoint',
    );
    const versionInfo = await version.json();
    console.log(`Connected to ${versionInfo.Browser}`);

    const target = await retry(
      async () => {
        const list = await (await fetch(`http://127.0.0.1:${options.port}/json/list`)).json();
        const page = list.find((entry) => entry.type === 'page');
        if (!page) throw new Error('no page target yet');
        return page;
      },
      20_000,
      'the page target',
    );
    devtools = await Devtools.connect(target.webSocketDebuggerUrl);

    await devtools.send('Page.enable');
    await devtools.send('Runtime.enable');
    await devtools.send('Emulation.setDeviceMetricsOverride', {
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const pageErrors = [];
    const pageConsole = [];
    devtools.on('Runtime.exceptionThrown', (params) => {
      pageErrors.push(params.exceptionDetails?.exception?.description ?? 'page exception');
    });
    devtools.on('Runtime.consoleAPICalled', (params) => {
      pageConsole.push(
        `${params.type}: ${(params.args ?? [])
          .map((argument) => argument.value ?? argument.description ?? argument.type)
          .join(' ')}`,
      );
    });

    console.log(`Navigating to ${options.url}`);
    await devtools.send('Page.navigate', { url: options.url });
    try {
      await retry(
        async () => {
          const ready = await devtools.evaluate(APP_READY);
          if (ready !== true) throw new Error('the café composition is not mounted yet');
          return true;
        },
        180_000,
        'the café composition to mount',
      );
    } catch (error) {
      const state = await devtools
        .evaluate(
          `({
             href: window.location.href,
             title: document.title,
             hasApp: Boolean(document.getElementById('app')),
             composition: typeof window.cafeComposition,
             canvas: Boolean(document.querySelector('canvas')),
           })`,
        )
        .catch((failure) => ({ evaluationFailed: String(failure) }));
      console.error('Page diagnostics:', JSON.stringify(state, null, 2));
      if (pageErrors.length > 0) console.error('Page exceptions:', pageErrors.slice(0, 5));
      if (pageConsole.length > 0) console.error('Page console:', pageConsole.slice(0, 20));
      throw error;
    }

    console.log('The café composition is mounted; unlocking the enter gate.');
    await activateApp(devtools);

    const records = [];
    for (const year of options.years) {
      const started = Date.now();
      await closeHotspot(devtools);
      const state = await selectYear(devtools, year);
      await restoreDefaultPose(devtools);
      const stats = await devtools.evaluate(SCENE_STATS);
      const files = {};

      files.default = 'default.png';
      const defaultBytes = await capture(devtools, join(options.out, year, files.default));
      console.log(
        `${year}: default pose captured (${Math.round(defaultBytes / 1024)} kB) ${JSON.stringify(stats.musicNodes)}`,
      );

      for (const hotspot of HOTSPOTS) {
        const opened = await frameHotspot(devtools, hotspot.id, year);
        const name = `closeup-${hotspot.key}.png`;
        files[`closeup-${hotspot.key}`] = name;
        const bytes = await capture(devtools, join(options.out, year, name));
        console.log(
          `${year}: close-up ${hotspot.label} captured (${Math.round(bytes / 1024)} kB, framed=${opened})`,
        );
      }
      await closeHotspot(devtools);

      records.push({
        year,
        capturedAt: new Date().toISOString(),
        url: options.url,
        viewport: { width: options.width, height: options.height },
        settledYear: state.year,
        transitionStatus: 'settled',
        headless: stats.headless,
        renderer: stats.renderer,
        musicDeviceNodes: stats.musicNodes,
        scene: {
          nodes: stats.nodes,
          drawCalls: stats.drawCalls,
          triangles: stats.triangles,
          geometries: stats.geometries,
          materials: stats.materials,
          textures: stats.textures,
        },
        files,
        closeUps: HOTSPOTS.map((hotspot) => ({ id: hotspot.id, label: hotspot.label })),
      });
      console.log(`${year}: captured in ${Math.round((Date.now() - started) / 1000)}s`);
    }

    await writeFile(
      join(options.out, 'capture-summary.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), records, pageErrors }, null, 2)}\n`,
    );
    if (pageErrors.length > 0) {
      console.warn(`Page reported ${pageErrors.length} uncaught error(s): ${pageErrors[0]}`);
    }
    console.log(`Evidence written to ${options.out}`);
  } finally {
    if (devtools && !options.keepOpen) devtools.close();
    if (!options.keepOpen) browser.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(`Evidence capture failed: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
