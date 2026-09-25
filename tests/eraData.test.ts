import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ERAS as ERAS_FROM_DATA_MODULE } from "../src/era/eraData";
import {
  ERAS,
  ERAS_BY_ID,
  ERA_DOMAIN_KEYS,
  ERA_IDS,
  clampBlend,
  eraIndex,
  getEraConfig,
  resolveEraWeights,
  type EraAware,
  type EraConfig,
  type EraDomainKey,
  type EraId,
  type EraSceneSystem,
  type EraUpdateContext,
  type SceneSystem,
} from "../src/era/eraTypes";

/**
 * Contract tests for the Chrono City era dataset.
 *
 * Everything is imported from `src/era/eraTypes.ts` on purpose: that file is
 * the consumer surface, so these tests fail if the dataset stops being
 * re-exported through it, if an era is missing a domain, if a domain stops
 * differing between eras, or if the data stops being deterministic and frozen.
 */

const TIMELINE: readonly EraId[] = ["1945", "1965", "1985", "2005", "2025"];

/** Repository root, used to assert the dataset has no clock/random source. */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Colour-bearing keys whose values must be real 24-bit colours. */
const COLOR_KEYS = new Set([
  "sky",
  "skyHorizon",
  "fog",
  "fogColor",
  "sunlight",
  "ambient",
  "ground",
  "asphalt",
  "sidewalk",
  "facadePrimary",
  "facadeSecondary",
  "accent",
  "windowGlow",
  "uiAccent",
  "color",
  "bodyColor",
  "roofColor",
  "awningColors",
]);

/** Values that would signal an unfilled or stubbed descriptor field. */
const PLACEHOLDER_PATTERN = /(todo|fixme|placeholder|tbd|lorem|xxx|n\/a|unknown-value)/i;

interface Leaf {
  readonly path: string;
  readonly key: string;
  readonly value: unknown;
}

/** Flattens a plain data tree, asserting that no branch is empty. */
function collectLeaves(value: unknown, path: string, out: Leaf[]): void {
  if (Array.isArray(value)) {
    expect(value.length, `${path} must not be an empty list`).toBeGreaterThan(0);
    value.forEach((entry, position) => collectLeaves(entry, `${path}[${position}]`, out));
    return;
  }

  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>);
    expect(entries.length, `${path} must not be an empty descriptor`).toBeGreaterThan(0);
    for (const [key, entry] of entries) {
      collectLeaves(entry, `${path}.${key}`, out);
    }
    return;
  }

  const key = path.match(/([A-Za-z_][A-Za-z0-9_]*)(?:\[\d+\])?$/)?.[1] ?? path;
  out.push({ path, key, value });
}

function expectProportion(value: unknown, path: string): void {
  expect(typeof value, `${path} must be a number`).toBe("number");
  expect(Number.isFinite(value as number), `${path} must be finite`).toBe(true);
  expect(value as number, `${path} must stay within 0..1`).toBeGreaterThanOrEqual(0);
  expect(value as number, `${path} must stay within 0..1`).toBeLessThanOrEqual(1);
}

function sumOf(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

describe("era dataset shape", () => {
  it("exposes exactly the five timeline stops in chronological order", () => {
    // Compile-time exhaustiveness: this literal requires every EraId member and
    // rejects any key the union does not declare.
    const eraIdCoverage: Record<EraId, true> = {
      "1945": true,
      "1965": true,
      "1985": true,
      "2005": true,
      "2025": true,
    };

    expect(Object.keys(eraIdCoverage).sort()).toEqual([...ERA_IDS].sort());
    expect(ERA_IDS).toEqual(TIMELINE);
    expect(ERAS).toHaveLength(TIMELINE.length);
    expect(ERAS.map((era) => era.id)).toEqual([...TIMELINE]);
  });

  it("carries the timeline labels, years and indices the slider renders", () => {
    const eras: readonly EraConfig[] = ERAS;

    expect(eras.map((era) => era.year)).toEqual([1945, 1965, 1985, 2005, 2025]);
    expect(eras.map((era) => era.label)).toEqual([...TIMELINE]);
    expect(eras.map((era) => era.index)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(eras.map((era) => era.title)).size).toBe(TIMELINE.length);

    for (const era of eras) {
      expect(era.year).toBe(Number(era.id));
      expect(era.label).toBe(era.id);
      expect(era.title.trim().length).toBeGreaterThan(0);
      expect(era.tagline.trim().length).toBeGreaterThan(0);
      expect(eraIndex(era.id)).toBe(era.index);
    }
  });

  it("defines every one of the nine descriptor domains for every era", () => {
    const domainCoverage: Record<EraDomainKey, true> = {
      palette: true,
      buildings: true,
      vehicles: true,
      storefronts: true,
      advertising: true,
      pedestrians: true,
      environment: true,
      sound: true,
      transition: true,
    };

    expect([...ERA_DOMAIN_KEYS]).toEqual(Object.keys(domainCoverage));

    for (const era of ERAS) {
      expect(Object.keys(era)).toEqual(
        expect.arrayContaining([...ERA_DOMAIN_KEYS, "id", "index", "year", "label", "title", "tagline"]),
      );
      for (const domain of ERA_DOMAIN_KEYS) {
        expect(era[domain], `${era.id}.${domain} must exist`).toBeTruthy();
        expect(typeof era[domain]).toBe("object");
      }
    }
  });
});

describe("era descriptor completeness", () => {
  it("has no empty, placeholder or malformed values in any era", () => {
    for (const era of ERAS) {
      const leaves: Leaf[] = [];
      collectLeaves(era, era.id, leaves);
      expect(leaves.length).toBeGreaterThan(100);

      for (const leaf of leaves) {
        expect(leaf.value, `${leaf.path} must not be null or undefined`).toBeDefined();
        expect(leaf.value, `${leaf.path} must not be null`).not.toBeNull();

        if (typeof leaf.value === "string") {
          expect(leaf.value.trim().length, `${leaf.path} must not be blank`).toBeGreaterThan(0);
          expect(PLACEHOLDER_PATTERN.test(leaf.value), `${leaf.path} looks like a placeholder`).toBe(false);
        }

        if (typeof leaf.value === "number") {
          expect(Number.isFinite(leaf.value), `${leaf.path} must be a finite number`).toBe(true);
        }

        if (COLOR_KEYS.has(leaf.key)) {
          expect(typeof leaf.value, `${leaf.path} must be a colour`).toBe("number");
          expect(Number.isInteger(leaf.value as number), `${leaf.path} must be an integer colour`).toBe(true);
          expect(leaf.value as number, `${leaf.path} must be > 0`).toBeGreaterThan(0);
          expect(leaf.value as number, `${leaf.path} must fit 24-bit RGB`).toBeLessThanOrEqual(0xffffff);
        }
      }
    }
  });

  it("keeps every probability, share and gain normalized and parameterized", () => {
    for (const era of ERAS) {
      const { palette, buildings, vehicles, storefronts, advertising, pedestrians, environment, sound, transition } = era;

      // Palette: every entry is a usable 24-bit colour.
      for (const [key, value] of Object.entries(palette)) {
        expect(Number.isInteger(value), `${era.id}.palette.${key} must be an integer colour`).toBe(true);
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(0xffffff);
      }

      // Buildings: massing is a real range and counts are positive integers.
      expect(buildings.minFloors).toBeGreaterThan(0);
      expect(buildings.maxFloors).toBeGreaterThan(buildings.minFloors);
      expect(buildings.floorHeight).toBeGreaterThan(0);
      expect(buildings.facadeModules).toBeGreaterThan(0);
      expect(buildings.window.columns).toBeGreaterThan(0);
      expect(buildings.window.rows).toBeGreaterThan(0);
      expect(buildings.materials.length).toBeGreaterThanOrEqual(2);
      expectProportion(buildings.footprintFill, `${era.id}.buildings.footprintFill`);
      expectProportion(buildings.ornament, `${era.id}.buildings.ornament`);
      expectProportion(buildings.window.glow, `${era.id}.buildings.window.glow`);
      expectProportion(buildings.heightFalloff, `${era.id}.buildings.heightFalloff`);

      // Vehicles: the spawn mix is a probability distribution with sane geometry.
      expect(vehicles.mix.length).toBeGreaterThanOrEqual(6);
      expect(sumOf(vehicles.mix.map((share) => share.share))).toBeCloseTo(1, 6);
      expect(new Set(vehicles.mix.map((share) => share.kind)).size).toBe(vehicles.mix.length);
      for (const share of vehicles.mix) {
        expect(share.share).toBeGreaterThan(0);
        expect(share.speed).toBeGreaterThan(0);
        expect(share.length).toBeGreaterThan(0);
        expect(share.width).toBeGreaterThan(0);
        expect(share.height).toBeGreaterThan(0);
        expectProportion(share.noise, `${era.id}.vehicles.${share.kind}.noise`);
      }
      expect(vehicles.laneCount).toBeGreaterThan(0);
      expect(vehicles.laneWidth).toBeGreaterThan(0);
      expect(vehicles.speedLimit).toBeGreaterThan(0);
      expectProportion(vehicles.chromeLevel, `${era.id}.vehicles.chromeLevel`);
      expectProportion(vehicles.parkingShare, `${era.id}.vehicles.parkingShare`);
      expectProportion(vehicles.idlingNoise, `${era.id}.vehicles.idlingNoise`);

      // Storefronts: hours form a real trading window and the mix is distinct.
      expect(storefronts.kinds.length).toBeGreaterThanOrEqual(5);
      expect(new Set(storefronts.kinds).size).toBe(storefronts.kinds.length);
      expect(storefronts.hours.closeHour).toBeGreaterThan(storefronts.hours.openHour);
      expect(storefronts.hours.openHour).toBeGreaterThanOrEqual(0);
      expect(storefronts.hours.closeHour).toBeLessThanOrEqual(24);
      expectProportion(storefronts.occupancy, `${era.id}.storefronts.occupancy`);
      expectProportion(storefronts.glassArea, `${era.id}.storefronts.glassArea`);
      expectProportion(storefronts.interiorGlow, `${era.id}.storefronts.interiorGlow`);
      expect(storefronts.queueDensity).toBeGreaterThanOrEqual(0);
      for (const color of storefronts.awningColors) {
        expect(Number.isInteger(color)).toBe(true);
        expect(color).toBeGreaterThan(0);
      }

      // Advertising: placements per 100 m stay in a renderable range.
      expect(advertising.media.length).toBeGreaterThanOrEqual(4);
      expect(advertising.density).toBeGreaterThan(0);
      expect(advertising.copyThemes.length).toBeGreaterThanOrEqual(2);
      expect(new Set(advertising.copyThemes).size).toBe(advertising.copyThemes.length);
      expect(advertising.billboardScale).toBeGreaterThan(0);
      expect(advertising.messageRotationSeconds).toBeGreaterThan(0);
      expectProportion(advertising.animatedShare, `${era.id}.advertising.animatedShare`);
      expectProportion(advertising.brightness, `${era.id}.advertising.brightness`);
      expectProportion(advertising.saturation, `${era.id}.advertising.saturation`);

      // Pedestrians: the wardrobe is a distribution over distinct outfit rules.
      expect(pedestrians.outfits.length).toBeGreaterThanOrEqual(4);
      expect(sumOf(pedestrians.outfits.map((outfit) => outfit.share))).toBeCloseTo(1, 6);
      expect(new Set(pedestrians.outfits.map((outfit) => outfit.id)).size).toBe(pedestrians.outfits.length);
      for (const outfit of pedestrians.outfits) {
        expect(outfit.share).toBeGreaterThan(0);
        expect(outfit.palette.length).toBeGreaterThanOrEqual(2);
        expect(outfit.accessories.length).toBeGreaterThanOrEqual(2);
        expectProportion(outfit.coverage, `${era.id}.pedestrians.${outfit.id}.coverage`);
      }
      expect(sumOf([pedestrians.ageMix.child, pedestrians.ageMix.adult, pedestrians.ageMix.senior])).toBeCloseTo(1, 6);
      expect(pedestrians.density).toBeGreaterThan(0);
      expect(pedestrians.walkSpeed).toBeGreaterThan(0);
      expect(pedestrians.strideScale).toBeGreaterThan(0);
      expectProportion(pedestrians.crowdRatio, `${era.id}.pedestrians.crowdRatio`);
      expectProportion(pedestrians.gadgetUse, `${era.id}.pedestrians.gadgetUse`);
      expectProportion(pedestrians.chatterLevel, `${era.id}.pedestrians.chatterLevel`);

      // Environment: the lighting rig is physically plausible.
      expect(environment.sunElevation).toBeGreaterThanOrEqual(0);
      expect(environment.sunElevation).toBeLessThanOrEqual(90);
      expect(environment.sunAzimuth).toBeGreaterThanOrEqual(0);
      expect(environment.sunAzimuth).toBeLessThan(360);
      expect(environment.lux).toBeGreaterThan(0);
      expect(environment.fogDensity).toBeGreaterThan(0);
      expect(environment.treeDensity).toBeGreaterThanOrEqual(0);
      expect(environment.laneMarkings.length).toBeGreaterThan(0);
      expect(environment.streetFurniture.length).toBeGreaterThanOrEqual(3);
      expectProportion(environment.airQuality, `${era.id}.environment.airQuality`);

      // Sound: layer gains sum to a unit soundscape and the mixer is in range.
      expect(sound.layers.length).toBeGreaterThanOrEqual(5);
      expect(sumOf(sound.layers.map((layer) => layer.gain))).toBeCloseTo(1, 6);
      expect(new Set(sound.layers.map((layer) => layer.id)).size).toBe(sound.layers.length);
      expect(sound.musicTempo).toBeGreaterThan(0);
      expect(sound.reverbSeconds).toBeGreaterThan(0);
      expect(sound.signatureCues.length).toBeGreaterThanOrEqual(2);
      for (const layer of sound.layers) {
        expectProportion(layer.gain, `${era.id}.sound.${layer.id}.gain`);
      }
      for (const [bus, gain] of Object.entries(sound.mixer)) {
        expectProportion(gain, `${era.id}.sound.mixer.${bus}`);
      }
      expectProportion(sound.trafficGain, `${era.id}.sound.trafficGain`);

      // Transition: durations and morph settings stay usable.
      expect(transition.durationMs).toBeGreaterThan(0);
      expect(transition.stepSeconds).toBeGreaterThan(0);
      expect(transition.cameraDolly).toBeGreaterThan(0);
      expectProportion(transition.crossfade, `${era.id}.transition.crossfade`);
    }
  });
});

describe("era distinctness", () => {
  it("gives every descriptor domain five unique values", () => {
    for (const domain of ERA_DOMAIN_KEYS) {
      const signatures = ERAS.map((era) => JSON.stringify(era[domain]));
      expect(new Set(signatures).size, `${domain} must differ across all five eras`).toBe(ERAS.length);
    }
  });

  it("differs in the specific behaviours the timeline promises to change", () => {
    const unique = (values: readonly string[]): number => new Set(values).size;

    expect(unique(ERAS.map((era) => era.buildings.style))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.buildings.secondaryStyle))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.vehicles.mix.map((share) => share.kind).join("+")))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.vehicles.headlight))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.storefronts.kinds.join("+")))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.storefronts.signStyles.join("+")))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.advertising.media.join("+")))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.pedestrians.outfits.map((outfit) => outfit.id).join("+")))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.pedestrians.gadgetUse.toString()))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.environment.skyModel))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.environment.streetSurface))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => `${era.environment.sunElevation}/${era.environment.lux}`))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.sound.soundscape))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.sound.musicStyle))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.transition.durationMs.toString()))).toBe(ERAS.length);
    expect(unique(ERAS.map((era) => era.palette.sky.toString()))).toBe(ERAS.length);

    // Building heights actually grow with the timeline stops, which is the
    // headline "time period affects the block" behaviour.
    expect(ERAS.map((era) => era.buildings.maxFloors)).toEqual([9, 16, 30, 40, 34]);
    expect(ERAS[4].environment.airQuality).toBeGreaterThan(ERAS[2].environment.airQuality);
    expect(ERAS[0].pedestrians.gadgetUse).toBe(0);
    expect(ERAS[4].pedestrians.gadgetUse).toBeGreaterThan(0.5);
  });
});

describe("era contract surface", () => {
  it("re-exports the dataset from src/era/eraTypes.ts", () => {
    expect(ERAS).toBe(ERAS_FROM_DATA_MODULE);
    expect(Object.keys(ERAS_BY_ID)).toEqual([...ERA_IDS]);
    for (const era of ERAS) {
      expect(ERAS_BY_ID[era.id]).toBe(era);
      expect(getEraConfig(era.id)).toBe(era);
    }
  });

  it("returns descriptors for known eras and rejects unknown ones", () => {
    expect(getEraConfig("1985")).toBe(ERAS[2]);
    expect(() => getEraConfig("1999" as EraId)).toThrowError(/Unknown Chrono City era/);
  });

  it("blends two eras into normalized weights and clamps raw slider input", () => {
    expect(clampBlend(Number.NaN)).toBe(0);
    expect(clampBlend(-4)).toBe(0);
    expect(clampBlend(0)).toBe(0);
    expect(clampBlend(0.42)).toBe(0.42);
    expect(clampBlend(1)).toBe(1);
    expect(clampBlend(9)).toBe(1);
    expect(clampBlend(Number.POSITIVE_INFINITY)).toBe(1);

    const halfway = resolveEraWeights("1945", "2025", 0.25);
    expect(halfway["1945"]).toBeCloseTo(0.75, 10);
    expect(halfway["2025"]).toBeCloseTo(0.25, 10);
    expect(sumOf(Object.values(halfway))).toBeCloseTo(1, 10);

    const start = resolveEraWeights("1945", "2025", -2);
    expect(start["1945"]).toBe(1);
    expect(start["2025"]).toBe(0);

    const end = resolveEraWeights("1945", "2025", 12);
    expect(end["2025"]).toBe(1);
    expect(end["1945"]).toBe(0);

    const stationary = resolveEraWeights("2005", "2005", 0.5);
    expect(stationary["2005"]).toBe(1);
    expect(sumOf(Object.values(stationary))).toBeCloseTo(1, 10);

    for (const id of ERA_IDS) {
      expect(halfway[id]).toBeGreaterThanOrEqual(0);
    }
  });

  it("drives a scene system through the EraAware and SceneSystem contracts", () => {
    class StubBlockSystem implements EraSceneSystem {
      readonly id = "stub-block";
      readonly group = new THREE.Group();
      readonly updates: EraUpdateContext[] = [];
      disposed = false;
      private applied: { era: EraId; blend: number } | null = null;
      private readonly meshes: THREE.Mesh[] = [
        new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()),
        new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial()),
      ];

      constructor() {
        this.group.add(...this.meshes);
      }

      applyEra(era: EraId, blend: number): void {
        const config = getEraConfig(era);
        const clamped = clampBlend(blend);
        this.applied = { era, blend: clamped };
        this.group.name = `stub-${config.id}`;
        this.group.userData.sky = config.palette.sky;
        this.group.userData.facade = config.buildings.style;
        this.group.userData.blend = clamped;
      }

      update(context: EraUpdateContext): void {
        this.updates.push(context);
        const blended = Object.entries(context.weights).reduce(
          (total, [id, weight]) => total + (ERAS_BY_ID[id as EraId].palette.sky * weight),
          0,
        );
        this.group.userData.blendedSky = blended;
      }

      getPickables(): readonly THREE.Object3D[] {
        return this.meshes;
      }

      dispose(): void {
        this.disposed = true;
        this.group.clear();
      }

      get lastApplied(): { era: EraId; blend: number } | null {
        return this.applied;
      }
    }

    const system = new StubBlockSystem();
    const eraAware: EraAware = system;
    const sceneSystem: SceneSystem = system;

    expect(sceneSystem.group).toBeInstanceOf(THREE.Group);
    expect(sceneSystem.getPickables()).toHaveLength(2);
    expect(sceneSystem.getPickables().every((object) => object instanceof THREE.Object3D)).toBe(true);

    eraAware.applyEra("1985", 1);
    expect(system.lastApplied).toEqual({ era: "1985", blend: 1 });
    expect(system.group.userData.sky).toBe(ERAS_BY_ID["1985"].palette.sky);
    expect(system.group.userData.facade).toBe("mirror-glass-tower");

    // Out-of-range blends are clamped, keeping the contract's 0..1 promise.
    eraAware.applyEra("2025", 7);
    expect(system.group.userData.blend).toBe(1);

    const context: EraUpdateContext = {
      era: "2025",
      from: "1945",
      blend: 0.25,
      weights: resolveEraWeights("1945", "2025", 0.25),
      delta: 1 / 60,
      elapsed: 1.5,
    };
    sceneSystem.update(context);

    expect(system.updates).toHaveLength(1);
    expect(system.updates[0]).toBe(context);
    expect(system.group.userData.blendedSky).toBeCloseTo(
      ERAS_BY_ID["1945"].palette.sky * 0.75 + ERAS_BY_ID["2025"].palette.sky * 0.25,
      8,
    );

    sceneSystem.dispose?.();
    expect(system.disposed).toBe(true);
    expect(system.group.children).toHaveLength(0);
  });

  it("keeps the dataset frozen and deterministic", () => {
    expect(Object.isFrozen(ERAS)).toBe(true);
    expect(Object.isFrozen(ERAS[0])).toBe(true);
    expect(Object.isFrozen(ERAS[0].palette)).toBe(true);
    expect(Object.isFrozen(ERAS[0].vehicles.mix)).toBe(true);
    expect(Object.isFrozen(ERAS[0].vehicles.mix[0])).toBe(true);
    expect(Object.isFrozen(ERAS_BY_ID)).toBe(true);
    expect(() => {
      (ERAS as EraConfig[]).push(ERAS[0]);
    }).toThrow(TypeError);
    expect(() => {
      (ERAS[0].palette as { sky: number }).sky = 0x000000;
    }).toThrow(TypeError);

    // No clock or random source may leak into the dataset: values must be the
    // same on every import, which is what makes the tests above stable.
    const source = readFileSync(resolve(repoRoot, "src/era/eraData.ts"), "utf8");
    expect(source).not.toMatch(/Date\.now|Math\.random|performance\.now|crypto\.randomUUID/);
    expect(JSON.parse(JSON.stringify(ERAS))).toEqual(JSON.parse(JSON.stringify(ERAS_FROM_DATA_MODULE)));
  });
});
