import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, test as base, type Page, type TestInfo } from "@playwright/test";

import { ERAS, type EraId } from "../../src/era/eraTypes";

/**
 * Chrono City end-to-end suite: the five era states, the navigation rig and
 * click-to-inspect.
 *
 * Everything runs against the built bundle served by `vite preview`. Two
 * properties of this app shape the harness, exactly as in `chrono.spec.ts`:
 *
 *   1. The scene is heavy: software rendering paints a few frames per second and
 *      the shared fixed-step loop clamps each frame's delta, so simulated time
 *      crawls and every round trip queues behind a multi-hundred-millisecond
 *      frame. After boot the suite parks the app's render loop and drives the
 *      very same scene by hand - `scene.update(dt)` steps plus an explicit
 *      `scene.render()` - so transformations and glides land in milliseconds and
 *      a frame is drawn only when a capture needs one.
 *   2. Booting is expensive, so the file boots one page in a worker-scoped
 *      fixture and every test shares it.
 *
 * Evidence: one screenshot per era lands in `artifacts/e2e/`, together with a
 * JSON fingerprint summary, and the pixel comparison below proves the five
 * canvas states are genuinely distinct rather than merely different files.
 */

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/** Address `playwright.config.ts` serves the built bundle on. */
const APP_URL = "http://127.0.0.1:4173";

/** Viewport the shared page uses; small enough for software rendering to keep up. */
const APP_VIEWPORT = { width: 800, height: 450 } as const;

/** Simulation step used by the deterministic driver, in seconds. */
const STEP_SECONDS = 0.1;

/** Upper bound on the steps one era transformation may need before failing. */
const MAX_SETTLE_STEPS = 400;

/** Where per-era screenshots and the fingerprint summary are written. */
const ARTIFACTS_DIR = path.resolve(process.cwd(), "artifacts", "e2e");

/**
 * Canvas fingerprint resolution: an 8x5 grid of mean-luminance cells plus the
 * frame mean. Coarse on purpose - it measures "is this the same picture", not
 * per-pixel noise.
 */
const GRID_COLUMNS = 8;
const GRID_ROWS = 5;

/**
 * Distance thresholds for the pixel comparison.
 *
 * Measured on this scene at this viewport: two signatures taken inside one era
 * differ by ~0.1 (a few moving vehicles and pedestrians), while the closest pair
 * of eras differs by ~8. The thresholds sit between the two with a wide margin,
 * so the comparison is meaningful instead of trivially passing on animation
 * noise.
 */
const MAX_SAME_ERA_DISTANCE = 1.5;
const MIN_CROSS_ERA_DISTANCE = 4;

/** The six composed systems an era changes, grouped by the block's own groups. */
const DOMAINS = [
  { name: "era-environment", label: "sky, lighting and street furniture" },
  { name: "buildings", label: "buildings" },
  { name: "storefronts", label: "storefronts" },
  { name: "era-advertising-system", label: "advertising" },
  { name: "era-vehicle-traffic", label: "vehicles" },
  { name: "pedestrian-crowd", label: "pedestrians" },
] as const;

/** `data-role` hooks the UI modules render, mirrored here as the DOM contract. */
const UI = {
  canvas: "#city-canvas",
  loading: "#loading-root",
  timelinePanel: '[data-role="timeline-panel"]',
  timelineStops: '[data-role="timeline-stop"]',
  hudYear: '[data-role="hud-year"]',
  hudEra: '[data-role="hud-era-name"]',
  infoCard: '[data-role="hud-info-card"]',
  infoTitle: '[data-role="hud-info-title"]',
  infoSubtitle: '[data-role="hud-info-subtitle"]',
  infoRows: '[data-role="hud-info-rows"]',
  infoClose: '[data-role="hud-info-close"]',
} as const;

interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One composed system's era and blend, as the scene reports them. */
interface SystemState {
  readonly id: string;
  readonly era: EraId;
  readonly blend: number;
}

/** Per-domain content fingerprint of one era's block. */
interface DomainFingerprint {
  readonly name: string;
  readonly label: string;
  readonly meshes: number;
  readonly vertices: number;
  readonly materials: number;
  /** Every material colour in the group, sorted (sky uniforms folded in). */
  readonly colors: string;
  /** Every light, as `type:colour:intensity`, sorted. */
  readonly lights: string;
  /** The composite identity two eras are compared on. */
  readonly signature: string;
}

/** Everything one era capture proves. */
interface EraCapture {
  readonly era: EraId;
  readonly label: string;
  readonly year: number;
  readonly steps: number;
  readonly report: Readonly<Record<string, EraId>>;
  readonly states: readonly SystemState[];
  readonly domains: readonly DomainFingerprint[];
  readonly signature: { readonly grid: readonly number[]; readonly mean: readonly number[] };
  readonly screenshot: string;
}

/** A clickable point on the canvas plus the object it resolves to. */
interface FocusCandidate {
  readonly clientX: number;
  readonly clientY: number;
  readonly kind: string;
  readonly id: string;
  readonly title: string;
}

/** Focus state plus the info card the HUD renders from it. */
interface FocusSnapshot {
  readonly kind: string;
  readonly era: EraId;
  readonly title: string;
  readonly worldPosition: Vec3;
  readonly gliding: boolean;
  readonly cardOpen: boolean;
  readonly cardTitle: string;
  readonly cardSubtitle: string;
  readonly cardRows: number;
}

/** Camera state and the clamps it currently breaks (an empty list means inside). */
interface NavigationState {
  readonly pose: { readonly position: Vec3; readonly target: Vec3 };
  readonly orbit: { readonly target: Vec3; readonly distance: number; readonly pitch: number };
  readonly bounds: {
    readonly target: {
      readonly minX: number;
      readonly maxX: number;
      readonly minZ: number;
      readonly maxZ: number;
    };
    readonly targetMinY: number;
    readonly targetMaxY: number;
    readonly eye: {
      readonly minX: number;
      readonly maxX: number;
      readonly minZ: number;
      readonly maxZ: number;
    };
    readonly eyeMinY: number;
    readonly eyeMaxY: number;
  };
  readonly config: {
    readonly minDistance: number;
    readonly maxDistance: number;
    readonly minPitch: number;
    readonly maxPitch: number;
  };
  readonly violations: readonly string[];
}

/** Shared, already-booted page. */
interface SharedApp {
  readonly page: Page;
}

const test = base.extend<object, { app: SharedApp }>({
  app: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: APP_URL,
        viewport: { ...APP_VIEWPORT },
      });
      const page = await context.newPage();
      await bootChronoCity(page);
      await parkRenderLoop(page);
      await use({ page });
      await context.close();
    },
    { scope: "worker" },
  ],
});

/** Boots the page and waits for the app's own readiness contract. */
async function bootChronoCity(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__chronoCity?.scene != null, null, {
    timeout: 120_000,
  });
  await expect(page.locator(UI.loading)).toHaveAttribute("data-state", "ready", {
    timeout: 120_000,
  });
  await expect(page.locator(UI.loading)).toBeHidden();
}

/**
 * Parks the app's `requestAnimationFrame` loop after boot.
 *
 * The composed scene stays exactly as the app built it - same systems, same
 * transition driver, same camera rig - but from here on the suite owns the
 * clock: `scene.update(dt)` advances one fixed step and `scene.render()` draws
 * one frame, both on demand. Without this the runner's software renderer would
 * spend ~600 ms of every frame painting the block, so each browser round trip
 * would queue behind a frame and the five-era walk would blow the test timeout.
 * Camera input and picking are unaffected: they are DOM-event driven and land in
 * `scene.update`/`scene.render` like any other frame.
 */
async function parkRenderLoop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const app = window.__chronoCity;
    if (!app) {
      throw new Error("Chrono City app handle is not available.");
    }
    app.loop.stop();
  });
}

/* -------------------------------------------------------------------------- */
/* In-page drivers                                                            */
/* -------------------------------------------------------------------------- */

/** Advances the composed block by `seconds` of simulated time, in fixed steps. */
async function advance(page: Page, seconds: number): Promise<void> {
  await page.evaluate(
    ({ step, seconds }) => {
      const scene = window.__chronoCity?.scene;
      if (!scene) {
        throw new Error("Chrono City scene is not available.");
      }
      const steps = Math.max(1, Math.ceil(seconds / step));
      for (let index = 0; index < steps; index += 1) {
        scene.update(step);
      }
    },
    { step: STEP_SECONDS, seconds },
  );
}

/**
 * Steps the simulation until the block has landed in `era`.
 *
 * Convergence is observed, never assumed: the driver must have stopped
 * travelling *and* every composed system must report `era`.
 */
async function settleOn(page: Page, era: EraId): Promise<number> {
  return page.evaluate(
    ({ era, step, maxSteps }) => {
      const scene = window.__chronoCity?.scene;
      if (!scene) {
        throw new Error("Chrono City scene is not available.");
      }
      for (let steps = 1; steps <= maxSteps; steps += 1) {
        scene.update(step);
        const report = scene.eraReport();
        const landed = Object.values(report).every((value) => value === era);
        if (!scene.transition.transitioning && landed) {
          return steps;
        }
      }
      throw new Error(`The Chrono City block never settled in ${era}.`);
    },
    { era, step: STEP_SECONDS, maxSteps: MAX_SETTLE_STEPS },
  );
}

/** Clicks the timeline stop for `era`. */
async function selectStop(page: Page, era: EraId): Promise<void> {
  await page.locator(`${UI.timelineStops}[data-era="${era}"]`).click();
  await expect(page.locator(UI.timelinePanel)).toHaveAttribute("data-era", era);
}

/**
 * Settles the block in `era`, then captures its per-domain content fingerprint
 * and a luminance signature of the freshly rendered frame.
 *
 * The signature is read straight out of the WebGL drawing buffer immediately
 * after a render, so nothing else - not the HUD, not the compositor - can leak
 * into it.
 */
async function captureEra(page: Page, era: EraId): Promise<EraCapture> {
  const capture = await page.evaluate(
    ({ era, domains, step, maxSteps, columns, rows }) => {
      const app = window.__chronoCity;
      const scene = app?.scene;
      const renderer = app?.view?.renderer;
      if (!scene || !renderer) {
        throw new Error("Chrono City scene is not available.");
      }

      /* ---- settle ------------------------------------------------------- */

      let steps = 0;
      for (steps = 1; steps <= maxSteps; steps += 1) {
        scene.update(step);
        const report = scene.eraReport();
        if (!scene.transition.transitioning && Object.values(report).every((value) => value === era)) {
          break;
        }
      }
      if (steps > maxSteps) {
        throw new Error(`The Chrono City block never settled in ${era}.`);
      }

      /* ---- per-domain fingerprint --------------------------------------- */

      const fingerprints = domains.map((domain) => {
        const group = scene.root.getObjectByName(domain.name);
        if (!group) {
          throw new Error(`Chrono City block is missing its ${domain.name} group.`);
        }
        const colors: string[] = [];
        const lights: string[] = [];
        const materials = new Set<string>();
        let meshes = 0;
        let vertices = 0;

        group.traverse((object) => {
          const candidate = object as {
            isMesh?: boolean;
            isLight?: boolean;
            type?: string;
            intensity?: number;
            geometry?: { attributes?: { position?: { count?: number } } };
            material?: unknown;
            color?: { getHexString(): string };
          };

          if (candidate.isMesh === true) {
            meshes += 1;
            vertices += candidate.geometry?.attributes?.position?.count ?? 0;
            const list = Array.isArray(candidate.material)
              ? candidate.material
              : [candidate.material];
            for (const entry of list) {
              const material = entry as {
                uuid?: string;
                color?: { getHexString(): string };
                uniforms?: Record<string, { value?: unknown }>;
              } | null;
              if (!material) continue;
              if (typeof material.uuid === "string") materials.add(material.uuid);
              material.color && colors.push(material.color.getHexString());
              // The sky dome is a shader material: its uniforms *are* the era's
              // lighting model, so they belong in the fingerprint.
              const uniforms = material.uniforms;
              const top = uniforms?.uTopColor?.value as { getHexString(): string } | undefined;
              if (top) {
                const shade = (key: string): string => {
                  const value = uniforms?.[key]?.value as { getHexString(): string } | undefined;
                  return value ? value.getHexString() : "none";
                };
                const intensity = uniforms?.uSunIntensity?.value as number | undefined;
                colors.push(`sky:${top.getHexString()}`);
                colors.push(`horizon:${shade("uHorizonColor")}`);
                colors.push(`sun:${shade("uSunColor")}`);
                colors.push(`sun-int:${(intensity ?? 0).toFixed(3)}`);
              }
            }
          }

          if (candidate.isLight === true && candidate.color) {
            lights.push(
              `${candidate.type}:${candidate.color.getHexString()}:${(candidate.intensity ?? 0).toFixed(2)}`,
            );
          }
        });

        colors.sort();
        lights.sort();
        const signature = [
          `meshes:${meshes}`,
          `vertices:${vertices}`,
          `materials:${materials.size}`,
          `colors:${colors.join(",")}`,
          `lights:${lights.join(",")}`,
        ].join("|");

        return {
          name: domain.name,
          label: domain.label,
          meshes,
          vertices,
          materials: materials.size,
          colors: colors.join(","),
          lights: lights.join(","),
          signature,
        };
      });

      /* ---- rendered frame signature ------------------------------------- */

      scene.render();
      const gl = renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

      const grid: number[] = [];
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const startX = Math.floor((column * width) / columns);
          const endX = Math.floor(((column + 1) * width) / columns);
          const startY = Math.floor((row * height) / rows);
          const endY = Math.floor(((row + 1) * height) / rows);
          let sum = 0;
          let count = 0;
          for (let y = startY; y < endY; y += 1) {
            for (let x = startX; x < endX; x += 1) {
              const index = (y * width + x) * 4;
              sum += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
              count += 1;
            }
          }
          grid.push(Number((sum / Math.max(1, count)).toFixed(3)));
        }
      }

      const sums = [0, 0, 0];
      for (let index = 0; index < pixels.length; index += 4) {
        sums[0] += pixels[index];
        sums[1] += pixels[index + 1];
        sums[2] += pixels[index + 2];
      }
      const total = pixels.length / 4;

      return {
        era,
        steps,
        report: { ...scene.eraReport() },
        states: scene.systemStates().map((state) => ({
          id: state.id,
          era: state.era,
          blend: state.blend,
        })),
        domains: fingerprints,
        signature: {
          grid,
          mean: sums.map((value) => Number((value / total).toFixed(3))),
        },
      };
    },
    {
      era,
      domains: DOMAINS,
      step: STEP_SECONDS,
      maxSteps: MAX_SETTLE_STEPS,
      columns: GRID_COLUMNS,
      rows: GRID_ROWS,
    },
  );

  const descriptor = ERAS.find((candidate) => candidate.id === era);
  if (!descriptor) {
    throw new Error(`Era ${era} is missing from the contract dataset.`);
  }
  return {
    ...capture,
    label: descriptor.label,
    year: descriptor.year,
    screenshot: path.join(ARTIFACTS_DIR, `era-${descriptor.year}.png`),
  };
}

/** Mean absolute luminance-grid difference between two frame signatures. */
function signatureDistance(left: EraCapture, right: EraCapture): number {
  const leftGrid = left.signature.grid;
  const rightGrid = right.signature.grid;
  let sum = 0;
  for (let index = 0; index < leftGrid.length; index += 1) {
    sum += Math.abs(leftGrid[index] - rightGrid[index]);
  }
  return sum / leftGrid.length;
}

/**
 * FNV-1a digest of a fingerprint list.
 *
 * Only used for the evidence JSON: the assertions compare the raw lists, but a
 * digest keeps the written summary readable instead of megabytes of colours.
 */
function digest(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

/** Reads the camera pose, its bounds and every clamp the pose currently breaks. */
async function readNavigation(page: Page): Promise<NavigationState> {
  return page.evaluate(() => {
    const scene = window.__chronoCity?.scene;
    if (!scene) {
      throw new Error("Chrono City scene is not available.");
    }
    const rig = scene.camera;
    const pose = rig.pose;
    const orbit = rig.orbit;
    const bounds = rig.bounds;
    const config = rig.config;

    const violations: string[] = [];
    if (pose.position.x < bounds.eye.minX || pose.position.x > bounds.eye.maxX) violations.push("eye.x");
    if (pose.position.y < bounds.eyeMinY || pose.position.y > bounds.eyeMaxY) violations.push("eye.y");
    if (pose.position.z < bounds.eye.minZ || pose.position.z > bounds.eye.maxZ) violations.push("eye.z");
    if (orbit.target.x < bounds.target.minX || orbit.target.x > bounds.target.maxX) {
      violations.push("target.x");
    }
    if (orbit.target.y < bounds.targetMinY || orbit.target.y > bounds.targetMaxY) {
      violations.push("target.y");
    }
    if (orbit.target.z < bounds.target.minZ || orbit.target.z > bounds.target.maxZ) {
      violations.push("target.z");
    }
    if (orbit.pitch < config.minPitch || orbit.pitch > config.maxPitch) violations.push("pitch");
    if (orbit.distance < config.minDistance || orbit.distance > config.maxDistance) {
      violations.push("distance");
    }

    return {
      pose: { position: pose.position, target: pose.target },
      orbit: { target: orbit.target, distance: orbit.distance, pitch: orbit.pitch },
      bounds: {
        target: bounds.target,
        targetMinY: bounds.targetMinY,
        targetMaxY: bounds.targetMaxY,
        eye: bounds.eye,
        eyeMinY: bounds.eyeMinY,
        eyeMaxY: bounds.eyeMaxY,
      },
      config: {
        minDistance: config.minDistance,
        maxDistance: config.maxDistance,
        minPitch: config.minPitch,
        maxPitch: config.maxPitch,
      },
      violations,
    };
  });
}

/**
 * Finds canvas points whose click would inspect a pickable of `kind`.
 *
 * For every registered target of that kind the object's world bounding box is
 * projected into client space and a few interior points are sampled, because a
 * vehicle's *origin* sits on the road surface below its own silhouette: the ray
 * through it misses the body, while the box centre lands on it. A point is only
 * accepted when both of these hold, in the page:
 *
 *   1. `focus.pickAt(point)` resolves to a target of `kind` - that is the
 *      controller's own click entry point, so the click that follows inspects
 *      that object and not an occluder;
 *   2. `document.elementFromPoint(point)` is the canvas itself - nothing in the
 *      HUD or the timeline swallows the click.
 *
 * The render loop is parked while this runs, so the scene is frozen and every
 * returned point stays valid until the test acts on it.
 */
async function findFocusCandidates(
  page: Page,
  kind: "building" | "vehicle",
  limit = 6,
): Promise<readonly FocusCandidate[]> {
  return page.evaluate(
    ({ kind, limit }) => {
      const app = window.__chronoCity;
      const scene = app?.scene;
      const canvas = document.querySelector("#city-canvas") as HTMLCanvasElement | null;
      if (!scene || !canvas) {
        throw new Error("Chrono City canvas is not available.");
      }
      const box = canvas.getBoundingClientRect();
      const camera = scene.camera.camera;
      /** Sample points inside the projected box, centre first. */
      const samples = [
        [0.5, 0.5],
        [0.5, 0.35],
        [0.5, 0.65],
        [0.35, 0.5],
        [0.65, 0.5],
      ] as const;

      const found: {
        clientX: number;
        clientY: number;
        kind: string;
        id: string;
        title: string;
      }[] = [];
      const seen = new Set<string>();

      for (const entry of scene.focus.registry.list()) {
        if (entry.target.kind !== kind || seen.has(entry.target.id)) continue;

        // World-space bounding box, assembled from the object's own geometry so
        // nothing has to be imported into the page.
        const min = { x: Infinity, y: Infinity, z: Infinity };
        const max = { x: -Infinity, y: -Infinity, z: -Infinity };
        entry.object.updateWorldMatrix(true, true);
        entry.object.traverse((child) => {
          const mesh = child as {
            isMesh?: boolean;
            visible?: boolean;
            geometry?: { boundingBox?: { min: Vec3; max: Vec3 }; computeBoundingBox?: () => void };
            matrixWorld?: { elements: number[] };
          };
          if (mesh.isMesh !== true || mesh.visible === false || !mesh.geometry || !mesh.matrixWorld) {
            return;
          }
          const geometry = mesh.geometry;
          if (!geometry.boundingBox) geometry.computeBoundingBox?.();
          const corners = geometry.boundingBox;
          if (!corners) return;
          const elements = mesh.matrixWorld.elements;
          for (const x of [corners.min.x, corners.max.x]) {
            for (const y of [corners.min.y, corners.max.y]) {
              for (const z of [corners.min.z, corners.max.z]) {
                const worldX = elements[0] * x + elements[4] * y + elements[8] * z + elements[12];
                const worldY = elements[1] * x + elements[5] * y + elements[9] * z + elements[13];
                const worldZ = elements[2] * x + elements[6] * y + elements[10] * z + elements[14];
                min.x = Math.min(min.x, worldX);
                min.y = Math.min(min.y, worldY);
                min.z = Math.min(min.z, worldZ);
                max.x = Math.max(max.x, worldX);
                max.y = Math.max(max.y, worldY);
                max.z = Math.max(max.z, worldZ);
              }
            }
          }
        });
        if (!Number.isFinite(min.x) || !Number.isFinite(max.x)) continue;

        // Project the eight corners: their client-space hull is the object's
        // on-screen footprint.
        const scratch = entry.object.position.clone();
        const project = (x: number, y: number, z: number): { x: number; y: number } => {
          scratch.set(x, y, z).project(camera);
          return {
            x: box.left + ((scratch.x + 1) / 2) * box.width,
            y: box.top + ((1 - scratch.y) / 2) * box.height,
          };
        };
        let left = Infinity;
        let right = -Infinity;
        let top = Infinity;
        let bottom = -Infinity;
        for (const x of [min.x, max.x]) {
          for (const y of [min.y, max.y]) {
            for (const z of [min.z, max.z]) {
              const point = project(x, y, z);
              left = Math.min(left, point.x);
              right = Math.max(right, point.x);
              top = Math.min(top, point.y);
              bottom = Math.max(bottom, point.y);
            }
          }
        }
        if (right < box.left + 3 || left > box.right - 3 || bottom < box.top + 3 || top > box.bottom - 3) {
          continue;
        }

        let matched = false;
        for (const [fx, fy] of samples) {
          const clientX = left + (right - left) * fx;
          const clientY = top + (bottom - top) * fy;
          if (
            clientX < box.left + 2 ||
            clientX > box.right - 2 ||
            clientY < box.top + 2 ||
            clientY > box.bottom - 2
          ) {
            continue;
          }
          if (document.elementFromPoint(clientX, clientY) !== canvas) continue;
          const hit = scene.focus.pickAt(clientX, clientY);
          if (!hit || hit.target.kind !== kind) continue;
          found.push({
            clientX: Math.round(clientX),
            clientY: Math.round(clientY),
            kind: hit.target.kind,
            id: hit.target.id,
            title: hit.target.title,
          });
          seen.add(entry.target.id);
          matched = true;
          break;
        }
        if (matched && found.length >= limit) break;
      }
      return found;
    },
    { kind, limit },
  );
}

/** Diagnostics for a failed candidate search: what the scene exposes to clicks. */
async function describeFocusAvailability(page: Page): Promise<string> {
  return page.evaluate(() => {
    const scene = window.__chronoCity?.scene;
    if (!scene) {
      return "scene unavailable";
    }
    const counts: Record<string, number> = {};
    for (const entry of scene.focus.registry.list()) {
      counts[entry.target.kind] = (counts[entry.target.kind] ?? 0) + 1;
    }
    const vehicles = scene.vehicles;
    return `pickables=${JSON.stringify(counts)} vehicles=${JSON.stringify({
      era: vehicles.activeEra,
      actors: scene.focus.registry.list().filter((entry) => entry.target.kind === "vehicle").length,
    })}`;
  });
}

/** Reads the focused object and the info card the composition fed it into. */
async function readFocus(page: Page): Promise<FocusSnapshot> {
  return page.evaluate(() => {
    const scene = window.__chronoCity?.scene;
    if (!scene) {
      throw new Error("Chrono City scene is not available.");
    }
    const info = scene.focus.focused;
    const text = (selector: string): string =>
      document.querySelector(selector)?.textContent?.trim() ?? "";
    return {
      kind: info ? info.kind : "",
      era: info ? info.era : scene.era,
      title: info ? info.title : "",
      worldPosition: info ? info.worldPosition : { x: 0, y: 0, z: 0 },
      gliding: scene.camera.isGliding,
      cardOpen:
        document.querySelector('[data-role="hud-panel"]')?.getAttribute("data-info-card") === "open",
      cardTitle: text('[data-role="hud-info-title"]'),
      cardSubtitle: text('[data-role="hud-info-subtitle"]'),
      cardRows: document.querySelectorAll('[data-role="hud-info-rows"] dt').length,
    };
  });
}

/** Steps the simulation until the camera has stopped gliding. */
async function settleCamera(page: Page): Promise<number> {
  return page.evaluate(
    ({ step, maxSteps }) => {
      const scene = window.__chronoCity?.scene;
      if (!scene) {
        throw new Error("Chrono City scene is not available.");
      }
      for (let steps = 1; steps <= maxSteps; steps += 1) {
        scene.update(step);
        if (!scene.camera.isGliding) {
          return steps;
        }
      }
      throw new Error("The Chrono City camera never finished its glide.");
    },
    { step: STEP_SECONDS, maxSteps: MAX_SETTLE_STEPS },
  );
}

/* -------------------------------------------------------------------------- */
/* Specs                                                                      */
/* -------------------------------------------------------------------------- */

test.describe.configure({ mode: "serial" });

test.describe("Chrono City era states and navigation", () => {
  test("captures one screenshot per era and proves the five canvas states are visually distinct", async ({
    app,
  }, testInfo: TestInfo) => {
    const { page } = app;
    mkdirSync(ARTIFACTS_DIR, { recursive: true });

    const captures: EraCapture[] = [];
    for (const era of ERAS) {
      await selectStop(page, era.id);
      const capture = await captureEra(page, era.id);

      // The transformation really landed before the frame was captured.
      expect(capture.report.buildings).toBe(era.id);
      expect(capture.report.vehicles).toBe(era.id);
      expect(capture.states.every((state) => state.era === era.id && state.blend === 1)).toBe(true);
      // The HUD is part of the evidence, so the readout must agree first.
      await expect(page.locator(UI.hudYear)).toHaveText(era.label);
      await expect(page.locator(UI.hudEra)).toHaveText(era.title);

      // The render loop is parked, so draw the frame the assertions above were
      // made on immediately before capturing it. The page is exactly one
      // viewport tall, so a plain screenshot already contains the canvas, the
      // timeline and the HUD readouts.
      await page.evaluate(() => window.__chronoCity?.scene?.render());
      await page.screenshot({ path: capture.screenshot });
      await testInfo.attach(`era-${era.label}`, {
        path: capture.screenshot,
        contentType: "image/png",
      });

      const bytes = readFileSync(capture.screenshot);
      expect(bytes.byteLength, `screenshot for ${era.label} must not be empty`).toBeGreaterThan(5_000);
      expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");

      captures.push(capture);
    }

    // One capture per contract stop, in order.
    expect(captures.map((capture) => capture.year)).toEqual(ERAS.map((era) => era.year));

    // Every domain the acceptance criteria name must actually change per era.
    for (const domain of DOMAINS) {
      const signatures = captures.map(
        (capture) => capture.domains.find((entry) => entry.name === domain.name)!.signature,
      );
      expect(new Set(signatures).size, `${domain.label} must differ in all five eras`).toBe(
        ERAS.length,
      );
    }

    // Lighting is called out separately: the lights themselves must change.
    const lightSignatures = captures.map(
      (capture) => capture.domains.find((entry) => entry.name === "era-environment")!.lights,
    );
    expect(new Set(lightSignatures).size).toBe(ERAS.length);

    // The captured frames are five different pictures, not one frame saved five
    // times.
    for (let left = 0; left < captures.length; left += 1) {
      for (let right = left + 1; right < captures.length; right += 1) {
        const leftBytes = readFileSync(captures[left].screenshot);
        const rightBytes = readFileSync(captures[right].screenshot);
        expect(
          leftBytes.equals(rightBytes),
          `${captures[left].label} and ${captures[right].label} must capture different frames`,
        ).toBe(false);
      }
    }

    // ...and they differ by far more than animation noise: the pixel signature
    // has a same-era control that proves the metric measures the era.
    const crossEraDistances = captures.flatMap((capture, left) =>
      captures.slice(left + 1).map((other) => ({
        pair: `${capture.label}-${other.label}`,
        distance: signatureDistance(capture, other),
      })),
    );
    for (const entry of crossEraDistances) {
      expect(
        entry.distance,
        `canvas states ${entry.pair} must differ by more than ${MIN_CROSS_ERA_DISTANCE}`,
      ).toBeGreaterThan(MIN_CROSS_ERA_DISTANCE);
    }

    const lastEra = captures[captures.length - 1];
    await advance(page, 0.5);
    const control = await captureEra(page, lastEra.era);
    const controlDistance = signatureDistance(lastEra, control);
    expect(
      controlDistance,
      "repeated captures inside one era must stay within the noise floor",
    ).toBeLessThan(MAX_SAME_ERA_DISTANCE);
    expect(
      Math.min(...crossEraDistances.map((entry) => entry.distance)),
      "cross-era differences must dominate the same-era noise floor",
    ).toBeGreaterThan(controlDistance * 3);

    // Fingerprint summary for review, alongside the screenshots.
    writeFileSync(
      path.join(ARTIFACTS_DIR, "era-fingerprints.json"),
      `${JSON.stringify(
        {
          viewport: APP_VIEWPORT,
          pixelThresholds: { MAX_SAME_ERA_DISTANCE, MIN_CROSS_ERA_DISTANCE },
          captures: captures.map((capture) => ({
            era: capture.era,
            year: capture.year,
            steps: capture.steps,
            screenshot: path.basename(capture.screenshot),
            bytes: statSync(capture.screenshot).size,
            signature: capture.signature,
            domains: capture.domains.map((domain) => ({
              name: domain.name,
              label: domain.label,
              meshes: domain.meshes,
              vertices: domain.vertices,
              materials: domain.materials,
              colorDigest: digest(domain.colors),
              lights: domain.lights,
            })),
          })),
          crossEraDistances,
          sameEraControlDistance: Number(controlDistance.toFixed(4)),
        },
        null,
        2,
      )}\n`,
    );
  });

  test("keeps orbit, pan, zoom and keyboard movement inside the navigation bounds", async ({
    app,
  }) => {
    const { page } = app;
    const canvas = page.locator(UI.canvas);
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    const centerX = box!.x + box!.width / 2;
    const centerY = box!.y + box!.height / 2;

    /** Asserts the camera is inside every clamp the rig enforces. */
    const expectInsideBounds = async (phase: string): Promise<NavigationState> => {
      const state = await readNavigation(page);
      expect(state.violations, `${phase} must stay inside the navigation bounds`).toEqual([]);
      return state;
    };

    /** Drags across the canvas with an optional modifier held down. */
    const drag = async (dx: number, dy: number, modifier?: "Shift"): Promise<void> => {
      if (modifier) {
        await page.keyboard.down(modifier);
      }
      await page.mouse.move(centerX, centerY);
      await page.mouse.down();
      await page.mouse.move(centerX + dx, centerY + dy, { steps: 12 });
      await page.mouse.up();
      if (modifier) {
        await page.keyboard.up(modifier);
      }
      // The rig damps towards its clamped target; give it the frames to land.
      await advance(page, 1);
    };

    const start = await expectInsideBounds("the establishing view");

    // Orbit: two oversized drags push hard into the pitch and eye clamps.
    await drag(700, 260);
    await drag(700, 260);
    const orbited = await expectInsideBounds("an oversized orbit drag");
    expect(orbited.pose.position).not.toEqual(start.pose.position);
    expect(orbited.orbit.pitch).toBeGreaterThanOrEqual(orbited.config.minPitch);
    expect(orbited.orbit.pitch).toBeLessThanOrEqual(orbited.config.maxPitch);
    expect(orbited.orbit.pitch).not.toEqual(start.orbit.pitch);

    // Pan: shift-drag pushes the pivot across the block envelope.
    await drag(-700, -320, "Shift");
    const panned = await expectInsideBounds("an oversized pan drag");
    expect(panned.orbit.target).not.toEqual(orbited.orbit.target);

    // Zoom: the wheel is clamped at both ends of the boom.
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 6_000);
    await advance(page, 1);
    const zoomedOut = await expectInsideBounds("an oversized zoom out");
    expect(zoomedOut.orbit.distance).toBeGreaterThan(panned.orbit.distance);
    expect(zoomedOut.orbit.distance).toBeLessThanOrEqual(zoomedOut.config.maxDistance);

    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, -6_000);
    await advance(page, 1);
    const zoomedIn = await expectInsideBounds("an oversized zoom in");
    expect(zoomedIn.orbit.distance).toBeLessThan(zoomedOut.orbit.distance);
    expect(zoomedIn.orbit.distance).toBeGreaterThanOrEqual(zoomedIn.config.minDistance);

    // Keyboard: the focused canvas owns WASD movement, so hold keys and let the
    // shared loop integrate them; pivot and eye must stay inside the envelope.
    await canvas.focus();
    await expect(canvas).toBeFocused();
    const beforeKeys = await readNavigation(page);
    await page.keyboard.down("w");
    await advance(page, 6);
    await page.keyboard.up("w");
    await page.keyboard.down("a");
    await advance(page, 4);
    await page.keyboard.up("a");
    await page.keyboard.down("r");
    await advance(page, 3);
    await page.keyboard.up("r");
    const afterKeys = await expectInsideBounds("held keyboard movement");
    expect(afterKeys.pose.position).not.toEqual(beforeKeys.pose.position);
    expect(afterKeys.orbit.target).not.toEqual(beforeKeys.orbit.target);

    // The final state is still bounded, explicitly, on every axis.
    const finalState = await expectInsideBounds("the end of the navigation sweep");
    expect(finalState.pose.position.x).toBeGreaterThanOrEqual(finalState.bounds.eye.minX);
    expect(finalState.pose.position.x).toBeLessThanOrEqual(finalState.bounds.eye.maxX);
    expect(finalState.pose.position.y).toBeGreaterThanOrEqual(finalState.bounds.eyeMinY);
    expect(finalState.pose.position.y).toBeLessThanOrEqual(finalState.bounds.eyeMaxY);
    expect(finalState.pose.position.z).toBeGreaterThanOrEqual(finalState.bounds.eye.minZ);
    expect(finalState.pose.position.z).toBeLessThanOrEqual(finalState.bounds.eye.maxZ);
    expect(finalState.orbit.target.x).toBeGreaterThanOrEqual(finalState.bounds.target.minX);
    expect(finalState.orbit.target.x).toBeLessThanOrEqual(finalState.bounds.target.maxX);
    expect(finalState.orbit.target.z).toBeGreaterThanOrEqual(finalState.bounds.target.minZ);
    expect(finalState.orbit.target.z).toBeLessThanOrEqual(finalState.bounds.target.maxZ);
  });

  test("glides the camera and opens an era-aware info card when a building or vehicle is clicked", async ({
    app,
  }) => {
    const { page } = app;
    const era = ERAS[2]!; // 1985: distinct from the block's initial era.
    await selectStop(page, era.id);
    await settleOn(page, era.id);

    /**
     * Restores the establishing view.
     *
     * The navigation spec deliberately leaves the camera pushed into its clamps,
     * so the inspection test starts from the authored landmark view - the same
     * view a user gets by pressing the documented Home shortcut - to make the
     * on-screen pick targets independent of test order.
     */
    const restoreEstablishingView = async (): Promise<void> => {
      await page.locator(UI.canvas).focus();
      await page.keyboard.press("Home");
      await advance(page, 2);
    };
    await restoreEstablishingView();

    /** Clicks `kind` on the canvas until the inspection card reports it. */
    const clickKind = async (kind: "building" | "vehicle"): Promise<FocusSnapshot> => {
      const candidates = await findFocusCandidates(page, kind);
      if (candidates.length === 0) {
        throw new Error(
          `the block must expose a clickable ${kind}: ${await describeFocusAvailability(page)}`,
        );
      }

      for (const candidate of candidates) {
        await page.mouse.click(candidate.clientX, candidate.clientY);
        const focused = await readFocus(page);
        if (focused.kind === kind) {
          return focused;
        }
      }
      throw new Error(`Clicking the canvas never inspected a ${kind}.`);
    };

    // --- a vehicle: the click glides the camera and fills the card ----------
    const beforeVehicle = await readNavigation(page);
    const vehicle = await clickKind("vehicle");
    expect(vehicle.kind).toBe("vehicle");
    expect(vehicle.era).toBe(era.id);
    expect(vehicle.gliding).toBe(true);
    expect(vehicle.cardOpen).toBe(true);
    expect(vehicle.cardTitle.length).toBeGreaterThan(0);
    expect(vehicle.cardSubtitle).toBe(`${era.label} · ${era.title} · vehicle`);
    expect(vehicle.cardRows).toBeGreaterThan(0);

    const glideSteps = await settleCamera(page);
    expect(glideSteps).toBeGreaterThan(0);
    const afterGlide = await readNavigation(page);
    expect(afterGlide.pose.position).not.toEqual(beforeVehicle.pose.position);
    // The glide frames the inspected object: the pivot lands on it (its height
    // is clamped into the authored pivot range), so the camera really travelled
    // to the vehicle instead of merely changing pose.
    expect(afterGlide.orbit.target.x).toBeCloseTo(vehicle.worldPosition.x, 0);
    expect(afterGlide.orbit.target.z).toBeCloseTo(vehicle.worldPosition.z, 0);

    // Closing the card clears the selection again.
    await page.locator(UI.infoClose).click();
    await expect(page.locator(UI.infoCard)).toBeHidden();
    expect((await readFocus(page)).kind).toBe("");

    // --- a building: same path, era-aware card ------------------------------
    await restoreEstablishingView();

    const building = await clickKind("building");
    expect(building.kind).toBe("building");
    expect(building.era).toBe(era.id);
    expect(building.cardOpen).toBe(true);
    expect(building.cardSubtitle).toBe(`${era.label} · ${era.title} · building`);
    expect(building.cardTitle).toBe(building.title);
    expect(building.cardRows).toBeGreaterThan(1);
    await expect(page.locator(UI.infoTitle)).toHaveText(building.title);
    await expect(page.locator(UI.infoSubtitle)).toHaveText(`${era.label} · ${era.title} · building`);
    await expect(page.locator(UI.infoRows).locator("dt")).toHaveCount(building.cardRows);
    await expect(page.locator(UI.infoCard)).toBeVisible();
  });
});
