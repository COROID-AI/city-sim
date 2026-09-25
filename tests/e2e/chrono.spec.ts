import { expect, test as base, type Page } from "@playwright/test";

import { ERAS, type EraId } from "../../src/era/eraTypes";

/**
 * Chrono City end-to-end suite: the top timeline, the HUD and the composed era
 * transformation, driven through the real built bundle.
 *
 * The specs serve `dist/` through `vite preview` (see `playwright.config.ts`),
 * so they exercise the same artefact the delivery gate inspects. Two properties
 * of this app shape the harness:
 *
 *   1. The scene is heavy. On a software-rendered runner the shared fixed-step
 *      loop paints a few frames per second, and the loop clamps each frame's
 *      delta, so simulated time advances far slower than wall-clock time: one
 *      ~2.5 s era transformation takes about a minute of real time, and every
 *      protocol round trip waits behind those multi-hundred-millisecond frames.
 *      After boot the suite therefore parks the app's render loop and drives the
 *      very same scene by hand - `scene.update(dt)` in fixed steps (see
 *      {@link settleOn}) - so a transformation lands in milliseconds and the
 *      browser only draws a frame when a spec asks for one. Nothing is stubbed:
 *      real geometry, real transition driver, real DOM events.
 *   2. Booting is expensive (~15 s), so the file boots one page in a
 *      worker-scoped fixture and every test shares it.
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

/** Number of systems the transition driver choreographs. */
const SYSTEM_COUNT = 8;

/** `data-role` hooks the UI modules render, mirrored here as the DOM contract. */
const UI = {
  canvas: "#city-canvas",
  loading: "#loading-root",
  timelineRoot: "#timeline-root",
  timelinePanel: '[data-role="timeline-panel"]',
  timelineStops: '[data-role="timeline-stop"]',
  playhead: '[data-role="timeline-playhead"]',
  hudRoot: "#hud-root",
  hudPanel: '[data-role="hud-panel"]',
  hudYear: '[data-role="hud-year"]',
  hudEra: '[data-role="hud-era-name"]',
  hudTagline: '[data-role="hud-tagline"]',
  hudMute: '[data-role="hud-mute"]',
  hudMuteLabel: '[data-role="hud-mute-label"]',
  hudHelp: '[data-role="hud-help"]',
  hudHelpPanel: '[data-role="hud-help-panel"]',
  hudHelpList: '[data-role="hud-help-list"]',
} as const;

/**
 * Controls the help overlay documents.
 *
 * Spelled out here (rather than imported from the HUD module, which imports CSS)
 * so a silently shortened overlay fails the suite.
 */
const DOCUMENTED_CONTROLS = [
  "Click / tap a year",
  "Drag the rail",
  "← / →",
  "1 – 5",
  "Click the block",
  "Sound",
] as const;

/** One composed system's era and blend, as the scene reports them. */
interface SystemState {
  readonly id: string;
  readonly era: EraId;
  readonly blend: number;
}

/** Snapshot of the composed block's era state, read through the app handle. */
interface SceneState {
  readonly era: EraId;
  readonly transitioning: boolean;
  readonly targetEra: EraId;
  readonly settledEra: EraId;
  readonly progress: number;
  readonly report: Readonly<Record<string, EraId>>;
  readonly states: readonly SystemState[];
}

/** Shared, already-booted page plus the console errors it produced. */
interface SharedApp {
  readonly page: Page;
  readonly consoleErrors: string[];
}

/**
 * Worker-scoped booted app.
 *
 * Sharing the page between tests is safe because each test re-establishes the
 * era it needs through real UI interaction, so test order cannot change an
 * outcome - and booting once per file keeps the suite inside its time budget.
 */
const test = base.extend<object, { app: SharedApp }>({
  app: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        baseURL: APP_URL,
        viewport: { ...APP_VIEWPORT },
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error") {
          consoleErrors.push(message.text());
        }
      });
      page.on("pageerror", (error) => {
        consoleErrors.push(error.message);
      });

      await bootChronoCity(page);
      await parkRenderLoop(page);

      await use({ page, consoleErrors });
      await context.close();
    },
    { scope: "worker" },
  ],
});

/** Boots the page and waits for the app's own readiness contract. */
async function bootChronoCity(page: Page): Promise<void> {
  await page.goto("/");
  // `main.ts` publishes the handle once the scene is composed.
  await page.waitForFunction(() => window.__chronoCity?.scene != null, null, {
    timeout: 120_000,
  });
  // ...and marks the overlay ready from inside the first rendered frame.
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
 * would queue behind a frame and a five-era walk would blow the test timeout.
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
 * travelling *and* every composed system must report `era`. Returns the number
 * of steps it took, so a caller can assert that a transformation really ran.
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

/** Reads the composed block's era state through the public app handle. */
async function readScene(page: Page): Promise<SceneState> {
  return page.evaluate(() => {
    const scene = window.__chronoCity?.scene;
    if (!scene) {
      throw new Error("Chrono City scene is not available.");
    }
    return {
      era: scene.era,
      transitioning: scene.transition.transitioning,
      targetEra: scene.transition.targetEra,
      settledEra: scene.transition.settledEra,
      progress: scene.transition.progress,
      report: { ...scene.eraReport() },
      states: scene.systemStates().map((state) => ({
        id: state.id,
        era: state.era,
        blend: state.blend,
      })),
    };
  });
}

/** Reads the sound state the HUD's mute control drives. */
async function readAudioMuted(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const sfx = window.__chronoCity?.sfx;
    if (!sfx) {
      throw new Error("Chrono City audio engine is not available.");
    }
    return sfx.state.muted;
  });
}

/** Looks up the era descriptor the assertions are anchored to. */
function eraFor(era: EraId): (typeof ERAS)[number] {
  const descriptor = ERAS.find((candidate) => candidate.id === era);
  if (!descriptor) {
    throw new Error(`Era ${era} is missing from the contract dataset.`);
  }
  return descriptor;
}

/** The ARIA value text the slider must report for `era`. */
function valueText(era: EraId): string {
  const descriptor = eraFor(era);
  return `${descriptor.label} — ${descriptor.title}`;
}

/** Locator for the timeline stop button of `era`. */
function stopFor(page: Page, era: EraId) {
  return page.locator(`${UI.timelineStops}[data-era="${era}"]`);
}

/** Clicks the timeline stop for `era` and waits for the panel to follow it. */
async function selectStop(page: Page, era: EraId): Promise<void> {
  await stopFor(page, era).click();
  await expect(page.locator(UI.timelinePanel)).toHaveAttribute("data-era", era);
}

/* -------------------------------------------------------------------------- */
/* Specs                                                                      */
/* -------------------------------------------------------------------------- */

test.describe.configure({ mode: "serial" });

test.describe("Chrono City timeline and HUD", () => {
  test("boots the built app with a live WebGL canvas and the five-stop timeline", async ({
    app,
  }) => {
    const { page, consoleErrors } = app;

    await expect(page.locator(UI.canvas)).toBeVisible();
    await expect(page.locator(UI.timelineRoot)).toBeAttached();
    await expect(page.locator(UI.hudRoot)).toBeAttached();

    // The canvas owns a sized drawing buffer with a live WebGL 2 context.
    const surface = await page.locator(UI.canvas).evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      return {
        width: canvas.width,
        height: canvas.height,
        webgl: canvas.getContext("webgl2") !== null,
      };
    });
    expect(surface.width).toBeGreaterThan(0);
    expect(surface.height).toBeGreaterThan(0);
    expect(surface.webgl).toBe(true);

    // The transport is pinned to the top edge of the viewport.
    const timelineBox = await page.locator(UI.timelineRoot).boundingBox();
    expect(timelineBox).not.toBeNull();
    expect(timelineBox!.y).toBeLessThanOrEqual(1);

    // Exactly the five contract stops, in contract order, labelled by year.
    const stops = page.locator(UI.timelineStops);
    await expect(stops).toHaveCount(ERAS.length);
    await expect(stops).toHaveText(ERAS.map((era) => era.label));
    for (const [index, era] of ERAS.entries()) {
      await expect(stops.nth(index)).toHaveAttribute("data-era", era.id);
      await expect(stops.nth(index)).toHaveAttribute("aria-label", `${era.label}: ${era.title}`);
    }

    // The rail exposes one ARIA slider spanning the timeline's year range.
    const playhead = page.locator(UI.playhead);
    await expect(playhead).toHaveAttribute("role", "slider");
    await expect(playhead).toHaveAttribute("aria-valuemin", String(ERAS[0].year));
    await expect(playhead).toHaveAttribute("aria-valuemax", String(ERAS[ERAS.length - 1].year));

    // The block starts settled on the first stop and the HUD agrees.
    const initial = await readScene(page);
    expect(initial.era).toBe(ERAS[0].id);
    expect(initial.transitioning).toBe(false);
    await expect(page.locator(UI.hudYear)).toHaveText(ERAS[0].label);
    await expect(page.locator(UI.hudEra)).toHaveText(ERAS[0].title);

    expect(consoleErrors).toEqual([]);
  });

  test("walks all five stops: every selection runs the staged transformation and lands that era", async ({
    app,
  }) => {
    const { page } = app;
    // 1945 is where the block starts, so it is selected at the end of the walk.
    const walk: readonly EraId[] = ["1965", "1985", "2005", "2025", "1945"];
    const playhead = page.locator(UI.playhead);

    for (const era of walk) {
      const descriptor = eraFor(era);

      await selectStop(page, era);

      // Selecting a stop aims the whole block at that era straight away.
      const aimed = await readScene(page);
      expect(aimed.era).toBe(era);
      expect(aimed.targetEra).toBe(era);
      expect(aimed.transitioning).toBe(true);
      expect(aimed.states).toHaveLength(SYSTEM_COUNT);

      // The transport and HUD follow the picked year while the block is morphing.
      await expect(playhead).toHaveAttribute("aria-valuenow", String(descriptor.year));
      await expect(playhead).toHaveAttribute("aria-valuetext", valueText(era));
      await expect(stopFor(page, era)).toHaveAttribute("aria-current", "true");
      await expect(page.locator(UI.hudYear)).toHaveText(descriptor.label);
      await expect(page.locator(UI.hudEra)).toHaveText(descriptor.title);

      // Mid-flight the choreography is genuinely staged: the environment has
      // moved furthest while street life has barely started.
      await advance(page, 0.8);
      const midFlight = await readScene(page);
      expect(midFlight.transitioning).toBe(true);
      expect(midFlight.progress).toBeGreaterThan(0.05);
      expect(midFlight.progress).toBeLessThan(0.95);
      const morphing = midFlight.states.filter((state) => state.blend > 0 && state.blend < 1);
      expect(morphing.length).toBeGreaterThanOrEqual(2);
      const environment = midFlight.states.find((state) => state.id === "environment")!;
      for (const state of midFlight.states.filter(
        (candidate) => candidate.id === "vehicles" || candidate.id === "pedestrians",
      )) {
        expect(environment.blend).toBeGreaterThanOrEqual(state.blend);
      }

      // Compressed time to the landing: every composed system reports the era.
      await settleOn(page, era);
      const landed = await readScene(page);
      expect(landed.transitioning).toBe(false);
      expect(landed.settledEra).toBe(era);
      expect(Object.values(landed.report).every((value) => value === era)).toBe(true);
      for (const state of landed.states) {
        expect(state.era).toBe(era);
        expect(state.blend).toBe(1);
      }
      await expect(page.locator(UI.hudYear)).toHaveText(descriptor.label);
      await expect(page.locator(UI.hudEra)).toHaveText(descriptor.title);
      await expect(page.locator(UI.hudTagline)).toHaveText(descriptor.tagline);
    }
  });

  test("drives the timeline from the keyboard and keeps its ARIA slider state in step", async ({
    app,
  }) => {
    const { page } = app;
    const playhead = page.locator(UI.playhead);
    const panel = page.locator(UI.timelinePanel);

    await playhead.focus();
    await expect(playhead).toBeFocused();

    /** Asserts the transport, the block and the HUD all agree on `era`. */
    const expectSelection = async (era: EraId): Promise<void> => {
      const descriptor = eraFor(era);
      await expect(panel).toHaveAttribute("data-era", era);
      await expect(playhead).toHaveAttribute("aria-valuenow", String(descriptor.year));
      await expect(playhead).toHaveAttribute("aria-valuetext", valueText(era));
      await expect(page.locator(UI.hudYear)).toHaveText(descriptor.label);
      const scene = await readScene(page);
      expect(scene.era).toBe(era);
      expect(scene.targetEra).toBe(era);
    };

    // End / Home jump to the last and the first stop.
    await page.keyboard.press("End");
    await expectSelection("2025");
    await page.keyboard.press("Home");
    await expectSelection("1945");

    // Arrows step exactly one stop, both directions, with Up/Down as aliases.
    await page.keyboard.press("ArrowRight");
    await expectSelection("1965");
    await page.keyboard.press("ArrowRight");
    await expectSelection("1985");
    await page.keyboard.press("ArrowLeft");
    await expectSelection("1965");
    await page.keyboard.press("ArrowDown");
    await expectSelection("1945");
    await page.keyboard.press("ArrowUp");
    await expectSelection("1965");

    // Digit shortcuts jump straight to a stop.
    await page.keyboard.press("3");
    await expectSelection("1985");

    // The scene follows the keyboard: the block lands in the selected era.
    const steps = await settleOn(page, "1985");
    expect(steps).toBeGreaterThan(0);
    const landed = await readScene(page);
    expect(landed.settledEra).toBe("1985");
    expect(Object.values(landed.report).every((value) => value === "1985")).toBe(true);
    await expect(playhead).toHaveAttribute("aria-valuenow", "1985");
    await expect(playhead).toHaveAttribute("aria-valuetext", valueText("1985"));
  });

  test("updates the HUD readouts, flips the mute toggle and lists the documented controls", async ({
    app,
  }) => {
    const { page } = app;
    const target = ERAS[ERAS.length - 1]!;

    await selectStop(page, target.id);
    await settleOn(page, target.id);

    // Year / era readouts track the selection.
    await expect(page.locator(UI.hudPanel)).toHaveAttribute("data-era", target.id);
    await expect(page.locator(UI.hudYear)).toHaveText(target.label);
    await expect(page.locator(UI.hudEra)).toHaveText(target.title);
    await expect(page.locator(UI.hudTagline)).toHaveText(target.tagline);

    // The sound control is a real toggle: it flips the DOM state *and* the engine.
    const mute = page.locator(UI.hudMute);
    const muteLabel = page.locator(UI.hudMuteLabel);
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await expect(muteLabel).toHaveText("Sound on");
    await expect(page.locator(UI.hudPanel)).toHaveAttribute("data-muted", "false");
    expect(await readAudioMuted(page)).toBe(false);

    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");
    await expect(muteLabel).toHaveText("Sound muted");
    await expect(page.locator(UI.hudPanel)).toHaveAttribute("data-muted", "true");
    expect(await readAudioMuted(page)).toBe(true);

    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await expect(muteLabel).toHaveText("Sound on");
    expect(await readAudioMuted(page)).toBe(false);

    // The controls overlay opens, lists every documented binding, and closes.
    const help = page.locator(UI.hudHelp);
    const helpPanel = page.locator(UI.hudHelpPanel);
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(helpPanel).toBeHidden();

    await help.click();
    await expect(help).toHaveAttribute("aria-expanded", "true");
    await expect(helpPanel).toBeVisible();

    const list = page.locator(UI.hudHelpList);
    await expect(list.locator("dt")).toHaveCount(DOCUMENTED_CONTROLS.length);
    for (const keys of DOCUMENTED_CONTROLS) {
      await expect(list).toContainText(keys);
    }
    // The hints name the keys the timeline and the picking layer really honour.
    await expect(list).toContainText("Home and End");
    await expect(list).toContainText("Inspect a building, vehicle or sign");

    await page.keyboard.press("Escape");
    await expect(help).toHaveAttribute("aria-expanded", "false");
    await expect(helpPanel).toBeHidden();
  });
});
