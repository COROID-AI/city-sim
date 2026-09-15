/**
 * Interior architecture of the café: the closed shell itself.
 *
 * `buildShell` raises the permanent structure as named nodes inside one
 * environment group:
 *
 *  - `environment-floor`, `environment-wall-back|front|left|right`,
 *    `environment-ceiling` — the interior envelope measured by
 *    {@link measureShellEnvelope}. The walls are single planes (the front and
 *    back walls are `ShapeGeometry` with real openings cut out), so the envelope
 *    is exact and never drifts from `RoomBounds`.
 *  - `environment-wainscot` — the period dado, rebuilt per era from the era's
 *    profile (height, panel pitch, rails, cap).
 *  - `environment-ceiling-detail` — cornice / tile grid / acoustic tracks /
 *    exposed services / concrete soffit, rebuilt per era.
 *  - `environment-counter-shell` — the service counter shell with its pass mats
 *    sitting exactly on the structural counter-pass slots.
 *  - `environment-back-room-doorway` — frame, leaf and the dim room beyond.
 *
 * The storefront nodes (glazing, entrance door, street sliver, signage bracket)
 * are raised by `./storefront` into the same group, so the module ends up with
 * one complete, uniformly named shell.
 *
 * Era changes never rebuild the envelope: `applyShellEra` swaps the material set
 * and rebuilds only the profile driven detail, disposing the geometries it
 * replaces.
 */

import * as THREE from 'three';
import { disposeObject3D } from '../../core/kernel';
import type { RoomBounds } from '../../contracts/period';
import type { EnvironmentSpec } from './data/years';
import { MATERIAL_SLOTS, type MaterialSet, type MaterialSlot } from './materials';
import {
  ENVIRONMENT_GROUP_NAME,
  SHELL_NODE_NAMES,
  STRUCTURAL_LAYOUT,
  counterRect,
  serviceLaneRect,
  wallSurface,
  type ShellNodeKey,
  type StructuralLayout,
  type WallId,
} from './roomBounds';

/* -------------------------------------------------------------------------- */
/* Node bookkeeping                                                           */
/* -------------------------------------------------------------------------- */

/** Registry of the shell's named nodes, filled in as the shell is raised. */
export type ShellNodes = Partial<Record<ShellNodeKey, THREE.Object3D>>;

/** The raised interior shell plus the groups `applyShellEra` rebuilds. */
export interface ShellParts {
  /** The single `environment` group every node lives in. */
  readonly group: THREE.Group;
  /** Named nodes, keyed by {@link ShellNodeKey}. */
  readonly nodes: ShellNodes;
  readonly bounds: RoomBounds;
  readonly layout: StructuralLayout;
  /** Period dado; rebuilt whenever the era changes. */
  readonly wainscot: THREE.Group;
  /** Period ceiling structure; rebuilt whenever the era changes. */
  readonly ceilingDetail: THREE.Group;
  /** Era currently applied. */
  currentSpec: EnvironmentSpec;
}

export interface ShellBuildOptions {
  readonly bounds: RoomBounds;
  readonly layout?: StructuralLayout;
  readonly spec: EnvironmentSpec;
  readonly materials: MaterialSet;
}

/** Name of the ceiling detail group. */
export const CEILING_DETAIL_NODE_NAME = 'environment-ceiling-detail';

/** Throws when a required shell node has not been created. */
export function requireShellNode(parts: ShellParts, key: ShellNodeKey): THREE.Object3D {
  const node = parts.nodes[key];
  if (!node) throw new Error(`The environment shell is missing the "${key}" node.`);
  return node;
}

/** Every node of the required inventory, or `null` when one is missing. */
export function shellNodeInventory(parts: ShellParts): Readonly<Record<ShellNodeKey, THREE.Object3D>> | null {
  const inventory = {} as Record<ShellNodeKey, THREE.Object3D>;
  for (const key of Object.keys(SHELL_NODE_NAMES) as ShellNodeKey[]) {
    const node = parts.nodes[key];
    if (!node) return null;
    inventory[key] = node;
  }
  return Object.freeze(inventory);
}

/* -------------------------------------------------------------------------- */
/* Geometry helpers                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Shared stand-in material. Every mesh is created with it and re-pointed at the
 * era's material slot by {@link assignShellMaterials} before anything renders,
 * so the shell never allocates a throwaway material per mesh.
 */
const PENDING_MATERIAL = new THREE.MeshStandardMaterial({ name: 'environment:pending-material' });

/**
 * Creates a slot-tagged mesh. Every mesh the environment builders create goes
 * through here, so the era material pass and the diagnostics in
 * `shellEraSignature` / `storefrontEraSignature` can address it by slot and part.
 */
export function boxMaterialMesh(
  geometry: THREE.BufferGeometry,
  slot: MaterialSlot,
  name: string,
  part: string,
  options: {
    readonly position?: readonly [number, number, number];
    readonly rotation?: readonly [number, number, number];
    readonly castShadow?: boolean;
  } = {},
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, PENDING_MATERIAL);
  mesh.name = name;
  mesh.userData.environmentSlot = slot;
  mesh.userData.environmentPart = part;
  if (options.position) mesh.position.set(...options.position);
  if (options.rotation) mesh.rotation.set(...options.rotation);
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Releases the geometries of `node`'s subtree and empties it. Materials stay
 * untouched: they belong to the era's {@link MaterialSet}, which the module owns.
 */
export function releaseGeometry(node: THREE.Object3D): number {
  let released = 0;
  node.traverse((object) => {
    const renderable = object as THREE.Object3D & { geometry?: THREE.BufferGeometry };
    if (renderable.geometry) {
      renderable.geometry.dispose();
      released += 1;
    }
  });
  node.clear();
  return released;
}

/** Re-points every mesh in the shell at the current era's material slot. */
export function assignShellMaterials(parts: ShellParts, materials: MaterialSet): number {
  let assigned = 0;
  parts.group.traverse((object) => {
    const mesh = object as THREE.Object3D & {
      material?: THREE.Material | THREE.Material[];
      userData: Record<string, unknown>;
    };
    const slot = mesh.userData['environmentSlot'];
    if (typeof slot !== 'string' || !(MATERIAL_SLOTS as readonly string[]).includes(slot)) return;
    mesh.material = materials.slots[slot as MaterialSlot];
    assigned += 1;
  });
  return assigned;
}

/** Builds a rectangular wall outline with rectangular openings cut out of it. */
function wallShapeGeometry(
  width: number,
  height: number,
  holes: readonly { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }[],
): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, height);
  shape.lineTo(-width / 2, height);
  shape.closePath();
  for (const hole of holes) {
    const path = new THREE.Path();
    path.moveTo(hole.minX, hole.minY);
    path.lineTo(hole.maxX, hole.minY);
    path.lineTo(hole.maxX, hole.maxY);
    path.lineTo(hole.minX, hole.maxY);
    path.closePath();
    shape.holes.push(path);
  }
  return new THREE.ShapeGeometry(shape);
}

function zoneHole(zone: { readonly position: { readonly x: number }; readonly width: number; readonly height: number; readonly sillHeight: number }) {
  return {
    minX: zone.position.x - zone.width / 2,
    maxX: zone.position.x + zone.width / 2,
    minY: zone.sillHeight,
    maxY: zone.sillHeight + zone.height,
  };
}

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

function buildFloor(parts: ShellParts): THREE.Mesh {
  const { width, depth } = parts.bounds;
  const mesh = boxMaterialMesh(new THREE.PlaneGeometry(width, depth), 'floor', SHELL_NODE_NAMES.floor, 'floor', {
    position: [0, parts.layout.floorHeight, 0],
    rotation: [-Math.PI / 2, 0, 0],
  });
  mesh.name = SHELL_NODE_NAMES.floor;
  parts.group.add(mesh);
  parts.nodes.floor = mesh;
  return mesh;
}

function buildCeiling(parts: ShellParts): THREE.Mesh {
  const { width, depth, height } = parts.bounds;
  const mesh = boxMaterialMesh(new THREE.PlaneGeometry(width, depth), 'ceiling', SHELL_NODE_NAMES.ceiling, 'ceiling', {
    position: [0, height, 0],
    rotation: [Math.PI / 2, 0, 0],
  });
  parts.group.add(mesh);
  parts.nodes.ceiling = mesh;
  return mesh;
}

function buildWalls(parts: ShellParts): void {
  const { width, depth, height } = parts.bounds;
  const layout = parts.layout;

  const sideGeometry = new THREE.PlaneGeometry(depth, height);
  const left = boxMaterialMesh(sideGeometry, 'wall', SHELL_NODE_NAMES.wallLeft, 'wall-left', {
    position: [-width / 2, height / 2, 0],
    rotation: [0, Math.PI / 2, 0],
  });
  const right = boxMaterialMesh(sideGeometry, 'wall', SHELL_NODE_NAMES.wallRight, 'wall-right', {
    position: [width / 2, height / 2, 0],
    rotation: [0, -Math.PI / 2, 0],
  });
  parts.group.add(left, right);
  parts.nodes.wallLeft = left;
  parts.nodes.wallRight = right;

  const backGeometry = wallShapeGeometry(width, height, [zoneHole(layout.doorway)]);
  const back = boxMaterialMesh(backGeometry, 'wall', SHELL_NODE_NAMES.wallBack, 'wall-back', {
    position: [0, 0, -depth / 2],
  });
  parts.group.add(back);
  parts.nodes.wallBack = back;

  const frontHoles = [zoneHole(layout.entrance), ...layout.glazingZones.map(zoneHole)];
  const frontGeometry = wallShapeGeometry(width, height, frontHoles);
  const front = boxMaterialMesh(frontGeometry, 'wall', SHELL_NODE_NAMES.wallFront, 'wall-front', {
    position: [0, 0, depth / 2],
  });
  parts.group.add(front);
  parts.nodes.wallFront = front;
}

/* -------------------------------------------------------------------------- */
/* Wainscot                                                                   */
/* -------------------------------------------------------------------------- */

interface WainscotRun {
  readonly id: string;
  readonly wall: WallId;
  /** Start of the run along the wall's run axis. */
  readonly from: number;
  readonly to: number;
  /** Height of the run: dado height inside, glazing sill height under the shopfront. */
  readonly height: number;
}

/**
 * Splits the period dado into runs that avoid the openings: the back wall runs
 * either side of the back room doorway and the front runs are the stall risers
 * under each glazing bay.
 */
export function wainscotRuns(layout: StructuralLayout, bounds: RoomBounds): readonly WainscotRun[] {
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const doorway = layout.doorway;
  const doorwayLeft = doorway.position.x - doorway.width / 2;
  const doorwayRight = doorway.position.x + doorway.width / 2;
  const runs: WainscotRun[] = [];

  if (doorwayLeft - (-halfWidth) > 0.4) {
    runs.push({ id: 'back-left', wall: 'back', from: -halfWidth + 0.02, to: doorwayLeft - 0.14, height: Number.NaN });
  }
  if (halfWidth - doorwayRight > 0.4) {
    runs.push({ id: 'back-right', wall: 'back', from: doorwayRight + 0.14, to: halfWidth - 0.02, height: Number.NaN });
  }
  runs.push({ id: 'left', wall: 'left', from: -halfDepth + 0.02, to: halfDepth - 0.02, height: Number.NaN });
  runs.push({ id: 'right', wall: 'right', from: -halfDepth + 0.02, to: halfDepth - 0.02, height: Number.NaN });
  layout.glazingZones.forEach((zone, index) => {
    runs.push({
      id: `front-${index + 1}`,
      wall: 'front',
      from: zone.position.x - zone.width / 2,
      to: zone.position.x + zone.width / 2,
      height: zone.sillHeight,
    });
  });
  return runs;
}

function rebuildWainscot(parts: ShellParts, spec: EnvironmentSpec): void {
  const { layout, bounds } = parts;
  const group = parts.wainscot;
  releaseGeometry(group);
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  const profile = spec.wainscot;
  const panelPitch = profile.panelWidth;
  const beadCount = panelPitch >= 0.25 ? 1 : 0;

  for (const run of wainscotRuns(layout, bounds)) {
    const runHeight = Number.isNaN(run.height) ? profile.height : run.height;
    const length = Math.max(run.to - run.from, 0.05);
    const centre = (run.from + run.to) / 2;
    const isStallRiser = run.wall === 'front';
    const wall = wallSurface(layout.walls, run.wall);
    // Inside the room by a few centimetres so the dado reads as a separate plane.
    const inset = 0.03;
    const thickness = 0.05;

    const position: [number, number, number] =
      run.wall === 'back'
        ? [centre, runHeight / 2, -halfDepth + inset]
        : run.wall === 'front'
          ? [centre, runHeight / 2, halfDepth - inset]
          : [wall.center.x > 0 ? halfWidth - inset : -halfWidth + inset, runHeight / 2, centre];
    const size: [number, number, number] =
      wall.runAxis === 'x' ? [length, runHeight, thickness] : [thickness, runHeight, length];

    group.add(
      boxMaterialMesh(new THREE.BoxGeometry(...size), 'wainscot', `${SHELL_NODE_NAMES.wainscot}-${run.id}`, 'wainscot-panel', {
        position,
      }),
    );

    // Panel pitch geometry (only for the coarser profiles; fine bead patterns
    // are carried by the finish texture instead of dozens of tiny meshes).
    if (beadCount > 0) {
      const panels = Math.max(Math.floor(length / panelPitch), 1);
      for (let index = 1; index < panels; index += 1) {
        const along = run.from + (length * index) / panels;
        const beadPosition: [number, number, number] =
          run.wall === 'back'
            ? [along, runHeight / 2, -halfDepth + inset + thickness / 2]
            : run.wall === 'front'
              ? [along, runHeight / 2, halfDepth - inset - thickness / 2]
              : [position[0] + (wall.center.x > 0 ? -thickness / 2 : thickness / 2), runHeight / 2, along];
        const beadSize: [number, number, number] =
          wall.runAxis === 'x'
            ? [0.03, runHeight * 0.94, thickness * 0.6]
            : [thickness * 0.6, runHeight * 0.94, 0.03];
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(...beadSize),
            'wainscot',
            `${SHELL_NODE_NAMES.wainscot}-${run.id}-bead-${index}`,
            'wainscot-bead',
            { position: beadPosition },
          ),
        );
      }
    }

    // Extra rails (chair rails / steel kick rails).
    for (let rail = 0; rail < profile.railCount; rail += 1) {
      const railHeight = runHeight * (rail === 0 ? 0.42 : 0.72);
      const railSize: [number, number, number] =
        wall.runAxis === 'x' ? [length, 0.025, thickness + 0.03] : [thickness + 0.03, 0.025, length];
      group.add(
        boxMaterialMesh(
          new THREE.BoxGeometry(...railSize),
          profile.capMetalness > 0.5 ? 'metal' : 'wainscotCap',
          `${SHELL_NODE_NAMES.wainscot}-${run.id}-rail-${rail + 1}`,
          'wainscot-rail',
          { position: [position[0], railHeight, position[2]] },
        ),
      );
    }

    // Cap / sill board on top of the run.
    const capSize: [number, number, number] =
      wall.runAxis === 'x'
        ? [length + 0.02, profile.capHeight, thickness + profile.capDepth * 0.5]
        : [thickness + profile.capDepth * 0.5, profile.capHeight, length + 0.02];
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(...capSize),
        isStallRiser ? 'trim' : 'wainscotCap',
        `${SHELL_NODE_NAMES.wainscot}-${run.id}-cap`,
        'wainscot-cap',
        { position: [position[0], runHeight + profile.capHeight / 2, position[2]] },
      ),
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Ceiling detail                                                             */
/* -------------------------------------------------------------------------- */

function rebuildCeilingDetail(parts: ShellParts, spec: EnvironmentSpec): void {
  const group = parts.ceilingDetail;
  releaseGeometry(group);
  const { width, depth, height } = parts.bounds;
  const ceiling = spec.ceiling;

  const addFixture = (x: number, z: number, length: number): void => {
    group.add(
      boxMaterialMesh(
        new THREE.CylinderGeometry(0.012, 0.012, 0.22, 8),
        'metal',
        `${CEILING_DETAIL_NODE_NAME}-fixture-rod-${x.toFixed(2)}-${z.toFixed(2)}`,
        'ceiling-rod',
        { position: [x, height - 0.11, z] },
      ),
    );
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(length, 0.08, length * 0.4),
        'lamp',
        `${CEILING_DETAIL_NODE_NAME}-fixture-${x.toFixed(2)}-${z.toFixed(2)}`,
        'ceiling-fixture',
        { position: [x, height - 0.26, z] },
      ),
    );
  };

  switch (ceiling.detail) {
    case 'cornice': {
      const depthOfCove = Math.max(ceiling.corniceDepth, 0.06);
      const perimeter: readonly [number, number, number, number, number, number][] = [
        [0, height - depthOfCove / 2, -depth / 2 + depthOfCove / 2, width, depthOfCove, depthOfCove],
        [0, height - depthOfCove / 2, depth / 2 - depthOfCove / 2, width, depthOfCove, depthOfCove],
        [-width / 2 + depthOfCove / 2, height - depthOfCove / 2, 0, depthOfCove, depthOfCove, depth - depthOfCove * 2],
        [width / 2 - depthOfCove / 2, height - depthOfCove / 2, 0, depthOfCove, depthOfCove, depth - depthOfCove * 2],
      ];
      perimeter.forEach((entry, index) => {
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(entry[3], entry[4], entry[5]),
            'ceilingDetail',
            `${CEILING_DETAIL_NODE_NAME}-cornice-${index + 1}`,
            'ceiling-cornice',
            { position: [entry[0], entry[1], entry[2]] },
          ),
        );
      });
      break;
    }
    case 'tile-grid':
    case 'acoustic-tracks': {
      const divisions = 5;
      for (let index = 1; index < divisions; index += 1) {
        const x = -width / 2 + (width * index) / divisions;
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(0.05, 0.06, depth),
            'ceilingDetail',
            `${CEILING_DETAIL_NODE_NAME}-grid-x-${index}`,
            'ceiling-grid',
            { position: [x, height - 0.07, 0] },
          ),
        );
      }
      for (let index = 1; index < 6; index += 1) {
        const z = -depth / 2 + (depth * index) / 6;
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(width, 0.06, 0.05),
            'ceilingDetail',
            `${CEILING_DETAIL_NODE_NAME}-grid-z-${index}`,
            'ceiling-grid',
            { position: [0, height - 0.07, z] },
          ),
        );
      }
      if (ceiling.detail === 'acoustic-tracks') {
        for (let index = 0; index < 2; index += 1) {
          const z = -depth / 4 + (index * depth) / 2;
          group.add(
            boxMaterialMesh(
              new THREE.BoxGeometry(width * 0.72, 0.1, 0.12),
              'metal',
              `${CEILING_DETAIL_NODE_NAME}-track-${index + 1}`,
              'ceiling-track',
              { position: [0, height - 0.16, z] },
            ),
          );
        }
      }
      const fixtures = Math.max(ceiling.fixtureCount, 0);
      for (let index = 0; index < fixtures; index += 1) {
        const t = fixtures === 1 ? 0.5 : index / (fixtures - 1);
        addFixture(-width * 0.3 + width * 0.6 * t, depth * 0.18, 0.42);
      }
      break;
    }
    case 'exposed-services': {
      const conduits = 3;
      for (let index = 0; index < conduits; index += 1) {
        const z = -depth / 3 + (index * depth) / 3;
        group.add(
          boxMaterialMesh(
            new THREE.CylinderGeometry(0.045, 0.045, width * 0.92, 10),
            'metal',
            `${CEILING_DETAIL_NODE_NAME}-conduit-${index + 1}`,
            'ceiling-conduit',
            { position: [0, height - 0.14, z], rotation: [0, 0, Math.PI / 2] },
          ),
        );
      }
      const fixtures = Math.max(ceiling.fixtureCount, 0);
      for (let index = 0; index < fixtures; index += 1) {
        const t = fixtures === 1 ? 0.5 : index / (fixtures - 1);
        addFixture(-width * 0.32 + width * 0.64 * t, -depth * 0.2, 0.34);
      }
      break;
    }
    case 'concrete-soffit':
    default: {
      for (let index = 0; index < 2; index += 1) {
        const z = -depth / 4 + index * (depth / 2);
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(width * 0.7, 0.09, 0.16),
            'ceilingDetail',
            `${CEILING_DETAIL_NODE_NAME}-soffit-bar-${index + 1}`,
            'ceiling-soffit-bar',
            { position: [0, height - 0.26, z] },
          ),
        );
        group.add(
          boxMaterialMesh(
            new THREE.BoxGeometry(width * 0.62, 0.02, 0.09),
            'lamp',
            `${CEILING_DETAIL_NODE_NAME}-linear-${index + 1}`,
            'ceiling-fixture',
            { position: [0, height - 0.32, z] },
          ),
        );
      }
      const fixtures = Math.max(ceiling.fixtureCount, 0);
      for (let index = 0; index < fixtures; index += 1) {
        const t = fixtures === 1 ? 0.5 : index / (fixtures - 1);
        group.add(
          boxMaterialMesh(
            new THREE.CylinderGeometry(0.16, 0.1, 0.16, 14, 1, true),
            'lamp',
            `${CEILING_DETAIL_NODE_NAME}-pendant-${index + 1}`,
            'ceiling-fixture',
            { position: [-width * 0.34 + width * 0.68 * t, height - 0.5, depth * 0.24] },
          ),
        );
        group.add(
          boxMaterialMesh(
            new THREE.CylinderGeometry(0.01, 0.01, 0.34, 6),
            'metal',
            `${CEILING_DETAIL_NODE_NAME}-pendant-rod-${index + 1}`,
            'ceiling-rod',
            { position: [-width * 0.34 + width * 0.68 * t, height - 0.26, depth * 0.24] },
          ),
        );
      }
      break;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Counter shell                                                              */
/* -------------------------------------------------------------------------- */

function buildCounterShell(parts: ShellParts, spec: EnvironmentSpec): THREE.Group {
  const { layout, bounds } = parts;
  const counter = layout.counter;
  const group = new THREE.Group();
  group.name = SHELL_NODE_NAMES.counterShell;
  const halfDepth = bounds.depth / 2;
  const frontZ = counter.serviceFaceZ;
  const plinthHeight = 0.1;

  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(counter.width, plinthHeight, counter.depth * 0.94),
      'counterTrim',
      `${SHELL_NODE_NAMES.counterShell}-toe-kick`,
      'counter-toe-kick',
      { position: [counter.center.x, plinthHeight / 2, counter.center.z] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(counter.width, counter.baseHeight - plinthHeight, counter.depth),
      'counterBase',
      `${SHELL_NODE_NAMES.counterShell}-base`,
      'counter-base',
      { position: [counter.center.x, plinthHeight + (counter.baseHeight - plinthHeight) / 2, counter.center.z] },
    ),
  );

  // Front panelling: three raised panels plus a trim frame (period detail).
  const panels = 3;
  const panelSpan = counter.width / panels;
  for (let index = 0; index < panels; index += 1) {
    const x = counter.center.x - counter.width / 2 + panelSpan * (index + 0.5);
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(panelSpan * 0.78, counter.baseHeight - 0.34, 0.03),
        'counterBase',
        `${SHELL_NODE_NAMES.counterShell}-panel-${index + 1}`,
        'counter-panel',
        { position: [x, plinthHeight + (counter.baseHeight - 0.34) / 2 + 0.06, frontZ + 0.015] },
      ),
    );
  }
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(counter.width, 0.05, 0.05),
      'counterTrim',
      `${SHELL_NODE_NAMES.counterShell}-top-rail`,
      'counter-trim',
      { position: [counter.center.x, counter.baseHeight - 0.06, frontZ + 0.02] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(counter.width, counter.topThickness, counter.depth + spec.counter.topOverhang),
      'counterTop',
      `${SHELL_NODE_NAMES.counterShell}-top`,
      'counter-top',
      {
        position: [
          counter.center.x,
          counter.baseHeight + counter.topThickness / 2,
          // Flush with the back wall, overhanging the service face only.
          counter.center.z + spec.counter.topOverhang / 2,
        ],
      },
    ),
  );

  // Splashback against the back wall.
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(counter.width, 0.62, 0.02),
      'tile',
      `${SHELL_NODE_NAMES.counterShell}-splashback`,
      'counter-splashback',
      {
        position: [
          counter.center.x,
          counter.baseHeight + counter.topThickness + 0.31,
          -halfDepth + 0.04,
        ],
      },
    ),
  );

  // Back bar: uprights and two shelves behind the counter.
  const backBarZ = -halfDepth + 0.18;
  for (const side of [-1, 1]) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(0.06, 1.05, 0.28),
        'counterTrim',
        `${SHELL_NODE_NAMES.counterShell}-backbar-upright-${side < 0 ? 'left' : 'right'}`,
        'counter-backbar',
        { position: [counter.center.x + (counter.width / 2 - 0.12) * side, 1.9, backBarZ] },
      ),
    );
  }
  for (const shelfHeight of [1.9, 2.4]) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(counter.width - 0.2, 0.04, 0.3),
        'counterBase',
        `${SHELL_NODE_NAMES.counterShell}-backbar-shelf-${shelfHeight.toFixed(1)}`,
        'counter-backbar',
        { position: [counter.center.x, shelfHeight, backBarZ] },
      ),
    );
  }

  // Pass mats mark the structural counter-pass slots machines sit on.
  for (const pass of layout.counterPassSlots) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(pass.width, 0.02, pass.depth),
        'metal',
        `${SHELL_NODE_NAMES.counterShell}-pass-${pass.index + 1}`,
        'counter-pass',
        { position: [pass.position.x, pass.surfaceHeight + 0.01, pass.position.z] },
      ),
    );
  }

  parts.group.add(group);
  parts.nodes.counterShell = group;
  return group;
}

/* -------------------------------------------------------------------------- */
/* Back room doorway                                                          */
/* -------------------------------------------------------------------------- */

function buildBackRoomDoorway(parts: ShellParts, spec: EnvironmentSpec): THREE.Group {
  const doorway = parts.layout.doorway;
  const halfDepth = parts.bounds.depth / 2;
  const group = new THREE.Group();
  group.name = SHELL_NODE_NAMES.backRoomDoorway;

  const frameZ = -halfDepth + 0.07;
  for (const side of [-1, 1]) {
    group.add(
      boxMaterialMesh(
        new THREE.BoxGeometry(0.09, doorway.height + 0.05, 0.15),
        'doorwayFrame',
        `${SHELL_NODE_NAMES.backRoomDoorway}-jamb-${side < 0 ? 'left' : 'right'}`,
        'doorway-jamb',
        { position: [doorway.position.x + (doorway.width / 2 + 0.045) * side, (doorway.height + 0.05) / 2, frameZ] },
      ),
    );
  }
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(doorway.width + 0.18, 0.09, 0.15),
      'doorwayFrame',
      `${SHELL_NODE_NAMES.backRoomDoorway}-head`,
      'doorway-head',
      { position: [doorway.position.x, doorway.height + 0.02, frameZ] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(doorway.width + 0.22, 0.04, 0.22),
      'doorwayFrame',
      `${SHELL_NODE_NAMES.backRoomDoorway}-threshold`,
      'doorway-threshold',
      { position: [doorway.position.x, 0.02, frameZ] },
    ),
  );

  // The dim room beyond the opening.
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(doorway.width, doorway.height),
      'shadow',
      `${SHELL_NODE_NAMES.backRoomDoorway}-void`,
      'doorway-void',
      { position: [doorway.position.x, doorway.height / 2, -halfDepth - 0.02] },
    ),
  );
  group.add(
    boxMaterialMesh(
      new THREE.PlaneGeometry(0.6, 0.3),
      'lamp',
      `${SHELL_NODE_NAMES.backRoomDoorway}-back-room-glow`,
      'doorway-glow',
      { position: [doorway.position.x, 1.55, -halfDepth - 0.35] },
    ),
  );

  // The leaf, hinged on the left jamb and left ajar by the era.
  const pivot = new THREE.Group();
  pivot.name = `${SHELL_NODE_NAMES.backRoomDoorway}-leaf-pivot`;
  pivot.position.set(doorway.position.x - doorway.width / 2 + 0.01, 0, frameZ + 0.05);
  pivot.rotation.y = spec.doorway.openAngle;
  const leafWidth = doorway.width - 0.04;
  pivot.add(
    boxMaterialMesh(
      new THREE.BoxGeometry(leafWidth, doorway.height - 0.05, 0.045),
      'door',
      `${SHELL_NODE_NAMES.backRoomDoorway}-leaf`,
      'doorway-leaf',
      { position: [leafWidth / 2, (doorway.height - 0.05) / 2, 0] },
    ),
  );
  if (spec.doorway.glazed) {
    pivot.add(
      boxMaterialMesh(
        new THREE.PlaneGeometry(leafWidth * 0.62, doorway.height * 0.34),
        'glass',
        `${SHELL_NODE_NAMES.backRoomDoorway}-leaf-glass`,
        'doorway-leaf-glass',
        { position: [leafWidth / 2, doorway.height * 0.66, 0.03] },
      ),
    );
  }
  group.add(pivot);

  parts.group.add(group);
  parts.nodes.backRoomDoorway = group;
  return group;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Raises the interior shell inside a fresh `environment` group. The storefront
 * nodes are added afterwards by `buildStorefront`; the returned parts are shared
 * by both builders and by `applyShellEra`.
 */
export function buildShell(options: ShellBuildOptions): ShellParts {
  const layout = options.layout ?? STRUCTURAL_LAYOUT;
  const group = new THREE.Group();
  group.name = ENVIRONMENT_GROUP_NAME;

  const wainscot = new THREE.Group();
  wainscot.name = SHELL_NODE_NAMES.wainscot;
  const ceilingDetail = new THREE.Group();
  ceilingDetail.name = CEILING_DETAIL_NODE_NAME;

  const parts: ShellParts = {
    group,
    nodes: {},
    bounds: options.bounds,
    layout,
    wainscot,
    ceilingDetail,
    currentSpec: options.spec,
  };

  buildFloor(parts);
  buildCeiling(parts);
  buildWalls(parts);
  group.add(wainscot, ceilingDetail);
  parts.nodes.wainscot = wainscot;
  rebuildWainscot(parts, options.spec);
  rebuildCeilingDetail(parts, options.spec);
  buildCounterShell(parts, options.spec);
  buildBackRoomDoorway(parts, options.spec);
  assignShellMaterials(parts, options.materials);
  return parts;
}

/**
 * Moves the shell to a new era: swaps the material set and rebuilds the profile
 * driven detail (dado, ceiling structure) while the envelope stays untouched.
 */
export function applyShellEra(parts: ShellParts, spec: EnvironmentSpec, materials: MaterialSet): void {
  parts.currentSpec = spec;
  rebuildWainscot(parts, spec);
  rebuildCeilingDetail(parts, spec);
  assignShellMaterials(parts, materials);
}

/** Releases every geometry, material and texture under the shell and detaches it. */
export function disposeShell(parts: ShellParts): void {
  releaseGeometry(parts.wainscot);
  releaseGeometry(parts.ceilingDetail);
  disposeObject3D(parts.group);
  for (const key of Object.keys(parts.nodes) as ShellNodeKey[]) {
    delete parts.nodes[key];
  }
}

/**
 * Structural fingerprint of the era's shell geometry: dado heights, panel pitch
 * count, ceiling structure and fixture counts. Two eras must never share one.
 */
export function shellEraSignature(parts: ShellParts): string {
  const heights = new Set<string>();
  const partCounts = new Map<string, number>();
  let beads = 0;
  parts.group.traverse((object) => {
    const data = object.userData as Record<string, unknown>;
    const part = data['environmentPart'];
    if (typeof part !== 'string') return;
    partCounts.set(part, (partCounts.get(part) ?? 0) + 1);
    if (part === 'wainscot-bead') beads += 1;
    if (part === 'wainscot-panel') {
      const geometry = (object as THREE.Mesh).geometry as THREE.BufferGeometry & {
        parameters?: { height?: number };
      };
      const height = geometry.parameters?.height;
      if (typeof height === 'number') heights.add(height.toFixed(3));
    }
  });
  const ceilingTypes = [...partCounts.keys()].filter((key) => key.startsWith('ceiling-')).sort();
  return [
    `dado=${[...heights].sort().join('+')}`,
    `pitch=${parts.currentSpec.wainscot.panelWidth.toFixed(2)}`,
    `beads=${beads}`,
    `ceiling=${ceilingTypes.join(',')}`,
    `fixtures=${(partCounts.get('ceiling-fixture') ?? 0)}`,
    `counterPanels=${(partCounts.get('counter-panel') ?? 0)}`,
  ].join('|');
}

/** Sanity check used by tests and by consumers: the layout fits inside the bounds. */
export function shellFootprintFits(parts: ShellParts): boolean {
  const counter = counterRect(parts.layout.counter);
  const lane = serviceLaneRect(parts.layout.serviceLane);
  const halfWidth = parts.bounds.width / 2;
  const halfDepth = parts.bounds.depth / 2;
  return (
    counter.minX >= -halfWidth &&
    counter.maxX <= halfWidth &&
    counter.minZ >= -halfDepth &&
    lane.maxZ <= halfDepth
  );
}
