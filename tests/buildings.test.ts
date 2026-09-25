/**
 * Building system tests.
 *
 * Two layers are covered:
 *
 * 1. Geometry planning - pure, GL-free inspection of the facade detail each era
 *    generates, using the real era contract (`../src/era/eraTypes`, which
 *    re-exports the `ERAS` dataset) and the real layout contract
 *    (`../src/scene/layout`).
 * 2. Composition - the live `BuildingsSystem`: generation/morph lifecycle,
 *    lot coverage at both ends of a transition, disposal of replaced geometry,
 *    advertising animation and teardown.
 */

import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  ERAS,
  ERA_IDS,
  getEraConfig,
  resolveEraWeights,
  type EraId,
  type EraUpdateContext,
} from "../src/era/eraTypes";
import { BUILDING_LOTS, CITY_LAYOUT, PERIMETER_STREETS, type CardinalSide } from "../src/scene/layout";
import {
  BUILDINGS_GROUP_NAME,
  BUILDINGS_SYSTEM_ID,
  censusAllEras,
  createBuildingsSystem,
  planBuilding,
  type BuildingRecord,
  type BuildingsSystem,
} from "../src/scene/buildings";
import {
  PART_MATERIAL_KEYS,
  advertisingStructuresFor,
  countTriangles,
  createEraMaterialSet,
  createEraTextures,
  mergeParts,
  triangleCount,
  type CanvasFactory,
} from "../src/scene/buildingDetails";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Ground-plane AABB of a building, exploiting the axis-aligned lot facing. */
function buildingBounds(record: BuildingRecord): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const alongX = Math.abs(record.placement.facing.x) > 0.5;
  const width = alongX ? record.placement.footprint.depth : record.placement.footprint.width;
  const depth = alongX ? record.placement.footprint.width : record.placement.footprint.depth;
  return {
    minX: record.placement.center.x - width / 2,
    maxX: record.placement.center.x + width / 2,
    minZ: record.placement.center.z - depth / 2,
    maxZ: record.placement.center.z + depth / 2,
  };
}

/** Signed distance along the outward normal of each block side. */
function outwardSpan(record: BuildingRecord, side: CardinalSide): readonly [number, number] {
  const bounds = buildingBounds(record);
  const axis = (value: number, sign: number): number => value * sign;
  switch (side) {
    case "north":
      return [axis(-bounds.maxZ, 1), axis(-bounds.minZ, 1)];
    case "south":
      return [axis(bounds.minZ, 1), axis(bounds.maxZ, 1)];
    case "east":
      return [axis(bounds.minX, 1), axis(bounds.maxX, 1)];
    case "west":
      return [axis(-bounds.maxX, 1), axis(-bounds.minX, 1)];
  }
}

function overlaps(
  a: { minX: number; maxX: number; minZ: number; maxZ: number },
  b: { minX: number; maxX: number; minZ: number; maxZ: number },
): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

function recordsFor(era: EraId): readonly BuildingRecord[] {
  return CITY_LAYOUT.lots.map((lot) => planBuilding(lot, getEraConfig(era), 0x5eed_c17a).record);
}

function generationGroups(system: BuildingsSystem): readonly THREE.Group[] {
  return system.group.children.filter((child): child is THREE.Group => child instanceof THREE.Group);
}

function lotIdsOf(generation: THREE.Group): readonly string[] {
  return generation.children
    .filter((child): child is THREE.Group => child instanceof THREE.Group)
    .map((building) => String(building.userData.lotId));
}

function materialOpacity(system: BuildingsSystem): readonly number[] {
  return system
    .visibleMeshes()
    .filter((mesh): mesh is THREE.Mesh => mesh instanceof THREE.Mesh)
    .map((mesh) => (mesh.material as THREE.MeshStandardMaterial).opacity);
}

function signature(records: readonly BuildingRecord[]): string {
  return records
    .map((record) => `${record.lotId}:${record.height.toFixed(2)}:${record.windowPanes}:${record.rooftopSign}`)
    .join("|");
}

function contextFor(from: EraId, era: EraId, blend: number): EraUpdateContext {
  return {
    era,
    from,
    blend,
    weights: resolveEraWeights(from, era, blend),
    delta: 1 / 60,
    elapsed: 12,
  };
}

/** 2D-context stub so the texture painters stay exercised without a GPU. */
function stubContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => undefined };
  const stub: Record<string, unknown> = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: () => undefined,
    strokeRect: () => undefined,
    clearRect: () => undefined,
    beginPath: () => undefined,
    closePath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    scale: () => undefined,
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
  };
  return stub as unknown as CanvasRenderingContext2D;
}

function countingCanvasFactory(): { factory: CanvasFactory; calls: () => number } {
  let calls = 0;
  return {
    factory: (size) => {
      calls += 1;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      return { canvas, ctx: stubContext() };
    },
    calls: () => calls,
  };
}

/* -------------------------------------------------------------------------- */
/* Planning: lots, footprints and street clearance                            */
/* -------------------------------------------------------------------------- */

describe("building placement on the layout contract", () => {
  it("plans exactly one building per real layout lot for every era", () => {
    for (const eraId of ERA_IDS) {
      const records = recordsFor(eraId);
      expect(records).toHaveLength(BUILDING_LOTS.length);
      expect(new Set(records.map((record) => record.id)).size).toBe(BUILDING_LOTS.length);
      expect([...records.map((record) => record.lotId)].sort()).toEqual(
        [...BUILDING_LOTS.map((lot) => lot.id)].sort(),
      );
      for (const record of records) {
        expect(record.triangles).toBeGreaterThan(0);
        expect(record.floors).toBeGreaterThanOrEqual(getEraConfig(eraId).buildings.minFloors);
        expect(record.floors).toBeLessThanOrEqual(getEraConfig(eraId).buildings.maxFloors);
        expect(record.storeys).toBe(record.floors * 2);
        expect(record.stepCount).toBeGreaterThanOrEqual(1);
        expect(record.stepCount).toBeLessThanOrEqual(getEraConfig(eraId).buildings.setbacks + 1);
      }
    }
  });

  it("keeps every footprint inside its lot and clear of neighbouring lots", () => {
    for (const eraId of ERA_IDS) {
      const records = recordsFor(eraId);
      const bounds = records.map(buildingBounds);
      records.forEach((record, index) => {
        const lot = BUILDING_LOTS.find((candidate) => candidate.id === record.lotId)!;
        const box = bounds[index]!;
        expect(box.minX).toBeGreaterThanOrEqual(lot.bounds.minX - 1e-9);
        expect(box.maxX).toBeLessThanOrEqual(lot.bounds.maxX + 1e-9);
        expect(box.minZ).toBeGreaterThanOrEqual(lot.bounds.minZ - 1e-9);
        expect(box.maxZ).toBeLessThanOrEqual(lot.bounds.maxZ + 1e-9);
        expect(record.placement.footprint.width).toBeLessThan(
          Math.abs(record.placement.facing.x) > 0.5 ? lot.footprint.depth : lot.footprint.width,
        );
        expect(record.placement.footprint.depth).toBeLessThan(
          Math.abs(record.placement.facing.x) > 0.5 ? lot.footprint.width : lot.footprint.depth,
        );
      });
      for (let left = 0; left < bounds.length; left += 1) {
        for (let right = left + 1; right < bounds.length; right += 1) {
          expect(overlaps(bounds[left]!, bounds[right]!), `${eraId} ${left}/${right}`).toBe(false);
        }
      }
    }
  });

  it("faces each building toward its street and stays clear of the street corridor", () => {
    for (const eraId of ERA_IDS) {
      for (const record of recordsFor(eraId)) {
        const lot = BUILDING_LOTS.find((candidate) => candidate.id === record.lotId)!;
        // Local +Z is the frontage: yaw must rotate it onto the lot's facing.
        expect(Math.sin(record.placement.yaw)).toBeCloseTo(lot.facing.x, 6);
        expect(Math.cos(record.placement.yaw)).toBeCloseTo(lot.facing.z, 6);

        const street = PERIMETER_STREETS.find((candidate) => candidate.side === lot.streetSide)!;
        const towardStreet = (street.center.x - record.placement.center.x) * lot.facing.x
          + (street.center.z - record.placement.center.z) * lot.facing.z;
        expect(towardStreet).toBeGreaterThan(0);

        // The street corridor spans 18..26 m from the block centre on each side;
        // no building may encroach on it (that is where the vehicle lanes are).
        const [near, far] = outwardSpan(record, lot.streetSide);
        expect(far <= 18 + 1e-9 || near >= 26 - 1e-9, `${eraId} ${record.lotId} intrudes on the street`).toBe(true);
      }
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Planning: per-era facade detail                                            */
/* -------------------------------------------------------------------------- */

describe("era-specific architecture", () => {
  it("generates 1945 brick walk-ups with fire escapes and water towers", () => {
    const descriptor = getEraConfig("1945").buildings;
    expect(descriptor.style).toBe("postwar-brick-masonry");
    const records = recordsFor("1945");
    for (const record of records) {
      expect(record.fireEscapes).toBeGreaterThan(0);
      expect(record.fireEscapePlatforms).toBeGreaterThan(0);
      expect(record.windowFrames).toBeGreaterThan(0);
      expect(record.windowSills).toBeGreaterThan(0);
      expect(record.windowLintels).toBeGreaterThan(0);
      expect(record.windowPanes).toBeGreaterThan(0);
      expect(record.cornices).toBeGreaterThan(0);
      expect(record.roofEquipment).toContain("water-tower");
      expect(record.rooftopSign).toBe("painted-roof-sign");
      // 1945 advertising is not animated, so no illuminated media panels.
      expect(record.mediaPanels).toBe(0);
      expect(record.height).toBeLessThan(40);
    }
  });

  it("generates 1965 mid-century blocks with ribbon bands and neon rooftop signs", () => {
    const records = recordsFor("1965");
    for (const record of records) {
      expect(record.windowBands).toBeGreaterThan(0);
      expect(record.windowMullions).toBeGreaterThan(0);
      expect(record.windowSills).toBe(0);
      expect(record.roofEquipment).toContain("hvac-package-units");
      expect(record.roofEquipment).toContain("helipad-marker");
      expect(record.rooftopSign).toBe("neon-rooftop-sign");
      expect(record.fireEscapes).toBe(0);
    }
  });

  it("generates 1985 brutalist and mirror-glass offices with neon billboards", () => {
    const records = recordsFor("1985");
    for (const record of records) {
      expect(record.windowMullions).toBeGreaterThan(0);
      expect(record.windowBands).toBeGreaterThan(0);
      expect(record.windowFrames).toBe(0);
      expect(record.cornices).toBeGreaterThan(0);
      expect(record.roofEquipment).toContain("satellite-dish");
      expect(record.roofEquipment).toContain("neon-crown-ring");
      expect(record.roofEquipment).toContain("antenna-mast");
      expect(record.rooftopSign).toBe("neon-rooftop-billboard");
    }
  });

  it("generates 2005 glass towers with digital advertising and roof greening", () => {
    const records = recordsFor("2005");
    for (const record of records) {
      expect(record.rooftopSign).toBe("digital-rooftop-panel");
      expect(record.mediaPanels).toBeGreaterThan(0);
      expect(record.roofEquipment).toContain("green-roof-tray");
      expect(record.roofEquipment).toContain("solar-hot-water");
      expect(record.roofEquipment).toContain("telecom-array");
    }
  });

  it("generates 2025 green/smart towers with media facades and planted storeys", () => {
    const records = recordsFor("2025");
    for (const record of records) {
      expect(record.rooftopSign).toBe("media-facade");
      expect(record.mediaPanels).toBeGreaterThanOrEqual(2);
      expect(record.planters).toBeGreaterThan(0);
      expect(record.roofEquipment).toContain("solar-canopy");
      expect(record.roofEquipment).toContain("wind-cowl");
      expect(record.roofEquipment).toContain("roof-garden-rail");
      expect(record.roofEquipment).toContain("drone-pad");
    }
    const heights = records.map((record) => record.height);
    expect(Math.max(...heights)).toBeGreaterThan(40);
  });

  it("carries the high-detail facade kit and internal signage anchors on every building", () => {
    for (const eraId of ERA_IDS) {
      const structures = advertisingStructuresFor(getEraConfig(eraId));
      for (const record of recordsFor(eraId)) {
        expect(record.windowPanes).toBeGreaterThan(0);
        expect(record.cornices).toBeGreaterThan(0);
        expect(record.entranceDoors).toBe(1);
        expect(record.storefrontBays).toBeGreaterThanOrEqual(1);
        expect(record.ornament).toBe(getEraConfig(eraId).buildings.ornament);
        expect(record.rooftopSign).toBe(structures.signage);
        expect(record.advertisingMedium).toBe(structures.medium);
        expect(record.roofEquipment.length).toBeGreaterThan(0);
        // Internal rooftop mounting anchors for the signage this task hosts.
        expect(record.signageAnchors.length).toBeGreaterThan(0);
        expect(record.signageAnchors.some((anchor) => anchor.kind === "rooftop-mount")).toBe(true);
        for (const anchor of record.signageAnchors) {
          expect(Number.isFinite(anchor.position.x)).toBe(true);
          expect(Number.isFinite(anchor.position.y)).toBe(true);
          expect(Number.isFinite(anchor.position.z)).toBe(true);
          expect(anchor.size.width).toBeGreaterThan(0);
          expect(anchor.size.height).toBeGreaterThan(0);
        }
      }
    }
  });

  it("keeps per-era geometry budgets broadly comparable", () => {
    const censuses = censusAllEras();
    expect(censuses.map((census) => census.eraId)).toEqual([...ERA_IDS]);
    for (const census of censuses) {
      expect(census.buildings).toBe(BUILDING_LOTS.length);
      expect(census.triangles).toBeGreaterThan(0);
      expect(census.cornices).toBeGreaterThanOrEqual(BUILDING_LOTS.length);
      expect(census.entranceDoors).toBe(BUILDING_LOTS.length);
      expect(census.signageAnchors).toBeGreaterThanOrEqual(BUILDING_LOTS.length);
    }
    const totals = censuses.map((census) => census.triangles);
    const ratio = Math.max(...totals) / Math.min(...totals);
    expect(ratio).toBeLessThan(1.75);
    const heights = censuses.map((census) => census.maxHeight);
    expect(Math.max(...heights)).toBeGreaterThan(Math.min(...heights) * 2);
  });

  it("builds triangle budgets analytically and preserves them when merging", () => {
    const planned = planBuilding(BUILDING_LOTS[0]!, getEraConfig("1985"), 7);
    expect(countTriangles(planned.parts)).toBe(planned.record.triangles);
    const merged = mergeParts(planned.parts);
    let mergedTriangles = 0;
    for (const geometry of merged.values()) {
      mergedTriangles += triangleCount(geometry);
      geometry.dispose();
    }
    expect(mergedTriangles).toBe(planned.record.triangles);
    expect(merged.size).toBeGreaterThan(1);
    for (const key of merged.keys()) {
      expect(PART_MATERIAL_KEYS).toContain(key);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Composition: the live system                                               */
/* -------------------------------------------------------------------------- */

describe("buildings system composition", () => {
  it("exposes the SceneSystem/EraAware surface and populates every lot on mount", () => {
    const system = createBuildingsSystem();
    try {
      expect(system.id).toBe(BUILDINGS_SYSTEM_ID);
      expect(system.group.name).toBe(BUILDINGS_GROUP_NAME);
      expect(typeof system.update).toBe("function");
      expect(typeof system.applyEra).toBe("function");
      expect(typeof system.dispose).toBe("function");

      expect(system.era).toBe(ERA_IDS[0]);
      const generations = generationGroups(system);
      expect(generations).toHaveLength(1);
      expect(generations[0]!.name).toBe(`${BUILDINGS_GROUP_NAME}-${ERA_IDS[0]}`);
      expect([...lotIdsOf(generations[0]!)].sort()).toEqual([...BUILDING_LOTS.map((lot) => lot.id)].sort());
      expect(system.visibleMeshes().length).toBeGreaterThan(0);
      expect(system.getPickables().length).toBe(system.visibleMeshes().length);
      expect(materialOpacity(system).every((opacity) => opacity === 1)).toBe(true);
    } finally {
      system.dispose();
    }
  });

  it("applies 1945 and 2025 from the real era and layout contracts and differs between them", () => {
    const system = createBuildingsSystem({ initialEra: "1945" });
    try {
      system.applyEra("1945", 1);
      const records1945 = system.describe();
      const visible1945 = system.visibleMeshes().length;
      const census1945 = system.census();
      expect(records1945).toHaveLength(BUILDING_LOTS.length);
      expect(census1945.eraId).toBe("1945");
      expect(census1945.rooftopSigns).toEqual(["painted-roof-sign"]);

      system.applyEra("2025", 1);
      const records2025 = system.describe();
      const census2025 = system.census();
      expect(records2025).toHaveLength(BUILDING_LOTS.length);
      expect(census2025.eraId).toBe("2025");
      expect(census2025.rooftopSigns).toEqual(["media-facade"]);

      expect(signature(records2025)).not.toBe(signature(records1945));
      expect(census2025.triangles).not.toBe(census1945.triangles);
      expect(system.visibleMeshes().length).toBeGreaterThan(0);

      // Only the target generation survives; the replaced geometry is gone.
      const generations = generationGroups(system);
      expect(generations).toHaveLength(1);
      expect(generations[0]!.name).toBe(`${BUILDINGS_GROUP_NAME}-2025`);
      expect(lotIdsOf(generations[0]!).length).toBe(BUILDING_LOTS.length);
      expect(system.era).toBe("2025");
      expect(visible1945).toBeGreaterThan(0);
    } finally {
      system.dispose();
    }
  });

  it("morphs continuously between eras while keeping all lots populated at blend 0 and 1", () => {
    const system = createBuildingsSystem({ initialEra: "1945" });
    try {
      // blend 0: fully the outgoing era, every lot populated.
      system.applyEra("2025", 0);
      expect(generationGroups(system)).toHaveLength(1);
      expect(lotIdsOf(generationGroups(system)[0]!)).toHaveLength(BUILDING_LOTS.length);
      expect(system.sourceEra).toBe("1945");
      expect(system.targetEra).toBe("2025");

      const sample = (blend: number): { scale: number; generations: number; visible: number } => {
        system.applyEra("2025", blend);
        const incoming = generationGroups(system).find((group) => group.name.endsWith("2025"))!;
        const building = incoming.children.find(
          (child): child is THREE.Group => child instanceof THREE.Group && child.userData.lotId === BUILDING_LOTS[0]!.id,
        )!;
        return { scale: building.scale.y, generations: generationGroups(system).length, visible: system.visibleMeshes().length };
      };

      const low = sample(0.25);
      const mid = sample(0.5);
      const high = sample(0.75);

      expect(low.generations).toBe(2);
      expect(mid.generations).toBe(2);
      expect(high.generations).toBe(2);
      expect(low.scale).toBeGreaterThan(0);
      expect(low.scale).toBeLessThan(mid.scale);
      expect(mid.scale).toBeLessThan(high.scale);
      expect(high.scale).toBeLessThanOrEqual(1);

      // Both generations are present and partially faded mid-transition.
      const opacities = materialOpacity(system);
      expect(opacities.length).toBeGreaterThan(0);
      expect(opacities.some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
      expect(opacities.every((opacity) => opacity >= 0 && opacity <= 1)).toBe(true);

      // blend 1: fully the incoming era, every lot populated, source disposed.
      system.applyEra("2025", 1);
      const generations = generationGroups(system);
      expect(generations).toHaveLength(1);
      expect(generations[0]!.name).toBe(`${BUILDINGS_GROUP_NAME}-2025`);
      expect(lotIdsOf(generations[0]!)).toHaveLength(BUILDING_LOTS.length);
      expect(materialOpacity(system).every((opacity) => opacity === 1)).toBe(true);
      expect(system.eraWeights()).toEqual(resolveEraWeights("2025", "2025", 1));
    } finally {
      system.dispose();
    }
  });

  it("is idempotent for the same era/blend and honours the shared update context", () => {
    const system = createBuildingsSystem({ initialEra: "1945" });
    try {
      system.applyEra("2025", 0.5);
      const before = signature(system.describe());
      const groupsBefore = generationGroups(system).map((group) => group.name);
      system.applyEra("2025", 0.5);
      expect(signature(system.describe())).toBe(before);
      expect(generationGroups(system).map((group) => group.name)).toEqual(groupsBefore);

      system.update(contextFor("1945", "2025", 1));
      expect(system.era).toBe("2025");
      expect(system.targetEra).toBe("2025");
      expect(system.blend).toBe(1);

      system.update(contextFor("2025", "1945", 0.5));
      expect(system.sourceEra).toBe("2025");
      expect(system.targetEra).toBe("1945");
      expect(generationGroups(system)).toHaveLength(2);

      system.update(contextFor("2025", "1945", 1));
      expect(system.era).toBe("1945");
      expect(generationGroups(system).map((group) => group.name)).toEqual([`${BUILDINGS_GROUP_NAME}-1945`]);
      expect(lotIdsOf(generationGroups(system)[0]!)).toHaveLength(BUILDING_LOTS.length);

      // Out-of-range blends are clamped, per the EraAware contract.
      system.applyEra("2025", 4);
      expect(system.blend).toBe(1);
      system.applyEra("2025", Number.NaN);
      expect(system.blend).toBe(0);
    } finally {
      system.dispose();
    }
  });

  it("animates era advertising with UV/emissive loops instead of texture regeneration", () => {
    const system = createBuildingsSystem({ initialEra: "2025" });
    try {
      const mediaMesh = system
        .visibleMeshes()
        .find((mesh): mesh is THREE.Mesh => mesh instanceof THREE.Mesh && mesh.name.includes(":media"));
      expect(mediaMesh).toBeDefined();
      const texture = (mediaMesh!.material as THREE.MeshStandardMaterial).map!;
      const uuid = texture.uuid;
      const before = texture.offset.x;

      system.update(contextFor("2025", "2025", 1));
      const afterFirst = texture.offset.x;
      expect(afterFirst).not.toBe(before);

      const material = mediaMesh!.material as THREE.MeshStandardMaterial;
      const glowBefore = material.emissiveIntensity;
      system.update({ ...contextFor("2025", "2025", 1), elapsed: 40 });
      expect(material.emissiveIntensity).not.toBe(glowBefore);
      // Same texture instance throughout: the canvas is never repainted.
      expect(texture.uuid).toBe(uuid);
    } finally {
      system.dispose();
    }
  });

  it("releases geometry, materials and textures on dispose", () => {
    const system = createBuildingsSystem({ initialEra: "1945" });
    system.applyEra("2025", 0.5);
    expect(generationGroups(system)).toHaveLength(2);

    system.dispose();
    expect(system.group.children).toHaveLength(0);
    expect(system.visibleMeshes()).toHaveLength(0);
    expect(system.getPickables()).toHaveLength(0);

    // Post-dispose calls are inert rather than throwing.
    system.applyEra("1945", 1);
    expect(system.group.children).toHaveLength(0);
    expect(ERAS).toHaveLength(ERA_IDS.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Textures and materials                                                     */
/* -------------------------------------------------------------------------- */

describe("procedural textures and materials", () => {
  it("paints a complete texture set per era", () => {
    const counter = countingCanvasFactory();
    for (const eraId of ERA_IDS) {
      const textures = createEraTextures(getEraConfig(eraId), { canvasFactory: counter.factory });
      for (const texture of Object.values(textures)) {
        expect(texture).toBeInstanceOf(THREE.CanvasTexture);
        expect(texture.colorSpace).toBe(THREE.SRGBColorSpace);
        expect(texture.image).toBeDefined();
      }
    }
    // Six distinct maps (facade, roof, window, storefront, signage, media) per era.
    expect(counter.calls()).toBe(ERA_IDS.length * 6);
  });

  it("falls back to a data texture when no 2D canvas exists and caches shared sets", () => {
    const fallback = createEraTextures(getEraConfig("1945"), { canvasFactory: () => null });
    expect(fallback.facade).toBeInstanceOf(THREE.DataTexture);

    const era = getEraConfig("1945");
    expect(createEraTextures(era)).toBe(createEraTextures(era));
  });

  it("builds one shared PBR material set per era and morphs its opacity/glow", () => {
    const era = getEraConfig("2025");
    const textures = createEraTextures(era, { canvasFactory: () => null });
    const materials = createEraMaterialSet(era, textures);
    try {
      for (const key of PART_MATERIAL_KEYS) {
        const material = materials.materials[key];
        expect(material).toBeInstanceOf(THREE.MeshStandardMaterial);
        expect(material.opacity).toBe(1);
        expect(material.transparent).toBe(false);
      }
      expect(materials.materials.glazing.map).toBe(textures.window);
      expect(materials.materials.signage.emissiveIntensity).toBeGreaterThan(0);

      materials.setOpacity(0.4);
      expect(materials.materials.wall.opacity).toBe(0.4);
      expect(materials.materials.wall.transparent).toBe(true);
      expect(materials.materials.wall.depthWrite).toBe(false);
      materials.setOpacity(1);
      expect(materials.materials.wall.transparent).toBe(false);

      const glow = materials.materials.media.emissiveIntensity;
      materials.setGlowScale(0.5);
      expect(materials.materials.media.emissiveIntensity).toBeCloseTo(glow * 0.5, 6);

      const offsetBefore = materials.materials.media.map!.offset.x;
      materials.animate(4, 0.5);
      expect(materials.materials.media.map!.offset.x).not.toBe(offsetBefore);
    } finally {
      materials.dispose();
      for (const texture of Object.values(textures)) {
        texture.dispose();
      }
    }
  });

  it("keeps non-animated eras static", () => {
    const era = getEraConfig("1945");
    const textures = createEraTextures(era, { canvasFactory: () => null });
    const materials = createEraMaterialSet(era, textures);
    try {
      const offsetBefore = materials.materials.signage.map!.offset.x;
      materials.animate(4, 0.5);
      expect(materials.materials.signage.map!.offset.x).toBe(offsetBefore);
    } finally {
      materials.dispose();
      for (const texture of Object.values(textures)) {
        texture.dispose();
      }
    }
  });
});
