import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_FIXED_STEP,
  DEFAULT_MAX_DELTA,
  FixedStepLoop,
  clampDelta,
  type FrameInfo,
} from "../src/core/loop";
import {
  BLOCK_SIZE,
  CAMERA_TARGET,
  DEFAULT_TONE_MAPPING_EXPOSURE,
  MAX_PIXEL_RATIO,
  MIN_PIXEL_RATIO,
  PLACEHOLDER_BLOCK_NAME,
  PLACEHOLDER_BUILDINGS,
  STREET_WIDTH,
  applyRendererSize,
  configureRenderer,
  createCityCamera,
  createCityScene,
  createPlaceholderBlock,
  normalizeViewport,
  type CameraLike,
  type RendererLike,
} from "../src/core/renderer";
import { SHELL_SELECTORS, bootstrap, resolveShellRoots } from "../src/main";

/**
 * Scaffold verification for Chrono City.
 *
 * Covers the four foundation contracts later tasks build on: the package
 * tooling surface, the `index.html` shell roots and their layout, the fixed-step
 * render loop, and the WebGL renderer/scene configuration. WebGL itself cannot
 * run under jsdom, so the GPU path (context creation, first real frame) is
 * asserted by `tests/e2e/smoke.spec.ts` against the built app instead.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readRepoFile = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), "utf8");

const indexHtml = readRepoFile("index.html");
const stylesCss = readRepoFile("src/styles.css");
const packageManifest = JSON.parse(readRepoFile("package.json")) as {
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

/** Parses `index.html` with scripts stripped so nothing executes when mounted. */
function parseShell(): Document {
  const parsed = new DOMParser().parseFromString(indexHtml, "text/html");
  parsed.querySelectorAll("script").forEach((script) => script.remove());
  return parsed;
}

/** Mounts the real shell markup and stylesheet into the jsdom document. */
function mountShell(): {
  canvas: HTMLCanvasElement;
  timeline: HTMLElement;
  hud: HTMLElement;
  loading: HTMLElement;
} {
  const shell = parseShell();
  document.head.innerHTML = `<style>${stylesCss}</style>`;
  document.body.innerHTML = shell.body.innerHTML;

  return {
    canvas: queryOrThrow<HTMLCanvasElement>(SHELL_SELECTORS.canvas),
    timeline: queryOrThrow<HTMLElement>(SHELL_SELECTORS.timeline),
    hud: queryOrThrow<HTMLElement>(SHELL_SELECTORS.hud),
    loading: queryOrThrow<HTMLElement>(SHELL_SELECTORS.loading),
  };
}

function queryOrThrow<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`test shell is missing ${selector}`);
  }
  return element;
}

function createHookSpies(): {
  update: ReturnType<typeof vi.fn<(delta: number, frame: FrameInfo) => void>>;
  render: ReturnType<typeof vi.fn<(frame: FrameInfo) => void>>;
} {
  return {
    update: vi.fn<(delta: number, frame: FrameInfo) => void>(),
    render: vi.fn<(frame: FrameInfo) => void>(),
  };
}

function createRendererStub(): RendererLike {
  return {
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    shadowMap: { enabled: false, type: THREE.BasicShadowMap },
    setPixelRatio: vi.fn<(value: number) => void>(),
    setSize: vi.fn<(width: number, height: number, updateStyle?: boolean) => void>(),
  };
}

describe("package tooling", () => {
  it("exposes the dev, build, preview, test, typecheck and e2e scripts", () => {
    for (const script of ["dev", "build", "preview", "test", "typecheck", "test:e2e"]) {
      expect(packageManifest.scripts[script], `missing npm script: ${script}`).toBeTruthy();
    }
  });

  it("pins every dependency to an exact version", () => {
    const all = { ...packageManifest.dependencies, ...packageManifest.devDependencies };
    for (const name of ["three", "typescript", "vite", "vitest", "jsdom", "@playwright/test", "playwright"]) {
      expect(all[name], `missing dependency: ${name}`).toMatch(/^\d+\.\d+\.\d+$/);
    }
    for (const [name, version] of Object.entries(all)) {
      expect(version, `${name} must be pinned, got ${version}`).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it("runs TypeScript tests under jsdom", () => {
    const vitestConfig = readRepoFile("vitest.config.ts");
    expect(vitestConfig).toContain("jsdom");
    expect(packageManifest.devDependencies.jsdom).toBeTruthy();
  });
});

describe("index.html shell", () => {
  it("declares the WebGL canvas, timeline, HUD and loading roots", () => {
    const shell = parseShell();

    const canvas = shell.querySelector(SHELL_SELECTORS.canvas);
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas?.tagName).toBe("CANVAS");

    expect(shell.querySelector(SHELL_SELECTORS.timeline)).toBeTruthy();
    expect(shell.querySelector(SHELL_SELECTORS.hud)).toBeTruthy();

    const loading = shell.querySelector<HTMLElement>(SHELL_SELECTORS.loading);
    expect(loading?.dataset.state).toBe("loading");
    expect(loading?.querySelector("[data-role='loading-status']")?.textContent).toBeTruthy();
  });

  it("loads src/main.ts as the single module entry", () => {
    // Parsed without stripping so the real entry tag is inspected.
    const shell = new DOMParser().parseFromString(indexHtml, "text/html");
    const scripts = Array.from(shell.querySelectorAll("script"));

    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.getAttribute("src")).toBe("/src/main.ts");
    expect(scripts[0]?.getAttribute("type")).toBe("module");
  });

  it("pins the timeline root to the top edge and stacks the overlays above the canvas", () => {
    const { canvas, timeline, hud, loading } = mountShell();

    const canvasStyle = getComputedStyle(canvas);
    const timelineStyle = getComputedStyle(timeline);
    const hudStyle = getComputedStyle(hud);
    const loadingStyle = getComputedStyle(loading);

    expect(canvasStyle.position).toBe("fixed");
    expect(canvasStyle.width).toBe("100%");
    expect(canvasStyle.height).toBe("100%");

    expect(timelineStyle.position).toBe("fixed");
    expect(timelineStyle.top).toBe("0px");
    expect(timelineStyle.left).toBe("0px");
    expect(timelineStyle.right).toBe("0px");

    expect(hudStyle.position).toBe("fixed");
    expect(hudStyle.bottom).toBe("0px");

    expect(loadingStyle.position).toBe("fixed");
    expect(loadingStyle.top).toBe("0px");
    expect(loadingStyle.bottom).toBe("0px");

    expect(Number(timelineStyle.zIndex)).toBeGreaterThan(Number(canvasStyle.zIndex));
    expect(Number(loadingStyle.zIndex)).toBeGreaterThan(Number(timelineStyle.zIndex));
  });

  it("keeps overlay roots transparent to canvas gestures", () => {
    const { timeline, hud } = mountShell();

    expect(getComputedStyle(timeline).pointerEvents).toBe("none");
    expect(getComputedStyle(hud).pointerEvents).toBe("none");
  });

  it("hides the loading root only once it is marked ready", () => {
    const { loading } = mountShell();

    expect(loading.hidden).toBe(false);
    expect(getComputedStyle(loading).display).not.toBe("none");

    loading.hidden = true;
    expect(getComputedStyle(loading).display).toBe("none");
  });
});

describe("FixedStepLoop", () => {
  it("anchors the clock on the first tick and renders immediately", () => {
    const { update, render } = createHookSpies();
    const loop = new FixedStepLoop({ hooks: { update, render } });

    const first = loop.tick(12.5);

    expect(first.frame).toBe(1);
    expect(first.delta).toBe(0);
    expect(first.steps).toBe(0);
    expect(first.elapsed).toBe(0);
    expect(update).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(loop.simulationTime).toBe(0);
    expect(loop.frameCount).toBe(1);
  });

  it("advances the simulation in fixed steps", () => {
    const { update, render } = createHookSpies();
    const loop = new FixedStepLoop({ hooks: { update, render }, maxDelta: 1 });

    loop.tick(0);
    const frame = loop.tick(0.5);

    expect(frame.delta).toBeCloseTo(0.5, 9);
    expect(frame.steps).toBe(30);
    expect(frame.elapsed).toBeCloseTo(30 * DEFAULT_FIXED_STEP, 9);
    expect(frame.alpha).toBeGreaterThanOrEqual(0);
    expect(frame.alpha).toBeLessThan(1);
    expect(update).toHaveBeenCalledTimes(30);
    expect(update.mock.calls[0]?.[0]).toBe(DEFAULT_FIXED_STEP);
    expect(render).toHaveBeenCalledTimes(2);
    expect(loop.simulationTime).toBeCloseTo(0.5, 9);
  });

  it("clamps long frames without losing simulated time", () => {
    const { update, render } = createHookSpies();
    const loop = new FixedStepLoop({ hooks: { update, render } });
    const stepsPerFrame = Math.round(DEFAULT_MAX_DELTA / DEFAULT_FIXED_STEP);

    loop.tick(0);
    const stalled = loop.tick(4);

    expect(stalled.delta).toBe(DEFAULT_MAX_DELTA);
    expect(stalled.steps).toBe(stepsPerFrame);
    expect(stalled.elapsed).toBeCloseTo(DEFAULT_MAX_DELTA, 9);
    expect(stalled.alpha).toBeGreaterThanOrEqual(0);
    expect(stalled.alpha).toBeLessThan(1);
    expect(loop.maxSubSteps).toBeGreaterThanOrEqual(stalled.steps);

    // A stalled frame leaves no backlog behind: the next frame advances by the
    // clamped delta again instead of inheriting the skipped time.
    const recovered = loop.tick(8);
    expect(recovered.steps).toBe(stepsPerFrame);
    expect(loop.simulationTime).toBeCloseTo(2 * DEFAULT_MAX_DELTA, 9);
    expect(update).toHaveBeenCalledTimes(2 * stepsPerFrame);
  });

  it("sheds the backlog when an explicit catch-up bound is exceeded", () => {
    const { update, render } = createHookSpies();
    const loop = new FixedStepLoop({ hooks: { update, render }, maxDelta: 1, maxSubSteps: 2 });

    expect(loop.maxSubSteps).toBe(2);
    loop.tick(0);

    const capped = loop.tick(1);
    expect(capped.delta).toBe(1);
    expect(capped.steps).toBe(2);
    expect(capped.alpha).toBeLessThan(1);
    expect(loop.simulationTime).toBeCloseTo(2 * DEFAULT_FIXED_STEP, 9);
    expect(loop.interpolation).toBeLessThan(1);

    const next = loop.tick(2);
    expect(next.steps).toBe(2);
    expect(loop.simulationTime).toBeCloseTo(4 * DEFAULT_FIXED_STEP, 9);
    expect(update).toHaveBeenCalledTimes(4);
  });

  it("rejects non-finite, negative and oversized deltas", () => {
    expect(clampDelta(-4)).toBe(0);
    expect(clampDelta(Number.NaN)).toBe(0);
    expect(clampDelta(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampDelta(0.05)).toBe(0.05);
    expect(clampDelta(2, DEFAULT_MAX_DELTA)).toBe(DEFAULT_MAX_DELTA);
    expect(clampDelta(0.05, 0)).toBe(0.05);

    const { update, render } = createHookSpies();
    const loop = new FixedStepLoop({ hooks: { update, render } });
    loop.tick(10);
    const backwards = loop.tick(5);
    expect(backwards.delta).toBe(0);
    expect(backwards.steps).toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("drives ticks from the injected frame scheduler and stops cleanly", () => {
    const { update, render } = createHookSpies();
    const frames: Array<(timeMs: number) => void> = [];
    const cancelFrame = vi.fn<(handle: number) => void>();
    const loop = new FixedStepLoop({
      hooks: { update, render },
      maxDelta: 1,
      requestFrame: (callback) => {
        frames.push(callback);
        return frames.length;
      },
      cancelFrame,
    });

    expect(loop.running).toBe(false);
    loop.start();
    expect(loop.running).toBe(true);
    expect(frames).toHaveLength(1);

    frames[0]?.(1000);
    expect(render).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(2);

    frames[1]?.(1500);
    expect(render).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(30);

    loop.stop();
    expect(loop.running).toBe(false);
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    loop.stop();
    expect(cancelFrame).toHaveBeenCalledTimes(1);

    // A pending callback from before stop() must not restart the loop.
    const pending = frames[frames.length - 1];
    pending?.(2000);
    expect(render).toHaveBeenCalledTimes(2);
    expect(frames).toHaveLength(3);
  });

  it("clears accumulated time on reset", () => {
    const { update, render } = createHookSpies();
    const loop = new FixedStepLoop({ hooks: { update, render }, maxDelta: 1 });
    loop.tick(0);
    loop.tick(1);
    expect(loop.frameCount).toBe(2);

    loop.reset();

    expect(loop.frameCount).toBe(0);
    expect(loop.simulationTime).toBe(0);
    const frame = loop.tick(100);
    expect(frame.frame).toBe(1);
    expect(frame.delta).toBe(0);
    expect(frame.steps).toBe(0);
  });
});

describe("render core", () => {
  it("configures ACES tone mapping and shadow maps", () => {
    const renderer = createRendererStub();

    configureRenderer(renderer);

    expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
    expect(renderer.toneMappingExposure).toBe(DEFAULT_TONE_MAPPING_EXPOSURE);
    expect(renderer.outputColorSpace).toBe(THREE.SRGBColorSpace);
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.type).toBe(THREE.PCFShadowMap);

    configureRenderer(renderer, { exposure: 0.6 });
    expect(renderer.toneMappingExposure).toBe(0.6);
  });

  it("normalizes hostile viewport input", () => {
    expect(normalizeViewport(0, 0, 0)).toEqual({ width: 1, height: 1, pixelRatio: 1, aspect: 1 });
    expect(normalizeViewport(Number.NaN, 600, Number.NaN)).toEqual({
      width: 1,
      height: 600,
      pixelRatio: 1,
      aspect: 1 / 600,
    });
    expect(normalizeViewport(Number.POSITIVE_INFINITY, 100, 1).width).toBe(1);
    expect(normalizeViewport(1280, 720, 8).pixelRatio).toBe(MAX_PIXEL_RATIO);
    expect(normalizeViewport(1280, 720, 0.1).pixelRatio).toBe(MIN_PIXEL_RATIO);

    const viewport = normalizeViewport(1600, 900, 1);
    expect(viewport).toEqual({ width: 1600, height: 900, pixelRatio: 1, aspect: 1600 / 900 });
  });

  it("applies resize changes to the renderer and camera", () => {
    const renderer = createRendererStub();
    const cameraStub: CameraLike = { aspect: 1, updateProjectionMatrix: vi.fn<() => void>() };

    applyRendererSize(renderer, cameraStub, normalizeViewport(1600, 900, 3));

    expect(renderer.setPixelRatio).toHaveBeenCalledWith(MAX_PIXEL_RATIO);
    expect(renderer.setSize).toHaveBeenCalledWith(1600, 900, false);
    expect(cameraStub.aspect).toBeCloseTo(1600 / 900, 9);
    expect(cameraStub.updateProjectionMatrix).toHaveBeenCalledTimes(1);

    // The real camera must actually refresh its projection matrix.
    const camera = createCityCamera(1);
    const firstProjection = camera.projectionMatrix.elements[0];
    applyRendererSize(renderer, camera, normalizeViewport(1600, 900, 1));
    expect(camera.aspect).toBeCloseTo(1600 / 900, 9);
    expect(camera.projectionMatrix.elements[0]).not.toBe(firstProjection);
    expect(camera.position.y).toBeGreaterThan(0);
    expect(camera.position.z).not.toBe(CAMERA_TARGET.z);
  });

  it("builds a lit placeholder block with shadow-casting buildings", () => {
    const block = createPlaceholderBlock();

    expect(block.name).toBe(PLACEHOLDER_BLOCK_NAME);

    const ground = block.getObjectByName("ground");
    expect(ground).toBeInstanceOf(THREE.Mesh);
    expect((ground as THREE.Mesh).receiveShadow).toBe(true);

    for (const street of ["street-east-west", "street-north-south"]) {
      expect(block.getObjectByName(street)).toBeInstanceOf(THREE.Mesh);
    }

    expect(PLACEHOLDER_BUILDINGS.length).toBeGreaterThanOrEqual(4);
    PLACEHOLDER_BUILDINGS.forEach((spec, index) => {
      const building = block.getObjectByName(`building-${index}`);
      expect(building, `building-${index} is missing`).toBeInstanceOf(THREE.Mesh);
      const mesh = building as THREE.Mesh;
      expect(mesh.castShadow).toBe(true);
      expect(mesh.position.y).toBeCloseTo(spec.height / 2, 9);

      const geometry = mesh.geometry as THREE.BoxGeometry;
      expect(geometry.parameters.height).toBe(spec.height);
      expect(geometry.parameters.width).toBe(spec.width);

      // Footprints stay inside the block and clear of the street corridors.
      expect(Math.abs(spec.x) + spec.width / 2).toBeLessThanOrEqual(BLOCK_SIZE / 2);
      expect(Math.abs(spec.z) + spec.depth / 2).toBeLessThanOrEqual(BLOCK_SIZE / 2);
      const clearsStreets =
        Math.abs(spec.x) - spec.width / 2 >= STREET_WIDTH / 2 ||
        Math.abs(spec.z) - spec.depth / 2 >= STREET_WIDTH / 2;
      expect(clearsStreets, `building-${index} overlaps a street`).toBe(true);
    });

    const sun = block.getObjectByName("sun");
    expect(sun).toBeInstanceOf(THREE.DirectionalLight);
    const directional = sun as THREE.DirectionalLight;
    expect(directional.castShadow).toBe(true);
    expect(directional.shadow.mapSize.width).toBeGreaterThanOrEqual(1024);
    expect(directional.shadow.camera.right - directional.shadow.camera.left).toBeGreaterThanOrEqual(BLOCK_SIZE);

    const bounce = block.getObjectByName("sky-bounce");
    expect(bounce).toBeInstanceOf(THREE.HemisphereLight);
    expect((bounce as THREE.HemisphereLight).intensity).toBeGreaterThan(0);
  });

  it("builds the scene with sky, fog and the placeholder block", () => {
    const { scene, block } = createCityScene();

    expect(scene.background).toBeInstanceOf(THREE.Color);
    expect(scene.fog).toBeInstanceOf(THREE.Fog);
    expect(scene.getObjectByName(PLACEHOLDER_BLOCK_NAME)).toBe(block);
    expect(scene.children).toContain(block);
  });
});

describe("bootstrap", () => {
  beforeEach(() => {
    mountShell();
  });

  it("resolves the shell roots declared in index.html", () => {
    const roots = resolveShellRoots(document);

    expect(roots.canvas).toBe(document.querySelector(SHELL_SELECTORS.canvas));
    expect(roots.timelineRoot).toBe(document.querySelector(SHELL_SELECTORS.timeline));
    expect(roots.hudRoot).toBe(document.querySelector(SHELL_SELECTORS.hud));
    expect(roots.loadingRoot).toBe(document.querySelector(SHELL_SELECTORS.loading));
  });

  it("throws a descriptive error when the shell is incomplete", () => {
    document.body.innerHTML = "<div id='timeline-root'></div>";
    expect(() => resolveShellRoots(document)).toThrow(/city-canvas/);

    document.body.innerHTML = "<canvas id='city-canvas'></canvas>";
    expect(() => resolveShellRoots(document)).toThrow(/timeline-root/);
  });

  it("reports a WebGL failure through the loading root instead of crashing", () => {
    // jsdom cannot create a WebGL context, so this is the failure path of the
    // real bootstrap code; the happy path is covered by the Playwright smoke test.
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const app = bootstrap(document);
    const loading = queryOrThrow<HTMLElement>(SHELL_SELECTORS.loading);

    expect(app.view).toBeNull();
    expect(app.loop.running).toBe(false);
    expect(loading.dataset.state).toBe("error");
    expect(loading.hidden).toBe(false);
    expect(getComputedStyle(loading).display).not.toBe("none");
    expect(loading.textContent).toMatch(/webgl/i);
    expect(consoleError).toHaveBeenCalled();

    expect(() => app.destroy()).not.toThrow();
  });
});
