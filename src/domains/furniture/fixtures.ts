/**
 * Fixtures — the small things that date a room as much as the furniture does:
 * the coat stand by the door, the hat rack on the wall, the magazine rack, the
 * wall clock, the era's payphone or wall phone and the waste bins.
 *
 * Placement rules
 * ---------------
 *  - The **coat stand** stands inside the entrance area but clear of the door's
 *    swing volume, on the room side of the storefront pier.
 *  - The **hat rack**, **clock** and **phone** hang from the wall mount surfaces
 *    the environment shell exports (`layout.wallMounts`): the clock uses the
 *    surface reserved for it, the phone the mount nearest the counter and the
 *    hat rack the mount nearest the door on the left wall.
 *  - The **magazine rack** stands against the left wall past the banquette; the
 *    **bins** flank the counter's left end and the entrance (outside the swing
 *    volume), so neither blocks the service lane.
 */

import * as THREE from 'three';
import type { RoomPoint } from '../../contracts/period';
import {
  wallMountsOf,
  type StructuralLayout,
  type WallMountPurpose,
  type WallMountSurface,
} from '../environment';
import type { FurnitureBuildInput, FurniturePlanInput, PlacedProp, PropBuildResult, PropPlanEntry, PropSize } from './FurnitureModule';
import { boxMesh, cylinderMesh, furnitureMaterial, propMesh, sphereMesh, torusMesh, wallMountTransform, yawForDirection } from './materials';
import { countMeshes } from './tables';

/* -------------------------------------------------------------------------- */
/* Zones                                                                      */
/* -------------------------------------------------------------------------- */

/** Coat stand: by the door, clear of the swing volume. */
const COAT_STAND = Object.freeze({ x: -1.35, z: 4.15 });
/** Magazine rack: against the left wall, past the banquette run. */
const MAGAZINE_RACK = Object.freeze({ x: -4.28, z: 3.85, width: 0.9, depth: 0.34 });
/** Waste unit: inside the entrance, clear of the door's swing. */
const BIN_ENTRANCE = Object.freeze({ x: 1.55, z: 4.35 });
/** Mount heights above the floor for the wall hung fixtures. */
const CLOCK_CENTRE = 1.62;
const PHONE_CENTRE = 1.42;
const HAT_RACK_CENTRE = 1.8;

export interface FixtureZone {
  readonly id: string;
  readonly kind: 'coat-stand' | 'hat-rack' | 'magazine-rack' | 'wall-clock' | 'payphone' | 'waste-bin';
  readonly label: string;
  readonly center: RoomPoint;
  readonly size: PropSize;
  readonly rotationY: number;
  readonly support: 'floor' | 'elevated';
  readonly tags: readonly string[];
}

function mountFor(
  layout: StructuralLayout,
  wall: 'left' | 'right' | 'back' | 'front',
  purpose?: WallMountPurpose,
  pick: 'first' | 'nearest-front' = 'first',
): WallMountSurface | undefined {
  const mounts = wallMountsOf(layout, wall, purpose);
  const candidates = mounts.length > 0 ? mounts : wallMountsOf(layout, wall);
  if (candidates.length === 0) return undefined;
  if (pick === 'nearest-front') {
    return candidates.reduce((best, mount) => (mount.position.z > best.position.z ? mount : best));
  }
  return candidates[0];
}

function wallFixture(
  id: string,
  kind: FixtureZone['kind'],
  label: string,
  mount: WallMountSurface,
  size: PropSize,
  centreHeight: number,
  tags: readonly string[],
): FixtureZone {
  const transform = wallMountTransform(mount, { depth: size.z, height: centreHeight });
  return {
    id,
    kind,
    label,
    center: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
    size,
    rotationY: transform.rotationY,
    support: 'elevated',
    tags,
  };
}

/** Every fixture placement of one era, without building anything. */
export function fixtureZones(input: FurniturePlanInput): readonly FixtureZone[] {
  const { fixtures } = input.spec;
  const radii = Math.max(fixtures.coatStand.radius, 0.2);
  const zones: FixtureZone[] = [];

  zones.push({
    id: 'furniture:coat-stand',
    kind: 'coat-stand',
    label: fixtures.coatStand.style,
    center: { x: COAT_STAND.x, y: fixtures.coatStand.height / 2, z: COAT_STAND.z },
    size: { x: radii * 2, y: fixtures.coatStand.height, z: radii * 2 },
    rotationY: 0,
    support: 'floor',
    tags: [fixtures.coatStand.kind],
  });

  const hatMount = mountFor(input.layout, 'left', undefined, 'nearest-front');
  if (hatMount) {
    zones.push(
      wallFixture(
        'furniture:hat-rack',
        'hat-rack',
        fixtures.hatRack.style,
        hatMount,
        { x: fixtures.hatRack.width, y: 0.48, z: 0.2 },
        HAT_RACK_CENTRE,
        [fixtures.hatRack.kind],
      ),
    );
  }

  const clockMount = mountFor(input.layout, 'right', 'clock');
  if (clockMount) {
    zones.push(
      wallFixture(
        'furniture:wall-clock',
        'wall-clock',
        fixtures.clock.style,
        clockMount,
        { x: fixtures.clock.radius * 2, y: fixtures.clock.radius * 2, z: 0.18 },
        CLOCK_CENTRE,
        [fixtures.clock.kind],
      ),
    );
  }

  const phoneMount = mountFor(input.layout, 'right');
  if (phoneMount) {
    zones.push(
      wallFixture(
        'furniture:payphone',
        'payphone',
        fixtures.phone.style,
        phoneMount,
        { x: fixtures.phone.width, y: fixtures.phone.height + 0.14, z: 0.3 },
        PHONE_CENTRE,
        [fixtures.phone.kind],
      ),
    );
  }

  zones.push({
    id: 'furniture:magazine-rack',
    kind: 'magazine-rack',
    label: fixtures.magazineRack.style,
    center: { x: MAGAZINE_RACK.x, y: fixtures.magazineRack.height / 2, z: MAGAZINE_RACK.z },
    size: { x: MAGAZINE_RACK.width, y: fixtures.magazineRack.height, z: MAGAZINE_RACK.depth },
    rotationY: yawForDirection(1, 0),
    support: 'floor',
    tags: [fixtures.magazineRack.kind],
  });

  const bin = fixtures.bin;
  // One waste unit per era, standing inside the entrance where the storefront
  // gives it a wall and the aisle leaves it alone. Its compartments carry the
  // era's recycling culture: a single pedal bin in 1945, a three-stream
  // station in 2025.
  zones.push({
    id: 'furniture:waste-bin',
    kind: 'waste-bin',
    label: bin.style,
    center: { x: BIN_ENTRANCE.x, y: bin.height / 2, z: BIN_ENTRANCE.z },
    size: { x: bin.width, y: bin.height, z: bin.depth },
    rotationY: Math.PI,
    support: 'floor',
    tags: [bin.kind, `streams:${bin.compartments}`],
  });

  return zones;
}

/** Every fixture plan entry of one era. */
export function planFixtures(input: FurniturePlanInput): readonly PropPlanEntry[] {
  return fixtureZones(input).map((zone) => ({
    id: zone.id,
    kind: zone.kind,
    group: 'fixtures' as const,
    label: zone.label,
    center: zone.center,
    size: zone.size,
    rotationY: zone.rotationY,
    support: zone.support,
    tags: zone.tags,
  }));
}

/* -------------------------------------------------------------------------- */
/* Geometry                                                                   */
/* -------------------------------------------------------------------------- */

function partName(id: string, part: string): string {
  return `${id}:${part}`;
}

function buildCoatStand(zone: FixtureZone, input: FurnitureBuildInput): THREE.Group {
  const spec = input.spec.fixtures.coatStand;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'coat-stand';
  const post = furnitureMaterial(input.materials, spec.postSlot);
  const hook = furnitureMaterial(input.materials, spec.hookSlot);
  const radius = zone.size.x / 2;
  const height = spec.height;

  group.add(
    cylinderMesh(radius * 0.82, radius, 0.05, post, {
      name: partName(zone.id, 'base'),
      part: 'coat-stand-base',
      position: [0, 0.025, 0],
    }, 22),
    cylinderMesh(radius * 0.55, radius * 0.7, 0.03, hook, {
      name: partName(zone.id, 'drip-tray'),
      part: 'coat-stand-tray',
      position: [0, 0.06, 0],
    }, 20),
    cylinderMesh(0.035, 0.045, height - 0.06, post, {
      name: partName(zone.id, 'post'),
      part: 'coat-stand-post',
      position: [0, (height - 0.06) / 2 + 0.06, 0],
    }, 16),
    sphereMesh(0.045, hook, {
      name: partName(zone.id, 'finial'),
      part: 'coat-stand-finial',
      position: [0, height + 0.02, 0],
    }),
  );

  const hooks = Math.max(spec.hooks, 4);
  for (let index = 0; index < hooks; index += 1) {
    const angle = (index / hooks) * Math.PI * 2;
    group.add(
      cylinderMesh(0.012, 0.014, 0.16, hook, {
        name: partName(zone.id, 'hook'),
        part: 'coat-stand-hook',
        position: [Math.cos(angle) * 0.07, height - 0.16, Math.sin(angle) * 0.07],
        rotation: [Math.cos(angle) * 1.15, 0, -Math.sin(angle) * 1.15],
      }),
    );
  }
  // A lower ring of hooks for bags and umbrellas.
  for (let index = 0; index < hooks; index += 1) {
    const angle = (index / hooks) * Math.PI * 2 + Math.PI / hooks;
    group.add(
      cylinderMesh(0.01, 0.011, 0.11, hook, {
        name: partName(zone.id, 'hook-low'),
        part: 'coat-stand-hook',
        position: [Math.cos(angle) * 0.06, height - 0.5, Math.sin(angle) * 0.06],
        rotation: [Math.cos(angle) * 1.3, 0, -Math.sin(angle) * 1.3],
      }),
    );
  }

  return group;
}

function buildHatRack(zone: FixtureZone, input: FurnitureBuildInput): THREE.Group {
  const spec = input.spec.fixtures.hatRack;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'hat-rack';
  const board = furnitureMaterial(input.materials, spec.boardSlot);
  const hook = furnitureMaterial(input.materials, spec.hookSlot);
  const width = spec.width;
  const halfHeight = zone.size.y / 2;

  group.add(
    boxMesh([width, zone.size.y * 0.82, 0.05], board, {
      name: partName(zone.id, 'board'),
      part: 'hat-rack-board',
      position: [0, -0.03, -0.07],
    }),
    boxMesh([width + 0.04, 0.04, 0.08], board, {
      name: partName(zone.id, 'rail'),
      part: 'hat-rack-rail',
      position: [0, halfHeight - 0.035, -0.05],
    }),
    boxMesh([width, 0.035, 0.05], hook, {
      name: partName(zone.id, 'plate'),
      part: 'hat-rack-plate',
      position: [0, -halfHeight + 0.05, -0.06],
    }),
  );

  const pegs = Math.max(Math.round(width / 0.18), 3);
  for (let index = 0; index < pegs; index += 1) {
    const x = -width / 2 + (width / pegs) * (index + 0.5);
    group.add(
      cylinderMesh(0.011, 0.014, 0.12, hook, {
        name: partName(zone.id, 'peg'),
        part: 'hat-rack-peg',
        position: [x, 0.04, 0],
        rotation: [Math.PI / 2.6, 0, 0],
      }),
      sphereMesh(0.016, hook, {
        name: partName(zone.id, 'peg-tip'),
        part: 'hat-rack-peg',
        position: [x, -0.015, 0.06],
      }),
    );
  }

  return group;
}

function buildMagazineRack(zone: FixtureZone, input: FurnitureBuildInput): THREE.Group {
  const spec = input.spec.fixtures.magazineRack;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'magazine-rack';
  const frame = furnitureMaterial(input.materials, spec.frameSlot);
  const pocket = furnitureMaterial(input.materials, spec.pocketSlot);
  const print = furnitureMaterial(input.materials, 'print');
  const width = spec.width;
  const depth = spec.depth;
  const height = spec.height;

  for (const end of [-1, 1]) {
    group.add(
      boxMesh([0.05, height, depth], frame, {
        name: partName(zone.id, 'side'),
        part: 'rack-side',
        position: [end * (width / 2 - 0.025), height / 2, 0],
      }),
    );
  }
  group.add(
    boxMesh([width - 0.1, height * 0.94, 0.03], pocket, {
      name: partName(zone.id, 'back'),
      part: 'rack-back',
      position: [0, height / 2, -depth / 2 + 0.015],
    }),
  );

  const shelves = 3;
  for (let index = 0; index < shelves; index += 1) {
    const y = 0.22 + (height - 0.42) * (index / (shelves - 1));
    group.add(
      boxMesh([width - 0.08, 0.03, depth - 0.06], pocket, {
        name: partName(zone.id, 'shelf'),
        part: 'rack-shelf',
        position: [0, y, 0.01],
        rotation: [-0.22, 0, 0],
      }),
      // A magazine lying on each shelf, so the rack reads as occupied.
      boxMesh([width * 0.34, 0.012, depth * 0.7], print, {
        name: partName(zone.id, 'magazine'),
        part: 'rack-magazine',
        position: [index % 2 === 0 ? -width * 0.16 : width * 0.16, y + 0.024, 0.02],
        rotation: [-0.22, 0.12, 0],
      }),
    );
  }

  group.add(
    boxMesh([width, 0.04, depth - 0.02], frame, {
      name: partName(zone.id, 'top'),
      part: 'rack-top',
      position: [0, height - 0.02, 0],
    }),
  );

  return group;
}

function buildWallClock(zone: FixtureZone, input: FurnitureBuildInput): THREE.Group {
  const spec = input.spec.fixtures.clock;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'wall-clock';
  const casing = furnitureMaterial(input.materials, spec.caseSlot);
  const face = furnitureMaterial(input.materials, spec.faceSlot);
  const hand = furnitureMaterial(input.materials, spec.handSlot);
  const radius = spec.radius;
  const square = spec.kind === 'electric-square' || spec.kind === 'digital-panel';
  const caseZ = -zone.size.z / 2 + 0.045;

  group.add(
    square
      ? boxMesh([radius * 2, radius * 2, 0.09], casing, {
          name: partName(zone.id, 'case'),
          part: 'clock-case',
          position: [0, 0, caseZ],
        })
      : cylinderMesh(radius, radius, 0.09, casing, {
          name: partName(zone.id, 'case'),
          part: 'clock-case',
          position: [0, 0, caseZ],
          rotation: [Math.PI / 2, 0, 0],
        }, 26),
    square
      ? boxMesh([radius * 1.6, radius * 1.4, 0.02], face, {
          name: partName(zone.id, 'face'),
          part: 'clock-face',
          position: [0, 0, caseZ + 0.045],
        })
      : cylinderMesh(radius * 0.86, radius * 0.86, 0.02, face, {
          name: partName(zone.id, 'face'),
          part: 'clock-face',
          position: [0, 0, caseZ + 0.04],
          rotation: [Math.PI / 2, 0, 0],
        }, 26),
  );

  if (!square) {
    group.add(
      torusMesh(radius * 0.92, 0.014, hand, {
        name: partName(zone.id, 'bezel'),
        part: 'clock-bezel',
        position: [0, 0, caseZ + 0.045],
      }, 26),
    );
  }

  // Hands live in their own group so the module can tick them each frame.
  const hands = new THREE.Group();
  hands.name = 'furniture:wall-clock-hands';
  hands.userData.furnitureKind = 'clock-hands';
  hands.position.set(0, 0, caseZ + 0.06);
  hands.add(
    boxMesh([0.012, radius * 0.62, 0.008], hand, {
      name: partName(zone.id, 'minute-hand'),
      part: 'clock-hand',
      position: [0, radius * 0.24, 0],
    }),
    boxMesh([0.007, radius * 0.78, 0.006], furnitureMaterial(input.materials, 'accent'), {
      name: partName(zone.id, 'second-hand'),
      part: 'clock-hand',
      position: [0, radius * 0.3, 0],
    }),
    boxMesh([0.014, radius * 0.36, 0.01], hand, {
      name: partName(zone.id, 'hour-hand'),
      part: 'clock-hand',
      position: [0, radius * 0.14, 0],
    }),
  );
  group.add(
    hands,
    cylinderMesh(0.02, 0.02, 0.02, hand, {
      name: partName(zone.id, 'boss'),
      part: 'clock-boss',
      position: [0, 0, caseZ + 0.075],
      rotation: [Math.PI / 2, 0, 0],
    }, 12),
    sphereMesh(0.016, hand, {
      name: partName(zone.id, 'finial'),
      part: 'clock-boss',
      position: [0, 0, caseZ + 0.095],
    }),
  );

  return group;
}

function buildPayphone(zone: FixtureZone, input: FurnitureBuildInput): THREE.Group {
  const spec = input.spec.fixtures.phone;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'payphone';
  const casing = furnitureMaterial(input.materials, spec.caseSlot);
  const trim = furnitureMaterial(input.materials, spec.trimSlot);
  const width = spec.width;
  const height = spec.height;
  const caseY = 0.06;

  group.add(
    boxMesh([width, height, 0.14], casing, {
      name: partName(zone.id, 'case'),
      part: 'phone-case',
      position: [0, caseY, -0.07],
    }),
    boxMesh([width * 0.82, height * 0.34, 0.04], trim, {
      name: partName(zone.id, 'keypad'),
      part: 'phone-keypad',
      position: [0, caseY - height * 0.22, 0.005],
    }),
    boxMesh([width * 0.5, 0.025, 0.05], trim, {
      name: partName(zone.id, 'coin-slot'),
      part: 'phone-coin-slot',
      position: [0, caseY + height * 0.26, 0.005],
    }),
    cylinderMesh(0.028, 0.028, width * 0.86, casing, {
      name: partName(zone.id, 'handset'),
      part: 'phone-handset',
      position: [0, caseY + height * 0.4, 0.03],
      rotation: [0, 0, Math.PI / 2],
    }, 14),
    propMesh(new THREE.TorusGeometry(0.06, 0.008, 8, 14, Math.PI * 1.4), trim, {
      name: partName(zone.id, 'cord'),
      part: 'phone-cord',
      position: [width * 0.34, caseY + height * 0.24, 0.02],
      rotation: [0, 0.4, 0],
    }),
    boxMesh([width * 1.24, 0.025, 0.16], furnitureMaterial(input.materials, 'accent'), {
      name: partName(zone.id, 'shelf'),
      part: 'phone-shelf',
      position: [0, -zone.size.y / 2 + 0.05, 0.03],
    }),
  );

  if (spec.directory) {
    group.add(
      boxMesh([width * 0.8, 0.03, 0.12], furnitureMaterial(input.materials, 'print'), {
        name: partName(zone.id, 'directory'),
        part: 'phone-directory',
        position: [0, -zone.size.y / 2 + 0.08, 0.03],
        rotation: [0, 0.12, 0],
      }),
    );
  }

  return group;
}

function buildBin(zone: FixtureZone, input: FurnitureBuildInput): THREE.Group {
  const spec = input.spec.fixtures.bin;
  const group = new THREE.Group();
  group.name = zone.id;
  group.userData.furnitureKind = 'waste-bin';
  const body = furnitureMaterial(input.materials, spec.bodySlot);
  const lid = furnitureMaterial(input.materials, spec.lidSlot);
  const width = spec.width;
  const depth = spec.depth;
  const height = spec.height;
  const round = spec.kind === 'pedal-bin-enamel' || spec.kind === 'swing-bin' || spec.kind === 'open-bin-steel';

  if (round) {
    const radius = width / 2;
    group.add(
      cylinderMesh(radius * 0.92, radius, height - 0.06, body, {
        name: partName(zone.id, 'body'),
        part: 'bin-body',
        position: [0, (height - 0.06) / 2, 0],
      }, 20),
      cylinderMesh(radius * 1.02, radius * 1.02, 0.04, lid, {
        name: partName(zone.id, 'lid'),
        part: 'bin-lid',
        position: [0, height - 0.02, 0],
      }, 20),
      cylinderMesh(radius * 0.86, radius * 0.86, 0.03, lid, {
        name: partName(zone.id, 'flap'),
        part: 'bin-flap',
        position: [0, height - 0.06, 0.02],
        rotation: [0.2, 0, 0],
      }, 20),
    );
    if (spec.kind === 'pedal-bin-enamel') {
      group.add(
        boxMesh([0.12, 0.02, 0.06], lid, {
          name: partName(zone.id, 'pedal'),
          part: 'bin-pedal',
          position: [0, 0.02, depth / 2 + 0.03],
        }),
      );
    }
  } else {
    group.add(
      boxMesh([width, height - 0.06, depth], body, {
        name: partName(zone.id, 'body'),
        part: 'bin-body',
        position: [0, (height - 0.06) / 2, 0],
      }),
      boxMesh([width, 0.05, depth], lid, {
        name: partName(zone.id, 'lid'),
        part: 'bin-lid',
        position: [0, height - 0.025, 0],
      }),
      boxMesh([width * 0.7, 0.03, depth * 0.6], lid, {
        name: partName(zone.id, 'opening'),
        part: 'bin-opening',
        position: [0, height + 0.005, 0],
      }),
    );
    const streams = Math.max(spec.compartments, 1);
    for (let index = 1; index < streams; index += 1) {
      group.add(
        boxMesh([0.03, height - 0.08, depth * 0.9], lid, {
          name: partName(zone.id, 'divider'),
          part: 'bin-divider',
          position: [-width / 2 + (width / streams) * index, (height - 0.08) / 2, 0],
        }),
      );
    }
  }

  return group;
}

/** Raises the meshes for the planned fixture entries. */
export function buildFixtures(
  input: FurnitureBuildInput,
  entries: readonly PropPlanEntry[],
): PropBuildResult {
  const group = new THREE.Group();
  group.name = 'furniture-fixtures';
  const props: PlacedProp[] = [];
  const landmarks: Record<string, THREE.Object3D> = {};
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  for (const zone of fixtureZones(input)) {
    const entry = byId.get(zone.id);
    if (!entry) throw new Error(`Missing the planned fixture entry "${zone.id}".`);
    let node: THREE.Group;
    switch (zone.kind) {
      case 'coat-stand':
        node = buildCoatStand(zone, input);
        break;
      case 'hat-rack':
        node = buildHatRack(zone, input);
        break;
      case 'magazine-rack':
        node = buildMagazineRack(zone, input);
        break;
      case 'wall-clock':
        node = buildWallClock(zone, input);
        break;
      case 'payphone':
        node = buildPayphone(zone, input);
        break;
      default:
        node = buildBin(zone, input);
        break;
    }
    // Floor fixtures stand on the floor; wall fixtures hang around their mount
    // centre, which is what the plan entry records.
    node.position.set(
      entry.center.x,
      entry.support === 'floor' ? 0 : entry.center.y,
      entry.center.z,
    );
    node.rotation.y = entry.rotationY;
    group.add(node);
    props.push({ ...entry, node });
    landmarks[zone.kind] = node;
    if (zone.kind === 'wall-clock') {
      const hands = node.getObjectByName('furniture:wall-clock-hands');
      if (hands) landmarks['clock-hands'] = hands;
    }
  }

  return { group, props, landmarks, meshCount: countMeshes(group) };
}
