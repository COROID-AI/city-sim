/**
 * Tables — the era's table builds, anchored on the environment's slot grid.
 *
 * Placement rules
 * ---------------
 * Tables stand on the eight table anchors exported by the environment shell
 * (`layout.tableSlots`), at the slot's own surface height, so anything placed on
 * a table (tableware, patrons, table-top decor) lands in the same place in every
 * era. Slots alternate orientation, so rows 1 and 3 run their long axis along Z
 * and rows 2 and 4 across X; the loose chairs follow that axis and the wall
 * banquette seats the outer side.
 *
 * On communal eras (2025) the two middle rows of each column merge into one long
 * reclaimed-board run, an accent table build dresses the outer row (the 1985
 * glass table, the 2025 terrazzo table), and the legs, apron, edge band and
 * exposed joinery of every build are expressed in the geometry itself.
 *
 * The planner is geometry free — the tests assert placement without a GPU — and
 * `buildTables` raises the meshes for the entries the planner produced.
 */

import * as THREE from 'three';
import type { RoomPoint } from '../../contracts/period';
import type { TableSlot } from '../environment';
import type {
  FurnitureBuildInput,
  FurniturePlanInput,
  PlacedProp,
  PropBuildResult,
  PropPlanEntry,
  TableVariant,
} from './FurnitureModule';
import { boxMesh, cylinderMesh, furnitureMaterial, torusMesh } from './materials';

/* -------------------------------------------------------------------------- */
/* Anchors                                                                    */
/* -------------------------------------------------------------------------- */

/** One table position: a slot, or the merged communal run of two slots. */
export interface TableAnchor {
  readonly id: string;
  readonly label: string;
  readonly column: number;
  readonly row: number;
  /** Floor anchor: centre of the table footprint. */
  readonly position: RoomPoint;
  /** Height of the usable table top above the floor. */
  readonly surfaceHeight: number;
  /** Yaw of the table around Y (`0` or `PI / 2`, matching the slot grid). */
  readonly rotationY: number;
  /** World half extents of the top, after {@link TableAnchor.rotationY}. */
  readonly halfX: number;
  readonly halfZ: number;
  /** Axis the loose chairs sit on (the table's long sides). */
  readonly seatAxis: 'x' | 'z';
  readonly communal: boolean;
  /** Which era table build is used here. */
  readonly table: TableVariant;
}

const COMMUNAL_ROWS: readonly number[] = Object.freeze([2, 3]);

function slotOf(input: FurniturePlanInput, column: number, row: number): TableSlot | undefined {
  return input.layout.tableSlots.find((slot) => slot.column === column && slot.row === row);
}

function variantFor(input: FurniturePlanInput, row: number): TableVariant {
  const { tables } = input.spec;
  if (tables.variant && tables.variantRows.includes(row)) return tables.variant;
  return tables;
}

function makeAnchor(input: FurniturePlanInput, slot: TableSlot, table: TableVariant): TableAnchor {
  const rotated = Math.abs(Math.sin(slot.orientation)) > 0.5;
  const halfX = rotated ? table.depth / 2 : table.width / 2;
  const halfZ = rotated ? table.width / 2 : table.depth / 2;
  return {
    id: `furniture:table:${slot.id.replace('table-slot-', '')}`,
    label: table.label,
    column: slot.column,
    row: slot.row,
    position: { ...slot.position },
    surfaceHeight: slot.surfaceHeight,
    rotationY: rotated ? Math.PI / 2 : 0,
    halfX,
    halfZ,
    // Chairs sit on the table's long sides: across the slot's orientation.
    seatAxis: rotated ? 'z' : 'x',
    communal: false,
    table,
  };
}

/**
 * Every table position of one era: the slot grid, or — on communal eras — the
 * outer rows plus one long shared run per column. Deterministic and derived from
 * the layout only, so navigation, seating and the hotspot anchors agree.
 */
export function tableAnchors(input: FurniturePlanInput): readonly TableAnchor[] {
  const { spec } = input;
  const anchors: TableAnchor[] = [];

  for (const slot of input.layout.tableSlots) {
    if (spec.tables.communal && COMMUNAL_ROWS.includes(slot.row)) continue;
    anchors.push(makeAnchor(input, slot, variantFor(input, slot.row)));
  }

  if (!spec.tables.communal) return anchors;

  const columns = [...new Set(input.layout.tableSlots.map((slot) => slot.column))].sort((a, b) => a - b);
  const firstRow = COMMUNAL_ROWS[0] ?? 2;
  const lastRow = COMMUNAL_ROWS[1] ?? 3;
  for (const column of columns) {
    const first = slotOf(input, column, firstRow);
    const last = slotOf(input, column, lastRow);
    if (!first || !last) continue;
    const centreZ = (first.position.z + last.position.z) / 2;
    const depth = Math.abs(last.position.z - first.position.z) + spec.tables.depth;
    anchors.push({
      id: `furniture:table:communal-c${column}`,
      label: `${spec.tables.label} laid as one communal run`,
      column,
      row: firstRow,
      position: { x: first.position.x, y: first.position.y, z: centreZ },
      surfaceHeight: first.surfaceHeight,
      rotationY: 0,
      halfX: spec.tables.width / 2,
      halfZ: depth / 2,
      seatAxis: 'x',
      communal: true,
      // The merged run is one long table: the era's build, twice the span.
      table: { ...spec.tables, depth },
    });
  }

  return anchors;
}

/** The plan entry one anchor contributes (no geometry). */
export function tablePlanEntry(anchor: TableAnchor, year: string): PropPlanEntry {
  return {
    id: anchor.id,
    kind: 'table',
    group: 'tables',
    label: anchor.label,
    center: { x: anchor.position.x, y: anchor.surfaceHeight / 2, z: anchor.position.z },
    size: { x: anchor.table.width, y: anchor.surfaceHeight, z: anchor.table.depth },
    rotationY: anchor.rotationY,
    support: 'floor',
    tags: [
      anchor.table.surface,
      anchor.table.base,
      anchor.communal ? 'communal' : 'standard',
      `year:${year}`,
    ],
  };
}

/** Every table of one era, placed but not built. */
export function planTables(input: FurniturePlanInput): readonly PropPlanEntry[] {
  return tableAnchors(input).map((anchor) => tablePlanEntry(anchor, input.year));
}

/** Number of meshes under a built group (diagnostics and the tests). */
export function countMeshes(root: THREE.Object3D): number {
  let count = 0;
  root.traverse((object) => {
    if ((object as THREE.Mesh).isMesh) count += 1;
  });
  return count;
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function partName(anchorId: string, part: string): string {
  return `${anchorId}:${part}`;
}

function buildTop(anchor: TableAnchor, input: FurnitureBuildInput): THREE.Object3D[] {
  const { table } = anchor;
  const surface = furnitureMaterial(input.materials, table.surfaceSlot);
  const parts: THREE.Object3D[] = [];
  const topY = anchor.surfaceHeight - table.topThickness / 2;
  const band = table.bandSlot ? furnitureMaterial(input.materials, table.bandSlot) : null;
  const apron = furnitureMaterial(input.materials, table.baseSlot);
  const apronMaterial = table.apronSlot ? furnitureMaterial(input.materials, table.apronSlot) : apron;

  if (table.shape === 'round' || table.shape === 'oval') {
    const radius = table.width / 2;
    const scaleZ = table.shape === 'oval' ? table.depth / table.width : 1;
    parts.push(
      cylinderMesh(radius, radius, table.topThickness, surface, {
        name: partName(anchor.id, 'top'),
        part: 'table-top',
        position: [0, topY, 0],
        scale: [1, 1, scaleZ],
      }, 28),
    );
    if (band) {
      parts.push(
        torusMesh(radius, table.topThickness * 0.7, band, {
          name: partName(anchor.id, 'top-rim'),
          part: 'table-edge-band',
          position: [0, topY, 0],
          rotation: [Math.PI / 2, 0, 0],
          scale: [1, scaleZ, 1],
        }, 28),
      );
    }
    // A turned collar under a round top: the era's first joinery detail.
    parts.push(
      cylinderMesh(radius * 0.32, radius * 0.34, 0.05, apronMaterial, {
        name: partName(anchor.id, 'collar'),
        part: 'table-collar',
        position: [0, topY - table.topThickness / 2 - 0.025, 0],
      }),
    );
    return parts;
  }

  parts.push(
    boxMesh([table.width, table.topThickness, table.depth], surface, {
      name: partName(anchor.id, 'top'),
      part: 'table-top',
      position: [0, topY, 0],
    }),
  );
  if (band) {
    parts.push(
      boxMesh([table.width + 0.024, table.topThickness * 0.6, table.depth + 0.024], band, {
        name: partName(anchor.id, 'edge-band'),
        part: 'table-edge-band',
        position: [0, topY - table.topThickness * 0.2, 0],
      }),
    );
  }
  // A shaped apron of four rails with exposed corner blocks, not one slab.
  const railHeight = 0.075;
  const railY = topY - table.topThickness / 2 - railHeight / 2;
  const railInset = 0.06;
  parts.push(
    boxMesh([table.width - railInset * 2, railHeight, 0.022], apronMaterial, {
      name: partName(anchor.id, 'apron-front'),
      part: 'table-apron',
      position: [0, railY, table.depth / 2 - railInset],
    }),
    boxMesh([table.width - railInset * 2, railHeight, 0.022], apronMaterial, {
      name: partName(anchor.id, 'apron-back'),
      part: 'table-apron',
      position: [0, railY, -table.depth / 2 + railInset],
    }),
    boxMesh([0.022, railHeight, table.depth - railInset * 2], apronMaterial, {
      name: partName(anchor.id, 'apron-left'),
      part: 'table-apron',
      position: [-table.width / 2 + railInset, railY, 0],
    }),
    boxMesh([0.022, railHeight, table.depth - railInset * 2], apronMaterial, {
      name: partName(anchor.id, 'apron-right'),
      part: 'table-apron',
      position: [table.width / 2 - railInset, railY, 0],
    }),
    boxMesh([0.06, railHeight + 0.01, 0.06], apronMaterial, {
      name: partName(anchor.id, 'corner-block'),
      part: 'table-corner-block',
      position: [table.width / 2 - railInset, railY, table.depth / 2 - railInset],
    }),
    boxMesh([0.06, railHeight + 0.01, 0.06], apronMaterial, {
      name: partName(anchor.id, 'corner-block'),
      part: 'table-corner-block',
      position: [-table.width / 2 + railInset, railY, table.depth / 2 - railInset],
    }),
  );
  return parts;
}

function buildBase(anchor: TableAnchor, input: FurnitureBuildInput): THREE.Object3D[] {
  const { table } = anchor;
  const base = furnitureMaterial(input.materials, table.baseSlot);
  const joinery = table.joinerySlot ? furnitureMaterial(input.materials, table.joinerySlot) : base;
  const parts: THREE.Object3D[] = [];
  const top = anchor.surfaceHeight;
  const corners: readonly (readonly [number, number])[] = [
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];

  switch (table.base) {
    /* 1945: a painted column on a braced cast base. */
    case 'cast-iron-pedestal': {
      const columnHeight = top - 0.12;
      parts.push(
        cylinderMesh(0.048, 0.06, columnHeight, joinery, {
          name: partName(anchor.id, 'pedestal'),
          part: 'table-pedestal',
          position: [0, columnHeight / 2, 0],
        }),
        cylinderMesh(0.075, 0.075, 0.05, joinery, {
          name: partName(anchor.id, 'collar'),
          part: 'table-collar',
          position: [0, columnHeight - 0.02, 0],
        }),
      );
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2;
        parts.push(
          boxMesh([0.32, 0.032, 0.06], base, {
            name: partName(anchor.id, 'foot'),
            part: 'table-foot',
            position: [Math.cos(angle) * 0.16, 0.016, Math.sin(angle) * 0.16],
            rotation: [0, -angle, 0],
          }),
          boxMesh([0.1, 0.03, 0.045], joinery, {
            name: partName(anchor.id, 'foot-brace'),
            part: 'table-brace',
            position: [Math.cos(angle) * 0.19, 0.05, Math.sin(angle) * 0.19],
            rotation: [0, -angle, 0.5],
          }),
        );
      }
      break;
    }

    /* 1965: a chrome column on four splayed legs. */
    case 'chrome-pedestal': {
      const columnHeight = top - 0.14;
      parts.push(
        cylinderMesh(0.04, 0.05, columnHeight, base, {
          name: partName(anchor.id, 'pedestal'),
          part: 'table-pedestal',
          position: [0, columnHeight / 2, 0],
        }),
        torusMesh(0.06, 0.008, base, {
          name: partName(anchor.id, 'foot-ring'),
          part: 'table-foot-ring',
          position: [0, 0.07, 0],
          rotation: [Math.PI / 2, 0, 0],
        }),
      );
      for (let index = 0; index < 4; index += 1) {
        const angle = (index / 4) * Math.PI * 2 + Math.PI / 4;
        parts.push(
          // Splayed legs are lifted so their tilted feet clear the floor.
          cylinderMesh(0.014, 0.016, 0.3, base, {
            name: partName(anchor.id, 'splay-leg'),
            part: 'table-leg',
            position: [Math.cos(angle) * 0.13, 0.15, Math.sin(angle) * 0.13],
            rotation: [Math.sin(angle) * 0.62, 0, -Math.cos(angle) * 0.62],
          }),
          cylinderMesh(0.02, 0.022, 0.02, base, {
            name: partName(anchor.id, 'glide'),
            part: 'table-glide',
            position: [Math.cos(angle) * 0.26, 0.012, Math.sin(angle) * 0.26],
          }),
        );
      }
      break;
    }

    /* 1985: a crossed X frame on a chrome shoe. */
    case 'x-frame-chrome': {
      const spread = Math.max(anchor.table.depth * 0.3, 0.18);
      const frameY = (top - 0.1) / 2 + 0.05;
      parts.push(
        boxMesh([spread * 2, 0.03, 0.05], base, {
          name: partName(anchor.id, 'x-frame'),
          part: 'table-frame',
          position: [0, frameY, 0],
          rotation: [0, 0, 0.62],
        }),
        boxMesh([spread * 2, 0.03, 0.05], base, {
          name: partName(anchor.id, 'x-frame'),
          part: 'table-frame',
          position: [0, frameY, 0],
          rotation: [0, 0, -0.62],
        }),
        boxMesh([spread * 2.2, 0.022, 0.06], base, {
          name: partName(anchor.id, 'x-shoe'),
          part: 'table-foot',
          position: [0, 0.011, 0],
        }),
      );
      for (const sign of [-1, 1]) {
        parts.push(
          boxMesh([0.05, top - 0.12, 0.05], base, {
            name: partName(anchor.id, 'column'),
            part: 'table-column',
            position: [sign * spread * 0.55, (top - 0.12) / 2, 0],
          }),
        );
      }
      break;
    }

    /* 2005: a brushed steel pedestal bolted through the top. */
    case 'steel-pedestal': {
      const columnHeight = top - 0.1;
      parts.push(
        boxMesh([0.09, columnHeight, 0.09], base, {
          name: partName(anchor.id, 'pedestal'),
          part: 'table-pedestal',
          position: [0, columnHeight / 2, 0],
        }),
        boxMesh([0.44, 0.03, 0.44], base, {
          name: partName(anchor.id, 'pedestal-plate'),
          part: 'table-foot',
          position: [0, 0.016, 0],
        }),
      );
      for (const sign of [-1, 1]) {
        parts.push(
          cylinderMesh(0.008, 0.008, 0.03, joinery, {
            name: partName(anchor.id, 'bolt'),
            part: 'table-bolt',
            position: [sign * 0.13, 0.046, 0],
          }),
        );
      }
      break;
    }

    /* 2025: exposed trestles with through-tenon keys. */
    case 'timber-trestle':
    case 'steel-trestle': {
      const spread = anchor.table.depth * 0.32;
      for (const sign of [-1, 1]) {
        const z = sign * spread;
        parts.push(
          boxMesh([0.06, top - 0.05, 0.09], base, {
            name: partName(anchor.id, 'trestle-leg'),
            part: 'table-trestle',
            position: [-0.14, (top - 0.05) / 2, z],
            rotation: [0, 0, 0.12 * sign],
          }),
          boxMesh([0.06, top - 0.05, 0.09], base, {
            name: partName(anchor.id, 'trestle-leg'),
            part: 'table-trestle',
            position: [0.14, (top - 0.05) / 2, z],
            rotation: [0, 0, -0.12 * sign],
          }),
          boxMesh([0.36, 0.07, 0.07], base, {
            name: partName(anchor.id, 'trestle-foot'),
            part: 'table-foot',
            position: [0, 0.035, z],
          }),
        );
      }
      parts.push(
        boxMesh([anchor.table.width * 0.72, 0.07, 0.07], base, {
          name: partName(anchor.id, 'stretcher'),
          part: 'table-stretcher',
          position: [0, top * 0.42, 0],
        }),
      );
      for (const sign of [-1, 1]) {
        parts.push(
          boxMesh([0.02, 0.09, 0.09], joinery, {
            name: partName(anchor.id, 'tenon-key'),
            part: 'table-tenon',
            position: [sign * (anchor.table.width / 2 - 0.008), top * 0.42, 0],
          }),
        );
      }
      break;
    }

    /* 1945 utility tables and 2005 bistro tables: four legs. */
    case 'cast-iron-legs':
    case 'timber-legs': {
      const legRadius = table.base === 'timber-legs' ? 0.03 : 0.026;
      for (const [signX, signZ] of corners) {
        parts.push(
          cylinderMesh(legRadius * 0.85, legRadius, top - 0.05, base, {
            name: partName(anchor.id, 'leg'),
            part: 'table-leg',
            position: [
              signX * (anchor.table.width / 2 - legRadius * 1.8),
              (top - 0.05) / 2,
              signZ * (anchor.table.depth / 2 - legRadius * 1.8),
            ],
          }),
        );
      }
      parts.push(
        torusMesh(anchor.table.width * 0.42, 0.01, joinery, {
          name: partName(anchor.id, 'leg-ring'),
          part: 'table-brace',
          position: [0, 0.14, 0],
          rotation: [Math.PI / 2, 0, 0],
        }),
      );
      break;
    }

    case 'hairpin-steel':
    default: {
      for (const [signX, signZ] of corners) {
        const x = signX * (anchor.table.width / 2 - 0.07);
        const z = signZ * (anchor.table.depth / 2 - 0.07);
        parts.push(
          cylinderMesh(0.008, 0.008, top - 0.02, base, {
            name: partName(anchor.id, 'hairpin'),
            part: 'table-leg',
            position: [x, (top - 0.02) / 2, z],
            rotation: [0, 0, -signX * 0.16],
          }),
          cylinderMesh(0.008, 0.008, top - 0.02, base, {
            name: partName(anchor.id, 'hairpin'),
            part: 'table-leg',
            position: [x, (top - 0.02) / 2, z],
            rotation: [signZ * 0.16, 0, 0],
          }),
        );
      }
      break;
    }
  }

  return parts;
}

/** Raises the meshes for the planned table entries. */
export function buildTables(
  input: FurnitureBuildInput,
  entries: readonly PropPlanEntry[],
): PropBuildResult {
  const group = new THREE.Group();
  group.name = 'furniture-tables';
  const props: PlacedProp[] = [];
  const landmarks: Record<string, THREE.Object3D> = {};
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  for (const anchor of tableAnchors(input)) {
    const entry = byId.get(anchor.id);
    if (!entry) throw new Error(`Missing the planned entry for table "${anchor.id}".`);

    const tableGroup = new THREE.Group();
    tableGroup.name = anchor.id;
    tableGroup.position.set(anchor.position.x, 0, anchor.position.z);
    tableGroup.rotation.y = anchor.rotationY;
    tableGroup.userData.furnitureKind = 'table';
    for (const part of buildTop(anchor, input)) tableGroup.add(part);
    for (const part of buildBase(anchor, input)) tableGroup.add(part);

    group.add(tableGroup);
    props.push({ ...entry, node: tableGroup });
    landmarks[anchor.communal ? `communal-table-${anchor.column}` : `table-${anchor.column}-${anchor.row}`] =
      tableGroup;
  }

  return { group, props, landmarks, meshCount: countMeshes(group) };
}
