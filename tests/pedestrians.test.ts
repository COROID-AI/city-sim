import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  ERA_IDS,
  ERAS,
  getEraConfig,
  resolveEraWeights,
  type EraId,
  type EraUpdateContext,
} from "../src/era/eraTypes";
import { CITY_LAYOUT, PERIMETER_STREETS } from "../src/scene/layout";
import {
  ACCESSORY_CATALOG,
  ACCESSORY_SLOTS,
  AGE_SPEED_FACTOR,
  BASE_RIG_PARAMS,
  ERA_WARDROBE,
  FABRICS,
  FIGURE_PARAM_KEYS,
  createFabricTextureSet,
  fabricTextureTransport,
  missingAccessoryIds,
  paintFabricPattern,
  type FigureAppearance,
  type PedestrianLookSummary,
} from "../src/scene/pedestrianOutfits";
import {
  BASE_STRIDE_LENGTH,
  HIDDEN_WEIGHT_EPSILON,
  MIN_FIGURE_SEPARATION,
  PEDESTRIAN_SYSTEM_ID,
  buildWalkNetwork,
  computeWalkCycle,
  createPedestrianSystem,
  planPopulation,
  sampleWalkRoute,
  walkableSidewalkLength,
  type FigureOutline,
  type PedestrianSystem,
  type PedestrianSystemOptions,
} from "../src/scene/pedestrians";

/**
 * Composition tests for the era pedestrian system.
 *
 * Everything is driven through the *real* contracts: the frozen era dataset
 * (`ERAS`) and the shared city layout (`CITY_LAYOUT`). There are no fixture
 * eras, fixture layouts or stubbed looks, so these tests fail if the crowd
 * stops following the era wardrobe, leaves the layout's walk paths, or stops
 * morphing continuously.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const TEST_SEED = 4242;

function systemFor(era: EraId, extra: Partial<PedestrianSystemOptions> = {}): PedestrianSystem {
  return createPedestrianSystem({ era, seed: TEST_SEED, ...extra });
}

/** Captures a system's outlines and releases its GPU resources again. */
function outlinesFor(era: EraId): readonly FigureOutline[] {
  const system = systemFor(era);
  const outlines = system.outlines();
  system.dispose();
  return outlines;
}

function contextFor(era: EraId, from: EraId, blend: number, delta: number, elapsed: number): EraUpdateContext {
  return { era, from, blend, weights: resolveEraWeights(from, era, blend), delta, elapsed };
}

interface SimulateOptions {
  readonly era: EraId;
  readonly from?: EraId;
  readonly blend?: number;
  readonly steps: number;
  readonly delta?: number;
  readonly onFrame?: (frame: number, system: PedestrianSystem) => void;
}

function simulate(system: PedestrianSystem, options: SimulateOptions): void {
  const delta = options.delta ?? 1 / 30;
  const from = options.from ?? options.era;
  const blend = options.blend ?? 1;
  for (let frame = 0; frame < options.steps; frame += 1) {
    system.update(contextFor(options.era, from, blend, delta, (frame + 1) * delta));
    options.onFrame?.(frame, system);
  }
}

interface GroundPoint {
  readonly x: number;
  readonly z: number;
}

function onSidewalk(point: GroundPoint): boolean {
  return PERIMETER_STREETS.some((street) => {
    const vertical = street.side === "east" || street.side === "west";
    return street.sidewalks.some((walk) => {
      const along = vertical ? Math.abs(point.z - walk.center.z) : Math.abs(point.x - walk.center.x);
      const across = vertical ? Math.abs(point.x - walk.center.x) : Math.abs(point.z - walk.center.z);
      return along <= walk.length / 2 + 1e-6 && across <= walk.width / 2 + 1e-6;
    });
  });
}

function insideCrosswalk(point: GroundPoint): boolean {
  return CITY_LAYOUT.crosswalks.some((crosswalk) => {
    const vertical = crosswalk.streetSide === "east" || crosswalk.streetSide === "west";
    const along = vertical ? Math.abs(point.x - crosswalk.center.x) : Math.abs(point.z - crosswalk.center.z);
    const across = vertical ? Math.abs(point.z - crosswalk.center.z) : Math.abs(point.x - crosswalk.center.x);
    return along <= crosswalk.width / 2 + 1e-6 && across <= crosswalk.length / 2 + 1e-6;
  });
}

function insideCarriageway(point: GroundPoint): boolean {
  const vertical = Math.abs(point.x) >= 18 && Math.abs(point.x) <= 26 && Math.abs(point.z) <= 30;
  const horizontal = Math.abs(point.z) >= 18 && Math.abs(point.z) <= 26 && Math.abs(point.x) <= 30;
  return vertical || horizontal;
}

/**
 * The 0.5 m kerb strip between the carriageway edge and the outer sidewalk a
 * crossing steps over; walkers are allowed to be there while crossing.
 */
function onKerbStrip(point: GroundPoint): boolean {
  const vertical = Math.abs(point.x) >= 26 && Math.abs(point.x) <= 26.6 && Math.abs(point.z) <= 2.6;
  const horizontal = Math.abs(point.z) >= 26 && Math.abs(point.z) <= 26.6 && Math.abs(point.x) <= 2.6;
  return vertical || horizontal;
}

function onWalkway(point: GroundPoint): boolean {
  return onSidewalk(point) || insideCrosswalk(point) || onKerbStrip(point);
}

function insideLot(point: GroundPoint): boolean {
  return CITY_LAYOUT.lots.some(
    (lot) =>
      point.x > lot.bounds.minX &&
      point.x < lot.bounds.maxX &&
      point.z > lot.bounds.minZ &&
      point.z < lot.bounds.maxZ,
  );
}

function findMesh(root: THREE.Object3D, name: string): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object.name === name) {
      found = object;
    }
  });
  return found;
}

function meshOpacity(root: THREE.Object3D, name: string): number {
  const mesh = findMesh(root, name);
  expect(mesh, `mesh "${name}" exists`).not.toBeNull();
  const material = Array.isArray(mesh!.material) ? mesh!.material[0]! : mesh!.material;
  return material.opacity;
}

function objectRotationX(root: THREE.Object3D, name: string): number {
  const node = root.getObjectByName(name);
  expect(node, `object "${name}" exists`).not.toBeNull();
  return node!.rotation.x;
}

function countMeshes(root: THREE.Object3D): number {
  let total = 0;
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      total += 1;
    }
  });
  return total;
}

function accessoryIdSet(outline: FigureOutline): ReadonlySet<string> {
  return new Set(outline.slots.map((slot) => slot.accessoryId).filter((id): id is string => Boolean(id)));
}

/** Meshes that make up one accessory slot, by their rig object names. */
const SLOT_OBJECT_NAMES: Readonly<Record<string, readonly string[]>> = {
  hat: ["hat"],
  eyewear: ["eyewear"],
  neck: ["neckwear"],
  hands: ["hand-skin"],
  audio: ["audio"],
  overlayer: ["overlayer"],
  bag: ["bag"],
  carried: ["carried-left", "carried-right"],
  support: ["cane-left", "cane-right"],
  wrist: ["wrist-left", "wrist-right"],
  footwear: [],
};

/** True when every mesh belonging to a slot is currently hidden. */
function slotMeshesHidden(root: THREE.Object3D, slot: string): boolean {
  const names = SLOT_OBJECT_NAMES[slot] ?? [];
  if (names.length === 0) {
    return true;
  }
  return names.every((name) => {
    const node = root.getObjectByName(name);
    if (!node) {
      return true;
    }
    let hidden = true;
    node.traverse((object) => {
      if (object instanceof THREE.Mesh && object.visible) {
        hidden = false;
      }
    });
    return hidden;
  });
}

function minPairDistance(system: PedestrianSystem): number {
  const figures = system.figures.filter((figure) => figure.activation > HIDDEN_WEIGHT_EPSILON);
  let min = Number.POSITIVE_INFINITY;
  for (let left = 0; left < figures.length; left += 1) {
    for (let right = left + 1; right < figures.length; right += 1) {
      const a = figures[left]!.position;
      const b = figures[right]!.position;
      min = Math.min(min, Math.hypot(a.x - b.x, a.z - b.z));
    }
  }
  return Number.isFinite(min) ? min : 0;
}

/* -------------------------------------------------------------------------- */
/* Scene-system contract                                                      */
/* -------------------------------------------------------------------------- */

describe("pedestrian scene system", () => {
  it("mounts like any SceneSystem and exposes an era-aware crowd", () => {
    const system = systemFor("2005");
    expect(system.id).toBe(PEDESTRIAN_SYSTEM_ID);
    expect(system.group.name).toBe("pedestrian-crowd");
    expect(typeof system.update).toBe("function");
    expect(typeof system.applyEra).toBe("function");
    expect(typeof system.dispose).toBe("function");

    const scene = new THREE.Scene();
    scene.add(system.group);
    expect(system.group.parent).toBe(scene);

    simulate(system, { era: "2005", steps: 5 });

    const pickables = system.getPickables();
    expect(pickables).toHaveLength(system.poolSize);
    expect(system.figures).toHaveLength(system.poolSize);
    for (const [index, pickable] of pickables.entries()) {
      expect(pickable.userData["pedestrianId"]).toBe(`pedestrian-${index}`);
      expect(pickable.parent).toBe(system.group);
    }

    system.dispose();
    expect(system.group.children).toHaveLength(0);
    expect(pickables.every((pickable) => pickable.parent === null)).toBe(true);
    // Teardown is idempotent and further frames are inert.
    expect(() => system.dispose()).not.toThrow();
    expect(() => simulate(system, { era: "2005", steps: 2 })).not.toThrow();
  });

  it("builds the crowd pool from the real layout walk paths", () => {
    const network = buildWalkNetwork();
    const layoutPoints = CITY_LAYOUT.pedestrianPaths.flatMap((path) =>
      path.waypoints.map((point) => ({ x: point.x, z: point.z })),
    );
    expect(network.routes).toHaveLength(5);
    expect(network.sidewalkLength).toBeCloseTo(132, 6);
    expect(walkableSidewalkLength()).toBeCloseTo(network.sidewalkLength, 6);

    for (const route of network.routes) {
      expect(route.vertices.length).toBeGreaterThanOrEqual(4);
      expect(route.length).toBeGreaterThan(0);
      for (const vertex of route.vertices) {
        const onLayoutPath = layoutPoints.some(
          (point) => Math.abs(point.x - vertex.x) < 1e-9 && Math.abs(point.z - vertex.z) < 1e-9,
        );
        expect(onLayoutPath, `${route.id} vertex (${vertex.x}, ${vertex.z}) is a layout waypoint`).toBe(true);
        expect(vertex.corridorHalfWidth).toBeGreaterThan(0);
      }
    }

    const circuit = network.routes.find((route) => route.kind === "sidewalk-loop")!;
    expect(circuit.closed).toBe(true);
    expect(circuit.crossingWindow).toBeNull();
    const excursions = network.routes.filter((route) => route.kind === "crossing-excursion");
    expect(excursions).toHaveLength(4);
    for (const excursion of excursions) {
      expect(CITY_LAYOUT.crosswalks.some((crosswalk) => crosswalk.id === excursion.crosswalkId)).toBe(true);
      expect(excursion.crossingWindow).not.toBeNull();
      const [from, to] = excursion.crossingWindow!;
      expect(to).toBeGreaterThan(from);
      // A quarter of the way into the window the walker is on the crosswalk.
      const onStripes = sampleWalkRoute(excursion, from + (to - from) * 0.25);
      expect(onStripes.corridor).toBe("crosswalk");
      expect(insideCrosswalk(onStripes)).toBe(true);
      // The far end of the excursion is the outer sidewalk.
      const farEnd = sampleWalkRoute(excursion, from + (to - from) * 0.5);
      expect(onSidewalk(farEnd)).toBe(true);
    }

    // Sampling a circuit always lands inside the sidewalk band.
    for (let distance = 0; distance < circuit.length; distance += 1.5) {
      const sample = sampleWalkRoute(circuit, distance, 1);
      expect(onSidewalk(sample)).toBe(true);
      expect(insideLot(sample)).toBe(false);
      expect(insideCarriageway(sample)).toBe(false);
    }
  });

  it("gives every figure a detailed multi-part rig", () => {
    const system = systemFor("2005");
    const outlines = system.outlines();
    expect(outlines.length).toBeGreaterThanOrEqual(10);
    for (const outline of outlines) {
      expect(outline.meshCount).toBeGreaterThan(40);
      expect(outline.parameters.heightScale).toBeGreaterThan(0.5);
      expect(outline.walkCycle.strideLength).toBeGreaterThan(0);
      // Hair, footwear and at least two extra details are always present.
      expect(outline.look.hairLabel.length).toBeGreaterThan(0);
      const footwear = outline.slots.find((slot) => slot.slot === "footwear")!;
      expect(footwear.accessoryId).not.toBeNull();
      expect(footwear.weight).toBeCloseTo(1, 6);
      expect(accessoryIdSet(outline).size).toBeGreaterThanOrEqual(3);
      // Body-level details exist regardless of the era.
      expect(outline.parameters.hairVolume).toBeGreaterThan(0);
      expect(outline.parameters.hemLength).toBeGreaterThan(0);
      expect(outline.parameters.shoeLength).toBeGreaterThan(0);
    }
    expect(system.stats().resources.meshes).toBe(
      outlines.reduce((total, outline) => total + outline.meshCount, 0),
    );
    expect(countMeshes(system.group)).toBe(system.stats().resources.meshes);
    system.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Era wardrobe                                                               */
/* -------------------------------------------------------------------------- */

describe("era-specific outfits", () => {
  it("covers every accessory the era dataset and wardrobes name", () => {
    expect(missingAccessoryIds()).toEqual([]);
    for (const spec of Object.values(ACCESSORY_CATALOG)) {
      expect(ACCESSORY_SLOTS).toContain(spec.slot);
      expect(spec.label.length).toBeGreaterThan(0);
      expect(Number.isInteger(spec.color)).toBe(true);
      expect(spec.color).toBeGreaterThanOrEqual(0);
      expect(spec.color).toBeLessThanOrEqual(0xffffff);
    }
    for (const era of ERAS) {
      for (const rule of era.pedestrians.outfits) {
        for (const id of rule.accessories) {
          expect(ACCESSORY_CATALOG[id], `${era.id}/${rule.id} accessory ${id}`).toBeDefined();
        }
      }
    }
  });

  it("dresses each era straight from the era contract", () => {
    const eraLooks = new Map<EraId, string>();
    for (const eraId of ERA_IDS) {
      const config = getEraConfig(eraId);
      const wardrobe = ERA_WARDROBE[eraId];
      const outlines = outlinesFor(eraId);
      const allowedAccessories = new Set<string>([
        ...wardrobe.fallbackHats,
        ...wardrobe.fallbackEyewear,
        ...wardrobe.fallbackBags,
        ...wardrobe.footwear,
        ...wardrobe.devices,
        "walking-cane",
      ]);
      const silhouettes = new Set<string>();
      const outfitIds = new Set<string>();
      for (const outline of outlines) {
        const rule = config.pedestrians.outfits.find((candidate) => candidate.id === outline.look.outfitId);
        expect(rule, `${eraId} outfit ${outline.look.outfitId} is in the era dataset`).toBeDefined();
        expect(rule!.silhouette).toBe(outline.look.silhouette);
        expect(wardrobe.fabrics).toContain(outline.look.fabricId);
        expect(FABRICS[outline.look.fabricId]).toBeDefined();
        expect(wardrobe.hairStyles).toContain(outline.look.hairStyle);
        expect(outline.look.signatures).toEqual([...wardrobe.signatures]);
        for (const id of accessoryIdSet(outline)) {
          const fromOutfit = rule!.accessories.includes(id);
          expect(
            fromOutfit || allowedAccessories.has(id),
            `${eraId} figure wears "${id}" from neither ${rule!.id} nor the era detail pool`,
          ).toBe(true);
        }
        silhouettes.add(outline.look.silhouette);
        outfitIds.add(outline.look.outfitId);
        expect(outline.parameters.coverage).toBeCloseTo(rule!.coverage, 6);
      }
      // Every outfit rule of the era is worn by at least one figure.
      for (const candidate of config.pedestrians.outfits) {
        expect(outfitIds.has(candidate.id), `${eraId} rule ${candidate.id} appears`).toBe(true);
      }
      expect(silhouettes.size).toBeGreaterThanOrEqual(2);
      expect(outfitIds.size).toBeGreaterThanOrEqual(2);
      eraLooks.set(eraId, JSON.stringify([...silhouettes].sort().concat([...outfitIds].sort())));
    }
    // The five stops must not dress the crowd identically.
    expect(new Set(eraLooks.values()).size).toBe(ERA_IDS.length);
  });

  it("carries the era tells the brief calls out", () => {
    const byEra = new Map<EraId, readonly FigureOutline[]>();
    for (const eraId of ERA_IDS) {
      byEra.set(eraId, outlinesFor(eraId));
    }
    const lookOf = (eraId: EraId): readonly PedestrianLookSummary[] =>
      byEra.get(eraId)!.map((outline) => outline.look);
    const hatsOf = (eraId: EraId): readonly (string | null)[] =>
      lookOf(eraId).map((look) => look.slotLabels.hat);

    // 1945: fedoras, wide-lapel overcoats/trench coats and A-line tea dresses.
    expect(ERA_WARDROBE["1945"].fallbackHats).toContain("fedora");
    expect(hatsOf("1945")).toContain("Fedora");
    expect(
      byEra.get("1945")!.some(
        (outline) => outline.parameters.lapelWidth >= 0.08 && outline.parameters.hemLength >= 0.7,
      ),
    ).toBe(true);
    expect(byEra.get("1945")!.some((outline) => outline.parameters.hemFlare >= 0.4)).toBe(true);

    // 1965: mod tailoring, pillbox hats, shift/A-line dresses.
    expect(ERA_WARDROBE["1965"].fallbackHats).toContain("pillbox-hat");
    expect(byEra.get("1965")!.some((outline) => outline.look.silhouette === "slim-lapel-suit")).toBe(true);
    expect(
      byEra.get("1965")!.some(
        (outline) => outline.look.silhouette === "shift-mini" || outline.look.silhouette === "sleeveless-a-line",
      ),
    ).toBe(true);
    expect(
      lookOf("1965").some((look) => Object.values(look.slotLabels).includes("Oversized sunglasses")),
    ).toBe(true);

    // 1985: power suits with shoulder pads, bright sportswear and denim.
    const powerSuits = byEra
      .get("1985")!
      .filter((outline) => outline.look.silhouette === "oversized-shoulder-pad");
    expect(powerSuits.length).toBeGreaterThan(0);
    expect(powerSuits.every((outline) => outline.parameters.shoulderLift >= 0.9)).toBe(true);
    expect(byEra.get("1985")!.some((outline) => outline.look.silhouette === "leotard-legwarmers")).toBe(true);
    expect(byEra.get("1985")!.some((outline) => outline.look.silhouette === "boxy-denim")).toBe(true);
    expect(
      lookOf("1985").some((look) =>
        Object.values(look.slotLabels).some((label) => label === "Windbreaker" || label === "Walkman"),
      ),
    ).toBe(true);

    // 2005: casual jeans, hoodies and business casual.
    for (const silhouette of ["low-rise-bootcut", "baggy-athletic", "untucked-shirt-trouser"]) {
      expect(
        byEra.get("2005")!.some((outline) => outline.look.silhouette === silhouette),
        `2005 includes ${silhouette}`,
      ).toBe(true);
    }
    expect(
      lookOf("2005").some(
        (look) => look.slotLabels.carried === "MP3 player" || look.slotLabels.audio === "Wired earbuds",
      ),
    ).toBe(true);

    // 2025: techwear shells, technical fabrics and smart accessories.
    expect(byEra.get("2025")!.some((outline) => outline.look.silhouette === "oversized-techwear")).toBe(true);
    expect(
      byEra.get("2025")!.some(
        (outline) =>
          FABRICS[outline.look.fabricId]!.weave === "technical-ripstop" ||
          FABRICS[outline.look.fabricId]!.weave === "bio-nylon" ||
          FABRICS[outline.look.fabricId]!.weave === "recycled-knit",
      ),
    ).toBe(true);
    const smart = new Set(["Smartwatch", "Bone-conduction earbuds", "Smart glasses", "Wireless charger", "Smartphone"]);
    const smartLooks = lookOf("2025").filter((look) =>
      Object.values(look.slotLabels).some((label) => (label ? smart.has(label) : false)),
    );
    expect(smartLooks.length).toBeGreaterThan(0);
    expect(getEraConfig("2025").pedestrians.gadgetUse).toBeGreaterThan(0.8);

    // Detail above the clothing layer, in every era: headwear, bags, footwear
    // and (for the older walkers) a support cane.
    for (const eraId of ERA_IDS) {
      const outlines = byEra.get(eraId)!;
      expect(outlines.some((outline) => outline.parameters.hatWeight > 0), `${eraId} headwear`).toBe(true);
      expect(outlines.some((outline) => outline.parameters.bagWeight > 0), `${eraId} bag`).toBe(true);
      expect(outlines.every((outline) => outline.parameters.footwearWeight > 0), `${eraId} footwear`).toBe(true);
      expect(outlines.some((outline) => outline.parameters.hairVolume > 0), `${eraId} hair`).toBe(true);
    }
    const canes = ERA_IDS.flatMap((eraId) => byEra.get(eraId)!).filter(
      (outline) => outline.parameters.supportWeight > 0,
    );
    expect(canes.length).toBeGreaterThan(0);
    expect(
      byEra.get("2005")!.some((outline) => outline.look.slotLabels.carried !== null || outline.parameters.carriedWeight > 0),
    ).toBe(true);
  });

  it("paints deterministic era fabric textures", () => {
    expect(Object.keys(FABRICS).length).toBeGreaterThanOrEqual(15);
    const transport = fabricTextureTransport();
    expect(["canvas-2d", "data-texture"]).toContain(transport);

    const signatures = new Set<string>();
    for (const fabric of Object.values(FABRICS)) {
      const weave = paintFabricPattern(fabric, 24, "weave");
      expect(weave).toHaveLength(24 * 24 * 4);
      const again = paintFabricPattern(fabric, 24, "weave");
      expect(Array.from(again)).toEqual(Array.from(weave));
      const pattern = paintFabricPattern(fabric, 24, "pattern");
      // The pattern layer is a transparent motif, the weave layer is opaque cloth.
      expect(Array.from(pattern)).not.toEqual(Array.from(weave));
      expect(weave[3]).toBe(255);
      for (let index = 3; index < pattern.length; index += 4) {
        expect(pattern[index]!).toBeLessThanOrEqual(255);
      }
      signatures.add(Array.from(weave.slice(0, 96)).join(","));

      const set = createFabricTextureSet(fabric, 16);
      expect(set.transport).toBe(transport);
      expect(set.fabricId).toBe(fabric.id);
      for (const texture of [set.weave, set.pattern]) {
        expect(texture.wrapS).toBe(THREE.RepeatWrapping);
        expect(texture.wrapT).toBe(THREE.RepeatWrapping);
        expect(texture.repeat.x).toBeCloseTo(fabric.repeats, 6);
        expect(texture.image).toBeTruthy();
        texture.dispose();
      }
    }
    // Distinct recipes must not paint identical cloth.
    expect(signatures.size).toBeGreaterThanOrEqual(Object.keys(FABRICS).length - 2);
  });
});

/* -------------------------------------------------------------------------- */
/* Routing, spacing and density                                               */
/* -------------------------------------------------------------------------- */

describe("crowd behaviour on the block", () => {
  it("walks sidewalks, crosses only at crosswalks and never enters a lot", () => {
    const system = systemFor("2005");
    let intrusions = 0;
    let crossingsSeen = 0;
    simulate(system, {
      era: "2005",
      steps: 2700,
      onFrame: (frame) => {
        if (frame % 3 !== 0) {
          return;
        }
        for (const figure of system.figures) {
          if (figure.activation <= HIDDEN_WEIGHT_EPSILON) {
            continue;
          }
          const point = { x: figure.position.x, z: figure.position.z };
          if (insideLot(point) || (insideCarriageway(point) && !insideCrosswalk(point))) {
            intrusions += 1;
          }
          if (insideCrosswalk(point)) {
            crossingsSeen += 1;
          }
          // Every walker stays on the pavement, the zebra crossing or the kerb
          // strip the crossing steps over.
          expect(onWalkway(point), `figure ${figure.id} off walkway`).toBe(true);
        }
      },
    });
    expect(intrusions).toBe(0);
    expect(crossingsSeen).toBeGreaterThan(0);
    expect(system.stats().crosswalkCrossings).toBeGreaterThan(0);

    // Figures routed over a crossing declare the matching crosswalk.
    for (const figure of system.figures) {
      if (figure.scenario === "crossing") {
        expect(figure.crosswalkId).not.toBeNull();
        expect(CITY_LAYOUT.crosswalks.some((crosswalk) => crosswalk.id === figure.crosswalkId)).toBe(true);
      } else {
        expect(figure.crosswalkId).toBeNull();
      }
    }
    system.dispose();
  });

  it("varies walking speed and keeps spacing between walkers", () => {
    const system = systemFor("2005");
    const descriptor = getEraConfig("2005").pedestrians;
    const expectedBase = descriptor.walkSpeed * descriptor.strideScale;
    const startPositions = system.figures.map((figure) => figure.position.clone());
    let sawQueueing = false;
    let worstSpacing = Number.POSITIVE_INFINITY;
    simulate(system, {
      era: "2005",
      steps: 900,
      onFrame: (frame) => {
        if (frame % 10 === 0) {
          worstSpacing = Math.min(worstSpacing, minPairDistance(system));
        }
        if (
          system.figures.some(
            (figure) =>
              figure.activation > HIDDEN_WEIGHT_EPSILON && figure.speed < figure.baseSpeed * 0.999,
          )
        ) {
          sawQueueing = true;
        }
      },
    });

    const speeds = system.figures
      .filter((figure) => figure.activation > HIDDEN_WEIGHT_EPSILON)
      .map((figure) => figure.speed);
    expect(new Set(speeds.map((speed) => speed.toFixed(3))).size).toBeGreaterThan(3);
    for (const figure of system.figures) {
      if (figure.activation <= HIDDEN_WEIGHT_EPSILON) {
        continue;
      }
      const base = figure.speedFactor * expectedBase * AGE_SPEED_FACTOR[figure.ageBracket];
      expect(figure.baseSpeed).toBeCloseTo(base, 6);
      expect(figure.speed).toBeLessThanOrEqual(figure.baseSpeed + 1e-9);
      expect(figure.speedFactor).toBeGreaterThanOrEqual(0.8);
      expect(figure.speedFactor).toBeLessThanOrEqual(1.2);
    }
    expect(sawQueueing).toBe(true);
    // Walkers give way and sidestep rather than walking through each other, so
    // the closest approach always leaves at least a shoulder's width.
    expect(worstSpacing).toBeGreaterThan(0.3);

    // The crowd really moves along the layout routes.
    const moved = system.figures.filter(
      (figure, index) => figure.position.distanceTo(startPositions[index]!) > 3,
    );
    expect(moved.length).toBeGreaterThanOrEqual(system.poolSize - 2);
    system.dispose();
  });

  it("scales density with the era descriptor", () => {
    const sidewalkLength = walkableSidewalkLength();
    const populations = new Map<EraId, number>();
    for (const eraId of ERA_IDS) {
      const descriptor = getEraConfig(eraId).pedestrians;
      const expected = planPopulation(descriptor.density, sidewalkLength);
      expect(expected).toBeCloseTo((descriptor.density * sidewalkLength) / 100, 9);
      const system = systemFor(eraId);
      const stats = system.stats();
      expect(stats.densityPer100m).toBeCloseTo(descriptor.density, 9);
      expect(stats.targetPopulation).toBeCloseTo(expected, 9);
      expect(stats.activePopulation).toBeGreaterThan(0);
      expect(stats.activePopulation).toBeLessThanOrEqual(system.poolSize);
      expect(stats.figurePoolSize).toBeGreaterThanOrEqual(Math.ceil(expected));
      expect(stats.sidewalkLength).toBeCloseTo(sidewalkLength, 6);
      populations.set(eraId, stats.targetPopulation);
      system.dispose();
    }
    const ordered = ERA_IDS.map((eraId) => populations.get(eraId)!);
    expect(Math.min(...ordered)).toBeCloseTo(populations.get("1945")!, 9);
    expect(populations.get("2025")!).toBeGreaterThan(populations.get("1945")!);
    expect(populations.get("2005")!).toBeGreaterThan(populations.get("1945")!);
    // Density is proportional to the descriptor: the same crowd per 100 m.
    for (const eraId of ERA_IDS) {
      const descriptor = getEraConfig(eraId).pedestrians;
      expect(populations.get(eraId)! / descriptor.density).toBeCloseTo(sidewalkLength / 100, 9);
    }
  });

  it("animates counter-swinging limbs with bobbing heads", () => {
    const system = systemFor("2005");
    simulate(system, { era: "2005", steps: 30 });
    const walker = system.figures.find((figure) => figure.speed > 0.5 && figure.activation > 0.9)!;
    expect(walker).toBeDefined();

    const before = { ...walker.walkCycle };
    simulate(system, { era: "2005", steps: 6 });
    const after = walker.walkCycle;

    expect(after.phase).not.toBeCloseTo(before.phase, 6);
    expect(Math.sign(after.leftLegSwing)).toBe(-Math.sign(after.rightLegSwing));
    expect(Math.sign(after.leftArmSwing)).toBe(-Math.sign(after.leftLegSwing));
    expect(Math.sign(after.leftArmSwing)).toBe(-Math.sign(after.rightArmSwing));
    expect(after.leftKneeBend).toBeGreaterThanOrEqual(0);
    expect(after.rightKneeBend).toBeGreaterThanOrEqual(0);
    expect(after.hipBob).toBeGreaterThanOrEqual(0);
    expect(after.hipBob).toBeLessThanOrEqual(0.05);
    expect(Math.abs(after.headBob)).toBeGreaterThan(0);
    const headBobs: number[] = [];
    simulate(system, {
      era: "2005",
      steps: 60,
      onFrame: () => {
        headBobs.push(walker.walkCycle.headBob);
      },
    });
    // The head bobs at twice the stride rate, so a couple of seconds cover both signs.
    expect(Math.min(...headBobs)).toBeLessThan(0);
    expect(Math.max(...headBobs)).toBeGreaterThan(0);

    const descriptor = getEraConfig("2005").pedestrians;
    const heightScale = walker.appearance.parameters.heightScale;
    expect(after.strideLength).toBeCloseTo(BASE_STRIDE_LENGTH * descriptor.strideScale * heightScale, 6);

    // The pose actually reached the rig joints.
    expect(objectRotationX(walker.group, "hip-left")).toBeCloseTo(after.leftLegSwing, 6);
    expect(objectRotationX(walker.group, "hip-right")).toBeCloseTo(after.rightLegSwing, 6);
    expect(objectRotationX(walker.group, "arm-left")).toBeCloseTo(after.leftArmSwing, 6);
    expect(objectRotationX(walker.group, "arm-right")).toBeCloseTo(after.rightArmSwing, 6);
    expect(objectRotationX(walker.group, "head")).toBeCloseTo(after.headBob, 6);
    expect(findMesh(walker.group, "thigh-left")).not.toBeNull();

    const cycle = computeWalkCycle(Math.PI / 2, 1.5);
    expect(cycle.strideLength).toBe(1.5);
    expect(cycle.leftLegSwing).toBeCloseTo(0.62, 6);
    expect(cycle.leftArmSwing).toBeCloseTo(-0.5, 6);
    system.dispose();
  });
});

/* -------------------------------------------------------------------------- */
/* Era morphing                                                               */
/* -------------------------------------------------------------------------- */

describe("applyEra morphing", () => {
  it("morphs outfits and density continuously without popping or leaking", () => {
    const system = systemFor("1945");
    const from: EraId = "1945";
    const to: EraId = "2025";
    const steps = 60;
    // Warm every era first: fabric textures load lazily, so the first visit to
    // a wardrobe is a cache fill, not growth during the transition under test.
    for (const eraId of ERA_IDS) {
      system.update(contextFor(eraId, eraId, 1, 0, 0));
    }
    // Return to the starting stop before measuring the morph itself.
    system.update(contextFor(from, from, 1, 0, 0));
    const pristineResources = system.stats().resources;
    expect(pristineResources.textures).toBeLessThanOrEqual(Object.keys(FABRICS).length * 2);
    const pristineMeshes = system.stats().resources.meshes;
    const figure = system.figures[0]!;
    let previous = figure.outline();
    let sawFractionalActivation = false;
    let sawBothLayers = false;

    for (let step = 1; step <= steps; step += 1) {
      const blend = step / steps;
      system.applyEra(to, blend);
      expect(system.stats().blend).toBeCloseTo(blend, 9);
      system.update(contextFor(to, from, blend, 1 / 30, step / 30));

      const outline = figure.outline();
      for (const key of FIGURE_PARAM_KEYS) {
        const delta = Math.abs(outline.parameters[key] - previous.parameters[key]);
        expect(delta, `${key} jumps at blend ${blend.toFixed(3)}`).toBeLessThan(0.06);
      }
      for (const [key, value] of Object.entries(outline.parameters)) {
        expect(Number.isFinite(value), `${key} stays finite`).toBe(true);
      }
      for (const [key, value] of Object.entries(outline.look.slotLabels)) {
        expect(key.length).toBeGreaterThan(0);
        expect(value === null || typeof value === "string").toBe(true);
      }
      if (outline.activation > HIDDEN_WEIGHT_EPSILON && outline.activation < 0.999) {
        sawFractionalActivation = true;
      }
      if (
        system
          .outlines()
          .some((candidate) => candidate.activation > HIDDEN_WEIGHT_EPSILON && candidate.activation < 0.999)
      ) {
        sawFractionalActivation = true;
      }

      // The two era fabrics cross-fade instead of switching.
      const base = meshOpacity(figure.group, "garment-shell");
      const alternate = meshOpacity(figure.group, "garment-shell-alt");
      expect(base + alternate).toBeCloseTo(1, 6);
      expect(base).toBeGreaterThanOrEqual(0);
      expect(alternate).toBeLessThanOrEqual(1);
      if (base > 0.01 && base < 0.99) {
        sawBothLayers = true;
      }
      if (Math.abs(blend - 0.5) < 1e-9) {
        expect(base).toBeCloseTo(0.5, 6);
        expect(alternate).toBeCloseTo(0.5, 6);
      }

      expect(system.stats().resources.meshes).toBe(pristineMeshes);
      expect(consoleHasNoNaN(system)).toBe(true);
      previous = outline;
    }

    expect(sawFractionalActivation).toBe(true);
    expect(sawBothLayers).toBe(true);
    const finalResources = system.stats().resources;
    expect(finalResources.geometries).toBe(pristineResources.geometries);
    expect(finalResources.materials).toBe(pristineResources.materials);
    expect(finalResources.textures).toBe(pristineResources.textures);
    expect(finalResources.meshes).toBe(pristineResources.meshes);
    expect(finalResources.disposedGeometries).toBe(0);

    // The crowd grew with the era density, and the look is now the 2025 wardrobe.
    const stats = system.stats();
    expect(stats.eraId).toBe(to);
    expect(stats.fromEra).toBe(from);
    expect(stats.targetPopulation).toBeGreaterThan(planPopulation(getEraConfig(from).pedestrians.density, stats.sidewalkLength));
    expect(figure.outline().eraId).toBe(to);
    expect(ERA_WARDROBE[to].fabrics).toContain(figure.outline().look.fabricId);

    system.dispose();
  });

  it("is idempotent, clamp-safe and releasable", () => {
    const system = systemFor("1965");
    const apply = (blend: number): string => {
      system.applyEra("1985", blend);
      system.update(contextFor("1985", "1965", blend, 0, 0));
      return JSON.stringify(system.outlines().map((outline) => [outline.parameters, outline.slots]));
    };
    const first = apply(0.5);
    const second = apply(0.5);
    expect(second).toBe(first);

    // Out-of-range and NaN blends clamp exactly like the shared helper.
    const clampedHigh = apply(4);
    expect(system.stats().blend).toBe(1);
    const clampedLow = apply(-3);
    expect(system.stats().blend).toBe(0);
    expect(clampedHigh).not.toBe(clampedLow);
    system.applyEra("1985", Number.NaN);
    expect(system.stats().blend).toBe(0);

    apply(1);
    // Fabrics are cached lazily, so the first pass through the timeline loads
    // textures that every later pass can only reuse.
    for (const eraId of ERA_IDS) {
      system.update(contextFor(eraId, eraId, 1, 1 / 60, 0));
    }
    const before = system.stats().resources;
    expect(before.textures).toBeLessThanOrEqual(Object.keys(FABRICS).length * 2);
    for (let cycle = 0; cycle < 40; cycle += 1) {
      const era = ERA_IDS[cycle % ERA_IDS.length]!;
      const source = ERA_IDS[(cycle + 2) % ERA_IDS.length]!;
      const blend = (cycle % 5) / 4;
      system.applyEra(era, blend);
      system.update(contextFor(era, source, blend, 1 / 60, cycle / 60));
    }
    const after = system.stats().resources;
    expect(after.geometries).toBe(before.geometries);
    expect(after.materials).toBe(before.materials);
    expect(after.textures).toBe(before.textures);
    expect(after.meshes).toBe(before.meshes);

    const finalStats = system.stats();
    expect(finalStats.activePopulation).toBeGreaterThan(0);
    expect(finalStats.minPairDistance).toBeGreaterThanOrEqual(MIN_FIGURE_SEPARATION * 0.8);
    system.dispose();
    const disposed = system.stats().resources;
    expect(disposed.disposedGeometries).toBe(disposed.geometries);
    expect(disposed.disposedMaterials).toBe(disposed.materials);
    expect(disposed.disposedTextures).toBe(disposed.textures);
    expect(disposed.meshes).toBe(0);
    expect(system.group.children).toHaveLength(0);
  });

  it("reads every era parameter through the shared transition driver", () => {
    const system = systemFor("1945");
    for (const eraId of ERA_IDS) {
      const descriptor = getEraConfig(eraId).pedestrians;
      system.update(contextFor(eraId, eraId, 1, 0, 0));
      const stats = system.stats();
      expect(stats.eraId).toBe(eraId);
      expect(stats.fromEra).toBe(eraId);
      expect(stats.densityPer100m).toBeCloseTo(descriptor.density, 9);
      expect(stats.walkSpeed).toBeCloseTo(descriptor.walkSpeed, 9);
      expect(stats.strideScale).toBeCloseTo(descriptor.strideScale, 9);
      expect(stats.crowdRatio).toBeCloseTo(descriptor.crowdRatio, 9);
      expect(stats.gadgetUse).toBeCloseTo(descriptor.gadgetUse, 9);
    }
    // A mid-transition frame reports the interpolated descriptor values.
    system.update(contextFor("2025", "1945", 0.25, 0, 0));
    const stats = system.stats();
    const low = getEraConfig("1945").pedestrians;
    const high = getEraConfig("2025").pedestrians;
    expect(stats.densityPer100m).toBeCloseTo(low.density + (high.density - low.density) * 0.25, 9);
    expect(stats.walkSpeed).toBeCloseTo(low.walkSpeed + (high.walkSpeed - low.walkSpeed) * 0.25, 9);
    expect(stats.gadgetUse).toBeCloseTo(low.gadgetUse + (high.gadgetUse - low.gadgetUse) * 0.25, 9);
    system.dispose();
  });

  it("keeps accessory presence continuous across eras", () => {
    const system = systemFor("1945");
    const figure = system.figures[3]!;
    const samples: number[][] = [];
    for (let step = 0; step <= 20; step += 1) {
      const blend = step / 20;
      system.applyEra("2025", blend);
      system.update(contextFor("2025", "1945", blend, 1 / 30, step / 30));
      samples.push(
        system.outlines()[3]!.slots.map((slot) => slot.weight),
      );
    }
    for (let slot = 0; slot < ACCESSORY_SLOTS.length; slot += 1) {
      for (let step = 1; step < samples.length; step += 1) {
        const delta = Math.abs(samples[step]![slot]! - samples[step - 1]![slot]!);
        expect(delta, `slot ${ACCESSORY_SLOTS[slot]} jumps`).toBeLessThan(0.06);
        expect(samples[step]![slot]!).toBeGreaterThanOrEqual(0);
        expect(samples[step]![slot]!).toBeLessThanOrEqual(1);
      }
    }
    // Accessories that disappear shrink to nothing instead of blinking out.
    const finalOutline = system.outlines()[3]!;
    for (const slot of finalOutline.slots) {
      if (slot.weight <= HIDDEN_WEIGHT_EPSILON) {
        // A slot that has morphed away is scaled out of existence, never left
        // hovering on the figure.
        expect(slotMeshesHidden(figure.group, slot.slot), `slot ${slot.slot} is hidden`).toBe(true);
      }
    }
    expect(figure.appearance.parameters.hatWeight).toBeGreaterThanOrEqual(0);
    system.dispose();
  });
});

function consoleHasNoNaN(system: PedestrianSystem): boolean {
  for (const figure of system.figures) {
    const { x, z } = figure.position;
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      return false;
    }
    if (!Number.isFinite(figure.speed) || !Number.isFinite(figure.distanceAlongRoute)) {
      return false;
    }
    if (!Number.isFinite(figure.appearance.parameters.heightScale)) {
      return false;
    }
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Appearance API smoke                                                       */
/* -------------------------------------------------------------------------- */

describe("appearance inspection API", () => {
  it("resolves per-era looks consistently with the wardrobe", () => {
    const system = systemFor("2025");
    const figure = system.figures[0]!;
    const look: FigureAppearance = figure.appearanceFor("1945");
    expect(look.eraId).toBe("1945");
    expect(ERA_WARDROBE["1945"].fabrics).toContain(look.fabric.id);
    expect(FIGURE_PARAM_KEYS).toHaveLength(Object.keys(BASE_RIG_PARAMS).length);
    for (const key of FIGURE_PARAM_KEYS) {
      expect(BASE_RIG_PARAMS[key]).toBeTypeOf("number");
    }
    const summary = figure.describe();
    expect(summary.fabricId).toBe(figure.appearance.fabric.id);
    expect(summary.slotLabels.footwear).not.toBeNull();
    system.dispose();
  });
});
