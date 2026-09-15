/**
 * Seating — the finest grain of the era read: loose chairs around every table,
 * the fixed wall banquettes, the facing booth unit, modular benches, counter
 * stools, the window lounge and the standing rail.
 *
 * Placement rules
 * ---------------
 *  - **Loose chairs** sit on the long side of each table, in the gap between the
 *    table edge and the walkway. Slots whose long axis runs along Z get one
 *    chair on the inner side (the outer side is the banquette); slots across X
 *    get two, one at each end. On communal eras the merged run seats three along
 *    its inner side.
 *  - **Banquettes** are fixed runs down both side walls, from the first to the
 *    last table row, so the wall bench serves the outer chair position in every
 *    era. Their position never moves; only the era's upholstery changes.
 *  - **The booth** occupies the front-right quadrant, back against the right
 *    wall, ahead of the last banquette bay and clear of the entrance swing.
 *  - **Stools** stand on the room side of the counter, flanking the service lane
 *    so the barista's path to the counter stays clear in every era.
 *  - **Window seats** (accent chairs, the mid-century lounge group or the 2025
 *    standing rail with perch stools) fill the window bay left of the entrance.
 *
 * Zones are computed by the same helpers for planning and building, so the
 * geometry always matches the plan the tests assert.
 */

import * as THREE from 'three';
import type { RoomPoint } from '../../contracts/period';
import type {
  ChairSpec,
  FurnitureBuildInput,
  FurniturePlanInput,
  PlacedProp,
  PropBuildResult,
  PropPlanEntry,
  PropSize,
} from './FurnitureModule';
import { boxMesh, cylinderMesh, furnitureMaterial, torusMesh, yawForDirection } from './materials';
import { countMeshes, tableAnchors } from './tables';

/* -------------------------------------------------------------------------- */
/* Placement constants                                                        */
/* -------------------------------------------------------------------------- */

/** Props stop this far short of a wall plane, so their box stays in bounds. */
const WALL_INSET = 0.05;
/** Knee space between a table edge and the seat in front of it. */
const CHAIR_GAP = 0.3;
/** Banquette: seat depth plus the leaning back. */
const BANQUETTE_DEPTH = 0.78;
/** How far the banquette run reaches past the first and last table row. */
const BANQUETTE_OVERHANG = 0.5;
/** Booth: bench + table + bench, across the booth. */
const BOOTH_DEPTH = 1.9;
const BOOTH_LENGTH = 1.5;
/** Counter stools: centres in front of the service face, either side of the lane. */
const COUNTER_STOOL_X: readonly number[] = Object.freeze([-2.6, -1.2, 1.2, 2.6]);
const COUNTER_STOOL_STAND_OFF = 0.35;
/** Window bay seats (accent chairs, lounge armchairs or perch stools). */
const WINDOW_SEAT_X: readonly number[] = Object.freeze([-3.35, -1.85]);
const WINDOW_SEAT_Z = 4.85;
const WINDOW_TABLE = Object.freeze({ x: -2.6, z: 4.75, radius: 0.24, height: 0.72 });
const WINDOW_RAIL_Z = 5.05;
const PERCH_STOOL_Z = 4.62;

function halfWidth(input: FurniturePlanInput): number {
  return input.bounds.width / 2;
}

/* -------------------------------------------------------------------------- */
/* Zones                                                                      */
/* -------------------------------------------------------------------------- */

export interface BanquetteZone {
  readonly id: string;
  readonly side: 'left' | 'right';
  /** Floor centre of the run. */
  readonly center: RoomPoint;
  readonly rotationY: number;
  readonly length: number;
  readonly depth: number;
  readonly seatHeight: number;
  readonly backHeight: number;
}

export interface BoothZone {
  readonly id: string;
  readonly center: RoomPoint;
  readonly length: number;
  readonly depth: number;
  readonly seatHeight: number;
  readonly backHeight: number;
}

export interface BenchZone {
  readonly id: string;
  /** `column-row` of the table anchor the module sits beside. */
  readonly key: string;
  readonly center: RoomPoint;
  readonly rotationY: number;
  readonly length: number;
  readonly depth: number;
  readonly seatHeight: number;
}

export interface SeatZone {
  readonly id: string;
  readonly label: string;
  /** Floor contact at the seat's own centre. */
  readonly center: RoomPoint;
  readonly rotationY: number;
  readonly size: PropSize;
}

export interface LoungeZone {
  readonly id: string;
  readonly center: RoomPoint;
  readonly rotationY: number;
  readonly width: number;
  readonly depth: number;
  readonly height: number;
}

export interface RailZone {
  readonly id: string;
  readonly center: RoomPoint;
  readonly length: number;
  readonly height: number;
}

/** The banquette runs, one per side wall, spanning the table rows. */
export function banquetteZones(input: FurniturePlanInput): readonly BanquetteZone[] {
  const anchors = tableAnchors(input);
  const zValues = anchors.map((anchor) => anchor.position.z);
  const minZ = Math.min(...zValues) - BANQUETTE_OVERHANG;
  const maxZ = Math.max(...zValues) + BANQUETTE_OVERHANG;
  const length = maxZ - minZ;
  const centreZ = (minZ + maxZ) / 2;
  const back = halfWidth(input) - WALL_INSET;
  const zones: BanquetteZone[] = [];
  for (const side of ['right', 'left'] as const) {
    const sign = side === 'right' ? 1 : -1;
    zones.push({
      id: `furniture:banquette:${side}`,
      side,
      center: { x: sign * (back - BANQUETTE_DEPTH / 2), y: 0, z: centreZ },
      rotationY: side === 'right' ? 0 : Math.PI,
      length,
      depth: BANQUETTE_DEPTH,
      seatHeight: input.spec.seating.banquette.seatHeight,
      backHeight: input.spec.seating.banquette.backHeight,
    });
  }
  return zones;
}

/** The facing booth unit in the front-right quadrant. */
export function boothZone(input: FurniturePlanInput): BoothZone {
  const back = halfWidth(input) - WALL_INSET;
  return {
    id: 'furniture:booth:right',
    center: { x: back - BOOTH_DEPTH / 2, y: 0, z: 4.35 },
    length: BOOTH_LENGTH,
    depth: BOOTH_DEPTH,
    seatHeight: input.spec.seating.booth.seatHeight,
    backHeight: input.spec.seating.booth.backHeight,
  };
}

/** Modular bench modules on the inner side of the Z-running table rows. */
export function benchZones(input: FurniturePlanInput): readonly BenchZone[] {
  const bench = input.spec.seating.bench;
  if (!bench) return [];
  const zones: BenchZone[] = [];
  for (const anchor of tableAnchors(input)) {
    if (anchor.seatAxis !== 'x' || anchor.communal) continue;
    const sign = anchor.position.x >= 0 ? 1 : -1;
    zones.push({
      id: `furniture:bench:${anchor.column}-${anchor.row}`,
      key: `${anchor.column}-${anchor.row}`,
      center: {
        x: anchor.position.x - sign * (anchor.halfX + CHAIR_GAP + bench.depth / 2),
        y: 0,
        z: anchor.position.z,
      },
      rotationY: anchor.position.x >= 0 ? Math.PI : 0,
      length: bench.length,
      depth: bench.depth,
      seatHeight: bench.seatHeight,
    });
  }
  return zones;
}

/** Loose chairs (and the communal run's three seats) for one era. */
export function chairZones(input: FurniturePlanInput): readonly SeatZone[] {
  const { chair } = input.spec.seating;
  const benchKeys = new Set(benchZones(input).map((zone) => zone.key));
  const zones: SeatZone[] = [];

  for (const anchor of tableAnchors(input)) {
    const sign = anchor.position.x >= 0 ? 1 : -1;
    if (anchor.communal) {
      const seats = Math.max(input.spec.seating.chairsPerSide, 1);
      for (let index = 0; index < seats; index += 1) {
        const t = seats === 1 ? 0 : index / (seats - 1) - 0.5;
        zones.push(
          seatZone(
            `furniture:chair:communal-c${anchor.column}-${index + 1}`,
            chair,
            {
              x: anchor.position.x - sign * (anchor.halfX + CHAIR_GAP + chair.seatDepth / 2),
              y: 0,
              z: anchor.position.z + t * anchor.halfZ * 1.24,
            },
            yawForDirection(sign, 0),
          ),
        );
      }
      continue;
    }

    if (anchor.seatAxis === 'x') {
      if (benchKeys.has(`${anchor.column}-${anchor.row}`)) continue;
      zones.push(
        seatZone(
          `furniture:chair:c${anchor.column}-r${anchor.row}-inner`,
          chair,
          {
            x: anchor.position.x - sign * (anchor.halfX + CHAIR_GAP + chair.seatDepth / 2),
            y: 0,
            z: anchor.position.z,
          },
          yawForDirection(-sign, 0),
        ),
      );
      continue;
    }

    for (const end of [-1, 1] as const) {
      zones.push(
        seatZone(
          `furniture:chair:c${anchor.column}-r${anchor.row}-${end > 0 ? 'far' : 'near'}`,
          chair,
          {
            x: anchor.position.x,
            y: 0,
            z: anchor.position.z + end * (anchor.halfZ + CHAIR_GAP + chair.seatDepth / 2),
          },
          yawForDirection(0, -end),
        ),
      );
    }
  }

  // A chair must never be planted inside the booth, whose two benches already
  // seat that corner; the plan drops it rather than pushing it into the aisle.
  const booth = boothZone(input);
  const boothRect = {
    minX: booth.center.x - booth.depth / 2 - 0.05,
    maxX: booth.center.x + booth.depth / 2 + 0.05,
    minZ: booth.center.z - booth.length / 2 - 0.05,
    maxZ: booth.center.z + booth.length / 2 + 0.05,
  };
  return zones.filter((zone) => !zoneOverlapsRect(zone, boothRect));
}

function zoneOverlapsRect(zone: SeatZone, rect: { minX: number; maxX: number; minZ: number; maxZ: number }): boolean {
  const cos = Math.abs(Math.cos(zone.rotationY));
  const sin = Math.abs(Math.sin(zone.rotationY));
  const halfX = (zone.size.x * cos + zone.size.z * sin) / 2;
  const halfZ = (zone.size.x * sin + zone.size.z * cos) / 2;
  return (
    zone.center.x - halfX < rect.maxX &&
    rect.minX < zone.center.x + halfX &&
    zone.center.z - halfZ < rect.maxZ &&
    rect.minZ < zone.center.z + halfZ
  );
}

function seatZone(id: string, chair: ChairSpec, center: RoomPoint, rotationY: number): SeatZone {
  return {
    id,
    label: chair.label,
    center,
    rotationY,
    size: { x: chair.seatWidth, y: chair.seatHeight + chair.backHeight, z: chair.seatDepth },
  };
}

/** Counter stools, split either side of the service lane. */
export function stoolZones(input: FurniturePlanInput): readonly SeatZone[] {
  const stools = input.spec.seating.stools;
  const z = input.layout.counter.serviceFaceZ + COUNTER_STOOL_STAND_OFF;
  return COUNTER_STOOL_X.slice(0, Math.max(Math.min(stools.count, COUNTER_STOOL_X.length), 0)).map(
    (x, index) => ({
      id: `furniture:stool:counter-${index + 1}`,
      label: stools.style,
      center: { x, y: 0, z },
      rotationY: yawForDirection(0, -1),
      size: { x: stools.radius * 2, y: stools.seatHeight + stools.radius * 0.9, z: stools.radius * 2 },
    }),
  );
}

/** The window bay: two seats, their table and — in 2025 — the standing rail. */
export function windowSeatZones(input: FurniturePlanInput): readonly SeatZone[] {
  const { spec } = input;
  if (spec.seating.standingRail) {
    return WINDOW_SEAT_X.map((x, index) => ({
      id: `furniture:stool:window-${index + 1}`,
      label: 'Reclaimed-timber perch stool',
      center: { x, y: 0, z: PERCH_STOOL_Z },
      rotationY: 0,
      size: { x: spec.seating.stools.radius * 2, y: spec.seating.stools.seatHeight, z: spec.seating.stools.radius * 2 },
    }));
  }
  const chair = spec.seating.lounge
    ? loungeChairSpec(spec.seating.lounge)
    : spec.seating.accentChair ?? spec.seating.chair;
  return WINDOW_SEAT_X.map((x, index) => seatZone(`furniture:chair:window-${index + 1}`, chair, { x, y: 0, z: WINDOW_SEAT_Z }, Math.PI));
}

/** A chair-shaped adapter for a lounge armchair, so seating plans stay uniform. */
function loungeChairSpec(lounge: NonNullable<FurniturePlanInput['spec']['seating']['lounge']>): ChairSpec {
  return {
    kind: 'upholstered-lounge',
    label: lounge.armchairLabel,
    frameSlot: lounge.legSlot,
    seatSlot: lounge.armchairSlot,
    backSlot: lounge.armchairSlot,
    seatHeight: lounge.seatHeight,
    seatWidth: lounge.width,
    seatDepth: lounge.depth,
    backHeight: lounge.height - lounge.seatHeight,
    stackable: false,
    joinery: lounge.joinery,
  };
}

/** The lounge group's low table. */
export function loungeTableZone(
  input: FurniturePlanInput,
): { center: RoomPoint; radius: number; height: number } | null {
  const lounge = input.spec.seating.lounge;
  if (!lounge || lounge.tableRadius <= 0) return null;
  return {
    center: { x: WINDOW_TABLE.x, y: 0, z: WINDOW_TABLE.z },
    radius: lounge.tableRadius,
    height: lounge.tableHeight,
  };
}

/** The era's standing / perch rail along the window bay. */
export function railZone(input: FurniturePlanInput): RailZone | null {
  const rail = input.spec.seating.standingRail;
  if (!rail) return null;
  const length = (WINDOW_SEAT_X[1] ?? 0) - (WINDOW_SEAT_X[0] ?? 0) + rail.length;
  return {
    id: 'furniture:rail:window',
    center: { x: WINDOW_TABLE.x, y: 0, z: WINDOW_RAIL_Z },
    length,
    height: rail.height,
  };
}

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

function floorEntry(
  id: string,
  kind: PropPlanEntry['kind'],
  label: string,
  center: RoomPoint,
  size: PropSize,
  rotationY: number,
  tags: readonly string[],
): PropPlanEntry {
  return {
    id,
    kind,
    group: 'seating',
    label,
    center: { x: center.x, y: size.y / 2, z: center.z },
    size,
    rotationY,
    support: 'floor',
    tags,
  };
}

/** Every seating placement of one era, without building anything. */
export function planSeating(input: FurniturePlanInput): readonly PropPlanEntry[] {
  const { spec } = input;
  const entries: PropPlanEntry[] = [];

  for (const zone of banquetteZones(input)) {
    entries.push(
      floorEntry(
        zone.id,
        'banquette',
        spec.seating.banquette.style,
        zone.center,
        { x: zone.depth, y: zone.backHeight, z: zone.length },
        zone.rotationY,
        [spec.seating.banquette.kind, `side:${zone.side}`, `length:${zone.length.toFixed(2)}`],
      ),
    );
  }

  const booth = boothZone(input);
  entries.push(
    floorEntry(
      booth.id,
      'booth',
      spec.seating.booth.style,
      booth.center,
      { x: booth.depth, y: booth.backHeight, z: booth.length },
      0,
      [spec.seating.booth.kind],
    ),
  );

  for (const zone of chairZones(input)) {
    entries.push(floorEntry(zone.id, 'chair', zone.label, zone.center, zone.size, zone.rotationY, [spec.seating.chair.kind]));
  }

  for (const zone of windowSeatZones(input)) {
    const kind = spec.seating.standingRail ? 'stool' : 'chair';
    const tag = spec.seating.standingRail
      ? 'perch-stool'
      : spec.seating.lounge
        ? spec.seating.lounge.kind
        : (spec.seating.accentChair ?? spec.seating.chair).kind;
    entries.push(floorEntry(zone.id, kind, zone.label, zone.center, zone.size, zone.rotationY, [tag]));
  }

  for (const zone of benchZones(input)) {
    entries.push(
      floorEntry(zone.id, 'bench', spec.seating.bench?.style ?? 'bench', zone.center, {
        x: zone.depth,
        y: zone.seatHeight + 0.08,
        z: zone.length,
      }, zone.rotationY, [spec.seating.bench?.kind ?? 'bench']),
    );
  }

  for (const zone of stoolZones(input)) {
    entries.push(floorEntry(zone.id, 'stool', zone.label, zone.center, zone.size, zone.rotationY, [spec.seating.stools.kind]));
  }

  const loungeTable = loungeTableZone(input);
  if (loungeTable) {
    entries.push(
      floorEntry(
        'furniture:lounge-table',
        'lounge',
        spec.seating.lounge?.style ?? 'lounge table',
        loungeTable.center,
        { x: loungeTable.radius * 2, y: loungeTable.height, z: loungeTable.radius * 2 },
        0,
        ['lounge-table'],
      ),
    );
  } else if (!spec.seating.lounge && !spec.seating.standingRail) {
    entries.push(
      floorEntry(
        'furniture:window-table',
        'table',
        'Window table',
        { x: WINDOW_TABLE.x, y: 0, z: WINDOW_TABLE.z },
        { x: WINDOW_TABLE.radius * 2, y: WINDOW_TABLE.height, z: WINDOW_TABLE.radius * 2 },
        0,
        ['window-table'],
      ),
    );
  }

  const rail = railZone(input);
  if (rail) {
    entries.push(
      floorEntry(
        rail.id,
        'standing-rail',
        spec.seating.standingRail?.style ?? 'standing rail',
        rail.center,
        { x: rail.length, y: rail.height, z: 0.14 },
        0,
        [spec.seating.standingRail?.kind ?? 'rail'],
      ),
    );
  }

  return entries;
}


/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function partName(id: string, part: string): string {
  return `${id}:${part}`;
}

function chairLegs(
  chair: ChairSpec,
  frame: THREE.Material,
  options: { readonly radius: number; readonly splay: number; readonly tapered?: boolean },
): THREE.Object3D[] {
  const parts: THREE.Object3D[] = [];
  const spreadX = chair.seatWidth / 2 - options.radius * 1.6;
  const spreadZ = chair.seatDepth / 2 - options.radius * 1.6;
  // Two millimetres of toe gap: a splayed leg must not sink into the floor.
  const height = chair.seatHeight - 0.024;
  for (const signX of [-1, 1]) {
    for (const signZ of [-1, 1]) {
      const x = signX * spreadX;
      const z = signZ * spreadZ;
      parts.push(
        cylinderMesh(
          options.tapered ? options.radius * 0.7 : options.radius,
          options.radius,
          height,
          frame,
          {
            name: partName(chair.kind, 'leg'),
            part: 'chair-leg',
            position: [x, height / 2 + 0.004, z],
            rotation: [signZ * options.splay, 0, -signX * options.splay],
          },
        ),
      );
      if (options.splay > 0.1) {
        parts.push(
          cylinderMesh(options.radius * 1.1, options.radius * 1.1, 0.016, frame, {
            name: partName(chair.kind, 'glide'),
            part: 'chair-glide',
            position: [x + signX * options.splay * 0.28, 0.008, z + signZ * options.splay * 0.28],
          }),
        );
      }
    }
  }
  return parts;
}

/** One loose chair, built to the era's chair spec. */
export function buildChair(
  chair: ChairSpec,
  materials: Parameters<typeof furnitureMaterial>[0],
  id: string,
): THREE.Group {
  const group = new THREE.Group();
  group.name = id;
  group.userData.furnitureKind = 'chair';
  const frame = furnitureMaterial(materials, chair.frameSlot);
  const seat = furnitureMaterial(materials, chair.seatSlot);
  const back = furnitureMaterial(materials, chair.backSlot);
  const add = (...parts: THREE.Object3D[]): void => {
    for (const part of parts) group.add(part);
  };

  switch (chair.kind) {
    case 'bentwood-cane': {
      add(...chairLegs(chair, frame, { radius: 0.016, splay: 0.1 }));
      add(
        torusMesh(chair.seatWidth / 2 - 0.012, 0.014, frame, {
          name: partName(id, 'seat-ring'),
          part: 'chair-seat-ring',
          position: [0, chair.seatHeight - 0.01, 0],
          rotation: [Math.PI / 2, 0, 0],
          scale: [1, chair.seatDepth / chair.seatWidth, 1],
        }),
        cylinderMesh(chair.seatWidth * 0.47, chair.seatWidth * 0.47, 0.018, seat, {
          name: partName(id, 'cane-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight, 0],
          scale: [1, 1, chair.seatDepth / chair.seatWidth],
        }),
      );
      for (const sign of [-1, 1]) {
        add(
          cylinderMesh(0.015, 0.017, chair.backHeight + 0.08, frame, {
            name: partName(id, 'back-stile'),
            part: 'chair-back-stile',
            position: [sign * (chair.seatWidth * 0.44), chair.seatHeight + (chair.backHeight + 0.08) / 2 - 0.04, -0.04],
            rotation: [0.14, 0, sign * 0.06],
          }),
        );
      }
      add(
        torusMesh(chair.seatWidth * 0.46, 0.016, frame, {
          name: partName(id, 'back-hoop'),
          part: 'chair-back-hoop',
          position: [0, chair.seatHeight + chair.backHeight - 0.04, -0.09],
          rotation: [Math.PI / 2, 0, 0],
        }, 22),
        boxMesh([chair.seatWidth * 0.9, 0.03, 0.02], frame, {
          name: partName(id, 'back-mid-rail'),
          part: 'chair-back-rail',
          position: [0, chair.seatHeight + chair.backHeight * 0.45, -0.06],
        }),
      );
      break;
    }

    case 'tubular-metal': {
      add(...chairLegs(chair, frame, { radius: 0.012, splay: 0.14 }));
      add(
        boxMesh([chair.seatWidth * 0.94, 0.03, chair.seatDepth * 0.94], seat, {
          name: partName(id, 'pressed-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight, 0],
        }),
        boxMesh([chair.seatWidth * 0.9, 0.026, 0.03], frame, {
          name: partName(id, 'seat-frame'),
          part: 'chair-seat-frame',
          position: [0, chair.seatHeight - 0.03, -chair.seatDepth * 0.46],
        }),
      );
      for (const sign of [-1, 1]) {
        add(
          cylinderMesh(0.012, 0.012, chair.backHeight, frame, {
            name: partName(id, 'back-tube'),
            part: 'chair-back-tube',
            position: [sign * (chair.seatWidth * 0.42), chair.seatHeight + chair.backHeight / 2, -0.05],
            rotation: [0.1, 0, 0],
          }),
        );
      }
      add(
        torusMesh(chair.seatWidth * 0.42, 0.013, frame, {
          name: partName(id, 'back-hoop'),
          part: 'chair-back-hoop',
          position: [0, chair.seatHeight + chair.backHeight - 0.03, -0.08],
          rotation: [Math.PI / 2, 0, 0],
        }, 22),
      );
      break;
    }

    case 'vinyl-diner': {
      add(...chairLegs(chair, frame, { radius: 0.014, splay: 0.12 }));
      add(
        boxMesh([chair.seatWidth * 0.92, 0.09, chair.seatDepth * 0.92], seat, {
          name: partName(id, 'seat-pad'),
          part: 'chair-seat',
          position: [0, chair.seatHeight - 0.02, 0],
        }),
        boxMesh([chair.seatWidth * 0.84, 0.09, chair.seatDepth * 0.42], back, {
          name: partName(id, 'back-pad'),
          part: 'chair-back',
          position: [0, chair.seatHeight + chair.backHeight * 0.42, -chair.seatDepth * 0.38],
          rotation: [0.16, 0, 0],
        }),
        boxMesh([chair.seatWidth * 0.88, 0.022, 0.022], frame, {
          name: partName(id, 'back-frame'),
          part: 'chair-back-frame',
          position: [0, chair.seatHeight + chair.backHeight - 0.02, -chair.seatDepth * 0.44],
        }),
      );
      // Two piping seams, so the vinyl reads as upholstery up close.
      for (const sign of [-1, 1]) {
        add(
          boxMesh([0.012, 0.012, chair.seatDepth * 0.8], frame, {
            name: partName(id, 'seat-piping'),
            part: 'chair-piping',
            position: [sign * chair.seatWidth * 0.44, chair.seatHeight + 0.02, 0],
          }),
        );
      }
      break;
    }

    case 'stacking-polypropylene': {
      add(...chairLegs(chair, frame, { radius: 0.017, splay: 0.12, tapered: true }));
      add(
        boxMesh([chair.seatWidth * 0.96, 0.035, chair.seatDepth * 0.94], seat, {
          name: partName(id, 'shell-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight, 0],
        }),
        boxMesh([chair.seatWidth * 0.94, chair.backHeight * 0.8, 0.035], back, {
          name: partName(id, 'shell-back'),
          part: 'chair-back',
          position: [0, chair.seatHeight + chair.backHeight * 0.45, -chair.seatDepth * 0.44],
          rotation: [0.12, 0, 0],
        }),
        boxMesh([chair.seatWidth * 0.9, 0.03, 0.04], frame, {
          name: partName(id, 'stacking-rail'),
          part: 'chair-stacking-rail',
          position: [0, chair.seatHeight - 0.06, -chair.seatDepth * 0.42],
        }),
      );
      break;
    }

    case 'chrome-moulded-shell': {
      for (const sign of [-1, 1]) {
        add(
          cylinderMesh(0.012, 0.012, chair.seatDepth * 0.92, frame, {
            name: partName(id, 'sled-runner'),
            part: 'chair-sled',
            position: [sign * (chair.seatWidth * 0.38), 0.012, 0],
            rotation: [Math.PI / 2, 0, 0],
          }),
          cylinderMesh(0.011, 0.011, chair.seatHeight - 0.02, frame, {
            name: partName(id, 'sled-post'),
            part: 'chair-sled-post',
            position: [sign * (chair.seatWidth * 0.38), chair.seatHeight / 2, -chair.seatDepth * 0.3],
            rotation: [0.22, 0, 0],
          }),
        );
      }
      add(
        boxMesh([chair.seatWidth * 0.94, 0.04, chair.seatDepth * 0.9], seat, {
          name: partName(id, 'shell-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight, 0],
        }),
        boxMesh([chair.seatWidth * 0.92, chair.backHeight, 0.04], back, {
          name: partName(id, 'shell-back'),
          part: 'chair-back',
          position: [0, chair.seatHeight + chair.backHeight / 2, -chair.seatDepth * 0.42],
          rotation: [0.14, 0, 0],
        }),
      );
      break;
    }

    case 'plywood-shell': {
      add(...chairLegs(chair, frame, { radius: 0.011, splay: 0.1 }));
      add(
        boxMesh([chair.seatWidth * 0.96, 0.028, chair.seatDepth * 0.94], seat, {
          name: partName(id, 'ply-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight, 0],
        }),
        boxMesh([chair.seatWidth * 0.94, chair.backHeight * 0.86, 0.026], back, {
          name: partName(id, 'ply-back'),
          part: 'chair-back',
          position: [0, chair.seatHeight + chair.backHeight * 0.47, -chair.seatDepth * 0.42],
          rotation: [0.15, 0, 0],
        }),
        boxMesh([0.02, chair.backHeight * 0.86, 0.02], frame, {
          name: partName(id, 'back-brace'),
          part: 'chair-back-brace',
          position: [0, chair.seatHeight + chair.backHeight * 0.4, -chair.seatDepth * 0.46],
        }),
      );
      break;
    }

    case 'moulded-shell': {
      add(...chairLegs(chair, frame, { radius: 0.013, splay: 0.11 }));
      add(
        boxMesh([chair.seatWidth * 0.98, 0.045, chair.seatDepth * 0.96], seat, {
          name: partName(id, 'moulded-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight, 0],
        }),
        boxMesh([chair.seatWidth * 0.96, chair.backHeight * 0.92, 0.05], back, {
          name: partName(id, 'moulded-back'),
          part: 'chair-back',
          position: [0, chair.seatHeight + chair.backHeight * 0.5, -chair.seatDepth * 0.4],
          rotation: [0.18, 0, 0],
        }),
        torusMesh(chair.seatWidth * 0.46, 0.024, back, {
          name: partName(id, 'shell-lip'),
          part: 'chair-back-lip',
          position: [0, chair.seatHeight + chair.backHeight * 0.48, -chair.seatDepth * 0.32],
          rotation: [Math.PI / 2.6, 0, 0],
        }, 22),
      );
      break;
    }

    case 'upholstered-lounge':
    default: {
      const width = chair.seatWidth;
      const depth = chair.seatDepth;
      add(
        boxMesh([width * 0.9, 0.2, depth * 0.88], seat, {
          name: partName(id, 'lounge-seat'),
          part: 'chair-seat',
          position: [0, chair.seatHeight - 0.1, 0.02],
        }),
        boxMesh([width * 0.88, chair.backHeight * 0.95, 0.16], back, {
          name: partName(id, 'lounge-back'),
          part: 'chair-back',
          position: [0, chair.seatHeight + chair.backHeight * 0.45, -depth * 0.42],
          rotation: [0.14, 0, 0],
        }),
      );
      for (const sign of [-1, 1]) {
        add(
          boxMesh([0.12, 0.2, depth * 0.82], seat, {
            name: partName(id, 'lounge-arm'),
            part: 'chair-arm',
            position: [sign * width * 0.44, chair.seatHeight, 0.02],
          }),
          boxMesh([0.05, 0.12, 0.05], frame, {
            name: partName(id, 'lounge-leg'),
            part: 'chair-leg',
            position: [sign * width * 0.4, 0.06, -depth * 0.34],
          }),
          boxMesh([0.05, 0.12, 0.05], frame, {
            name: partName(id, 'lounge-leg'),
            part: 'chair-leg',
            position: [sign * width * 0.4, 0.06, depth * 0.34],
          }),
        );
      }
      break;
    }
  }

  return group;
}

/** The fixed banquette run of one side wall. */
export function buildBanquette(
  zone: BanquetteZone,
  input: FurnitureBuildInput,
): THREE.Group {
  const { banquette } = input.spec.seating;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'banquette';
  const seat = furnitureMaterial(input.materials, banquette.seatSlot);
  const back = furnitureMaterial(input.materials, banquette.backSlot);
  const plinth = furnitureMaterial(input.materials, banquette.plinthSlot);
  const trim = banquette.trimSlot ? furnitureMaterial(input.materials, banquette.trimSlot) : plinth;
  const depth = zone.depth;
  const length = zone.length;

  group.add(
    boxMesh([depth - 0.12, 0.26, length - 0.05], plinth, {
      name: partName(zone.id, 'plinth'),
      part: 'banquette-plinth',
      position: [0.06, 0.13, 0],
    }),
    boxMesh([0.05, 0.1, length - 0.05], trim, {
      name: partName(zone.id, 'kick'),
      part: 'banquette-kick',
      position: [-depth / 2 + 0.03, 0.05, 0],
    }),
    boxMesh([depth - 0.18, 0.18, length - 0.03], seat, {
      name: partName(zone.id, 'seat'),
      part: 'banquette-seat',
      position: [-0.02, zone.seatHeight - 0.09, 0],
    }),
    boxMesh([0.16, zone.backHeight - zone.seatHeight + 0.05, length - 0.03], back, {
      name: partName(zone.id, 'back'),
      part: 'banquette-back',
      position: [depth / 2 - 0.09, (zone.backHeight + zone.seatHeight) / 2 + 0.02, 0],
      rotation: [0, 0, -0.06],
    }),
  );

  // Upholstery panels, each with its own buttons: the era's joinery detail.
  const panels = Math.max(Math.round(length / 2), 2);
  const panelLength = length / panels;
  for (let index = 0; index < panels; index += 1) {
    const centreZ = -length / 2 + panelLength * (index + 0.5);
    if (index > 0) {
      group.add(
        boxMesh([0.05, zone.backHeight - zone.seatHeight, 0.025], trim, {
          name: partName(zone.id, 'panel-seam'),
          part: 'banquette-seam',
          position: [depth / 2 - 0.18, (zone.backHeight + zone.seatHeight) / 2, -length / 2 + panelLength * index],
        }),
      );
    }
    for (let button = 0; button < Math.max(Math.min(banquette.buttons, 3), 0); button += 1) {
      const offset = (button - (banquette.buttons - 1) / 2) * 0.28;
      group.add(
        cylinderMesh(0.016, 0.016, 0.012, trim, {
          name: partName(zone.id, 'button'),
          part: 'banquette-button',
          position: [depth / 2 - 0.17, zone.seatHeight + 0.22, centreZ + offset],
          rotation: [0, 0, Math.PI / 2],
        }, 10),
      );
    }
  }

  for (const end of [-1, 1]) {
    group.add(
      boxMesh([0.13, 0.24, 0.1], seat, {
        name: partName(zone.id, 'arm'),
        part: 'banquette-arm',
        position: [-depth / 2 + 0.08, zone.seatHeight + 0.11, end * (length / 2 - 0.05)],
      }),
    );
  }

  return group;
}

/** The facing booth unit: two upholstered benches and their table. */
export function buildBooth(zone: BoothZone, input: FurnitureBuildInput): THREE.Group {
  const { booth } = input.spec.seating;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'booth';
  const bench = furnitureMaterial(input.materials, booth.benchSlot);
  const frame = furnitureMaterial(input.materials, booth.frameSlot);
  const table = furnitureMaterial(input.materials, booth.tableSlot);
  const tableTop = furnitureMaterial(input.materials, booth.tableSurfaceSlot);
  const tableHeight = input.layout.tableSlots[0]?.surfaceHeight ?? 0.74;
  const length = zone.length;
  const depth = zone.depth;

  for (const sign of [-1, 1]) {
    const benchX = sign * (depth / 2 - 0.34);
    group.add(
      boxMesh([0.62, 0.28, length - 0.12], frame, {
        name: partName(zone.id, 'bench-plinth'),
        part: 'booth-plinth',
        position: [benchX, 0.14, 0],
      }),
      boxMesh([0.64, 0.16, length - 0.06], bench, {
        name: partName(zone.id, 'bench-seat'),
        part: 'booth-seat',
        position: [benchX, zone.seatHeight - 0.08, 0],
      }),
      boxMesh([0.15, zone.backHeight - zone.seatHeight + 0.04, length - 0.06], bench, {
        name: partName(zone.id, 'bench-back'),
        part: 'booth-back',
        position: [sign * (depth / 2 - 0.08), (zone.backHeight + zone.seatHeight) / 2 + 0.01, 0],
        rotation: [0, 0, -sign * 0.05],
      }),
    );
    // A stitched seam down the back panel.
    group.add(
      boxMesh([0.02, zone.backHeight - zone.seatHeight - 0.06, 0.03], frame, {
        name: partName(zone.id, 'back-seam'),
        part: 'booth-seam',
        position: [sign * (depth / 2 - 0.15), (zone.backHeight + zone.seatHeight) / 2, 0],
      }),
    );
  }

  group.add(
    boxMesh([0.66, 0.05, length * 0.86], tableTop, {
      name: partName(zone.id, 'table-top'),
      part: 'booth-table-top',
      position: [0, tableHeight - 0.025, 0],
    }),
    boxMesh([0.66, 0.03, length * 0.86 - 0.08], table, {
      name: partName(zone.id, 'table-apron'),
      part: 'booth-table-apron',
      position: [0, tableHeight - 0.065, 0],
    }),
    boxMesh([0.09, tableHeight - 0.09, 0.09], table, {
      name: partName(zone.id, 'table-column'),
      part: 'booth-table-column',
      position: [0, (tableHeight - 0.09) / 2, 0],
    }),
    boxMesh([0.46, 0.03, 0.46], table, {
      name: partName(zone.id, 'table-foot'),
      part: 'booth-table-foot',
      position: [0, 0.015, 0],
    }),
  );

  for (const end of [-1, 1]) {
    group.add(
      boxMesh([depth - 0.06, 0.78, 0.055], frame, {
        name: partName(zone.id, 'divider'),
        part: 'booth-divider',
        position: [0, 0.39, end * (length / 2 - 0.03)],
      }),
      boxMesh([depth - 0.02, 0.04, 0.075], furnitureMaterial(input.materials, 'accent'), {
        name: partName(zone.id, 'divider-cap'),
        part: 'booth-divider-cap',
        position: [0, 0.8, end * (length / 2 - 0.03)],
      }),
    );
  }

  return group;
}

/** A free-standing modular bench module. */
export function buildBench(zone: BenchZone, input: FurnitureBuildInput): THREE.Group {
  const bench = input.spec.seating.bench;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'bench';
  if (!bench) return group;
  const seat = furnitureMaterial(input.materials, bench.seatSlot);
  const frame = furnitureMaterial(input.materials, bench.frameSlot);
  const depth = zone.depth;
  const length = zone.length;

  group.add(
    boxMesh([depth - 0.04, 0.06, length], frame, {
      name: partName(zone.id, 'bench-rail'),
      part: 'bench-rail',
      position: [0, zone.seatHeight - 0.04, 0],
    }),
    boxMesh([0.07, 0.32, length - 0.04], seat, {
      name: partName(zone.id, 'bench-back'),
      part: 'bench-back',
      position: [depth / 2 - 0.05, zone.seatHeight + 0.16, 0],
      rotation: [0, 0, -0.05],
    }),
  );
  // Modular pads: two seat cushions on a steel frame.
  for (const end of [-1, 1]) {
    group.add(
      boxMesh([depth - 0.08, 0.06, length / 2 - 0.12], seat, {
        name: partName(zone.id, 'bench-pad'),
        part: 'bench-pad',
        position: [0, zone.seatHeight + 0.03, end * (length / 4)],
      }),
      boxMesh([0.05, zone.seatHeight - 0.06, 0.05], frame, {
        name: partName(zone.id, 'bench-leg'),
        part: 'bench-leg',
        position: [depth / 2 - 0.07, (zone.seatHeight - 0.06) / 2, end * (length / 2 - 0.1)],
      }),
      boxMesh([0.05, zone.seatHeight - 0.06, 0.05], frame, {
        name: partName(zone.id, 'bench-leg'),
        part: 'bench-leg',
        position: [-depth / 2 + 0.07, (zone.seatHeight - 0.06) / 2, end * (length / 2 - 0.1)],
      }),
    );
  }
  return group;
}

/** One counter stool, built to the era's stool spec. */
export function buildStool(zone: SeatZone, input: FurnitureBuildInput): THREE.Group {
  const stools = input.spec.seating.stools;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'stool';
  const seat = furnitureMaterial(input.materials, stools.seatSlot);
  const frame = furnitureMaterial(input.materials, stools.frameSlot);
  const radius = stools.radius;
  const height = stools.seatHeight;
  const add = (...parts: THREE.Object3D[]): void => {
    for (const part of parts) group.add(part);
  };

  switch (stools.kind) {
    case 'timber-round':
    case 'reclaimed-timber': {
      const timber = stools.kind === 'reclaimed-timber';
      for (const sign of [-1, 1]) {
        add(
          boxMesh([0.045, height - 0.05, 0.05], frame, {
            name: partName(zone.id, 'stool-leg'),
            part: 'stool-leg',
            position: [sign * (radius * 0.72), (height - 0.05) / 2, 0.08],
            rotation: [0, 0, -sign * 0.1],
          }),
          boxMesh([0.045, height - 0.05, 0.05], frame, {
            name: partName(zone.id, 'stool-leg'),
            part: 'stool-leg',
            position: [sign * (radius * 0.72), (height - 0.05) / 2, -0.08],
            rotation: [0, 0, -sign * 0.1],
          }),
          boxMesh([0.06, 0.02, 0.26], frame, {
            name: partName(zone.id, 'stool-foot'),
            part: 'stool-foot',
            position: [sign * (radius * 0.8), 0.01, 0],
          }),
        );
      }
      add(
        boxMesh([radius * 1.6, 0.035, 0.05], frame, {
          name: partName(zone.id, 'stool-stretcher'),
          part: 'stool-stretcher',
          position: [0, height * 0.36, 0],
        }),
        cylinderMesh(radius, radius, timber ? 0.045 : 0.04, seat, {
          name: partName(zone.id, 'stool-seat'),
          part: 'stool-seat',
          position: [0, height - (timber ? 0.02 : 0.02), 0],
        }, 20),
      );
      break;
    }

    case 'chrome-vinyl':
    case 'leather-bar': {
      const columnHeight = height - 0.06;
      if (stools.footRail) {
        add(
          torusMesh(0.14, 0.011, frame, {
            name: partName(zone.id, 'stool-footrest'),
            part: 'stool-footrest',
            position: [0, height * 0.35, 0],
            rotation: [Math.PI / 2, 0, 0],
          }),
        );
      }
      add(
        cylinderMesh(0.022, 0.028, columnHeight, frame, {
          name: partName(zone.id, 'stool-column'),
          part: 'stool-column',
          position: [0, columnHeight / 2, 0],
        }),
        torusMesh(0.16, 0.012, frame, {
          name: partName(zone.id, 'stool-base-ring'),
          part: 'stool-base',
          position: [0, 0.02, 0],
          rotation: [Math.PI / 2, 0, 0],
        }),
      );
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        add(
          cylinderMesh(0.011, 0.013, 0.2, frame, {
            name: partName(zone.id, 'stool-leg'),
            part: 'stool-leg',
            position: [Math.cos(angle) * 0.12, 0.09, Math.sin(angle) * 0.12],
            rotation: [Math.sin(angle) * 0.7, 0, -Math.cos(angle) * 0.7],
          }),
        );
      }
      add(
        cylinderMesh(radius, radius, 0.07, seat, {
          name: partName(zone.id, 'stool-cushion'),
          part: 'stool-seat',
          position: [0, height - 0.02, 0],
        }, 20),
        torusMesh(radius, 0.01, frame, {
          name: partName(zone.id, 'stool-cushion-seam'),
          part: 'stool-seam',
          position: [0, height - 0.02, 0],
          rotation: [Math.PI / 2, 0, 0],
        }),
      );
      break;
    }

    case 'moulded-polypropylene':
    default: {
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        add(
          cylinderMesh(0.013, 0.015, height - 0.03, frame, {
            name: partName(zone.id, 'stool-leg'),
            part: 'stool-leg',
            position: [Math.cos(angle) * (radius * 0.62), (height - 0.03) / 2, Math.sin(angle) * (radius * 0.62)],
            rotation: [Math.sin(angle) * 0.14, 0, -Math.cos(angle) * 0.14],
          }),
        );
      }
      add(
        cylinderMesh(radius, radius * 0.92, 0.05, seat, {
          name: partName(zone.id, 'stool-seat'),
          part: 'stool-seat',
          position: [0, height, 0],
        }, 20),
        boxMesh([radius * 1.5, 0.16, 0.04], seat, {
          name: partName(zone.id, 'stool-back'),
          part: 'stool-back',
          position: [0, height + 0.14, -radius * 0.55],
          rotation: [0.16, 0, 0],
        }),
        ...(stools.footRail
          ? [
              torusMesh(radius * 0.9, 0.012, frame, {
                name: partName(zone.id, 'stool-footrest'),
                part: 'stool-footrest',
                position: [0, height * 0.32, 0],
                rotation: [Math.PI / 2, 0, 0],
              }),
            ]
          : []),
      );
      break;
    }
  }

  return group;
}

/** A small round table: the window table or the lounge group's low table. */
export function buildRoundTable(
  id: string,
  center: RoomPoint,
  radius: number,
  height: number,
  top: THREE.Material,
  frame: THREE.Material,
): THREE.Group {
  const group = new THREE.Group();
  group.name = id;
  group.userData.furnitureKind = 'table';
  group.position.set(center.x, 0, center.z);
  group.add(
    cylinderMesh(radius, radius, 0.045, top, {
      name: partName(id, 'top'),
      part: 'table-top',
      position: [0, height - 0.022, 0],
    }, 24),
    cylinderMesh(0.028, 0.034, height - 0.05, frame, {
      name: partName(id, 'column'),
      part: 'table-column',
      position: [0, (height - 0.05) / 2, 0],
    }),
    cylinderMesh(radius * 0.5, radius * 0.55, 0.022, frame, {
      name: partName(id, 'foot'),
      part: 'table-foot',
      position: [0, 0.011, 0],
    }, 20),
    torusMesh(radius, 0.008, frame, {
      name: partName(id, 'edge-ring'),
      part: 'table-edge-band',
      position: [0, height - 0.03, 0],
      rotation: [Math.PI / 2, 0, 0],
    }, 24),
  );
  return group;
}

/** The 2025 standing rail: a perch rail along the window bay. */
export function buildRail(zone: RailZone, input: FurnitureBuildInput): THREE.Group {
  const rail = input.spec.seating.standingRail;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'standing-rail';
  if (!rail) return group;
  const top = furnitureMaterial(input.materials, rail.topSlot);
  const frame = furnitureMaterial(input.materials, rail.frameSlot);
  group.add(
    boxMesh([zone.length, 0.05, 0.15], top, {
      name: partName(zone.id, 'rail-top'),
      part: 'rail-top',
      position: [0, zone.height, 0],
    }),
    boxMesh([zone.length - 0.2, 0.03, 0.03], frame, {
      name: partName(zone.id, 'rail-stretcher'),
      part: 'rail-stretcher',
      position: [0, zone.height * 0.35, 0],
    }),
  );
  for (const end of [-1, 1]) {
    const x = end * (zone.length / 2 - 0.08);
    group.add(
      boxMesh([0.05, zone.height, 0.05], frame, {
        name: partName(zone.id, 'rail-post'),
        part: 'rail-post',
        position: [x, zone.height / 2, 0],
      }),
      boxMesh([0.07, 0.02, 0.28], frame, {
        name: partName(zone.id, 'rail-foot'),
        part: 'rail-foot',
        position: [x, 0.01, 0],
      }),
    );
  }
  return group;
}

/** Raises the meshes for the planned seating entries. */
export function buildSeating(
  input: FurnitureBuildInput,
  entries: readonly PropPlanEntry[],
): PropBuildResult {
  const group = new THREE.Group();
  group.name = 'furniture-seating';
  const props: PlacedProp[] = [];
  const landmarks: Record<string, THREE.Object3D> = {};
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const { spec } = input;

  const place = (id: string): PropPlanEntry => {
    const entry = byId.get(id);
    if (!entry) throw new Error(`Missing the planned seating entry "${id}".`);
    return entry;
  };
  const commit = (entry: PropPlanEntry, node: THREE.Object3D, landmark?: string): void => {
    node.position.set(entry.center.x, 0, entry.center.z);
    node.rotation.y = entry.rotationY;
    group.add(node);
    props.push({ ...entry, node });
    if (landmark) landmarks[landmark] = node;
  };

  for (const zone of banquetteZones(input)) {
    commit(place(zone.id), buildBanquette(zone, input), `banquette-${zone.side}`);
  }

  const booth = boothZone(input);
  commit(place(booth.id), buildBooth(booth, input), 'booth');

  for (const zone of chairZones(input)) {
    const chair = buildChair(spec.seating.chair, input.materials, zone.id);
    commit(place(zone.id), chair, zone.id.includes('c1-r1') ? 'chair-field' : undefined);
  }

  for (const zone of windowSeatZones(input)) {
    if (spec.seating.standingRail) {
      // Perch stools at the rail reuse the era's counter stool build.
      commit(place(zone.id), buildStool(zone, input), 'window-perch');
      continue;
    }
    const chairSpec = spec.seating.lounge
      ? loungeChairSpec(spec.seating.lounge)
      : spec.seating.accentChair ?? spec.seating.chair;
    const node = buildChair(chairSpec, input.materials, zone.id);
    commit(place(zone.id), node, zone.id.endsWith('1') ? (spec.seating.lounge ? 'lounge' : 'window-seat') : undefined);
  }

  for (const zone of benchZones(input)) {
    commit(place(zone.id), buildBench(zone, input), zone.id.endsWith('-1') ? 'bench' : undefined);
  }

  for (const zone of stoolZones(input)) {
    commit(place(zone.id), buildStool(zone, input), zone.id.endsWith('-1') ? 'counter-stools' : undefined);
  }

  const loungeTable = loungeTableZone(input);
  if (loungeTable && spec.seating.lounge) {
    const entry = place('furniture:lounge-table');
    const node = buildRoundTable(
      'furniture:lounge-table',
      loungeTable.center,
      loungeTable.radius,
      loungeTable.height,
      furnitureMaterial(input.materials, spec.seating.lounge.tableTopSlot),
      furnitureMaterial(input.materials, spec.seating.lounge.tableFrameSlot),
    );
    commit(entry, node, 'lounge-table');
  } else if (!spec.seating.standingRail) {
    const entry = place('furniture:window-table');
    const node = buildRoundTable(
      'furniture:window-table',
      { x: WINDOW_TABLE.x, y: 0, z: WINDOW_TABLE.z },
      WINDOW_TABLE.radius,
      WINDOW_TABLE.height,
      furnitureMaterial(input.materials, spec.tables.surfaceSlot),
      furnitureMaterial(input.materials, spec.tables.baseSlot),
    );
    commit(entry, node, 'window-table');
  }

  const rail = railZone(input);
  if (rail) commit(place(rail.id), buildRail(rail, input), 'standing-rail');

  return { group, props, landmarks, meshCount: countMeshes(group) };
}
