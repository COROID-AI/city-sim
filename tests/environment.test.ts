import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ERAS,
  getEraConfig,
  type EraId,
  type EraUpdateContext,
} from "../src/era/eraTypes";
import {
  BUILDING_LOTS,
  CITY_LAYOUT,
  CROSSWALKS,
  INNER_SIDEWALK_OFFSET,
  OUTER_SIDEWALK_OFFSET,
  PERIMETER_STREETS,
  SIDEWALK_WIDTH,
  VEHICLE_LANE_LOOPS,
  type Crosswalk,
} from "../src/scene/layout";
import { carriagewayBounds, createEnvironmentSystem, lightingForEra, streetFacingYaw } from "../src/scene/environment";
import {
  ANCHOR_FURNITURE_KINDS,
  extrasForEra,
  furnitureKindFromName,
  lampSpecFor,
  primaryKindForSlot,
  treeSpecFor,
} from "../src/scene/streetProps";

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

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

const frame = (delta = 1 / 30, elapsed = 0): EraUpdateContext => ({
  era: "1945",
  from: "1945",
  blend: 1,
  weights: { "1945": 1, "1965": 0, "1985": 0, "2005": 0, "2025": 0 },
  delta,
  elapsed,
});

function findMesh(root: THREE.Object3D, name: string): THREE.Mesh {
  let found: THREE.Mesh | null = null;
  root.traverse((object) => {
    if (!found && object instanceof THREE.Mesh && object.name === name) found = object;
  });
  if (!found) throw new Error(`Expected a mesh named "${name}".`);
  return found;
}

/** Union of the prop's meshes that sit below head height (2.2 m). */
function groundFootprint(root: THREE.Object3D): { minX: number; maxX: number; minZ: number; maxZ: number } | null {
  root.updateWorldMatrix(true, true);
  const union = new THREE.Box3();
  let found = false;
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.min.y > 2.2) return;
    union.union(box);
    found = true;
  });
  if (!found) return null;
  return { minX: union.min.x, maxX: union.max.x, minZ: union.min.z, maxZ: union.max.z };
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** Lane corridors: each real lane-loop segment widened by a half lane width. */
function laneCorridors(halfLane: number): Bounds[] {
  const corridors: Bounds[] = [];
  for (const lane of VEHICLE_LANE_LOOPS) {
    for (let index = 0; index < lane.waypoints.length - 1; index += 1) {
      const from = lane.waypoints[index]!.position;
      const to = lane.waypoints[index + 1]!.position;
      corridors.push({
        minX: Math.min(from.x, to.x) - halfLane,
        maxX: Math.max(from.x, to.x) + halfLane,
        minZ: Math.min(from.z, to.z) - halfLane,
        maxZ: Math.max(from.z, to.z) + halfLane,
      });
    }
  }
  return corridors;
}

function crosswalkBounds(crosswalk: Crosswalk): Bounds {
  const alongX = crosswalk.streetSide === "north" || crosswalk.streetSide === "south";
  const along = alongX ? crosswalk.length / 2 : crosswalk.width / 2;
  const across = alongX ? crosswalk.width / 2 : crosswalk.length / 2;
  return {
    minX: crosswalk.center.x - along,
    maxX: crosswalk.center.x + along,
    minZ: crosswalk.center.z - across,
    maxZ: crosswalk.center.z + across,
  };
}

function overlaps(footprint: { minX: number; maxX: number; minZ: number; maxZ: number }, bounds: Bounds, epsilon = 0.02): boolean {
  return footprint.minX < bounds.maxX - epsilon
    && footprint.maxX > bounds.minX + epsilon
    && footprint.minZ < bounds.maxZ - epsilon
    && footprint.maxZ > bounds.minZ + epsilon;
}

describe("era environment: sky, lighting, streets and furniture", () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => makeCanvasContext(),
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("tunes sky gradient, sun, ambient level and fog from the real era descriptors", () => {
    const scene = new THREE.Scene();
    const system = createEnvironmentSystem({ layout: CITY_LAYOUT, scene });

    expect(system.sky.name).toBe("era-sky-dome");
    expect(system.sky.material).toBeInstanceOf(THREE.ShaderMaterial);
    expect(system.fog).toBeInstanceOf(THREE.FogExp2);
    expect(scene.fog).toBe(system.fog);
    for (const name of ["era-sun", "era-sky-light", "era-ambient-light", "era-bounce-light"]) {
      expect(system.group.getObjectByName(name)).toBeDefined();
    }

    const skyTops = new Set<number>();
    const sunIntensities: number[] = [];
    const ambientLevels: number[] = [];

    for (const era of ERAS) {
      system.applyEra(era.id, 1);
      const environment = era.environment;
      const expected = lightingForEra(era);

      expect(system.transitionBlend).toBe(1);
      expect(system.activeEra).toBe(era.id);
      expect(system.fog.density).toBeCloseTo(environment.fogDensity, 8);
      expect(system.fog.color.getHex()).toBe(environment.fogColor);
      expect(system.skyUniforms.uTopColor.value.getHex()).toBe(era.palette.sky);
      expect(system.skyUniforms.uHorizonColor.value.getHex()).toBe(era.palette.skyHorizon);
      expect(system.skyUniforms.uSunColor.value.getHex()).toBe(era.palette.sunlight);
      expect(system.sun.color.getHex()).toBe(era.palette.sunlight);
      expect(system.sun.intensity).toBeCloseTo(expected.sunIntensity, 8);
      expect(system.skyLight.intensity).toBeCloseTo(expected.hemisphereIntensity, 8);
      expect(system.ambientLight.intensity).toBeCloseTo(expected.ambientIntensity, 8);

      const direction = system.sun.position.clone().normalize();
      expect(direction.x).toBeCloseTo(expected.sunDirection.x, 6);
      expect(direction.y).toBeCloseTo(expected.sunDirection.y, 6);
      expect(direction.z).toBeCloseTo(expected.sunDirection.z, 6);
      expect(direction.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(environment.sunElevation)), 6);
      expect(system.sun.position.length()).toBeGreaterThan(100);

      skyTops.add(era.palette.sky);
      sunIntensities.push(system.sun.intensity);
      ambientLevels.push(system.skyLight.intensity);
    }

    // Five visually distinct skies, and a dusk/overcast-to-crisp-day range.
    expect(skyTops.size).toBe(ERAS.length);
    expect(new Set(sunIntensities.map((value) => value.toFixed(3))).size).toBe(ERAS.length);
    const dusk = getEraConfig("1985");
    const modern = getEraConfig("2025");
    expect(dusk.environment.fogDensity).toBeGreaterThan(modern.environment.fogDensity);
    expect(lightingForEra(dusk).hemisphereIntensity).toBeLessThan(lightingForEra(modern).hemisphereIntensity);
    expect(lightingForEra(getEraConfig("1945")).hemisphereIntensity).toBeLessThan(lightingForEra(modern).hemisphereIntensity);

    system.dispose();
  });

  it("builds era street surfaces, drainage, markings and tram rails on the real corridors", () => {
    const system = createEnvironmentSystem({ layout: CITY_LAYOUT });

    for (const era of ERAS) {
      system.applyEra(era.id, 1);
      const report = system.report;
      expect(report).toBeDefined();
      expect(report!.surface).toBe(era.environment.streetSurface);
      expect(report!.sidewalkMaterial).toBe(era.environment.sidewalkMaterial);
      expect(report!.laneMarkings).toEqual([...era.environment.laneMarkings]);
      expect(report!.carriageways).toBe(PERIMETER_STREETS.length);
      expect(report!.sidewalks).toBe(PERIMETER_STREETS.length * 2);
      expect(report!.curbs).toBe(PERIMETER_STREETS.length * 2);
      expect(report!.gutters).toBe(PERIMETER_STREETS.length * 2);
      expect(report!.drains).toBeGreaterThan(0);
      expect(report!.manholes).toBe(PERIMETER_STREETS.length * 2);

      const surfaces = system.surfaces!;
      expect(findMesh(surfaces, "surface-carriageway-north")).toBeInstanceOf(THREE.Mesh);
      expect(findMesh(surfaces, "surface-sidewalk-north-inner-sidewalk")).toBeInstanceOf(THREE.Mesh);
      expect(findMesh(surfaces, "surface-curb-north-inner-curb")).toBeInstanceOf(THREE.Mesh);
      expect(findMesh(surfaces, "surface-drain-north")).toBeInstanceOf(THREE.Mesh);

      // Cobblestones and tram rails belong to 1945; painted crossings to later eras.
      expect(report!.tramRails).toBe(era.id === "1945" ? PERIMETER_STREETS.length * 4 : 0);
      expect(report!.crosswalkBars > 0).toBe(era.id !== "1945");
      const ladderEdges = surfaces.getObjectByName("surface-crosswalk-ladder-north-crosswalk");
      expect(Boolean(ladderEdges)).toBe(era.environment.laneMarkings.includes("crosswalk-ladder"));
    }

    system.dispose();
  });

  it("mounts each era's own furniture set on the real prop slots without blocking the street", () => {
    const system = createEnvironmentSystem({ layout: CITY_LAYOUT });
    const lanes = laneCorridors(1);
    const crossings = CROSSWALKS.map(crosswalkBounds);

    for (const era of ERAS) {
      system.applyEra(era.id, 1);
      const props = system.props;
      const kinds = new Set(props.map(({ kind }) => kind));

      // Every era draws a full set: the brief's anchors plus its declared list.
      for (const kind of ANCHOR_FURNITURE_KINDS) {
        expect(kinds.has(kind), `${era.id} is missing anchor furniture "${kind}"`).toBe(true);
      }
      for (const name of era.environment.streetFurniture) {
        const kind = furnitureKindFromName(name);
        expect(kinds.has(kind), `${era.id} is missing declared furniture "${name}"`).toBe(true);
      }
      expect(kinds.has("street-sign")).toBe(true);
      expect(kinds.size).toBeGreaterThanOrEqual(10);
      expect(props.length).toBeGreaterThanOrEqual(25);
      expect(props.reduce((total, { model }) => total + model.geometries.length, 0)).toBeGreaterThan(200);

      /**
       * The layout runs each sidewalk the length of its street, so its corner
       * slots fall inside the perpendicular carriageway. Those slots must be
       * reported and left empty rather than blocking traffic.
       */
      const carriageways = PERIMETER_STREETS.map(carriagewayBounds);
      const insideTraffic = (slot: (typeof CITY_LAYOUT.propSlots)[number]): boolean => carriageways.some((bounds) =>
        slot.anchor.position.x > bounds.minX && slot.anchor.position.x < bounds.maxX
        && slot.anchor.position.z > bounds.minZ && slot.anchor.position.z < bounds.maxZ);
      const skipped = system.skippedSlots;
      expect(skipped.length).toBeGreaterThan(0);
      const mounted = new Set(props.map(({ slot }) => slot.id));
      for (const id of skipped) {
        const slot = CITY_LAYOUT.propSlots.find((candidate) => candidate.id === id)!;
        expect(mounted.has(id)).toBe(false);
        expect(insideTraffic(slot)).toBe(true);
      }
      const usablePrimarySlots = CITY_LAYOUT.propSlots.filter((slot) => primaryKindForSlot(slot) !== null && !insideTraffic(slot));
      expect(props.filter(({ primary }) => primary)).toHaveLength(usablePrimarySlots.length);

      const specs = lampSpecFor(era);
      const lamps = props.filter(({ kind }) => kind === "lamp");
      expect(lamps.length).toBeGreaterThan(0);
      for (const lamp of lamps) {
        const emitter = lamp.model.emitters[0]!;
        expect(emitter.light.color.getHex()).toBe(specs.color);
        expect(emitter.light.intensity).toBeGreaterThan(0);
        expect(lamp.model.geometries.length).toBeGreaterThanOrEqual(8);
      }

      const tree = props.find(({ kind }) => kind === "tree")!;
      expect(tree.model.size.height).toBeGreaterThan(treeSpecFor(era).trunkHeight);

      for (const prop of props) {
        // Props only ever occupy real layout slots.
        const slot = CITY_LAYOUT.propSlots.find(({ id }) => id === prop.slot.id);
        expect(slot).toBeDefined();
        expect(prop.group.position.toArray()).toEqual([
          prop.slot.anchor.position.x,
          prop.slot.anchor.position.y,
          prop.slot.anchor.position.z,
        ]);
        expect(prop.group.rotation.y).toBeCloseTo(streetFacingYaw(prop.slot.streetSide, prop.slot.sidewalkEdge), 8);
        expect(prop.model.group.position.x).toBeCloseTo(prop.tangentOffset, 8);

        if (prop.primary) {
          expect(prop.kind).toBe(primaryKindForSlot(prop.slot));
        } else {
          expect(prop.slot.type).not.toBe("signage");
          expect(extrasForEra(era)).toContain(prop.kind);
        }

        const footprint = groundFootprint(prop.group);
        expect(footprint).not.toBeNull();

        // Ground-level geometry stays inside its own sidewalk band.
        const vertical = prop.slot.streetSide === "east" || prop.slot.streetSide === "west";
        const centre = prop.slot.sidewalkEdge === "inner" ? INNER_SIDEWALK_OFFSET : OUTER_SIDEWALK_OFFSET;
        const halfWalk = SIDEWALK_WIDTH / 2;
        const acrossMin = vertical
          ? Math.min(Math.abs(footprint!.minX), Math.abs(footprint!.maxX))
          : Math.min(Math.abs(footprint!.minZ), Math.abs(footprint!.maxZ));
        const acrossMax = vertical
          ? Math.max(Math.abs(footprint!.minX), Math.abs(footprint!.maxX))
          : Math.max(Math.abs(footprint!.minZ), Math.abs(footprint!.maxZ));
        expect(acrossMin).toBeGreaterThanOrEqual(centre - halfWalk - 0.02);
        expect(acrossMax).toBeLessThanOrEqual(centre + halfWalk + 0.02);

        // …and never intrudes into vehicle lanes, crossings or building lots.
        for (const bounds of lanes) {
          expect(
            overlaps(footprint!, bounds),
            `${era.id} ${prop.kind} on ${prop.slot.id} (${JSON.stringify(footprint)}) blocks lane ${JSON.stringify(bounds)}`,
          ).toBe(false);
        }
        for (const bounds of crossings) expect(overlaps(footprint!, bounds)).toBe(false);
        for (const lot of BUILDING_LOTS) expect(overlaps(footprint!, lot.bounds)).toBe(false);
      }
    }

    // Lamp technology and tree treatment really do change per era.
    const lampHeads = ERAS.map((era) => lampSpecFor(era).head);
    const lampColors = ERAS.map((era) => lampSpecFor(era).color);
    const treeStyles = ERAS.map((era) => era.environment.treeStyle);
    expect(new Set(lampHeads).size).toBe(ERAS.length);
    expect(new Set(lampColors).size).toBe(ERAS.length);
    expect(new Set(treeStyles).size).toBe(ERAS.length);

    system.dispose();
  });

  it("morphs lighting, surfaces and furniture continuously and disposes retired resources", () => {
    const geometryDispose = vi.spyOn(THREE.BufferGeometry.prototype, "dispose");
    const textureDispose = vi.spyOn(THREE.Texture.prototype, "dispose");
    const scene = new THREE.Scene();
    const system = createEnvironmentSystem({ layout: CITY_LAYOUT, scene, seed: 7 });

    system.applyEra("1965", 0);
    expect(system.transitionTarget).toBe("1965");
    const outgoing = system.getVariant("1945")!;
    const incoming = system.getVariant("1965")!;
    expect(incoming.group.parent).toBe(system.group);
    expect(system.group.children.filter((child) => child.userData.era === "1965")).toHaveLength(1);
    // Blend 0 shows the source era exactly.
    expect(system.transitionBlend).toBe(0);
    expect(system.fog.density).toBeCloseTo(getEraConfig("1945").environment.fogDensity, 8);
    expect(system.skyUniforms.uTopColor.value.getHex()).toBe(getEraConfig("1945").palette.sky);
    expect(incoming.group.visible).toBe(false);

    const geometryDisposalsBefore = geometryDispose.mock.calls.length;
    system.applyEra("1965", 0.5);
    const from = getEraConfig("1945");
    const to = getEraConfig("1965");
    expect(system.transitionBlend).toBeCloseTo(0.5, 8);
    expect(system.fog.density).toBeGreaterThan(Math.min(from.environment.fogDensity, to.environment.fogDensity));
    expect(system.fog.density).toBeLessThan(Math.max(from.environment.fogDensity, to.environment.fogDensity));
    expect(system.sun.intensity).toBeCloseTo(
      (from.environment.lux / 100000) * 3.4 + ((to.environment.lux / 100000) * 3.4 - (from.environment.lux / 100000) * 3.4) * 0.5,
      6,
    );
    // Both variants mounted and crossfading; nothing disposed mid-morph.
    expect(outgoing.group.visible).toBe(true);
    expect(incoming.group.visible).toBe(true);
    expect(geometryDispose).toHaveBeenCalledTimes(geometryDisposalsBefore);
    const outgoingSurface = findMesh(outgoing.group, "surface-carriageway-north");
    const incomingSurface = findMesh(incoming.group, "surface-carriageway-north");
    expect((outgoingSurface.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.5, 6);
    expect((incomingSurface.material as THREE.MeshStandardMaterial).opacity).toBeCloseTo(0.5, 6);

    const textureDisposalsBefore = textureDispose.mock.calls.length;
    system.applyEra("1965", 1);
    expect(system.getVariant("1945")).toBeUndefined();
    expect(system.group.children.filter((child) => child.userData.era === "1945")).toHaveLength(0);
    expect(geometryDispose.mock.calls.length).toBeGreaterThan(geometryDisposalsBefore);
    expect(textureDispose.mock.calls.length).toBeGreaterThan(textureDisposalsBefore);
    expect(system.activeEra).toBe("1965");
    expect(system.fog.density).toBeCloseTo(to.environment.fogDensity, 8);
    expect(system.skyUniforms.uTopColor.value.getHex()).toBe(to.palette.sky);

    // Clamping and idempotence: repeating a pair never rebuilds or disposes.
    system.applyEra("1985", -4);
    expect(system.transitionBlend).toBe(0);
    expect(system.fog.density).toBeCloseTo(to.environment.fogDensity, 8);
    const stableDisposals = geometryDispose.mock.calls.length;
    system.applyEra("1985", 0);
    expect(geometryDispose.mock.calls.length).toBe(stableDisposals);
    system.applyEra("1985", 4);
    expect(system.transitionBlend).toBe(1);
    expect(system.getVariant("1965")).toBeUndefined();
    expect(system.fog.density).toBeCloseTo(getEraConfig("1985").environment.fogDensity, 8);

    system.dispose();
    expect(system.group.children).toHaveLength(0);
    expect(scene.fog).toBeNull();
    expect(() => system.applyEra("2005", 1)).toThrow(/disposed/);
    expect(() => system.update(frame())).toThrow(/disposed/);
  });

  it("owns scene fog and animates era lamp emitters per frame", () => {
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x000000, 1, 2);
    const system = createEnvironmentSystem({ layout: CITY_LAYOUT, scene });

    expect(scene.fog).toBe(system.fog);
    const emitters = system.getVariant("1945")!.emitters;
    expect(emitters.length).toBeGreaterThan(0);
    const index = emitters.findIndex(({ flicker }) => flicker > 0);
    expect(index).toBeGreaterThanOrEqual(0);
    const lamp = emitters[index]!;
    expect(lamp.light.intensity).toBeCloseTo(lamp.baseIntensity, 8);

    system.update(frame(0.1, 0.5));
    const expected = lamp.baseIntensity * (1 + lamp.flicker * Math.sin(0.5 * 3.7 + index * 1.7));
    expect(lamp.light.intensity).toBeCloseTo(expected, 6);
    expect(lamp.light.intensity).not.toBeCloseTo(lamp.baseIntensity, 3);

    expect(system.getPickables().length).toBe(system.props.length);
    expect(system.furnitureSet("1945")).toContain("lamp");

    system.dispose();
    expect(scene.fog).toBeNull();
  });

  it("keeps the fog denser with distance haze in 1945 than in the crisp modern era", () => {
    const early = lightingForEra(getEraConfig("1945"));
    const dusk = lightingForEra(getEraConfig("1985"));
    const modern = lightingForEra(getEraConfig("2025"));
    expect(early.fogDensity).toBeGreaterThan(modern.fogDensity);
    expect(dusk.fogDensity).toBeGreaterThan(early.fogDensity);
    expect(early.fogColor.getHex()).toBe(getEraConfig("1945").environment.fogColor);
    expect(dusk.sunElevation).toBeLessThan(early.sunElevation);
    const ids: EraId[] = ERAS.map(({ id }) => id);
    expect(ids).toEqual(["1945", "1965", "1985", "2005", "2025"]);
  });
});
