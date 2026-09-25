import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ERAS,
  getEraConfig,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
} from "../src/era/eraTypes";
import { CITY_LAYOUT } from "../src/scene/layout";
import { createEnvironmentSystem } from "../src/scene/environment";
import {
  EASINGS,
  EASING_NAMES,
  easeInOut,
  isEasingName,
  linear,
  resolveEasing,
  resolveEasingName,
  spring,
  stageProgress,
  stagesOverlap,
} from "../src/transitions/easing";
import {
  DEFAULT_STAGE_PLAN,
  DEFAULT_TRANSITION_DURATION_MS,
  ERA_STAGE_ORDER,
  createEraTransition,
  eraForYear,
  resolveEraStage,
  type EraStageEvent,
  type EraStageId,
  type EraStagePlanEntry,
  type EraTransitionCompleteEvent,
  type EraTransitionDriver,
  type EraTransitionDriverOptions,
  type EraTransitionEvent,
  type EraTransitionRegistrationInput,
  type EraTransitionStartEvent,
} from "../src/transitions/eraTransition";

/**
 * Composition tests for the staged era transformation driver.
 *
 * The driver is exercised the way scene assembly will use it: a list of real
 * `EraSceneSystem` instances (three.js groups, frame updates, pickables) is
 * registered against the *real* era contract, pumped with fixed 1/60 s steps and
 * asserted on the `applyEra` call sequence it produces. Nothing is stubbed
 * except the 2D canvas backing the procedural textures of the real environment
 * system at the bottom of this file.
 *
 * The assertions cover the acceptance criteria end to end: a ~2.5 s four-stage
 * sequence with overlapping eased stages (not one global fade), monotonic
 * `0..1` blends that end at exactly `1` for the target era, retargeting and
 * cancelling from any point without rewind, `onStart`/`onStage`/`onComplete`
 * events carrying era ids, and the camera pose surviving untouched.
 */

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

/** Fixed-step size used by the shared render loop; 150 steps is 2.5 s. */
const STEP = 1 / 60;

/** One shared, ordered log of every `applyEra` call the driver makes. */
type ApplyLog = Array<{ readonly id: string; readonly era: EraId; readonly blend: number }>;

/**
 * A real `EraSceneSystem`: it owns a three.js group, exposes pickables, is
 * updated by scene assembly and morphs through the era contract.
 */
class RecordingSystem implements EraSceneSystem {
  readonly id: string;
  readonly group = new THREE.Group();
  /** Eras handed to `applyEra`, in call order. */
  readonly eras: EraId[] = [];
  /** Blends handed to `applyEra`, in call order. */
  readonly blends: number[] = [];
  /** Frame updates; the driver must never contribute to this. */
  updates = 0;
  /** Picking reads; the driver must never contribute to this. */
  pickableReads = 0;

  private readonly log: ApplyLog | undefined;

  constructor(id: string, log?: ApplyLog) {
    this.id = id;
    this.log = log;
    this.group.name = id;
  }

  get lastEra(): EraId | undefined {
    return this.eras.at(-1);
  }

  get lastBlend(): number | undefined {
    return this.blends.at(-1);
  }

  applyEra(era: EraId, blend: number): void {
    this.eras.push(era);
    this.blends.push(blend);
    this.log?.push({ id: this.id, era, blend });
  }

  update(_context: EraUpdateContext): void {
    this.updates += 1;
  }

  getPickables(): readonly THREE.Object3D[] {
    this.pickableReads += 1;
    return [];
  }
}

/**
 * Registration order, deliberately scrambled.
 *
 * Scene assembly will not register systems in choreography order, so the tests
 * assert the driver's call order is stage-major regardless of input order.
 */
const BLOCK: readonly { readonly id: string; readonly stage: EraStageId }[] = [
  { id: "pedestrians", stage: "street-life" },
  { id: "vehicles", stage: "street-life" },
  { id: "advertising", stage: "retail" },
  { id: "storefronts", stage: "retail" },
  { id: "buildings", stage: "buildings" },
  { id: "environment", stage: "environment" },
];

/** Stage-major call order the driver must produce for {@link BLOCK}. */
const BLOCK_ORDER = [
  "environment",
  "buildings",
  "advertising",
  "storefronts",
  "pedestrians",
  "vehicles",
] as const;

interface Harness {
  readonly driver: EraTransitionDriver;
  readonly systems: RecordingSystem[];
  readonly byId: Map<string, RecordingSystem>;
  readonly events: EraTransitionEvent[];
  readonly log: ApplyLog;
}

function createHarness(options: EraTransitionDriverOptions = {}): Harness {
  const events: EraTransitionEvent[] = [];
  const log: ApplyLog = [];
  const systems: RecordingSystem[] = [];
  const inputs: EraTransitionRegistrationInput[] = [];

  for (const entry of BLOCK) {
    const system = new RecordingSystem(entry.id, log);
    systems.push(system);
    inputs.push({ system, stage: entry.stage, id: entry.id });
  }

  const driver = createEraTransition({
    durationMs: DEFAULT_TRANSITION_DURATION_MS,
    ...options,
    systems: inputs,
  });
  driver.subscribe((event) => events.push(event));
  return { driver, systems, byId: new Map(systems.map((system) => [system.id, system])), events, log };
}

function stepTimes(driver: EraTransitionDriver, steps: number): void {
  for (let index = 0; index < steps; index += 1) {
    driver.update(STEP);
  }
}

/** Steps until the driver is idle; throws instead of silently under-running. */
function runToIdle(driver: EraTransitionDriver, maxSteps = 600): number {
  let steps = 0;
  while (driver.transitioning && steps < maxSteps) {
    driver.update(STEP);
    steps += 1;
  }
  if (driver.transitioning) {
    throw new Error("Era transition never completed within the step budget.");
  }
  return steps;
}

/**
 * Blend applied to `system` on the `step`-th fixed update (1-based).
 *
 * Index `0` is the registration apply that lands the system on the settled era,
 * so update `n` is found at index `n`.
 */
function blendAt(system: RecordingSystem, step: number): number {
  const blend = system.blends[step];
  if (blend === undefined) {
    throw new Error(`System "${system.id}" has no blend for step ${step}.`);
  }
  return blend;
}

function startEvents(events: readonly EraTransitionEvent[]): EraTransitionStartEvent[] {
  return events.filter((event): event is EraTransitionStartEvent => event.type === "start");
}

function stageEvents(events: readonly EraTransitionEvent[]): EraStageEvent[] {
  return events.filter((event): event is EraStageEvent => event.type === "stage");
}

function completeEvents(events: readonly EraTransitionEvent[]): EraTransitionCompleteEvent[] {
  return events.filter((event): event is EraTransitionCompleteEvent => event.type === "complete");
}

/** Blend a correctly choreographed driver must produce, from the real data. */
function expectedBlend(era: EraId, stage: EraStagePlanEntry, progress: number): number {
  return EASINGS[getEraConfig(era).transition.easing](stageProgress(progress, stage.start, stage.end));
}

function stageOf(id: string): EraStagePlanEntry {
  const stageId = BLOCK.find((entry) => entry.id === id)!.stage;
  return DEFAULT_STAGE_PLAN.find((entry) => entry.id === stageId)!;
}

/* -------------------------------------------------------------------------- */
/* Easing utilities                                                           */
/* -------------------------------------------------------------------------- */

describe("timing utilities", () => {
  it("covers the era contract's easing vocabulary with monotone 0..1 curves", () => {
    const declared = ERAS.map((era) => era.transition.easing);
    for (const name of declared) {
      expect(EASING_NAMES).toContain(name);
    }
    expect([...EASING_NAMES].sort()).toEqual(["ease-in-out", "ease-out", "linear", "spring"]);

    for (const name of EASING_NAMES) {
      const curve = EASINGS[name];
      // Endpoint exactness: stages start where they were handed and land on 1.
      expect(curve(0)).toBe(0);
      expect(curve(1)).toBe(1);
      expect(curve(-5)).toBe(0);
      expect(curve(5)).toBe(1);
      expect(curve(Number.NaN)).toBe(0);

      let previous = 0;
      for (let step = 0; step <= 200; step += 1) {
        const value = curve(step / 200);
        expect(value).toBeGreaterThanOrEqual(previous);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        previous = value;
      }
    }
  });

  it("keeps the curves distinct so stages cannot read as one global fade", () => {
    expect(linear(0.25)).toBeCloseTo(0.25, 12);
    expect(easeInOut(0.25)).toBeLessThan(linear(0.25));
    expect(EASINGS["ease-out"](0.25)).toBeGreaterThan(linear(0.25));
    expect(spring(0.5)).toBeCloseTo(0.8125, 12);
    expect(EASINGS["ease-out"](0.5)).not.toBeCloseTo(spring(0.5), 6);
  });

  it("falls back on unknown names instead of throwing mid-frame", () => {
    expect(resolveEasingName("wobble")).toBe("ease-in-out");
    expect(resolveEasingName(undefined, "spring")).toBe("spring");
    expect(resolveEasing("constructor")).toBe(easeInOut);
    expect(isEasingName("toString")).toBe(false);
    expect(isEasingName("ease-in-out")).toBe(true);
  });

  it("windows stages with clamped, NaN-free local progress", () => {
    expect(stageProgress(0, 0, 0.42)).toBe(0);
    expect(stageProgress(0.21, 0, 0.42)).toBeCloseTo(0.5, 12);
    expect(stageProgress(0.42, 0, 0.42)).toBe(1);
    expect(stageProgress(1, 0, 0.42)).toBe(1);
    expect(stageProgress(0.2, 0.3, 0.78)).toBe(0);
    expect(stageProgress(Number.NaN, 0.3, 0.78)).toBe(0);
    // A degenerate window opens only at its end; never NaN, never 1 early.
    expect(stageProgress(0.5, 0.5, 0.5)).toBe(1);
    expect(stageProgress(0.4, 0.5, 0.5)).toBe(0);
  });

  it("reports overlapping windows across the real choreography", () => {
    const [environment, buildings, retail, streetLife] = DEFAULT_STAGE_PLAN as [
      EraStagePlanEntry,
      EraStagePlanEntry,
      EraStagePlanEntry,
      EraStagePlanEntry,
    ];
    expect(stagesOverlap(0.2, environment, buildings)).toBe(true);
    expect(stagesOverlap(0.2, environment, retail)).toBe(false);
    expect(stagesOverlap(0.6, buildings, streetLife)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Stage plan                                                                 */
/* -------------------------------------------------------------------------- */

describe("stage plan", () => {
  it("orders four overlapping stages from atmosphere to street life", () => {
    expect(ERA_STAGE_ORDER).toEqual(["environment", "buildings", "retail", "street-life"]);
    expect(DEFAULT_STAGE_PLAN.map((stage) => stage.id)).toEqual([...ERA_STAGE_ORDER]);
    expect(DEFAULT_STAGE_PLAN[0]!.start).toBe(0);
    expect(DEFAULT_STAGE_PLAN.at(-1)!.end).toBe(1);

    for (let index = 0; index < DEFAULT_STAGE_PLAN.length; index += 1) {
      const stage = DEFAULT_STAGE_PLAN[index]!;
      expect(stage.end).toBeGreaterThan(stage.start);
      expect(stage.label.length).toBeGreaterThan(0);
      if (index > 0) {
        const previous = DEFAULT_STAGE_PLAN[index - 1]!;
        // Later stages start later, but before the previous one finishes.
        expect(stage.start).toBeGreaterThan(previous.start);
        expect(stage.start).toBeLessThan(previous.end);
      }
    }
  });

  it("folds system-style stage aliases onto the choreography", () => {
    expect(resolveEraStage("advertising")).toBe("retail");
    expect(resolveEraStage("storefronts")).toBe("retail");
    expect(resolveEraStage("pedestrians")).toBe("street-life");
    expect(resolveEraStage("vehicles")).toBe("street-life");
    expect(resolveEraStage("lighting")).toBe("environment");
    expect(resolveEraStage(" Environment ")).toBe("environment");
    expect(() => resolveEraStage("engine")).toThrow(/Unknown era transition stage/);
  });
});

/* -------------------------------------------------------------------------- */
/* The transformation itself                                                  */
/* -------------------------------------------------------------------------- */

describe("staged year change across the whole block", () => {
  it("runs a ~2.5 s staged, overlapping, eased transformation from 1945 to 2025", () => {
    const { driver, systems, byId, events, log } = createHarness();
    const targetEasing = getEraConfig("2025").transition.easing;

    driver.transitionTo("2025");
    const steps = runToIdle(driver);

    // ~2.5 s of fixed-step time, then the driver is idle again.
    expect(steps).toBe(150);
    expect(steps * STEP * 1000).toBeCloseTo(DEFAULT_TRANSITION_DURATION_MS, 6);
    expect(driver.transitioning).toBe(false);
    expect(driver.settledEra).toBe("2025");
    expect(driver.targetEra).toBe("2025");

    // Every system walked 0 -> exactly 1, monotonically, for the target era.
    for (const system of systems) {
      expect(system.blends.length).toBeGreaterThan(100);
      expect(system.lastEra).toBe("2025");
      expect(system.lastBlend).toBe(1);
      // The first call lands the system on the settled era; the leg then starts
      // from blend 0, which means "the era you are already showing".
      expect(system.eras[0]).toBe("1945");
      expect(system.blends[0]).toBe(1);
      expect(system.eras[1]).toBe("2025");
      expect(system.blends[1]).toBeLessThan(0.01);

      let previous = 0;
      for (const blend of system.blends.slice(1)) {
        expect(blend).toBeGreaterThanOrEqual(0);
        expect(blend).toBeLessThanOrEqual(1);
        expect(blend).toBeGreaterThanOrEqual(previous);
        previous = blend;
      }
      // The driver drives `applyEra` only - never the frame update or picking.
      expect(system.updates).toBe(0);
      expect(system.pickableReads).toBe(0);
    }

    // Blends follow the target era's declared curve, stage by stage.
    expect(blendAt(byId.get("environment")!, 5)).toBeCloseTo(
      expectedBlend("2025", stageOf("environment"), 5 / 150),
      6,
    );
    expect(blendAt(byId.get("buildings")!, 30)).toBeCloseTo(
      expectedBlend("2025", stageOf("buildings"), 30 / 150),
      6,
    );
    expect(blendAt(byId.get("storefronts")!, 90)).toBeCloseTo(
      expectedBlend("2025", stageOf("storefronts"), 90 / 150),
      6,
    );
    expect(targetEasing).toBe("spring");

    // Stagger, not one global fade: early on only the environment has moved ...
    expect(blendAt(byId.get("environment")!, 5)).toBeGreaterThan(0);
    expect(blendAt(byId.get("buildings")!, 5)).toBe(0);
    expect(blendAt(byId.get("storefronts")!, 5)).toBe(0);
    expect(blendAt(byId.get("vehicles")!, 5)).toBe(0);
    expect(blendAt(byId.get("pedestrians")!, 5)).toBe(0);

    // ... at 20 % the atmosphere and the buildings overlap ...
    expect(blendAt(byId.get("environment")!, 30)).toBeGreaterThan(0.5);
    expect(blendAt(byId.get("buildings")!, 30)).toBeGreaterThan(0);
    expect(blendAt(byId.get("storefronts")!, 30)).toBe(0);

    // ... and at 60 % three stages are mid-morph at once, in stage order.
    expect(blendAt(byId.get("environment")!, 90)).toBe(1);
    expect(blendAt(byId.get("buildings")!, 90)).toBeGreaterThan(blendAt(byId.get("storefronts")!, 90));
    expect(blendAt(byId.get("storefronts")!, 90)).toBeGreaterThan(blendAt(byId.get("vehicles")!, 90));
    expect(blendAt(byId.get("advertising")!, 90)).toBe(blendAt(byId.get("storefronts")!, 90));
    expect(blendAt(byId.get("pedestrians")!, 90)).toBe(blendAt(byId.get("vehicles")!, 90));

    // Systems are applied in choreography order no matter how they registered
    // (the settled-era applies that registration makes are era 1945).
    const firstStep = log
      .filter((entry) => entry.era === "2025")
      .slice(0, BLOCK.length)
      .map((entry) => entry.id);
    expect(firstStep).toEqual([...BLOCK_ORDER]);

    // Events: one start, four staged begins and ends, one landing complete.
    const start = startEvents(events);
    expect(start).toHaveLength(1);
    expect(start[0]).toMatchObject({
      type: "start",
      from: "1945",
      to: "2025",
      durationMs: DEFAULT_TRANSITION_DURATION_MS,
      easing: "spring",
      retarget: false,
      descriptor: getEraConfig("2025").transition,
    });
    expect(start[0]!.descriptor.stingerSound).toBe(getEraConfig("2025").transition.stingerSound);

    const staged = stageEvents(events);
    expect(staged.map((event) => `${event.stage}:${event.phase}`)).toEqual([
      "environment:begin",
      "buildings:begin",
      "retail:begin",
      "environment:end",
      "street-life:begin",
      "buildings:end",
      "retail:end",
      "street-life:end",
    ]);
    for (const event of staged) {
      expect(event.from).toBe("1945");
      expect(event.to).toBe("2025");
      expect(event.stageCount).toBe(DEFAULT_STAGE_PLAN.length);
    }
    expect(staged[0]!.systemIds).toEqual(["environment"]);
    expect(staged.find((event) => event.stage === "street-life")!.systemIds).toEqual([
      "pedestrians",
      "vehicles",
    ]);

    const complete = completeEvents(events);
    expect(complete).toHaveLength(1);
    expect(complete[0]).toMatchObject({
      type: "complete",
      from: "1945",
      to: "2025",
      interrupted: false,
      settledEra: "2025",
      progress: 1,
      elapsedMs: DEFAULT_TRANSITION_DURATION_MS,
    });
  });

  it("preserves the camera pose and never touches anything but applyEra", () => {
    const rig = new THREE.Group();
    rig.position.set(14, 9.5, 22);
    rig.quaternion.setFromEuler(new THREE.Euler(0.4, 0.8, 0));
    const pose = { position: rig.position.clone(), quaternion: rig.quaternion.clone() };
    let rigUpdates = 0;
    let rigApplies = 0;

    const rigSystem: EraSceneSystem = {
      id: "camera-rig",
      group: rig,
      update: () => {
        rigUpdates += 1;
      },
      getPickables: () => [],
      // CameraRig.applyEra is a deliberate no-op: the pose must survive the morph.
      applyEra: () => {
        rigApplies += 1;
      },
    };
    const environment = new RecordingSystem("environment");
    const driver = createEraTransition({
      systems: [
        { system: environment, stage: "environment", id: "environment" },
        { system: rigSystem, stage: "lighting", id: "camera-rig" },
      ],
    });

    driver.transitionTo("2025");
    runToIdle(driver);

    expect(rigApplies).toBeGreaterThan(100);
    expect(rigUpdates).toBe(0);
    expect(environment.updates).toBe(0);
    expect(rig.position.equals(pose.position)).toBe(true);
    expect(rig.quaternion.equals(pose.quaternion)).toBe(true);
  });

  it("treats non-finite or negative deltas as a zero step and cannot stall", () => {
    const { driver, events } = createHarness();
    driver.transitionTo("2025");
    driver.update(Number.NaN);
    driver.update(-1);
    driver.update(Number.POSITIVE_INFINITY);

    expect(driver.elapsedMs).toBe(0);
    expect(driver.progress).toBe(0);
    expect(stageEvents(events)).toHaveLength(0);
    expect(completeEvents(events)).toHaveLength(0);

    // A zero-length leg still lands every system on its target.
    const instant = createHarness({ durationMs: 0 });
    instant.driver.transitionTo("2025");
    expect(instant.driver.transitioning).toBe(false);
    for (const system of instant.systems) {
      expect(system.lastEra).toBe("2025");
      expect(system.lastBlend).toBe(1);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Interruption                                                               */
/* -------------------------------------------------------------------------- */

describe("interruption", () => {
  it("retargets from the current blend without rewinding, then lands on the new era", () => {
    const { driver, systems, events } = createHarness();

    driver.transitionTo("2025");
    stepTimes(driver, 60); // 1.0 s in: every stage is in flight, none is done yet
    const carried = new Map(systems.map((system) => [system.id, system.lastBlend!]));
    expect(carried.get("environment")!).toBeGreaterThan(0.9);
    expect(carried.get("vehicles")!).toBe(0);

    driver.transitionTo("1985");

    // The superseded leg reports itself, the new leg starts immediately.
    const superseded = completeEvents(events);
    expect(superseded).toHaveLength(1);
    expect(superseded[0]).toMatchObject({
      from: "1945",
      to: "2025",
      interrupted: true,
      settledEra: "1985",
    });
    expect(startEvents(events).at(-1)).toMatchObject({
      type: "start",
      from: "2025",
      to: "1985",
      retarget: true,
      durationMs: DEFAULT_TRANSITION_DURATION_MS,
    });
    // The new leg restarts its own fixed-step timeline.
    expect(driver.elapsedMs).toBe(0);
    expect(driver.targetEra).toBe("1985");

    // One step later every system continues from where it was: a stage still in
    // flight picks up its exact blend, a finished one restarts from the state it
    // is already showing. Nothing jumps backwards through the year it left.
    driver.update(STEP);
    const newProgress = (STEP * 1000) / DEFAULT_TRANSITION_DURATION_MS;
    for (const system of systems) {
      const previous = carried.get(system.id)!;
      const next = system.lastBlend!;
      expect(system.lastEra).toBe("1985");
      if (previous > 0 && previous < 1) {
        expect(next).toBeGreaterThanOrEqual(previous);
        expect(next).toBeCloseTo(
          previous + (1 - previous) * expectedBlend("1985", stageOf(system.id), newProgress),
          6,
        );
      } else {
        expect(next).toBeCloseTo(expectedBlend("1985", stageOf(system.id), newProgress), 6);
        expect(next).toBe(0);
      }
    }

    runToIdle(driver);
    for (const system of systems) {
      expect(system.lastEra).toBe("1985");
      expect(system.lastBlend).toBe(1);
    }

    // The retargeted choreography still staggers, in stage order.
    const newBegins = stageEvents(events)
      .filter((event) => event.to === "1985" && event.phase === "begin")
      .map((event) => event.stage);
    expect(newBegins).toEqual([...ERA_STAGE_ORDER]);

    // Every start is matched by exactly one complete.
    expect(completeEvents(events)).toHaveLength(startEvents(events).length);
    expect(completeEvents(events).at(-1)).toMatchObject({
      interrupted: false,
      settledEra: "1985",
      progress: 1,
    });
  });

  it("restarts an already-finished stage from the state it is showing", () => {
    const { driver, byId, events } = createHarness();
    driver.transitionTo("2025");
    stepTimes(driver, 120); // 80 %: atmosphere, buildings and retail are already done

    const environment = byId.get("environment")!;
    const pedestrians = byId.get("pedestrians")!;
    expect(environment.lastBlend).toBe(1);
    expect(pedestrians.lastBlend).toBeLessThan(1);
    expect(pedestrians.lastBlend).toBeGreaterThan(0);

    driver.transitionTo("1985");
    driver.update(STEP);

    // The finished stage crossfades into the new era from what it shows now ...
    expect(environment.lastEra).toBe("1985");
    expect(environment.lastBlend).toBeLessThan(0.05);
    // ... while the stage still in flight keeps its blend and carries on.
    expect(pedestrians.lastEra).toBe("1985");
    expect(pedestrians.lastBlend).toBeGreaterThanOrEqual(0.6);

    runToIdle(driver);
    for (const system of [environment, pedestrians]) {
      expect(system.lastEra).toBe("1985");
      expect(system.lastBlend).toBe(1);
    }
    expect(completeEvents(events).filter((event) => event.interrupted)).toHaveLength(1);
  });

  it("survives rapid slider scrubbing and still lands on the final year", () => {
    const { driver, systems, events } = createHarness();
    const script: EraId[] = ["1965", "2025", "1985", "1945", "2005", "2025", "1965", "2025"];

    driver.transitionTo("2025");
    script.forEach((era, index) => {
      stepTimes(driver, 3 + index);
      driver.transitionTo(era);
    });
    // A no-op re-selection of the era already in flight.
    driver.transitionTo("2025");
    expect(startEvents(events)).toHaveLength(1 + script.length);

    runToIdle(driver);

    expect(driver.transitioning).toBe(false);
    expect(driver.settledEra).toBe("2025");
    for (const system of systems) {
      expect(system.lastEra).toBe("2025");
      expect(system.lastBlend).toBe(1);
      // Each leg ramps up to exactly 1; the only permitted step down is a
      // finished stage restarting a new leg from the state it is showing, so a
      // partially morphed system can never be rewound by scrubbing.
      let previous = 0;
      for (const blend of system.blends) {
        expect(blend).toBeGreaterThanOrEqual(0);
        expect(blend).toBeLessThanOrEqual(1);
        if (blend < previous) {
          expect(previous).toBe(1);
          expect(blend).toBeLessThan(0.05);
        }
        previous = blend;
      }
    }

    const completes = completeEvents(events);
    expect(completes).toHaveLength(startEvents(events).length);
    expect(completes.filter((event) => event.interrupted)).toHaveLength(script.length);
    expect(completes.at(-1)).toMatchObject({ interrupted: false, settledEra: "2025" });
  });

  it("cancels back to the era the leg started from, fully applied", () => {
    const { driver, systems, events } = createHarness();
    driver.transitionTo("2025");
    stepTimes(driver, 45);

    driver.cancel();

    expect(driver.transitioning).toBe(false);
    expect(driver.settledEra).toBe("1945");
    expect(driver.targetEra).toBe("1945");
    for (const system of systems) {
      expect(system.lastEra).toBe("1945");
      expect(system.lastBlend).toBe(1);
    }
    expect(completeEvents(events).at(-1)).toMatchObject({
      from: "1945",
      to: "2025",
      interrupted: true,
      settledEra: "1945",
    });

    // Idle: cancelling again (and updating) changes nothing.
    const settledCalls = systems.map((system) => system.blends.length);
    driver.cancel();
    driver.update(STEP);
    expect(systems.map((system) => system.blends.length)).toEqual(settledCalls);
  });

  it("settles a running leg on its target on demand", () => {
    const { driver, systems, events } = createHarness();
    driver.transitionTo("1985");
    stepTimes(driver, 20);

    driver.settle();

    expect(driver.transitioning).toBe(false);
    expect(driver.settledEra).toBe("1985");
    for (const system of systems) {
      expect(system.lastEra).toBe("1985");
      expect(system.lastBlend).toBe(1);
    }
    const staged = stageEvents(events);
    expect(staged.filter((event) => event.phase === "begin").map((event) => event.stage)).toEqual([
      ...ERA_STAGE_ORDER,
    ]);
    expect(staged.filter((event) => event.phase === "end").map((event) => event.stage)).toEqual([
      ...ERA_STAGE_ORDER,
    ]);
    expect(completeEvents(events).at(-1)).toMatchObject({
      interrupted: false,
      settledEra: "1985",
      elapsedMs: DEFAULT_TRANSITION_DURATION_MS,
    });
  });

  it("ignores a re-selection of the era already in flight or already settled", () => {
    const { driver, events, systems } = createHarness();
    driver.transitionTo("2005");
    stepTimes(driver, 10);
    driver.transitionTo("2005");
    expect(startEvents(events)).toHaveLength(1);

    runToIdle(driver);
    const calls = systems[0]!.blends.length;
    driver.transitionTo("2005");
    expect(startEvents(events)).toHaveLength(1);
    expect(completeEvents(events)).toHaveLength(1);
    driver.update(STEP);
    expect(systems[0]!.blends).toHaveLength(calls);

    expect(() => driver.transitionTo("2100" as EraId)).toThrow();
  });
});

/* -------------------------------------------------------------------------- */
/* Registration, events and determinism                                       */
/* -------------------------------------------------------------------------- */

describe("registration", () => {
  it("brings a system mounted mid-transition in line with its stage-mates", () => {
    const driver = createEraTransition();
    const environment = new RecordingSystem("environment");
    const handle = driver.register(environment, { stage: "environment", id: "environment" });

    // Registering on an idle driver applies the era the block already shows.
    expect(handle.stage).toBe("environment");
    expect(environment.lastEra).toBe("1945");
    expect(environment.lastBlend).toBe(1);

    driver.transitionTo("2025");
    stepTimes(driver, 60);

    const late = new RecordingSystem("buildings");
    driver.register(late, { stage: "buildings" });

    // The newcomer joins at the blend its stage has already reached.
    expect(late.eras).toHaveLength(1);
    expect(late.lastEra).toBe("2025");
    expect(late.lastBlend).toBeCloseTo(expectedBlend("2025", stageOf("buildings"), 60 / 150), 6);
    expect(driver.blendFor(late)).toBe(late.lastBlend);

    runToIdle(driver);
    expect(late.lastBlend).toBe(1);
    expect(environment.lastBlend).toBe(1);
  });

  it("rejects duplicates and unknown stages, and supports removal and disposal", () => {
    const driver = createEraTransition();
    const system = new RecordingSystem("storefronts");
    const handle = driver.register(system, { stage: "storefronts", id: "storefronts" });

    expect(handle.stage).toBe("retail");
    expect(handle.id).toBe("storefronts");
    expect(driver.registered.map((entry) => [entry.id, entry.stage])).toEqual([["storefronts", "retail"]]);
    expect(() => driver.register(system, { stage: "retail" })).toThrow(/already registered/);
    expect(() => driver.register(new RecordingSystem("engine"), { stage: "engine" })).toThrow(
      /Unknown era transition stage/,
    );

    expect(driver.unregister(handle)).toBe(true);
    expect(driver.unregister(system)).toBe(false);
    expect(driver.registered).toHaveLength(0);
    expect(driver.blendFor(system)).toBeUndefined();

    driver.dispose();
    expect(() => driver.register(new RecordingSystem("late"), { stage: "retail" })).toThrow(/disposed/);
  });

  it("tears down without emitting a fake completion", () => {
    const events: EraTransitionEvent[] = [];
    const driver = createEraTransition({ durationMs: 1000 });
    driver.subscribe((event) => events.push(event));
    driver.register(new RecordingSystem("environment"), { stage: "environment" });
    driver.transitionTo("2025");
    driver.update(STEP);

    driver.dispose();
    driver.update(STEP);
    driver.transitionTo("1985");

    expect(driver.transitioning).toBe(false);
    expect(events.filter((event) => event.type === "complete")).toHaveLength(0);
  });

  it("keeps its configured duration and reports leg state", () => {
    const system = new RecordingSystem("environment");
    const driver = createEraTransition({
      systems: [{ system, stage: "environment", id: "environment" }],
      durationMs: 1000,
    });

    expect(driver.durationMs).toBe(1000);
    expect(driver.stagePlan.map((stage) => stage.id)).toEqual([...ERA_STAGE_ORDER]);
    expect(driver.registered).toHaveLength(1);
    expect(driver.activeLeg).toBeNull();

    driver.transitionTo("1965");
    // 1965 declares `ease-out`, straight from the era contract.
    expect(driver.activeLeg).toEqual({ from: "1945", target: "1965", easing: "ease-out" });
    expect(driver.activeLeg?.easing).toBe(getEraConfig("1965").transition.easing);

    runToIdle(driver);
    expect(driver.activeLeg).toBeNull();
    expect(driver.progress).toBe(1);
  });

  it("honours a custom choreography", () => {
    const events: EraTransitionEvent[] = [];
    const environment = new RecordingSystem("environment");
    const pedestrian = new RecordingSystem("pedestrians");
    const driver = createEraTransition({
      durationMs: 1000,
      stagePlan: [
        { id: "environment", label: "Atmosphere", start: 0, end: 0.5 },
        { id: "street-life", label: "Street", start: 0.5, end: 1 },
      ],
      systems: [
        { system: environment, stage: "lighting", id: "environment" },
        { system: pedestrian, stage: "pedestrians", id: "pedestrians" },
      ],
    });
    driver.subscribe((event) => events.push(event));

    expect(driver.stagePlan.map((stage) => stage.label)).toEqual(["Atmosphere", "Street"]);
    driver.transitionTo("2025");
    stepTimes(driver, 30); // half way: the atmosphere stage is done, the street awaits

    expect(environment.lastBlend).toBe(1);
    expect(pedestrian.lastBlend).toBeLessThan(0.01);

    expect(runToIdle(driver)).toBe(30);
    expect(pedestrian.lastBlend).toBe(1);
    expect(stageEvents(events).map((event) => `${event.stage}:${event.phase}`)).toEqual([
      "environment:begin",
      "environment:end",
      "street-life:begin",
      "street-life:end",
    ]);
  });
});

describe("events", () => {
  it("emits onStart, onStage and onComplete with era ids for SFX and UI", () => {
    const counts = { start: 0, stage: 0, complete: 0 };
    const seen: EraTransitionEvent[] = [];
    const system = new RecordingSystem("environment");
    const driver = createEraTransition({
      durationMs: DEFAULT_TRANSITION_DURATION_MS,
      onStart: () => {
        counts.start += 1;
      },
      onStage: () => {
        counts.stage += 1;
      },
      onComplete: () => {
        counts.complete += 1;
      },
      systems: [{ system, stage: "environment", id: "environment" }],
    });
    const unsubscribe = driver.subscribe((event) => seen.push(event));

    driver.transitionTo("1965");
    runToIdle(driver);

    // Every stage of the plan reports itself, including stages with no systems.
    expect(counts).toEqual({ start: 1, stage: 2 * DEFAULT_STAGE_PLAN.length, complete: 1 });
    expect(seen.map((event) => event.type)).toEqual([
      "start",
      "stage",
      "stage",
      "stage",
      "stage",
      "stage",
      "stage",
      "stage",
      "stage",
      "complete",
    ]);

    const staged = stageEvents(seen);
    expect(staged.map((event) => `${event.stage}:${event.phase}`)).toEqual([
      "environment:begin",
      "buildings:begin",
      "retail:begin",
      "environment:end",
      "street-life:begin",
      "buildings:end",
      "retail:end",
      "street-life:end",
    ]);
    expect(staged.map((event) => event.stageIndex)).toEqual([0, 1, 2, 0, 3, 1, 2, 3]);
    for (const event of staged) {
      expect(event.from).toBe("1945");
      expect(event.to).toBe("1965");
      expect(event.label.length).toBeGreaterThan(0);
      expect(event.progress).toBeGreaterThanOrEqual(0);
      expect(event.progress).toBeLessThanOrEqual(1);
    }
    const progress = staged.map((event) => event.progress);
    expect(progress.every((value, index) => index === 0 || value >= progress[index - 1]!)).toBe(true);

    // Unsubscribing stops the union channel but leaves the options callbacks alone.
    unsubscribe();
    driver.transitionTo("2025");
    driver.update(STEP);
    expect(seen.filter((event) => event.to === "2025")).toHaveLength(0);
    expect(counts.start).toBe(2);
  });

  it("maps slider years onto the real era timeline", () => {
    for (const era of ERAS) {
      expect(eraForYear(era.year)).toBe(era.id);
    }
    expect(eraForYear(1946)).toBe("1945");
    expect(eraForYear(1970)).toBe("1965");
    expect(eraForYear(2015)).toBe("2005"); // an exact tie resolves to the earlier era
    expect(eraForYear(2016)).toBe("2025");
    expect(() => eraForYear(Number.NaN)).toThrow(/Cannot resolve an era/);

    const { driver, events } = createHarness();
    driver.transitionToYear(1985);
    expect(startEvents(events).at(-1)).toMatchObject({ from: "1945", to: "1985" });
    runToIdle(driver);
    expect(driver.settledEra).toBe("1985");
  });
});

describe("determinism", () => {
  it("produces identical applyEra sequences for identical scripts", () => {
    const run = (): { eras: EraId[]; blends: number[]; events: string[] } => {
      const { driver, systems, events } = createHarness();
      driver.transitionTo("2025");
      stepTimes(driver, 40);
      driver.transitionTo("1985");
      stepTimes(driver, 25);
      driver.transitionTo("2025");
      runToIdle(driver);
      return {
        eras: systems.flatMap((system) => system.eras),
        blends: systems.flatMap((system) => system.blends),
        events: events.map((event) => JSON.stringify(event)),
      };
    };

    const first = run();
    expect(first.blends.length).toBeGreaterThan(600);
    expect(run()).toEqual(first);
  });
});

/* -------------------------------------------------------------------------- */
/* Composition with a real scene system                                       */
/* -------------------------------------------------------------------------- */

/** Minimal 2D context for the procedural canvas textures of the real system. */
function makeCanvasContext(): CanvasRenderingContext2D {
  return {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    font: "10px sans-serif",
    textAlign: "center",
    textBaseline: "middle",
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn((text: string) => ({ width: text.length * 10 }) as TextMetrics),
  } as unknown as CanvasRenderingContext2D;
}

describe("composition with the real era environment system", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => makeCanvasContext());
  });

  afterEach(() => vi.restoreAllMocks());

  it("drives the real EnvironmentSystem from 1945 to 2025 through the choreography", () => {
    const scene = new THREE.Scene();
    const environment = createEnvironmentSystem({ layout: CITY_LAYOUT, scene });
    const updateSpy = vi.spyOn(environment, "update");
    const sunBefore = environment.sun.color.getHex();
    const skyBefore = environment.skyUniforms.uTopColor.value.getHex();

    const driver = createEraTransition({
      systems: [{ system: environment, stage: "lighting", id: "environment" }],
    });
    driver.transitionTo("2025");

    const samples: number[] = [];
    let steps = 0;
    while (driver.transitioning && steps < 600) {
      driver.update(STEP);
      samples.push(environment.transitionBlend);
      steps += 1;
    }

    expect(steps).toBe(150);
    expect(environment.transitionTarget).toBe("2025");
    expect(environment.transitionBlend).toBe(1);
    expect(environment.activeEra).toBe("2025");
    expect(environment.sun.color.getHex()).not.toBe(sunBefore);
    expect(environment.skyUniforms.uTopColor.value.getHex()).not.toBe(skyBefore);
    expect(environment.fog.color.getHex()).toBe(getEraConfig("2025").palette.fog);
    // The driver morphs the real system through `applyEra`, never `update`.
    expect(updateSpy).not.toHaveBeenCalled();

    // The real system's own blend tracks the driver's staged ramp.
    expect(samples).toHaveLength(150);
    expect(samples[0]).toBeGreaterThan(0);
    expect(samples.at(-1)).toBe(1);
    expect(samples.every((value, index) => index === 0 || value >= samples[index - 1]!)).toBe(true);
    expect(samples[Math.floor(samples.length / 4)]!).toBeLessThan(1);
    expect(samples[Math.floor(samples.length / 2)]!).toBeGreaterThan(samples[0]!);
    expect(environment.report).toBeDefined();

    environment.dispose();
  });
});
