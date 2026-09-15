/**
 * Deterministic patron placement.
 *
 * The room belongs to `environment-shell`: this module reads its `RoomBounds`
 * and structural layout (table slot grid, counter zone, service lane, reserved
 * doorway/entrance zones) and decides *where each figure stands or sits*,
 * without ever inventing competing geometry:
 *
 *  - the barista is planted behind the counter's service face and works on the
 *    counter top (the counter zone, never a hardcoded constant),
 *  - seated patrons take the two-seat grid around the table slots, facing their
 *    table,
 *  - standing patrons fill a candidate lattice along the side walls and the
 *    storefront glazing, clear of the counter footprint, the service lane, the
 *    doorway and every table's clearance radius,
 *  - every coordinate is derived from one seeded random source, so the same
 *    year and seed produce a byte-identical plan.
 *
 * `placementConflicts` re-derives the invariants from the finished plan, which
 * is what the tests assert instead of trusting the generator.
 */

import { createSeededRandom } from '../../../core/kernel';
import type { RoomBounds, RoomPoint } from '../../../contracts/period';
import {
  counterRect,
  floorRect,
  rectsOverlap,
  serviceLaneRect,
  type CounterZone,
  type FloorRect,
  type ReservedZone,
  type StructuralLayout,
  type TableSlot,
} from '../../environment';
import type { FigureBlueprint, FigureZone } from '../figures/FigureRig';

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

/** Distance from the table anchor to a chair's floor anchor. */
export const SEAT_OFFSET = 0.62;

/** How far in front of a figure its working surface sits (table or counter). */
export const TABLE_SURFACE_DISTANCE = 0.5;

/** Standing room the room is planned for, on top of the table seats. */
export const STANDING_CAPACITY = 10;

/** Keep-clear distance from the walls for a standing figure. */
export const WALL_MARGIN = 0.42;

/** Lattice pitch the standing candidates are sampled on. */
export const STANDING_STEP = 0.5;

/** Minimum distance between two standing figures. */
export const STANDING_SPACING = 0.55;

/** How far the barista stands behind the counter's back face. */
export const COUNTER_STAND_INSET = 0.32;

/** Depth of the counter pass the barista works on. */
export const COUNTER_SURFACE_DISTANCE = 0.34;

/** Figures never come closer than this to a table anchor that is not theirs. */
export const TABLE_CLEARANCE = 0.95;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

/** Per-figure jitter drawn from the seed, so no two patrons are identical. */
export interface FigureVariation {
  /** Stature multiplier applied to the canonical body. */
  readonly stature: number;
  /** Reserved lean offset for the rig's pose tweaks. */
  readonly lean: number;
  /** Idle motion phase offset, radians. */
  readonly phase: number;
  /** Idle motion speed multiplier. */
  readonly speed: number;
  /** Palette tone offset, so two patrons never share a skin tone exactly. */
  readonly tone: number;
}

export interface PlacedFigure {
  readonly figureId: string;
  readonly zone: FigureZone;
  /** Anchor id the figure was placed on (`'table-slot-c1-r1-seat-1'`, …). */
  readonly slotId: string;
  /** Floor anchor of the figure. */
  readonly position: RoomPoint;
  /** Y rotation in radians; the figure faces `+Z` rotated by this. */
  readonly facing: number;
  readonly footprintRadius: number;
  readonly seated: boolean;
  /** Table anchor the figure sits at, or `null`. */
  readonly tableId: string | null;
  /** Height of the surface in front of the figure (table top or counter top). */
  readonly surfaceHeight: number;
  /** Distance in front of the figure its surface sits. */
  readonly surfaceDistance: number;
  readonly variation: FigureVariation;
}

export interface PlacementPlan {
  readonly seed: number;
  readonly bounds: RoomBounds;
  readonly placed: readonly PlacedFigure[];
  readonly seated: number;
  readonly standing: number;
  readonly capacity: number;
  /** Figures the room could not host, with the reason. */
  readonly skipped: readonly string[];
  /** Stable per-figure transform signatures (determinism evidence). */
  readonly signatures: readonly string[];
}

export interface PlacementOptions {
  readonly layout: StructuralLayout;
  readonly figures: readonly FigureBlueprint[];
  readonly seed: number;
}

/** One candidate anchor the plan can hand to a figure. */
export interface StandingCandidate {
  readonly id: string;
  readonly zone: Extract<FigureZone, 'standing' | 'window'>;
  readonly position: RoomPoint;
  readonly facing: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Rotation about Y applied to a local offset. */
function rotateOffset(dx: number, dz: number, angle: number): { x: number; z: number } {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos };
}

/** Y rotation that points a figure's `+Z` axis along `(dx, dz)`. */
export function facingTowards(from: RoomPoint, to: RoomPoint): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 0;
  return Math.atan2(dx, dz);
}

function expand(rect: FloorRect, margin: number): FloorRect {
  return {
    minX: rect.minX - margin,
    maxX: rect.maxX + margin,
    minZ: rect.minZ - margin,
    maxZ: rect.maxZ + margin,
  };
}

function containsPoint(rect: FloorRect, point: RoomPoint, margin = 0): boolean {
  return (
    point.x >= rect.minX - margin &&
    point.x <= rect.maxX + margin &&
    point.z >= rect.minZ - margin &&
    point.z <= rect.maxZ + margin
  );
}

/* -------------------------------------------------------------------------- */
/* Candidate anchors                                                          */
/* -------------------------------------------------------------------------- */

export interface SeatCandidate {
  readonly id: string;
  readonly zone: 'table';
  readonly position: RoomPoint;
  readonly facing: number;
  readonly tableId: string;
  readonly surfaceHeight: number;
  readonly seatIndex: number;
}

/**
 * Chair anchors around every table slot: two seats per slot, offset along the
 * table's local axis and facing the table centre.
 */
export function seatCandidates(layout: StructuralLayout): readonly SeatCandidate[] {
  const halfWidth = layout.bounds.width / 2;
  const halfDepth = layout.bounds.depth / 2;
  const counter = counterRect(layout.counter);
  const candidates: SeatCandidate[] = [];

  for (const slot of layout.tableSlots) {
    const seatCount = Math.max(slot.seats, 1);
    for (let index = 0; index < seatCount; index += 1) {
      // Spread the seats symmetrically across the table's local X axis.
      const t = seatCount === 1 ? 0 : index / (seatCount - 1) - 0.5;
      const local = rotateOffset(t * SEAT_OFFSET * 2, 0, slot.orientation);
      const position: RoomPoint = {
        x: slot.position.x + local.x,
        y: slot.position.y,
        z: slot.position.z + local.z,
      };
      if (Math.abs(position.x) > halfWidth - WALL_MARGIN) continue;
      if (Math.abs(position.z) > halfDepth - WALL_MARGIN) continue;
      if (containsPoint(counter, position, 0.1)) continue;
      candidates.push(
        Object.freeze({
          id: `${slot.id}-seat-${index + 1}`,
          zone: 'table' as const,
          position,
          facing: facingTowards(position, slot.position),
          tableId: slot.id,
          surfaceHeight: slot.surfaceHeight,
          seatIndex: index,
        }),
      );
    }
  }
  return Object.freeze(candidates);
}

function tableAnchorRects(layout: StructuralLayout): readonly FloorRect[] {
  return layout.tableSlots.map((slot: TableSlot) =>
    floorRect(slot.position, TABLE_CLEARANCE, TABLE_CLEARANCE),
  );
}

function reservedBlocks(layout: StructuralLayout): readonly FloorRect[] {
  const halfDepth = layout.bounds.depth / 2;
  const blocks: FloorRect[] = [];
  for (const zone of [layout.doorway, layout.entrance] as readonly ReservedZone[]) {
    const alongWall = zone.wall === 'front' ? halfDepth - 1.6 : -halfDepth + 1.6;
    blocks.push(
      Object.freeze({
        minX: zone.position.x - zone.width / 2 - 0.45,
        maxX: zone.position.x + zone.width / 2 + 0.45,
        minZ: zone.wall === 'front' ? alongWall : zone.position.z - 0.4,
        maxZ: zone.wall === 'front' ? zone.position.z + 0.4 : alongWall,
      }),
    );
  }
  return Object.freeze(blocks);
}

/**
 * Standing room the room actually has: a lattice of positions clear of the
 * counter, the service lane, every table's clearance and the reserved openings,
 * split into a storefront (`window`) zone and a side-wall (`standing`) zone.
 * Candidates face the middle of the room.
 */
export function standingCandidates(layout: StructuralLayout): readonly StandingCandidate[] {
  const { bounds } = layout;
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const xInset = Math.max(halfWidth - WALL_MARGIN, 0);
  const zInset = Math.max(halfDepth - WALL_MARGIN, 0);
  const counter = expand(counterRect(layout.counter), 0.35);
  const lane = expand(serviceLaneRect(layout.serviceLane), 0.18);
  const tables = tableAnchorRects(layout);
  const reserved = reservedBlocks(layout);
  const candidates: StandingCandidate[] = [];

  const steps = Math.floor((xInset * 2) / STANDING_STEP);
  const depthSteps = Math.floor((zInset * 2) / STANDING_STEP);

  for (let xi = 0; xi <= steps; xi += 1) {
    for (let zi = 0; zi <= depthSteps; zi += 1) {
      const position: RoomPoint = {
        x: -xInset + xi * STANDING_STEP,
        y: layout.floorHeight,
        z: -zInset + zi * STANDING_STEP,
      };
      if (containsPoint(counter, position, 0)) continue;
      if (containsPoint(lane, position, 0)) continue;
      if (tables.some((rect) => containsPoint(rect, position, 0))) continue;
      if (reserved.some((rect) => containsPoint(rect, position, 0))) continue;
      const nearWindow = position.z >= halfDepth - 2;
      const nearWall = Math.abs(position.x) >= bounds.width * 0.2;
      if (!nearWindow && !nearWall) continue;
      const zone: StandingCandidate['zone'] = nearWindow ? 'window' : 'standing';
      candidates.push(
        Object.freeze({
          id: `${zone}-${xi}-${zi}`,
          zone,
          position,
          facing: facingTowards(position, { x: 0, y: layout.floorHeight, z: 0 }),
        }),
      );
    }
  }
  return Object.freeze(candidates);
}

/* -------------------------------------------------------------------------- */
/* Plan                                                                       */
/* -------------------------------------------------------------------------- */

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const value = copy[index];
    const other = copy[swap];
    if (value === undefined || other === undefined) continue;
    copy[index] = other;
    copy[swap] = value;
  }
  return copy;
}

function nextVariation(random: () => number, seated: boolean): FigureVariation {
  return Object.freeze({
    stature: 0.96 + random() * 0.07,
    lean: (random() - 0.5) * 0.08,
    phase: random() * Math.PI * 2,
    speed: 0.85 + random() * 0.3,
    tone: Math.round(random() * 3) + (seated ? 0 : 1),
  });
}

function counterAnchor(layout: StructuralLayout): {
  position: RoomPoint;
  facing: number;
  surfaceHeight: number;
  surfaceDistance: number;
  id: string;
} {
  const counter: CounterZone = layout.counter;
  const handoff = layout.counterPassSlots.find((slot) => slot.kind === 'handoff');
  const x = handoff ? handoff.position.x : counter.center.x;
  return {
    id: 'counter-zone',
    position: {
      x,
      y: layout.floorHeight,
      z: counter.backFaceZ + COUNTER_STAND_INSET,
    },
    // Zero rotation: the figure's +Z axis points at the counter's service face.
    facing: 0,
    surfaceHeight: counter.surfaceHeight,
    surfaceDistance: COUNTER_SURFACE_DISTANCE,
  };
}

function footprintRadiusFor(blueprint: FigureBlueprint): number {
  return blueprint.pose === 'seated' ? 0.3 : 0.24;
}

/**
 * Plans the whole crowd for one era. Blueprints are consumed in order, so the
 * plan is a pure function of `(layout, figure order, seed)`.
 */
export function planPatronPlacement(options: PlacementOptions): PlacementPlan {
  const { layout, figures } = options;
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : 0;
  const random = createSeededRandom(seed);

  const seats = shuffle(seatCandidates(layout), random);
  const standing = standingCandidates(layout);
  const windowPool = shuffle(
    standing.filter((candidate) => candidate.zone === 'window'),
    random,
  );
  const roomPool = shuffle(
    standing.filter((candidate) => candidate.zone === 'standing'),
    random,
  );

  const placed: PlacedFigure[] = [];
  const skipped: string[] = [];
  let seatCursor = 0;
  let windowCursor = 0;
  let roomCursor = 0;

  const takeSeat = (figure: FigureBlueprint): PlacedFigure | null => {
    while (seatCursor < seats.length) {
      const seat = seats[seatCursor];
      seatCursor += 1;
      if (!seat) continue;
      return Object.freeze({
        figureId: figure.id,
        zone: 'table' as const,
        slotId: seat.id,
        position: seat.position,
        facing: seat.facing,
        footprintRadius: footprintRadiusFor(figure),
        seated: true,
        tableId: seat.tableId,
        surfaceHeight: seat.surfaceHeight,
        surfaceDistance: TABLE_SURFACE_DISTANCE,
        variation: nextVariation(random, true),
      });
    }
    return null;
  };

  const takeStanding = (
    figure: FigureBlueprint,
    zones: readonly Extract<FigureZone, 'standing' | 'window'>[],
  ): PlacedFigure | null => {
    for (const zone of zones) {
      if (zone === 'window') {
        while (windowCursor < windowPool.length) {
          const candidate = windowPool[windowCursor];
          windowCursor += 1;
          if (!candidate) continue;
          return Object.freeze({
            figureId: figure.id,
            zone: candidate.zone,
            slotId: candidate.id,
            position: candidate.position,
            facing: candidate.facing,
            footprintRadius: footprintRadiusFor(figure),
            seated: false,
            tableId: null,
            surfaceHeight: 0,
            surfaceDistance: 0,
            variation: nextVariation(random, false),
          });
        }
      } else {
        while (roomCursor < roomPool.length) {
          const candidate = roomPool[roomCursor];
          roomCursor += 1;
          if (!candidate) continue;
          return Object.freeze({
            figureId: figure.id,
            zone: candidate.zone,
            slotId: candidate.id,
            position: candidate.position,
            facing: candidate.facing,
            footprintRadius: footprintRadiusFor(figure),
            seated: false,
            tableId: null,
            surfaceHeight: 0,
            surfaceDistance: 0,
            variation: nextVariation(random, false),
          });
        }
      }
    }
    return null;
  };

  for (const figure of figures) {
    const seated = figure.pose === 'seated';
    let entry: PlacedFigure | null = null;

    if (figure.zone === 'counter') {
      const anchor = counterAnchor(layout);
      entry = Object.freeze({
        figureId: figure.id,
        zone: 'counter' as const,
        slotId: anchor.id,
        position: anchor.position,
        facing: anchor.facing,
        footprintRadius: footprintRadiusFor(figure),
        seated: false,
        tableId: null,
        surfaceHeight: anchor.surfaceHeight,
        surfaceDistance: anchor.surfaceDistance,
        variation: nextVariation(random, false),
      });
    } else if (figure.zone === 'window') {
      entry = takeStanding(figure, ['window', 'standing']) ?? takeSeat(figure);
    } else if (figure.zone === 'standing') {
      entry = takeStanding(figure, ['standing', 'window']) ?? takeSeat(figure);
    } else {
      entry = takeSeat(figure) ?? takeStanding(figure, ['standing', 'window']);
    }

    if (entry) {
      placed.push(entry);
    } else {
      skipped.push(`${figure.id}: no free ${seated ? 'seat' : 'standing room'}`);
    }
  }

  const placedSeated = placed.filter((entry) => entry.seated).length;
  const signatures = placed.map((entry) =>
    [
      entry.figureId,
      entry.zone,
      entry.slotId,
      entry.position.x.toFixed(6),
      entry.position.z.toFixed(6),
      entry.facing.toFixed(6),
      entry.variation.stature.toFixed(6),
      entry.variation.phase.toFixed(6),
    ].join('|'),
  );

  return Object.freeze({
    seed,
    bounds: layout.bounds,
    placed: Object.freeze(placed),
    seated: placedSeated,
    standing: placed.length - placedSeated,
    capacity: layout.tableSlots.length * 2 + STANDING_CAPACITY,
    skipped: Object.freeze(skipped),
    signatures: Object.freeze(signatures),
  });
}

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

/** Floor rectangle a placed figure occupies. */
export function figureFootprint(placed: PlacedFigure): FloorRect {
  return floorRect(placed.position, placed.footprintRadius, placed.footprintRadius);
}

/** True when the whole footprint (not just the anchor) is inside the room. */
export function footprintInsideBounds(placed: PlacedFigure, bounds: RoomBounds): boolean {
  const rect = figureFootprint(placed);
  return (
    rect.minX >= -bounds.width / 2 &&
    rect.maxX <= bounds.width / 2 &&
    rect.minZ >= -bounds.depth / 2 &&
    rect.maxZ <= bounds.depth / 2
  );
}

/**
 * Re-derives every placement invariant from a finished plan: footprints inside
 * the room, patrons clear of the counter and the service lane, seated patrons
 * at their own table, the barista behind the counter and no two figures on top
 * of each other. An empty array means the plan is sound.
 */
export function placementConflicts(plan: PlacementPlan, layout: StructuralLayout): readonly string[] {
  const problems: string[] = [];
  const counter = counterRect(layout.counter);
  const lane = serviceLaneRect(layout.serviceLane);
  const halfWidth = layout.bounds.width / 2;
  const halfDepth = layout.bounds.depth / 2;

  for (const entry of plan.placed) {
    if (!footprintInsideBounds(entry, layout.bounds)) {
      problems.push(`${entry.figureId} is outside the room bounds`);
    }
    const footprint = figureFootprint(entry);
    if (entry.zone === 'counter') {
      if (entry.position.z >= layout.counter.serviceFaceZ) {
        problems.push(`${entry.figureId} is not behind the counter`);
      }
      if (
        entry.position.x < counter.minX - 0.05 ||
        entry.position.x > counter.maxX + 0.05 ||
        entry.position.z < counter.minZ - 0.05
      ) {
        problems.push(`${entry.figureId} is not inside the counter footprint`);
      }
    } else if (rectsOverlap(footprint, counter)) {
      problems.push(`${entry.figureId} stands inside the counter footprint`);
    }
    if (entry.zone !== 'counter' && rectsOverlap(footprint, lane)) {
      problems.push(`${entry.figureId} blocks the service lane`);
    }
    if (entry.seated) {
      const table = layout.tableSlots.find((slot) => slot.id === entry.tableId);
      if (!table) {
        problems.push(`${entry.figureId} sits at an unknown table`);
        continue;
      }
      const dx = entry.position.x - table.position.x;
      const dz = entry.position.z - table.position.z;
      const distance = Math.hypot(dx, dz);
      if (Math.abs(distance - SEAT_OFFSET) > 0.05) {
        problems.push(`${entry.figureId} is ${distance.toFixed(3)} m from its table anchor`);
      }
      const expected = facingTowards(entry.position, table.position);
      if (Math.abs(Math.atan2(Math.sin(entry.facing - expected), Math.cos(entry.facing - expected))) > 1e-6) {
        problems.push(`${entry.figureId} does not face its table`);
      }
    }
    if (entry.position.x < -halfWidth || entry.position.x > halfWidth) {
      problems.push(`${entry.figureId} is off the room's X axis`);
    }
    if (entry.position.z < -halfDepth || entry.position.z > halfDepth) {
      problems.push(`${entry.figureId} is off the room's Z axis`);
    }
  }

  for (let first = 0; first < plan.placed.length; first += 1) {
    for (let second = first + 1; second < plan.placed.length; second += 1) {
      const a = plan.placed[first];
      const b = plan.placed[second];
      if (!a || !b) continue;
      const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
      if (distance < STANDING_SPACING) {
        problems.push(`${a.figureId} and ${b.figureId} overlap (${distance.toFixed(3)} m apart)`);
      }
    }
  }

  return Object.freeze(problems);
}

/** Stable one-line-per-figure rendering of a plan (determinism evidence). */
export function formatPlacementPlan(plan: PlacementPlan): string {
  return [
    `seed=${plan.seed}`,
    `placed=${plan.placed.length}`,
    `seated=${plan.seated}`,
    `standing=${plan.standing}`,
    `capacity=${plan.capacity}`,
    ...plan.signatures,
  ].join('\n');
}

export function clampDensity(value: number): number {
  return clamp(Number.isFinite(value) ? value : 0, 0, 1);
}
