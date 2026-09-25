import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PLACEHOLDER_BLOCK_NAME } from "../../src/core/renderer";
import { ERAS, ERA_IDS, getEraConfig, type EraId } from "../../src/era/eraTypes";
import { SHELL_SELECTORS } from "../../src/main";
import type { SfxEngine, SfxEngineState } from "../../src/audio/sfx";
import type { PostFXRenderer } from "../../src/render/postfx";
import { CITY_LAYOUT } from "../../src/scene/layout";
import {
  CHRONO_CITY_SYSTEM_IDS,
  CITY_BLOCK_GROUP_NAME,
  createChronoCityScene,
  mountChronoCityUi,
  type ChronoCityEraReport,
  type ChronoCityScene,
  type ChronoCitySceneEvent,
  type ChronoCitySceneOptions,
} from "../../src/scene/scene";

/**
 * Composition test for the assembled Chrono City block.
 *
 * This is the integration test of the whole task: every system is built from its
 * *real* module, mounted through `src/scene/scene.ts` exactly as `src/main.ts`
 * does, and then driven through the five timeline stops. Nothing is stubbed
 * except WebGL itself (jsdom has no GPU), which is why the renderer is the same
 * structural stub the post-processing tests use and canvas painting goes through
 * a recording 2D context.
 *
 * The assertions cover the acceptance criteria at the composition level:
 *   1. every factory's system is mounted into one block, placeholder retired,
 *      fog owned by the environment, ads anchored to real layout slots;
 *   2. every system and the post pipeline are updated on every tick;
 *   3. one `setEra` call starts one staged transition that reaches all eight
 *      participants and lands with every one of them reporting the target era at
 *      full blend;
 *   4. each era produces a different composed block and repeated era changes do
 *      not accumulate replaced geometry;
 *   5. the timeline, the HUD sound control and click-to-inspect are wired to the
 *      scene through real DOM events, with era-aware inspection cards.
 *
 * Browser-only evidence (pixels, screenshots, steady frame pacing) is produced by
 * the preview-served browser pass; this file proves the same behaviour without a
 * GPU.
 */

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const VIEWPORT = { width: 1280, height: 720, pixelRatio: 1 } as const;

/**
 * GL-free stand-in for `THREE.WebGLRenderer`.
 *
 * `EffectComposer` only needs the renderer at construction (`getPixelRatio`) and
 * while rendering; every call is recorded so the frame path is asserted without
 * a WebGL context.
 */
function makeStubRenderer(pixelRatio = 1): PostFXRenderer {
  return {
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    autoClearColor: true,
    autoClearDepth: true,
    autoClearStencil: true,
    getPixelRatio: () => pixelRatio,
    getSize: (target: THREE.Vector2) => target.set(VIEWPORT.width, VIEWPORT.height),
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: vi.fn(),
    clear: vi.fn(),
    getClearColor: (target: THREE.Color) => target.setRGB(0, 0, 0),
    getClearAlpha: () => 1,
    setClearColor: vi.fn(),
    setClearAlpha: vi.fn(),
  };
}

/**
 * Minimal `SfxEngine` double that records what the composition asks audio to do.
 *
 * jsdom has no Web Audio implementation, so a real engine degrades to a
 * gesture-gated no-op; this recorder makes the *wiring* observable (mute, era
 * reverb, transition cues and the one-shot gesture gate) while the engine's own
 * signal path stays covered by `tests/sfx.test.ts`.
 */
function createSfxRecorder(): {
  engine: SfxEngine;
  gestures: () => number;
  reverb: () => number;
  cues: () => readonly string[];
} {
  let muted = false;
  let reverbSeconds = 0;
  let gestureCount = 0;
  const cues: string[] = [];
  const count = (cue: string): number => cues.filter((entry) => entry === cue).length;
  const engine: SfxEngine = {
    available: false,
    context: null,
    get state(): SfxEngineState {
      return {
        available: false,
        running: false,
        started: false,
        gestureSeen: gestureCount > 0,
        muted,
        volume: 1,
        headroom: 1,
        masterGain: muted ? 0 : 1,
        reverbSeconds,
        reverbFeedback: 0,
        cues: {
          footsteps: count("footstep"),
          horns: count("horn"),
          stingers: count("stinger"),
          whooshes: count("whoosh"),
          chimes: count("chime"),
          tones: count("tone"),
          noiseBursts: count("noise"),
        },
        time: 0,
      };
    },
    now: () => 0,
    isRunning: () => false,
    start: (fromUserGesture = false) => {
      if (fromUserGesture) {
        gestureCount += 1;
      }
      return false;
    },
    attachGestureStart: (target: EventTarget) => {
      const types = ["pointerdown", "keydown", "touchstart"] as const;
      const onGesture = (): void => {
        gestureCount += 1;
      };
      for (const type of types) {
        target.addEventListener(type, onGesture);
      }
      return () => {
        for (const type of types) {
          target.removeEventListener(type, onGesture);
        }
      };
    },
    setMuted: (next: boolean) => {
      muted = Boolean(next);
    },
    setVolume: () => {},
    setReverb: (seconds: number) => {
      reverbSeconds = seconds;
    },
    busInput: () => null,
    tone: () => cues.push("tone"),
    noiseBurst: () => cues.push("noise"),
    footstep: () => cues.push("footstep"),
    horn: () => cues.push("horn"),
    whoosh: () => cues.push("whoosh"),
    chime: () => cues.push("chime"),
    transitionStinger: () => cues.push("stinger"),
    dispose: () => {},
  };
  return { engine, gestures: () => gestureCount, reverb: () => reverbSeconds, cues: () => cues };
}

/**
 * Recording stand-in for a 2D canvas context.
 *
 * The production painters run for real (street furniture, storefront signage and
 * advertising artwork all paint through this), so a proxy that accepts every
 * drawing call keeps the composed path honest without a rasterizer.
 */
function createRecordingContext(): CanvasRenderingContext2D {
  const noop = (): undefined => undefined;
  const gradient = { addColorStop: noop };
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: Array.from(text).length * 6 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => null,
    getLineDash: () => [],
    createImageData: (width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
    }),
    getImageData: (_x: number, _y: number, width: number, height: number) => ({
      width,
      height,
      data: new Uint8ClampedArray(Math.max(1, width * height * 4)),
    }),
  };
  return new Proxy(target, {
    get(object, key) {
      const value = object[key as string];
      return value === undefined ? noop : value;
    },
    set(object, key, value) {
      object[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Mounts the real shell markup declared in `index.html` into jsdom. */
function mountShell(): void {
  const id = (selector: string): string => selector.slice(1);
  document.body.innerHTML = [
    `<canvas id="${id(SHELL_SELECTORS.canvas)}" data-role="scene-canvas"></canvas>`,
    `<div id="${id(SHELL_SELECTORS.timeline)}" data-role="timeline"></div>`,
    `<div id="${id(SHELL_SELECTORS.hud)}" data-role="hud"></div>`,
    `<div id="${id(SHELL_SELECTORS.loading)}" data-role="loading"><p data-role="loading-status"></p></div>`,
  ].join("");
}

function query<T extends Element>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) {
    throw new Error(`test shell is missing ${selector}`);
  }
  return node;
}

interface Harness {
  readonly scene: ChronoCityScene;
  readonly renderer: PostFXRenderer;
  readonly three: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
}

/** Builds the composed block exactly the way `src/main.ts` boots it. */
function buildScene(overrides: Partial<ChronoCitySceneOptions> = {}): Harness {
  const renderer = makeStubRenderer();
  const three = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, VIEWPORT.width / VIEWPORT.height, 0.1, 800);
  const scene = createChronoCityScene({
    renderer,
    scene: three,
    camera,
    viewport: VIEWPORT,
    vehicleCount: 6,
    figurePoolSize: 12,
    ...overrides,
  });
  return { scene, renderer, three, camera };
}

/** Pumps fixed steps until the running leg lands; returns the frames consumed. */
function runUntilSettled(scene: ChronoCityScene, maxFrames = 600): number {
  let frames = 0;
  while (scene.transition.transitioning && frames < maxFrames) {
    scene.update(1 / 60);
    frames += 1;
  }
  return frames;
}

/** One era, repeated into the shape the report has. */
function allEras(era: EraId): ChronoCityEraReport {
  return {
    environment: era,
    buildings: era,
    storefronts: era,
    advertising: era,
    vehicles: era,
    pedestrians: era,
    postfx: era,
    sfx: era,
  };
}

interface ResourceCounts {
  readonly meshes: number;
  readonly geometries: number;
  readonly materials: number;
}

/** Distinct GPU resources reachable from a subtree; growth shows up here. */
function resourcesOf(root: THREE.Object3D): ResourceCounts {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  let meshes = 0;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }
    meshes += 1;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  return { meshes, geometries: geometries.size, materials: materials.size };
}

/** Everything era-specific about the composed block, as one comparable string. */
function blockSignature(scene: ChronoCityScene): string {
  const grade = scene.postfx.grade;
  const environment = scene.environment;
  return JSON.stringify({
    buildings: scene.buildings.census().triangles,
    tallest: Math.max(...scene.buildings.describe().map((record) => record.height)),
    trading: scene.storefronts.stats.trading,
    shop: scene.storefronts.units[0]?.plan.programme.brand,
    glow: scene.storefronts.units[0]?.glowIntensity,
    ads: scene.advertising.placements.map((placement) => placement.mediaTo),
    vehicles: scene.vehicles.vehicles.map((actor) => actor.kind).sort(),
    density: scene.pedestrians.stats().densityPer100m,
    fog: Number(environment.fog.density.toFixed(6)),
    sun: Number(environment.sun.intensity.toFixed(4)),
    sky: environment.skyUniforms.uTopColor.value.getHex(),
    horizon: environment.skyUniforms.uHorizonColor.value.getHex(),
    exposure: grade.exposure,
    contrast: grade.contrast,
    saturation: grade.saturation,
    vignette: grade.vignette,
    grain: grade.grain,
    bloom: grade.bloomStrength,
    reverb: scene.sfx.state.reverbSeconds,
  });
}

/** Tallest visible building plus a point part-way up its mass. */
function tallestVisibleBuilding(scene: ChronoCityScene): {
  box: THREE.Box3;
  clickPoint: THREE.Vector3;
} {
  const seen = new Set<THREE.Object3D>();
  let best: THREE.Box3 | null = null;
  for (const mesh of scene.buildings.visibleMeshes()) {
    const group = mesh.parent ?? mesh;
    if (seen.has(group)) {
      continue;
    }
    seen.add(group);
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group);
    if (!best || box.max.y > best.max.y) {
      best = box;
    }
  }
  if (!best) {
    throw new Error("the composed block has no visible building geometry to pick");
  }
  const box = best;
  const clickPoint = box.getCenter(new THREE.Vector3());
  clickPoint.y = box.min.y + (box.max.y - box.min.y) * 0.7;
  return { box, clickPoint };
}

/** Projects a world point into client pixels for the rig's viewport. */
function toClientPixels(camera: THREE.Camera, point: THREE.Vector3): { x: number; y: number } {
  camera.updateMatrixWorld(true);
  const ndc = point.clone().project(camera);
  return {
    x: ((ndc.x + 1) / 2) * VIEWPORT.width,
    y: ((1 - ndc.y) / 2) * VIEWPORT.height,
  };
}

function pressAndRelease(element: HTMLElement, x: number, y: number): void {
  element.dispatchEvent(new MouseEvent("mousedown", { clientX: x, clientY: y, button: 0, bubbles: true }));
  element.dispatchEvent(new MouseEvent("mouseup", { clientX: x, clientY: y, button: 0, bubbles: true }));
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // A recording 2D context per canvas keeps every painter on its production path.
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    let context = contexts.get(this);
    if (!context) {
      context = createRecordingContext();
      contexts.set(this, context);
    }
    return context as never;
  });
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Assembly                                                                   */
/* -------------------------------------------------------------------------- */

describe("composed Chrono City block", () => {
  it("mounts every system from the real modules into one era-aware block", () => {
    const { scene, three } = buildScene();

    try {
      expect(scene.root.name).toBe(CITY_BLOCK_GROUP_NAME);
      expect(scene.root.parent).toBe(three);

      // The scaffold's placeholder block is retired by real geometry.
      expect(three.getObjectByName(PLACEHOLDER_BLOCK_NAME)).toBeUndefined();

      for (const system of [
        scene.environment,
        scene.buildings,
        scene.storefronts,
        scene.advertising,
        scene.vehicles,
        scene.pedestrians,
      ]) {
        expect(system.group.parent).toBe(scene.root);
      }

      // Environment owns the single scene fog and the sky background.
      expect(three.fog).toBe(scene.environment.fog);
      expect(three.fog).toBeInstanceOf(THREE.FogExp2);
      expect(three.background).toBeInstanceOf(THREE.Color);

      // Buildings and storefronts populate every authored lot.
      expect(scene.buildings.visibleMeshes().length).toBeGreaterThanOrEqual(CITY_LAYOUT.lots.length);
      expect(scene.storefronts.units).toHaveLength(CITY_LAYOUT.lots.length);
      expect(scene.storefronts.stats.units).toBe(CITY_LAYOUT.lots.length);

      // Advertising is slot-anchored to the real layout ad signage slots.
      const adSlots = CITY_LAYOUT.propSlots.filter(
        (slot) => slot.type === "signage" && slot.signageKind === "advertisement",
      );
      expect(adSlots.length).toBeGreaterThanOrEqual(12);
      expect(scene.advertising.placements).toHaveLength(adSlots.length);
      for (const [index, placement] of scene.advertising.placements.entries()) {
        const slot = adSlots[index]!;
        expect(placement.slot.id).toBe(slot.id);
        expect(placement.group.position.toArray()).toEqual([
          slot.anchor.position.x,
          slot.anchor.position.y,
          slot.anchor.position.z,
        ]);
      }

      // Traffic and crowd are mounted in the same block.
      expect(scene.vehicles.vehicles.length).toBeGreaterThanOrEqual(6);
      expect(scene.pedestrians.figures.length).toBeGreaterThan(0);

      // The driver owns all eight participants, in choreography order.
      expect(scene.transition.registered.map((registration) => registration.id)).toEqual([
        ...CHRONO_CITY_SYSTEM_IDS,
      ]);

      // Post-processing wraps the shared renderer in the full pass chain.
      expect(scene.postfx.composer.passes.length).toBeGreaterThanOrEqual(4);
      expect(scene.postfx.renderer).toBe(scene.postfx.composer.renderer);
      expect(scene.postfx.fromEra).toBe("1945");
      expect(scene.postfx.toEra).toBe("1945");

      // The block starts settled in the first timeline stop.
      expect(scene.era).toBe("1945");
      expect(scene.eraReport()).toEqual(allEras("1945"));

      // ... and every object the user can click is registered for inspection.
      const pickables = [
        ...scene.buildings.getPickables(),
        ...scene.vehicles.getPickables(),
        ...scene.pedestrians.getPickables(),
        ...scene.advertising.getPickables(),
      ];
      expect(pickables.length).toBeGreaterThan(20);
      expect(scene.focus.registry.size).toBeGreaterThanOrEqual(pickables.length);
    } finally {
      scene.dispose();
    }
  });

  it("updates every system and the post-processing pipeline on every tick", () => {
    const { scene } = buildScene();
    const systems = [
      scene.environment,
      scene.buildings,
      scene.storefronts,
      scene.advertising,
      scene.vehicles,
      scene.pedestrians,
    ] as const;
    const updateSpies = systems.map((system) => vi.spyOn(system, "update"));
    const renderSpy = vi.spyOn(scene.postfx, "render");
    const grain = scene.postfx.gradePass.uniforms.time as { value: number };

    scene.update(1 / 60);
    for (const spy of updateSpies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }

    const elapsed = scene.elapsed;
    scene.update(1 / 60);
    for (const spy of updateSpies) {
      expect(spy).toHaveBeenCalledTimes(2);
    }
    expect(scene.elapsed).toBeCloseTo(elapsed + 1 / 60, 9);

    // Every system receives the shared era context, all describing the same stop.
    for (const spy of updateSpies) {
      const context = spy.mock.calls[0]![0];
      expect(context.era).toBe("1945");
      expect(context.from).toBe("1945");
      expect(context.blend).toBe(1);
      expect(context.delta).toBeCloseTo(1 / 60, 9);
      expect(context.weights["1945"]).toBe(1);
    }

    const grainBefore = grain.value;
    scene.render();
    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(grain.value).toBeGreaterThan(grainBefore);

    scene.dispose();
  });

  it("tears the block down without throwing", () => {
    const { scene, three } = buildScene();
    scene.dispose();

    expect(scene.root.parent).toBeNull();
    expect(three.children).toHaveLength(0);
    expect(scene.postfx.disposed).toBe(true);
    expect(() => {
      scene.update(1 / 60);
      scene.render();
      scene.setEra("2025");
    }).not.toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Era transformation                                                         */
/* -------------------------------------------------------------------------- */

describe("composed era transformation", () => {
  it("starts one staged transition per selected year and lands every subsystem on it", () => {
    const sfx = createSfxRecorder();
    const { scene } = buildScene({ sfx: sfx.engine });
    const journey: readonly EraId[] = ["1965", "1985", "2005", "2025", "1945"];

    try {
      expect(scene.eraReport()).toEqual(allEras("1945"));

      let previous: EraId = "1945";
      for (const era of journey) {
        const events: ChronoCitySceneEvent[] = [];
        const unsubscribe = scene.subscribe((event) => events.push(event));
        scene.setEra(era);
        unsubscribe();

        // One user action: exactly one leg from the stop on screen to the
        // year that was picked.
        expect(events.map((event) => event.type)).toEqual(["transition-start"]);
        expect(events[0]!.era).toBe(era);
        expect(events[0]!.from).toBe(previous);
        expect(scene.transition.transitioning).toBe(true);
        expect(scene.transition.targetEra).toBe(era);
        previous = era;

        // The very first fixed step reaches all eight participants at once.
        scene.update(1 / 60);
        const midStates = scene.systemStates();
        expect(midStates.map((state) => state.id)).toEqual([...CHRONO_CITY_SYSTEM_IDS]);
        for (const state of midStates) {
          expect(state.era).toBe(era);
          expect(state.blend).toBeGreaterThanOrEqual(0);
          expect(state.blend).toBeLessThanOrEqual(1);
        }

        // Choreography: the atmosphere leads, street life follows.
        const blendOf = (id: string): number =>
          midStates.find((state) => state.id === id)?.blend ?? 0;
        expect(blendOf("environment")).toBeGreaterThan(blendOf("pedestrians"));
        expect(blendOf("environment")).toBeLessThan(1);

        const frames = runUntilSettled(scene);
        expect(frames).toBeGreaterThan(100);
        expect(frames).toBeLessThanOrEqual(160);
        expect(scene.transition.transitioning).toBe(false);

        // At completion every subsystem reports the target era at full strength.
        expect(scene.eraReport()).toEqual(allEras(era));
        for (const state of scene.systemStates()) {
          expect(state.era).toBe(era);
          expect(state.blend).toBe(1);
        }
        // The shared driver agrees, participant by participant.
        for (const registration of scene.transition.registered) {
          expect(registration.era).toBe(era);
          expect(registration.blend).toBe(1);
        }
        expect(scene.transition.settledEra).toBe(era);
        expect(scene.era).toBe(era);

        // Audio travels in the same transformation: the era stinger fires on the
        // way in, the arrival chime on landing, and the street reverb is
        // re-voiced from the era contract's own descriptor.
        expect(sfx.reverb()).toBeCloseTo(getEraConfig(era).sound.reverbSeconds, 9);
      }

      expect(sfx.cues().filter((cue) => cue === "stinger")).toHaveLength(journey.length);
      expect(sfx.cues().filter((cue) => cue === "chime")).toHaveLength(journey.length);
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      scene.dispose();
    }
  }, 30_000);

  it("keeps a steady loop across repeated era changes with no unbounded growth", () => {
    const { scene } = buildScene();
    const firstPass = new Map<EraId, { signature: string; resources: ResourceCounts }>();

    try {
      for (const era of ERA_IDS) {
        scene.setEra(era);
        const frames = runUntilSettled(scene);
        expect(scene.transition.transitioning).toBe(false);
        expect(frames).toBeLessThanOrEqual(160);
        expect(scene.eraReport()).toEqual(allEras(era));
        firstPass.set(era, {
          signature: blockSignature(scene),
          resources: resourcesOf(scene.root),
        });
      }

      // Every stop produces a visibly different composed block.
      const signatures = new Set([...firstPass.values()].map((entry) => entry.signature));
      expect(signatures.size).toBe(ERA_IDS.length);

      // A second full sweep through all five years must land on exactly the same
      // GPU footprint per era: superseded generations are released, not stacked.
      for (const era of ERA_IDS) {
        scene.setEra(era);
        runUntilSettled(scene);
        expect(resourcesOf(scene.root), `resource drift after repeating ${era}`).toEqual(
          firstPass.get(era)!.resources,
        );
      }
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      scene.dispose();
    }
  }, 60_000);
});

/* -------------------------------------------------------------------------- */
/* UI wiring                                                                  */
/* -------------------------------------------------------------------------- */

describe("composed app interactions", () => {
  beforeEach(() => {
    mountShell();
  });

  it("drives the transition from the timeline and flips SFX state from the HUD", () => {
    const sfx = createSfxRecorder();
    const { scene } = buildScene({ sfx: sfx.engine });
    const ui = mountChronoCityUi(scene, {
      timeline: query(SHELL_SELECTORS.timeline),
      hud: query(SHELL_SELECTORS.hud),
    });

    try {
      const stopButtons = Array.from(
        document.querySelectorAll<HTMLButtonElement>('[data-role="timeline-stop"]'),
      );
      expect(stopButtons.map((button) => button.dataset.era)).toEqual(ERAS.map((era) => era.id));

      const target = stopButtons.find((button) => button.dataset.era === "2025")!;
      target.click();

      expect(scene.transition.transitioning).toBe(true);
      expect(scene.transition.targetEra).toBe("2025");
      expect(ui.timeline.era).toBe("2025");
      expect(
        query(SHELL_SELECTORS.hud).querySelector('[data-role="hud-year"]')?.textContent,
      ).toBe(getEraConfig("2025").label);

      runUntilSettled(scene);
      expect(scene.eraReport()).toEqual(allEras("2025"));

      // The sound control takes effect on the engine immediately.
      const muteButton = query<HTMLButtonElement>('[data-role="hud-mute"]');
      expect(scene.sfx.state.muted).toBe(false);
      muteButton.click();
      expect(scene.sfx.state.muted).toBe(true);
      expect(scene.sfx.state.masterGain).toBe(0);
      muteButton.click();
      expect(scene.sfx.state.muted).toBe(false);
      expect(scene.sfx.state.masterGain).toBeGreaterThan(0);

      // Audio stays gesture gated: mounting the UI binds the one-shot listeners
      // but must not start the engine, and a real gesture releases the gate.
      expect(scene.sfx.state.gestureSeen).toBe(false);
      expect(sfx.gestures()).toBe(0);
      window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      expect(sfx.gestures()).toBe(1);
      expect(scene.sfx.state.gestureSeen).toBe(true);

      // Selecting a year fired the era stinger, and landing fired the arrival
      // chime: the audio layer is driven by the same one user action.
      expect(sfx.cues()).toContain("stinger");
      expect(sfx.cues()).toContain("chime");

      // Slider scrubbing never needs to wait for the morph to finish.
      stopButtons.find((button) => button.dataset.era === "1945")!.click();
      expect(scene.transition.targetEra).toBe("1945");
      expect(
        query(SHELL_SELECTORS.hud).querySelector('[data-role="hud-year"]')?.textContent,
      ).toBe(getEraConfig("1945").label);
    } finally {
      ui.dispose();
      scene.dispose();
    }
  });

  it("focuses the camera and fills an era-aware inspection card when a building is clicked", () => {
    const canvas = query<HTMLCanvasElement>(SHELL_SELECTORS.canvas);
    const { scene } = buildScene({ element: canvas });
    const ui = mountChronoCityUi(scene, {
      timeline: query(SHELL_SELECTORS.timeline),
      hud: query(SHELL_SELECTORS.hud),
    });

    try {
      scene.setEra("2025");
      runUntilSettled(scene);

      // Establish a wide view first, so focusing has a real pose change to make.
      scene.camera.reset({ immediate: true });
      scene.update(0);

      const { clickPoint } = tallestVisibleBuilding(scene);
      const { x, y } = toClientPixels(scene.camera.camera, clickPoint);
      const before = scene.camera.pose;

      // The projected building pixel must actually be pickable ...
      const hit = scene.focus.pickAt(x, y);
      expect(hit, "the composed block should be pickable at a projected building pixel").not.toBeNull();
      expect(hit!.target.kind).toBe("building");

      // ... and the real pointer path (mousedown + mouseup on the canvas) must
      // focus it, glide the camera and open the info card.
      pressAndRelease(canvas, x, y);

      const focused = scene.focus.focused;
      expect(focused).not.toBeNull();
      expect(focused!.kind).toBe("building");
      expect(focused!.era).toBe("2025");
      expect(scene.camera.isGliding).toBe(true);

      const panel = query(SHELL_SELECTORS.hud).querySelector<HTMLElement>('[data-role="hud-panel"]')!;
      expect(panel.dataset.infoCard).toBe("open");
      const card = query(SHELL_SELECTORS.hud).querySelector<HTMLElement>('[data-role="hud-info-card"]')!;
      expect(card.hidden).toBe(false);
      expect(card.querySelector('[data-role="hud-info-title"]')?.textContent).toBe(focused!.title);
      expect(card.querySelector('[data-role="hud-info-subtitle"]')?.textContent).toContain(
        getEraConfig("2025").title,
      );
      expect(card.querySelector('[data-role="hud-info-rows"]')?.children.length).toBeGreaterThan(0);

      // The same composed registry makes vehicles inspectable, with the same
      // era-aware label resolution.
      const vehicle = scene.vehicles.vehicles[0];
      const vehicleInfo = scene.focus.focusTarget(`vehicle:${vehicle.id}`);
      expect(vehicleInfo).not.toBeNull();
      expect(vehicleInfo!.kind).toBe("vehicle");
      expect(vehicleInfo!.era).toBe("2025");
      expect(card.querySelector('[data-role="hud-info-title"]')?.textContent).toBe(
        vehicleInfo!.title,
      );

      // The glide really moves the eye.
      for (let frame = 0; frame < 120; frame += 1) {
        scene.update(1 / 60);
      }
      expect(scene.camera.pose).not.toEqual(before);

      // An era change re-labels the focused object without touching the pose.
      scene.camera.cancelGlide();
      const settledPose = scene.camera.pose;
      scene.setEra("1945");
      scene.settle();

      const subtitle =
        card.querySelector('[data-role="hud-info-subtitle"]')?.textContent ?? "";
      expect(subtitle).toContain(getEraConfig("1945").title);
      expect(subtitle).not.toContain(getEraConfig("2025").title);
      expect(scene.focus.era).toBe("1945");
      expect(scene.camera.pose).toEqual(settledPose);
      expect(scene.eraReport()).toEqual(allEras("1945"));

      // Dismissing the card clears the focus without breaking the scene.
      const close = query<HTMLButtonElement>('[data-role="hud-info-close"]');
      close.click();
      expect(panel.dataset.infoCard).toBe("closed");
      expect(scene.focus.focused).toBeNull();
      expect(() => scene.update(1 / 60)).not.toThrow();
    } finally {
      ui.dispose();
      scene.dispose();
    }
  });
});
