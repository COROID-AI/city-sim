/**
 * Chrono City — era-evolving rooftop clutter.
 *
 * Roofs are where an era is most legible from a low camera: 1945 walk-ups carry
 * tar decks, brick parapets, chimney stacks, pigeon coops and a timber water
 * tower; 1965 adds plant rooms, TV masts and a rooftop neon sign; 1985 bolts
 * dishes, duct runs and a mirrored mechanical floor onto stepped towers; 2005
 * fills rail-capped roofs with chillers and telecom masts; 2025 turns the roof
 * into a green terrace with solar arrays, wind cowls, planters and an LED crown.
 *
 * Like `facades.ts`, every instance is queued through a `DetailBatcher` (one
 * `InstancedMesh` per shape/material pair) and nothing is authored below the
 * storefront band — roofs already sit far above it, and `addDeck` skips any mass
 * block whose top is still inside the `0–4 m` band so the storefronts task keeps
 * that zone to itself.
 *
 * Lifecycle:
 *   create    → `buildRooftopDetails()` for one plan/variant.
 *   consume   → `buildingsApi.ts` (per building variant).
 *   integrate → `RooftopFeatureCounts` backs the per-era roof summary and the
 *               tests that prove each era's roof line is authentic.
 */

import type * as THREE from 'three';

import type { RandomSource } from '../../core/sceneContext';
import type { EraId } from '../../core/eraContracts';
import {
  DETAIL_BASE_Y,
  DetailBatcher,
  type BuildingMassBlock,
  type BuildingMaterialSet,
  type BuildingPlan,
  type DetailGeometrySet,
} from './buildingFactory';

export const ROOFTOP_DETAILS_VERSION = 1;

/** Everything one variant put on its roofs, item by item. */
export interface RooftopFeatureCounts {
  roofDecks: number;
  parapets: number;
  bulkheads: number;
  waterTowers: number;
  chimneys: number;
  pigeonCoops: number;
  acUnits: number;
  vents: number;
  satelliteDishes: number;
  ductRuns: number;
  crates: number;
  neonRoofSigns: number;
  antennaMasts: number;
  mechanicalFloors: number;
  solarPanels: number;
  windTurbines: number;
  planters: number;
  roofTrees: number;
  mediaCrowns: number;
  /** Loose rooftop clutter: ducts, crates, vents, plant, coops and dishes. */
  clutter: number;
}

export interface RooftopDetailOptions {
  readonly plan: BuildingPlan;
  readonly materials: BuildingMaterialSet;
  readonly geometries: DetailGeometrySet;
  /** Group the variant's instanced roof meshes are parented to. */
  readonly parent: THREE.Group;
  readonly random: RandomSource;
  readonly batcher?: DetailBatcher;
}

export interface RooftopDetailResult {
  readonly planId: string;
  readonly era: EraId;
  readonly instanceCount: number;
  readonly counts: RooftopFeatureCounts;
  readonly batcher: DetailBatcher;
}

/* ------------------------------------------------------------------------- *
 * Roof frames and slot allocation
 * ------------------------------------------------------------------------- */

interface RoofSlot {
  readonly x: number;
  readonly z: number;
}

/**
 * Local frame of one mass block's roof: `(dx, dz)` are offsets from the block
 * centre, rotated by the block's twist so a parametric tower's roof clutter
 * turns with its floor plates.
 */
interface RoofFrame {
  readonly block: BuildingMassBlock;
  readonly top: number;
  readonly usableWidth: number;
  readonly usableDepth: number;
  point(dx: number, y: number, dz: number): readonly [number, number, number];
}

function roofFrame(block: BuildingMassBlock, inset: number): RoofFrame {
  const cos = Math.cos(block.yaw);
  const sin = Math.sin(block.yaw);
  const centerX = block.centerX;
  const centerZ = -(block.frontOffset + block.depth / 2);
  return {
    block,
    top: block.baseY + block.height,
    usableWidth: Math.max(0, block.width - inset * 2),
    usableDepth: Math.max(0, block.depth - inset * 2),
    point: (dx, y, dz) => [centerX + dx * cos + dz * sin, y, centerZ - dx * sin + dz * cos],
  };
}

/**
 * An even, jittered, deterministically shuffled grid of roof positions. Features
 * pull slots in turn, so plant spreads across the deck instead of stacking.
 */
class RoofSlots {
  private readonly slots: RoofSlot[];
  private cursor = 0;

  constructor(stream: RandomSource, width: number, depth: number, target: number) {
    const wanted = Math.max(1, Math.ceil(target));
    const ratio = depth <= 0.01 ? 1 : width / depth;
    const columns = Math.max(1, Math.round(Math.sqrt(wanted * Math.max(0.4, ratio))));
    const rows = Math.max(1, Math.ceil(wanted / columns));
    const cellWidth = width / columns;
    const cellDepth = depth / rows;
    const generated: RoofSlot[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const jitterX = stream.float(-0.22, 0.22) * cellWidth;
        const jitterZ = stream.float(-0.22, 0.22) * cellDepth;
        generated.push({
          x: -width / 2 + cellWidth * (column + 0.5) + jitterX,
          z: -depth / 2 + cellDepth * (row + 0.5) + jitterZ,
        });
      }
    }
    this.slots = stream.shuffle(generated);
  }

  /** Next free slot, or `null` once the deck is full. */
  next(): RoofSlot | null {
    const slot = this.slots[this.cursor];
    this.cursor += 1;
    return slot ?? null;
  }

  get remaining(): number {
    return Math.max(0, this.slots.length - this.cursor);
  }
}

interface RoofContext {
  readonly batcher: DetailBatcher;
  readonly frame: RoofFrame;
  readonly slots: RoofSlots;
  readonly materials: BuildingMaterialSet;
  readonly stream: RandomSource;
  readonly counts: RooftopFeatureCounts;
}

/** A zeroed counter set, so callers can aggregate across variants. */
export function createRooftopFeatureCounts(): RooftopFeatureCounts {
  return {
    roofDecks: 0,
    parapets: 0,
    bulkheads: 0,
    waterTowers: 0,
    chimneys: 0,
    pigeonCoops: 0,
    acUnits: 0,
    vents: 0,
    satelliteDishes: 0,
    ductRuns: 0,
    crates: 0,
    neonRoofSigns: 0,
    antennaMasts: 0,
    mechanicalFloors: 0,
    solarPanels: 0,
    windTurbines: 0,
    planters: 0,
    roofTrees: 0,
    mediaCrowns: 0,
    clutter: 0,
  };
}

/* ------------------------------------------------------------------------- *
 * Elements
 * ------------------------------------------------------------------------- */

/** The tar/asphalt deck slab of one mass block, plus the parapet ringing it. */
function addDeck(
  batcher: DetailBatcher,
  block: BuildingMassBlock,
  materials: BuildingMaterialSet,
  counts: RooftopFeatureCounts,
  parapet: { readonly kind: BuildingPlan['recipe']['roof']['parapet']; readonly height: number },
): void {
  const frame = roofFrame(block, 0.15);
  if (frame.top < DETAIL_BASE_Y + 0.8) return;

  const [dx, dy, dz] = frame.point(0, frame.top - 0.12, 0);
  batcher.box(materials.get('roof'), dx, dy, dz, block.width, 0.24, block.depth, {
    yaw: block.yaw,
  });
  counts.roofDecks += 1;

  if (parapet.kind === 'none' || parapet.height <= 0.05) return;
  const material =
    parapet.kind === 'green'
      ? materials.has('foliage')
        ? materials.get('foliage')
        : materials.get('trim')
      : parapet.kind === 'mirror'
        ? materials.get('glass')
        : parapet.kind === 'cap'
          ? materials.get('metal')
          : materials.get('trim');
  const height = Math.max(0.4, parapet.height);
  const thickness = 0.34;
  const ring = roofFrame(block, thickness / 2);
  const y = ring.top + height / 2;
  const faces: Array<[number, number, number, number, number]> = [
    [0, -block.depth / 2 + thickness / 2, block.width, thickness, 1],
    [0, block.depth / 2 - thickness / 2, block.width, thickness, 1],
    [-block.width / 2 + thickness / 2, 0, thickness, block.depth, 2],
    [block.width / 2 - thickness / 2, 0, thickness, block.depth, 2],
  ];
  for (const [px, pz, width, depth] of faces) {
    const [x, , z] = frame.point(px, y, pz);
    batcher.box(material, x, y, z, width, height, depth, { yaw: block.yaw });
    counts.parapets += 1;
  }
}

/** Stair head house: the door and lip every walk-up roof carries. */
function addBulkhead(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials } = context;
  const width = Math.min(4.2, Math.max(2.6, frame.usableWidth * 0.45));
  const depth = Math.min(4.6, Math.max(2.6, frame.usableDepth * 0.5));
  const height = 2.7;
  const [x, y, z] = frame.point(slot.x, frame.top + height / 2, slot.z);
  batcher.box(materials.get('trim'), x, y, z, width, height, depth, { yaw: frame.block.yaw });
  batcher.box(
    materials.get('metal'),
    x,
    frame.top + 0.05,
    z,
    width + 0.25,
    0.16,
    depth + 0.25,
    { yaw: frame.block.yaw },
  );
  context.counts.bulkheads += 1;
}

/** The 1945 timber water tower: legs, tank, conical lid, ladder and riser. */
function addWaterTower(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const legHeight = 2.3;
  const tankDiameter = Math.min(3.4, Math.max(2.4, frame.usableWidth * 0.5));
  const legSpread = tankDiameter * 0.32;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const [x, y, z] = frame.point(slot.x + sx * legSpread, frame.top + legHeight / 2, slot.z + sz * legSpread);
      batcher.cylinder(materials.get('metal'), x, y, z, 0.2, legHeight);
    }
  }
  const tankY = frame.top + legHeight + 1.5;
  const [tx, ty, tz] = frame.point(slot.x, tankY, slot.z);
  batcher.cylinder(materials.get('trim'), tx, ty, tz, tankDiameter, 3, { yaw: frame.block.yaw });
  batcher.cylinder(materials.get('metal'), tx, tankY + 1.15, tz, tankDiameter * 0.98, 0.28, {
    yaw: frame.block.yaw,
  });
  batcher.cone(materials.get('metal'), tx, tankY + 2.05, tz, tankDiameter * 1.05, 0.9, {
    yaw: frame.block.yaw,
  });
  const [lx, ly, lz] = frame.point(slot.x + tankDiameter * 0.55, frame.top + legHeight + 1.4, slot.z);
  batcher.box(materials.get('metal'), lx, ly, lz, 0.5, 3.2, 0.07, { yaw: frame.block.yaw });
  const [rx, ry, rz] = frame.point(slot.x, frame.top + 1.1, slot.z);
  batcher.cylinder(materials.get('metal'), rx, ry, rz, 0.18, 2.2);
  counts.waterTowers += 1;
}

/** Brick chimney stack with a cap and pot. */
function addChimney(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const height = Math.min(3.2, 1.6 + frame.usableDepth * 0.14);
  const [x, y, z] = frame.point(slot.x, frame.top + height / 2, slot.z);
  batcher.box(materials.get('facade'), x, y, z, 0.95, height, 0.95, { yaw: frame.block.yaw });
  batcher.box(materials.get('trim'), x, frame.top + height + 0.1, z, 1.15, 0.2, 1.15, {
    yaw: frame.block.yaw,
  });
  batcher.cylinder(materials.get('metal'), x, frame.top + height + 0.45, z, 0.42, 0.5);
  counts.chimneys += 1;
  counts.clutter += 1;
}

/** Improvised pigeon coop with a landing ramp. */
function addPigeonCoop(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const [x, y, z] = frame.point(slot.x, frame.top + 0.75, slot.z);
  batcher.box(materials.get('trim'), x, y, z, 1.7, 1.5, 1.3, { yaw: frame.block.yaw });
  const [rx, ry, rz] = frame.point(slot.x, frame.top + 0.06, slot.z + 1.2);
  batcher.box(materials.get('metal'), rx, ry, rz, 0.5, 0.08, 1.2, { yaw: frame.block.yaw, pitch: 0.35 });
  counts.pigeonCoops += 1;
  counts.clutter += 1;
}

/** Rooftop chiller: cabinet plus fan grille. */
function addAcUnit(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const [x, y, z] = frame.point(slot.x, frame.top + 0.7, slot.z);
  batcher.box(materials.get('metal'), x, y, z, 2.1, 1.4, 1.4, { yaw: frame.block.yaw });
  batcher.cylinder(materials.get('metal'), x, frame.top + 1.44, z, 1.0, 0.08);
  counts.acUnits += 1;
  counts.clutter += 1;
}

/** Vent stack with a weather hood. */
function addVent(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const [x, y, z] = frame.point(slot.x, frame.top + 0.45, slot.z);
  batcher.box(materials.get('metal'), x, y, z, 0.6, 0.9, 0.6, { yaw: frame.block.yaw });
  batcher.box(materials.get('metal'), x, frame.top + 0.98, z, 0.95, 0.14, 0.95, {
    yaw: frame.block.yaw,
  });
  counts.vents += 1;
  counts.clutter += 1;
}

/** Satellite dish on a short mast. */
function addSatelliteDish(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const [x, y, z] = frame.point(slot.x, frame.top + 0.9, slot.z);
  batcher.cylinder(materials.get('metal'), x, y, z, 0.14, 1.8);
  batcher.cone(materials.get('metal'), x, frame.top + 1.9, z, 1.7, 0.42, {
    yaw: frame.block.yaw,
    pitch: Math.PI - 1.15,
  });
  counts.satelliteDishes += 1;
  counts.clutter += 1;
}

/** Service duct run with a right-angle elbow. */
function addDuctRun(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const length = Math.min(6, Math.max(2.4, frame.usableWidth * 0.5));
  const [x, y, z] = frame.point(slot.x, frame.top + 0.45, slot.z);
  batcher.box(materials.get('metal'), x, y, z, length, 0.8, 0.8, { yaw: frame.block.yaw });
  const [ex, ey, ez] = frame.point(slot.x + length / 2, frame.top + 1.0, slot.z);
  batcher.box(materials.get('metal'), ex, ey, ez, 0.8, 0.9, 0.8, { yaw: frame.block.yaw });
  counts.ductRuns += 1;
  counts.clutter += 2;
}

/** Loose crate and pallet clutter. */
function addCrate(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const [x, y, z] = frame.point(slot.x, frame.top + 0.4, slot.z);
  batcher.box(materials.get('trim'), x, y, z, 1.0, 0.8, 0.9, { yaw: frame.block.yaw + 0.3 });
  const [sx, sy, sz] = frame.point(slot.x + 0.35, frame.top + 1.05, slot.z + 0.2);
  batcher.box(materials.get('trim'), sx, sy, sz, 0.7, 0.5, 0.6, {
    yaw: frame.block.yaw - 0.4,
  });
  counts.crates += 1;
  counts.clutter += 2;
}

/** Roof-top neon sign frame — the 1965 and 1985 skyline signature. */
function addNeonRoofSign(context: RoofContext): void {
  const { batcher, frame, materials, counts } = context;
  const width = Math.min(7.5, Math.max(3.4, frame.usableWidth * 0.9));
  const z = frame.usableDepth / 2 + 0.35;
  const baseY = frame.top;
  for (const side of [-1, 1]) {
    const [px, py, pz] = frame.point(side * width * 0.45, baseY + 1.6, z);
    batcher.box(materials.get('metal'), px, py, pz, 0.2, 3.2, 0.2, { yaw: frame.block.yaw });
  }
  const [px, py, pz] = frame.point(0, baseY + 3.1, z);
  batcher.box(materials.get('metal'), px, py, pz, width, 2.2, 0.3, { yaw: frame.block.yaw });
  batcher.box(materials.get('accent'), px, frame.top + 2.35, pz + 0.18, width * 0.92, 1.7, 0.12, {
    yaw: frame.block.yaw,
  });
  counts.neonRoofSigns += 1;
}

/** Telecom / TV mast with cross arms. */
function addAntennaMast(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const height = Math.min(12, 6 + frame.usableDepth * 0.4);
  const [x, y, z] = frame.point(slot.x, frame.top + height / 2, slot.z);
  batcher.cylinder(materials.get('metal'), x, y, z, 0.16, height);
  for (const level of [0.62, 0.82]) {
    batcher.box(materials.get('metal'), x, frame.top + height * level, z, 2.4, 0.09, 0.09, {
      yaw: frame.block.yaw,
    });
  }
  counts.antennaMasts += 1;
}

/** The mirrored mechanical floor that rings a 1985 tower's top. */
function addMechanicalFloor(context: RoofContext): void {
  const { batcher, frame, materials, counts } = context;
  const block = frame.block;
  const height = 3.1;
  const material = materials.get('metal');
  const panels: Array<[number, number, number, number]> = [
    [0, -block.depth / 2 + 0.2, block.width, 0.4],
    [0, block.depth / 2 - 0.2, block.width, 0.4],
    [-block.width / 2 + 0.2, 0, 0.4, block.depth],
    [block.width / 2 - 0.2, 0, 0.4, block.depth],
  ];
  for (const [px, pz, width, depth] of panels) {
    const [x, y, z] = frame.point(px, frame.top + height / 2, pz);
    batcher.box(material, x, y, z, width, height, depth, { yaw: block.yaw });
    counts.mechanicalFloors += 1;
  }
  // Louvre line across the street elevation.
  const louvers = Math.max(3, Math.min(8, Math.floor(block.width / 1.2)));
  for (let index = 0; index < louvers; index += 1) {
    const x = -block.width / 2 + (block.width / louvers) * (index + 0.5);
    const [lx, ly, lz] = frame.point(x, frame.top + 1.6, -block.depth / 2 + 0.05);
    batcher.box(material, lx, ly, lz, block.width / louvers - 0.3, 0.3, 0.3, { yaw: block.yaw });
  }
}

/** Tilted solar array laid out on a terrace. */
function addSolarRow(context: RoofContext, count: number): void {
  const { batcher, frame, materials, counts } = context;
  for (let index = 0; index < count; index += 1) {
    const slot = context.slots.next();
    if (!slot) return;
    const [x, y, z] = frame.point(slot.x, frame.top + 0.75, slot.z);
    batcher.box(materials.get('glass'), x, y, z, 2.8, 0.12, 1.7, {
      yaw: frame.block.yaw,
      pitch: 0.5,
    });
    batcher.box(materials.get('metal'), x, frame.top + 0.3, z, 2.4, 0.1, 0.12, {
      yaw: frame.block.yaw,
    });
    counts.solarPanels += 1;
  }
}

/** Vertical-axis wind cowl: mast, hub and three blades. */
function addWindTurbine(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  const mastHeight = 5;
  const [x, y, z] = frame.point(slot.x, frame.top + mastHeight / 2, slot.z);
  batcher.cylinder(materials.get('metal'), x, y, z, 0.2, mastHeight);
  const hubY = frame.top + mastHeight + 0.45;
  batcher.sphere(materials.get('metal'), x, hubY, z, 0.45);
  for (let blade = 0; blade < 3; blade += 1) {
    batcher.box(materials.get('metal'), x, hubY + 0.95, z, 0.14, 1.9, 0.06, {
      roll: (Math.PI * 2 * blade) / 3,
      yaw: frame.block.yaw,
    });
  }
  counts.windTurbines += 1;
}

/** Green-roof planter and its tree. */
function addPlanter(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  if (!materials.has('foliage')) return;
  const foliage = materials.get('foliage');
  const [x, y, z] = frame.point(slot.x, frame.top + 0.4, slot.z);
  batcher.box(foliage, x, y, z, 2.4, 0.8, 1.5, { yaw: frame.block.yaw });
  counts.planters += 1;
}

function addRoofTree(context: RoofContext): void {
  const slot = context.slots.next();
  if (!slot) return;
  const { batcher, frame, materials, counts } = context;
  if (!materials.has('foliage')) return;
  const foliage = materials.get('foliage');
  const [x, y, z] = frame.point(slot.x, frame.top + 0.6, slot.z);
  batcher.cylinder(foliage, x, y, z, 0.2, 1.2);
  batcher.sphere(foliage, x, frame.top + 1.9, z, 2.0);
  batcher.sphere(foliage, x + 0.5, frame.top + 1.4, z + 0.3, 1.3);
  counts.roofTrees += 1;
}

/** Programmable LED crown ringing the top of a 2025 tower. */
function addMediaCrown(context: RoofContext): void {
  const { batcher, frame, materials, counts } = context;
  const block = frame.block;
  const height = 1.4;
  const panels: Array<[number, number, number, number]> = [
    [0, -block.depth / 2 + 0.1, block.width, 0.22],
    [0, block.depth / 2 - 0.1, block.width, 0.22],
    [-block.width / 2 + 0.1, 0, 0.22, block.depth],
    [block.width / 2 - 0.1, 0, 0.22, block.depth],
  ];
  for (const [px, pz, width, depth] of panels) {
    const [x, y, z] = frame.point(px, frame.top + height / 2, pz);
    batcher.box(materials.get('accent'), x, y, z, width, height, depth, { yaw: block.yaw });
    counts.mediaCrowns += 1;
  }
}

/* ------------------------------------------------------------------------- *
 * Entry point
 * ------------------------------------------------------------------------- */

/**
 * Builds one variant's rooftops: a deck and parapet for every mass block, then
 * the era's plant, clutter, ornament and greenery on the tallest roof and its
 * terraces.
 */
export function buildRooftopDetails(options: RooftopDetailOptions): RooftopDetailResult {
  const { plan, materials, geometries, parent, random } = options;
  const batcher = options.batcher ?? new DetailBatcher(parent, geometries, 'rooftop');
  const counts = createRooftopFeatureCounts();
  const stream = random.fork(`${plan.id}:rooftop`);
  const roof = plan.recipe.roof;

  // Deck + parapet on every mass, so set-back terraces read as terraces.
  for (const block of plan.masses) {
    addDeck(batcher, block, materials, counts, {
      kind: roof.parapet,
      height: roof.parapetHeight,
    });
  }

  // Every mass whose roof clears the storefront band is a usable roof; stair
  // towers and plant rooms only ever carry their own deck.
  const roofs: RoofContext[] = plan.masses
    .map((block) => roofFrame(block, 0.9))
    .filter(
      (frame) =>
        frame.top >= DETAIL_BASE_Y + 0.85 && frame.usableWidth >= 2 && frame.usableDepth >= 2,
    )
    .map((frame) => ({
      batcher,
      frame,
      materials,
      stream,
      counts,
      slots: new RoofSlots(stream, frame.usableWidth, frame.usableDepth, 20),
    }));

  if (roofs.length > 0) {
    // The signature roof is the tallest one with room for plant; if every roof
    // is cramped, the roomiest still takes the plant rather than leaving it out.
    const roomy = roofs.filter(
      (context) => context.frame.usableWidth * context.frame.usableDepth >= 12,
    );
    const pool = roomy.length > 0 ? roomy : roofs;
    const signature = pool.reduce((tallest, context) =>
      context.frame.top > tallest.frame.top ? context : tallest,
    );

    if (roof.bulkhead) addBulkhead(signature);
    if (roof.mechanicalFloor) addMechanicalFloor(signature);
    for (let index = 0; index < roof.waterTowers; index += 1) addWaterTower(signature);
    for (let index = 0; index < roof.chimneys; index += 1) addChimney(signature);
    for (let index = 0; index < roof.pigeonCoops; index += 1) addPigeonCoop(signature);
    for (let index = 0; index < roof.satelliteDishes; index += 1) addSatelliteDish(signature);
    for (let index = 0; index < roof.windTurbines; index += 1) addWindTurbine(signature);
    for (let index = 0; index < roof.planters; index += 1) addPlanter(signature);
    for (let index = 0; index < roof.trees; index += 1) addRoofTree(signature);
    if (roof.solarPanels > 0) addSolarRow(signature, roof.solarPanels);
    if (roof.neonRoofSign) addNeonRoofSign(signature);
    if (roof.antennaMast) addAntennaMast(signature);
    if (roof.mediaCrown) addMediaCrown(signature);

    // Service clutter is spread over every roof — main roof and terraces alike,
    // which is where a real block keeps its vents, ducts and chiller cabinets.
    const clutter: Array<(context: RoofContext) => void> = [
      ...Array.from({ length: roof.acUnits }, () => addAcUnit),
      ...Array.from({ length: roof.vents }, () => addVent),
      ...Array.from({ length: roof.ductRuns }, () => addDuctRun),
      ...Array.from({ length: roof.crates }, () => addCrate),
    ];
    clutter.forEach((place, index) => place(roofs[index % roofs.length]!));

    // Set-back terraces take the greenery and the extra solar that will not fit
    // on the plant-covered signature roof.
    if (materials.has('foliage')) {
      for (const context of roofs) {
        if (context === signature) continue;
        addPlanter(context);
        addRoofTree(context);
        if (roof.solarPanels > 0) addSolarRow(context, 1);
      }
    }
  }

  const instanceCount = batcher.flush();

  return {
    planId: plan.id,
    era: plan.era,
    instanceCount,
    counts: Object.freeze({ ...counts }),
    batcher,
  };
}
