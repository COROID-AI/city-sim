/**
 * Chrono City — era-evolving facade ornament.
 *
 * Turns a `BuildingPlan` into the facade detail that makes each era readable
 * from the street: framed windows with sills and lintels, brick piers and stone
 * copings, ribbon glazing with spandrel bands and brise-soleil fins, mirrored
 * spandrel bands, neoned fascias, concrete grids, planted terraces, media
 * facades, deep cornices with dentils, and iron fire escapes with landings,
 * railings and drop ladders.
 *
 * Two rules hold for every builder here:
 *
 *  1. **Nothing is authored inside the storefront band.** The lowest ornament
 *     sits at `DETAIL_BASE_Y` (4.05 m); the `0–4 m` band is covered by the plain
 *     `mount-surface` panel this module draws at the end of each street wall, so
 *     the storefronts/advertisements task owns that band alone.
 *  2. **Everything is instanced.** Details are queued through a `DetailBatcher`,
 *     which flushes one `InstancedMesh` per `(shape, material)` pair, so a whole
 *     block of ornament costs a handful of draw calls.
 *
 * Lifecycle:
 *   create    → `buildFacadeDetails()` for one plan/variant.
 *   consume   → `buildingsApi.ts` (per building variant).
 *   integrate → `FacadeFeatureCounts` feeds the per-era feature summary HUDs and
 *               test assertions use to prove each era's ornament is authentic.
 */

import * as THREE from 'three';

import type { RandomSource } from '../../core/sceneContext';
import type { EraId } from '../../core/eraContracts';
import {
  DETAIL_BASE_Y,
  STOREFRONT_BAND_HEIGHT,
  DetailBatcher,
  streetWallBlock,
  type BuildingMassBlock,
  type BuildingMaterialSet,
  type BuildingPlan,
  type DetailGeometrySet,
} from './buildingFactory';

export const FACADE_DETAILS_VERSION = 1;

/** What one variant's facade actually drew, element by element. */
export interface FacadeFeatureCounts {
  /** Framed windows, one per opening. */
  windows: number;
  // The same windows broken out by element, so the detail budget is auditable.
  sills: number;
  lintels: number;
  pilasters: number;
  mullions: number;
  spandrels: number;
  briseSoleilFins: number;
  mirrorBands: number;
  concreteGrids: number;
  neonStrips: number;
  cornices: number;
  dentils: number;
  bandCaps: number;
  fireEscapeStacks: number;
  fireEscapeParts: number;
  mediaPanels: number;
  planterBands: number;
  facadeTrees: number;
}

/** The band panel a storefront system attaches its shopfront to. */
export interface MountSurfacePanel {
  readonly lotId: string;
  /** Centre of the panel along the frontage, in metres (lot-local `x`). */
  readonly centerX: number;
  /** Panel width, in metres — the lot frontage. */
  readonly width: number;
  /** Panel height, in metres — always the storefront band height. */
  readonly height: number;
  /** Lowest `y` of the panel, in metres. */
  readonly baseY: number;
  /** Distance the panel sits proud of the street line, in metres. */
  readonly projection: number;
}

export interface FacadeDetailOptions {
  readonly plan: BuildingPlan;
  readonly materials: BuildingMaterialSet;
  readonly geometries: DetailGeometrySet;
  /** Group the variant's instanced meshes are parented to. */
  readonly parent: THREE.Group;
  /** Deterministic stream for detail jitter (dentils, tree spacing, dishes). */
  readonly random: RandomSource;
  /** Reuse a batcher when the caller queues more detail afterwards. */
  readonly batcher?: DetailBatcher;
}

export interface FacadeDetailResult {
  readonly planId: string;
  readonly era: EraId;
  /** Instances flushed into facade instanced meshes. */
  readonly instanceCount: number;
  readonly counts: FacadeFeatureCounts;
  /** The storefront-band mount panel this lot offers. */
  readonly mountSurface: MountSurfacePanel;
  readonly batcher: DetailBatcher;
}

/* ------------------------------------------------------------------------- *
 * Geometry helpers
 * ------------------------------------------------------------------------- */

/**
 * Maps `(along frontage, height, distance in front of the face)` into the
 * variant's local space, honouring a mass block's twist. `u` is measured from
 * the block's centre and `v` grows towards the street.
 */
interface BlockFaceFrame {
  readonly block: BuildingMassBlock;
  point(u: number, y: number, v: number): readonly [number, number, number];
}

function faceFrame(block: BuildingMassBlock): BlockFaceFrame {
  const cos = Math.cos(block.yaw);
  const sin = Math.sin(block.yaw);
  const faceX = block.centerX + sin * (block.depth / 2);
  const faceZ = -(block.frontOffset + block.depth / 2) + cos * (block.depth / 2);
  return {
    block,
    point: (u, y, v) => [faceX + u * cos + v * sin, y, faceZ - u * sin + v * cos],
  };
}

/** Top of a mass block, in metres. */
function blockTop(block: BuildingMassBlock): number {
  return block.baseY + block.height;
}

/**
 * `y` of every window row a block carries, measured at the sill.
 *
 * Rows start just above the storefront band (or just above the block's own
 * base, for upper masses) and stop short of the cornice, so no opening ever
 * lands inside the `0–4 m` band or collides with the roof line.
 */
export function facadeRowSills(plan: BuildingPlan, block: BuildingMassBlock): readonly number[] {
  const { floorHeight, recipe } = plan;
  const windowHeight = floorHeight * recipe.facade.windowHeightRatio;
  const topLimit = blockTop(block) - (recipe.facade.corniceHeight + 0.4);
  const startY = Math.max(DETAIL_BASE_Y + 0.2, block.baseY + 0.3);
  const sills: number[] = [];
  for (let y = startY; y + windowHeight <= topLimit; y += floorHeight) sills.push(y);
  return Object.freeze(sills);
}

/** Column centres and spacing for a block's window grid (lot-local `x`). */
export function facadeColumns(
  plan: BuildingPlan,
  block: BuildingMassBlock,
): { readonly centers: readonly number[]; readonly spacing: number } {
  const margin = Math.min(1.1, block.width * 0.16);
  const usable = Math.max(1, block.width - margin * 2);
  const count = Math.max(1, Math.floor(usable / plan.recipe.facade.baySpacing));
  const spacing = usable / count;
  const centers: number[] = [];
  for (let index = 0; index < count; index += 1) {
    centers.push(-usable / 2 + spacing * (index + 0.5));
  }
  return { centers: Object.freeze(centers), spacing };
}

/**
 * `true` when a mass block's street face can actually be seen.
 *
 * A block is buried when an equally tall or taller mass stands in front of it
 * with lateral overlap — a walk-up's rear wing flush behind its street wall, for
 * example. Detailing a buried face would spend instances on geometry nobody can
 * ever see, so those blocks only keep their roof deck.
 */
export function hasExposedFace(plan: BuildingPlan, block: BuildingMassBlock): boolean {
  if (block.frontOffset <= 0.05) return true;
  const blockLeft = block.centerX - block.width / 2;
  const blockRight = block.centerX + block.width / 2;
  const blockTop = block.baseY + block.height;
  return !plan.masses.some((other) => {
    if (other === block) return false;
    if (other.frontOffset > block.frontOffset - 1e-6) return false;
    if (other.frontOffset + other.depth < block.frontOffset - 1e-6) return false;
    if (other.baseY > block.baseY + 1e-6) return false;
    if (other.baseY + other.height < blockTop - 0.05) return false;
    const overlap =
      Math.min(blockRight, other.centerX + other.width / 2) -
      Math.max(blockLeft, other.centerX - other.width / 2);
    return overlap > 0.2;
  });
}

/** A zeroed counter set, so callers can aggregate across variants. */
export function createFacadeFeatureCounts(): FacadeFeatureCounts {
  return {
    windows: 0,
    sills: 0,
    lintels: 0,
    pilasters: 0,
    mullions: 0,
    spandrels: 0,
    briseSoleilFins: 0,
    mirrorBands: 0,
    concreteGrids: 0,
    neonStrips: 0,
    cornices: 0,
    dentils: 0,
    bandCaps: 0,
    fireEscapeStacks: 0,
    fireEscapeParts: 0,
    mediaPanels: 0,
    planterBands: 0,
    facadeTrees: 0,
  };
}

/* ------------------------------------------------------------------------- *
 * Element builders
 * ------------------------------------------------------------------------- */

/** Frames, glazing, sills, lintels, piers, spandrels, fins and applied grids. */
function addOpenings(
  batcher: DetailBatcher,
  plan: BuildingPlan,
  frame: BlockFaceFrame,
  materials: BuildingMaterialSet,
  counts: FacadeFeatureCounts,
): void {
  const { block } = frame;
  const facade = plan.recipe.facade;
  const trim = materials.get('trim');
  const glass = materials.get('glass');
  const frameDepth = Math.max(0.1, facade.frameDepth);
  const windowHeight = plan.floorHeight * facade.windowHeightRatio;
  const { centers, spacing } = facadeColumns(plan, block);
  const windowWidth = Math.min(facade.windowWidth, spacing * 0.78);
  const sills = facadeRowSills(plan, block);
  const firstBayEdge = -((centers.length * spacing) / 2);

  for (const sill of sills) {
    const windowCenterY = sill + windowHeight / 2;
    for (const center of centers) {
      // Frame: a proud surround, so every opening reads as a framed window.
      const [fx, fy, fz] = frame.point(center, windowCenterY, frameDepth / 2);
      batcher.box(trim, fx, fy, fz, windowWidth + 0.18, windowHeight + 0.18, frameDepth, {
        yaw: block.yaw,
      });

      // Glazing: flush with the frame's front, leaving a visible frame border.
      const [gx, gy, gz] = frame.point(center, windowCenterY, frameDepth - 0.02);
      batcher.box(glass, gx, gy, gz, windowWidth, windowHeight, 0.04, { yaw: block.yaw });
      counts.windows += 1;

      if (facade.sillProjection > 0.02) {
        const [sx, sy, sz] = frame.point(center, sill - 0.05, facade.sillProjection / 2);
        batcher.box(trim, sx, sy, sz, windowWidth + 0.32, 0.1, facade.sillProjection, {
          yaw: block.yaw,
        });
        counts.sills += 1;
      }

      if (facade.lintels) {
        const [lx, ly, lz] = frame.point(center, sill + windowHeight + 0.2, 0.11);
        batcher.box(trim, lx, ly, lz, windowWidth + 0.4, 0.24, 0.22, { yaw: block.yaw });
        counts.lintels += 1;
      }
    }

    // One mullion line between each pair of bays, per row.
    if (facade.mullions) {
      for (let index = 1; index < centers.length; index += 1) {
        const [mx, my, mz] = frame.point(firstBayEdge + spacing * index, windowCenterY, 0.09);
        batcher.box(trim, mx, my, mz, 0.16, windowHeight + 0.4, 0.18, { yaw: block.yaw });
        counts.mullions += 1;
      }
    }

    // Horizontal band under every row: precast spandrels, mirrored bands or an
    // expressed concrete floor band.
    const gapCenter = sill + windowHeight + (plan.floorHeight - windowHeight) * 0.5;
    if (facade.spandrels) {
      const [px, py, pz] = frame.point(0, gapCenter, 0.07);
      batcher.box(trim, px, py, pz, block.width * 0.98, 0.5, 0.14, { yaw: block.yaw });
      counts.spandrels += 1;
    }
    if (facade.mirroredBands) {
      const [mx, my, mz] = frame.point(0, gapCenter, 0.16);
      batcher.box(glass, mx, my, mz, block.width * 0.99, 0.78, 0.32, { yaw: block.yaw });
      counts.mirrorBands += 1;
    }
    if (facade.concreteGrid) {
      // Clamped so even the lowest row's floor band stays clear of the band.
      const bandCentre = Math.max(DETAIL_BASE_Y + 0.19, sill - 0.26);
      const [cx, cy, cz] = frame.point(0, bandCentre, 0.12);
      batcher.box(trim, cx, cy, cz, block.width * 1.01, 0.36, 0.24, { yaw: block.yaw });
      counts.concreteGrids += 1;
    }
    if (facade.briseSoleil) {
      const [bx, by, bz] = frame.point(0, sill + windowHeight + 0.07, 0.28);
      batcher.box(trim, bx, by, bz, block.width * 1.01, 0.09, 0.56, { yaw: block.yaw });
      counts.briseSoleilFins += 1;
    }
  }

  // Tall vertical members — brick piers and an expressed concrete grid — run
  // the whole facade, so they are queued once per block rather than per row.
  if (facade.pilasters || facade.concreteGrid) {
    const pierWidth = facade.pilasters ? 0.4 : 0.46;
    const pierDepth = facade.concreteGrid ? 0.26 : 0.16;
    const pierBase = Math.max(DETAIL_BASE_Y, block.baseY);
    const pierTop = blockTop(block) - (facade.corniceHeight + 0.4);
    if (pierTop - pierBase > 1) {
      for (let index = 0; index <= centers.length; index += 1) {
        const x = firstBayEdge + spacing * index;
        const [px, py, pz] = frame.point(x, (pierBase + pierTop) / 2, facade.concreteGrid ? 0.13 : 0.08);
        batcher.box(trim, px, py, pz, pierWidth, pierTop - pierBase, pierDepth, { yaw: block.yaw });
        if (facade.concreteGrid) counts.concreteGrids += 1;
        else counts.pilasters += 1;
      }
    }
  }
}

/** Deep cornices, thin fascias, concrete caps and planted parapet planters. */
function addCornice(
  batcher: DetailBatcher,
  plan: BuildingPlan,
  frame: BlockFaceFrame,
  materials: BuildingMaterialSet,
  counts: FacadeFeatureCounts,
): void {
  const { block } = frame;
  const facade = plan.recipe.facade;
  if (facade.cornice === 'none') return;
  const top = blockTop(block);
  if (top - facade.corniceHeight < DETAIL_BASE_Y - 0.05) return;

  const trim = materials.get('trim');
  const metal = materials.get('metal');
  const foliage = materials.has('foliage') ? materials.get('foliage') : trim;

  switch (facade.cornice) {
    case 'deep': {
      // Moulding + coping + a run of dentils under it.
      const [mx, my, mz] = frame.point(0, top - facade.corniceHeight * 0.45, facade.corniceDepth / 2);
      batcher.box(trim, mx, my, mz, block.width + 0.5, facade.corniceHeight * 0.6, facade.corniceDepth, {
        yaw: block.yaw,
      });
      const [cx, cy, cz] = frame.point(0, top - 0.09, facade.corniceDepth * 0.4);
      batcher.box(trim, cx, cy, cz, block.width + 0.42, 0.18, facade.corniceDepth * 0.8, {
        yaw: block.yaw,
      });
      counts.cornices += 2;
      const dentils = Math.max(2, Math.floor(block.width / 0.8));
      const spacing = block.width / dentils;
      for (let index = 0; index < dentils; index += 1) {
        const x = -block.width / 2 + spacing * (index + 0.5);
        const [dx, dy, dz] = frame.point(x, top - facade.corniceHeight - 0.08, 0.19);
        batcher.box(trim, dx, dy, dz, 0.4, 0.26, 0.32, { yaw: block.yaw });
        counts.dentils += 1;
      }
      break;
    }
    case 'green': {
      const [px, py, pz] = frame.point(0, top - facade.corniceHeight * 0.5, 0.45);
      batcher.box(foliage, px, py, pz, block.width + 0.3, facade.corniceHeight, 0.9, {
        yaw: block.yaw,
      });
      counts.cornices += 1;
      const trees = Math.max(2, Math.floor(block.width / 2.4));
      const spacing = block.width / trees;
      for (let index = 0; index < trees; index += 1) {
        const x = -block.width / 2 + spacing * (index + 0.5);
        const treeY = top + 0.9;
        const [tx, ty, tz] = frame.point(x, treeY, 0.5);
        batcher.cylinder(foliage, tx, ty, tz, 0.18, 1.1, { yaw: block.yaw });
        const [sx, sy, sz] = frame.point(x, treeY + 1.15, 0.5);
        batcher.sphere(foliage, sx, sy, sz, 1.7);
        counts.facadeTrees += 1;
      }
      break;
    }
    case 'cap': {
      const [cx, cy, cz] = frame.point(0, top - 0.17, facade.corniceDepth / 2 + 0.04);
      batcher.box(metal, cx, cy, cz, block.width + 0.34, 0.34, facade.corniceDepth, {
        yaw: block.yaw,
      });
      counts.cornices += 1;
      break;
    }
    default: {
      // 'thin' (1965 fascia) and 'band' (1985 expressed top band).
      const material = facade.cornice === 'band' ? trim : metal;
      const [bx, by, bz] = frame.point(0, top - facade.corniceHeight / 2, facade.corniceDepth / 2);
      batcher.box(material, bx, by, bz, block.width + 0.24, facade.corniceHeight, facade.corniceDepth, {
        yaw: block.yaw,
      });
      counts.cornices += 1;
      break;
    }
  }
}

/** Neoned fascias, vertical edge tubes and a programmable media wall. */
function addEmissiveTrim(
  batcher: DetailBatcher,
  plan: BuildingPlan,
  frame: BlockFaceFrame,
  materials: BuildingMaterialSet,
  counts: FacadeFeatureCounts,
): void {
  const { block } = frame;
  const facade = plan.recipe.facade;
  const accent = materials.get('accent');
  const top = blockTop(block);

  if (facade.neonTrim) {
    const lineY = DETAIL_BASE_Y + 0.62;
    const [fx, fy, fz] = frame.point(0, lineY, 0.07);
    batcher.box(accent, fx, fy, fz, block.width * 0.98, 0.15, 0.14, { yaw: block.yaw });
    counts.neonStrips += 1;
    if (top - lineY > 3) {
      const railHeight = top - lineY - 0.6;
      for (const side of [-1, 1]) {
        const [vx, vy, vz] = frame.point(
          side * block.width * 0.47,
          lineY + railHeight / 2,
          0.06,
        );
        batcher.box(accent, vx, vy, vz, 0.13, railHeight, 0.12, { yaw: block.yaw });
        counts.neonStrips += 1;
      }
    }
  }

  if (facade.mediaFacade && block.height >= 18) {
    const panelHeight = Math.min(block.height * 0.5, 16);
    const [mx, my, mz] = frame.point(0, block.baseY + block.height * 0.58, 0.16);
    batcher.box(accent, mx, my, mz, block.width * 0.86, panelHeight, 0.32, { yaw: block.yaw });
    counts.mediaPanels += 1;
  }
}

/** Planted terraces with trees: the 2025 green facade. */
function addPlantedBands(
  batcher: DetailBatcher,
  plan: BuildingPlan,
  frame: BlockFaceFrame,
  materials: BuildingMaterialSet,
  counts: FacadeFeatureCounts,
): void {
  const { block } = frame;
  if (!materials.has('foliage')) return;
  const foliage = materials.get('foliage');
  const sills = facadeRowSills(plan, block);
  const { centers } = facadeColumns(plan, block);

  for (const sill of sills) {
    const bandCentre = Math.max(DETAIL_BASE_Y + 0.27, sill - 0.34);
    const [px, py, pz] = frame.point(0, bandCentre, 0.36);
    batcher.box(foliage, px, py, pz, block.width * 0.94, 0.52, 0.72, { yaw: block.yaw });
    counts.planterBands += 1;
    centers.forEach((center, index) => {
      if (index % 2 !== 0) return;
      const [tx, ty, tz] = frame.point(center, bandCentre + 0.95, 0.42);
      batcher.cylinder(foliage, tx, ty, tz, 0.17, 1.0, { yaw: block.yaw });
      const [sx, sy, sz] = frame.point(center, bandCentre + 1.95, 0.42);
      batcher.sphere(foliage, sx, sy, sz, 1.6);
      counts.facadeTrees += 1;
    });
  }
}

/** Iron fire escapes: stringers, landings, railings and a drop ladder. */
function addFireEscapes(
  batcher: DetailBatcher,
  plan: BuildingPlan,
  frame: BlockFaceFrame,
  materials: BuildingMaterialSet,
  counts: FacadeFeatureCounts,
): void {
  const facade = plan.recipe.facade;
  if (!facade.fireEscapes) return;
  const { block } = frame;
  const metal = materials.get('metal');
  const stacks = Math.max(1, facade.fireEscapeBays);
  const sills = facadeRowSills(plan, block);
  const top = Math.min(blockTop(block) - 0.7, blockTop(block));
  const bottom = DETAIL_BASE_Y;

  for (let stack = 0; stack < stacks; stack += 1) {
    const offset = stacks === 1 ? 0 : (stack / (stacks - 1) - 0.5) * block.width * 0.62;
    const width = Math.min(2.3, Math.max(1.4, block.width * 0.22));
    const railZ = 0.95;

    // Two stringers rising the full height of the stack.
    for (const side of [-1, 1]) {
      const [sx, sy, sz] = frame.point(offset + side * (width / 2), (bottom + top) / 2, 0.52);
      batcher.box(metal, sx, sy, sz, 0.11, top - bottom, 0.12, { yaw: block.yaw });
      counts.fireEscapeParts += 1;
    }

    // A landing, railing and ladder connection at every floor above the band.
    for (const sill of sills) {
      const landingY = sill - 0.05;
      if (landingY >= top) break;
      const [lx, ly, lz] = frame.point(offset, landingY, 0.52);
      batcher.box(metal, lx, ly, lz, width, 0.12, 0.95, { yaw: block.yaw });
      const [rx, ry, rz] = frame.point(offset, landingY + 0.92, railZ);
      batcher.box(metal, rx, ry, rz, width + 0.1, 0.07, 0.08, { yaw: block.yaw });
      for (const side of [-1, 1]) {
        const [px, py, pz] = frame.point(offset + side * (width / 2), landingY + 0.46, railZ);
        batcher.box(metal, px, py, pz, 0.07, 0.92, 0.9, { yaw: block.yaw });
        counts.fireEscapeParts += 1;
      }
      const [dx, dy, dz] = frame.point(offset + width * 0.28, landingY + 0.5, 0.78);
      batcher.box(metal, dx, dy, dz, 0.06, 1.35, 0.08, { yaw: block.yaw, pitch: 0.9 });
      counts.fireEscapeParts += 4;
    }

    // The counterweighted drop ladder hanging over the storefront band.
    const [hx, hy, hz] = frame.point(offset - width * 0.2, bottom + 1.15, 0.78);
    batcher.box(metal, hx, hy, hz, 0.07, 2.2, 0.09, { yaw: block.yaw });
    counts.fireEscapeParts += 1;
    counts.fireEscapeStacks += 1;
  }
}

/* ------------------------------------------------------------------------- *
 * Entry point
 * ------------------------------------------------------------------------- */

/**
 * Builds one variant's facade: every block's street elevation, its cornice and
 * emissive trim, plus the lot's storefront-band mount panel.
 */
export function buildFacadeDetails(options: FacadeDetailOptions): FacadeDetailResult {
  const { plan, materials, geometries, parent, random } = options;
  const batcher = options.batcher ?? new DetailBatcher(parent, geometries, 'facade-detail');
  const counts = createFacadeFeatureCounts();
  const streetWall = streetWallBlock(plan);
  const streetFrontOffset = streetWall.frontOffset;
  const stream = random.fork(`${plan.id}:facade`);

  for (const block of plan.masses) {
    // Buried faces (a walk-up's rear wing behind its street wall) get no
    // ornament: the instance budget belongs where it can be seen.
    if (!hasExposedFace(plan, block)) continue;
    const frame = faceFrame(block);
    const onStreet = Math.abs(block.frontOffset - streetFrontOffset) < 0.01;

    addOpenings(batcher, plan, frame, materials, counts);
    addCornice(batcher, plan, frame, materials, counts);
    if (onStreet) {
      addEmissiveTrim(batcher, plan, frame, materials, counts);
      addPlantedBands(batcher, plan, frame, materials, counts);
      addFireEscapes(batcher, plan, frame, materials, counts);

      // The plain cap that terminates the storefront band — the top of the band
      // the storefront system works against, never inside it.
      const facade = plan.recipe.facade;
      const [bx, by, bz] = frame.point(
        0,
        DETAIL_BASE_Y + facade.bandCapHeight / 2,
        facade.bandCapDepth / 2,
      );
      batcher.box(
        materials.get('trim'),
        bx,
        by,
        bz,
        block.width + 0.16,
        facade.bandCapHeight,
        facade.bandCapDepth,
        { yaw: block.yaw },
      );
      counts.bandCaps += 1;
    }

    // Dentil rhythm jitter keeps adjacent lots from marching in lockstep.
    if (plan.recipe.facade.cornice === 'deep' && stream.bool(0.35)) {
      const [jx, jy, jz] = frame.point(0, blockTop(block) - 0.22, 0.3);
      batcher.box(materials.get('trim'), jx, jy, jz, block.width * 0.4, 0.16, 0.5, {
        yaw: block.yaw,
      });
      counts.cornices += 1;
    }
  }

  const mountSurface = addMountSurface(parent, plan, materials, geometries, streetWall);
  const instanceCount = batcher.flush();

  return {
    planId: plan.id,
    era: plan.era,
    instanceCount,
    counts: Object.freeze({ ...counts }),
    mountSurface,
    batcher,
  };
}

/**
 * Draws the lot's `0–4 m` mount panel: a plain, unornamented wall panel the
 * storefront/advertisement system attaches its shopfront band to. It is the only
 * geometry this task places inside the band, and it carries no signage.
 */
function addMountSurface(
  parent: THREE.Group,
  plan: BuildingPlan,
  materials: BuildingMaterialSet,
  geometries: DetailGeometrySet,
  streetWall: BuildingMassBlock,
): MountSurfacePanel {
  const batcher = new DetailBatcher(parent, geometries, 'mount-surface');
  const projection = 0.12;
  const centerX = streetWall.centerX;
  const z = -streetWall.frontOffset + projection / 2;
  batcher.box(
    materials.get('trim'),
    centerX,
    STOREFRONT_BAND_HEIGHT / 2,
    z,
    streetWall.width,
    STOREFRONT_BAND_HEIGHT,
    projection,
  );
  batcher.flush();
  return Object.freeze({
    lotId: plan.lot.id,
    centerX,
    width: streetWall.width,
    height: STOREFRONT_BAND_HEIGHT,
    baseY: 0,
    projection,
  });
}
