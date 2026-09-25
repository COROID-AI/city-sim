/**
 * The street grid: two crossing streets, four sidewalk quadrants, curbs,
 * crosswalks, lane markings, era roadway surfaces (cobbles with tram rails in
 * 1945 → patched asphalt → fresh asphalt with a protected bike lane in 2025),
 * plus the micro-detail that sells the ground plane (patches, potholes, leaf
 * litter, drain grates).
 *
 * Also exports {@link LAYOUT} and {@link buildingSlots}, the single source of
 * truth for the block geometry shared by buildings, props, signage and the sims.
 */

import * as THREE from 'three';
import type { WorldKit } from './textures';

export const LAYOUT = {
  /** Half-size of the paved ground plane. */
  groundHalf: 96,
  /** Half-width of each roadway. */
  streetHalfWidth: 7.5,
  /** Sidewalk width beyond the kerb. */
  sidewalkWidth: 6,
  /** Top surface height of the kerb / sidewalk slab. */
  sidewalkY: 0.22,
  /** |x| of the first facade line. */
  frontageOffset: 13.5,
  /** Body height of the kerb stones. */
  curbHeight: 0.28,
} as const;

/** Frontage line: where the first building facade sits. */
export const FRONTAGE = LAYOUT.streetHalfWidth + LAYOUT.sidewalkWidth;

export interface BuildingSlot {
  /** World-space centre of the building footprint. */
  x: number;
  z: number;
  /** Footprint size. */
  width: number;
  depth: number;
  /** Facade axis: 'x' means the shop front faces +/-x (toward the N-S street). */
  facing: 'x' | 'z';
  facingSign: 1 | -1;
  /** Corner / tower plot - gets the maximum available storey count. */
  landmark: boolean;
  /** 1 = front row on the street, 2 = mid-block, 3 = outer skyline ring. */
  ring: 1 | 2 | 3;
}

function slotFacing(x: number, z: number): { facing: 'x' | 'z'; facingSign: 1 | -1 } {
  // Face whichever street is closer.
  if (Math.abs(x) <= Math.abs(z)) {
    return { facing: 'x', facingSign: x >= 0 ? -1 : 1 };
  }
  return { facing: 'z', facingSign: z >= 0 ? -1 : 1 };
}

/** The 32 building plots of the block, in stable generation order. */
export function buildingSlots(): BuildingSlot[] {
  const slots: BuildingSlot[] = [];
  const columnX = [21, 41, 61];
  const rowZ = [21, 40];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (let col = 0; col < columnX.length; col += 1) {
        for (let row = 0; row < rowZ.length; row += 1) {
          const x = sx * columnX[col];
          const z = sz * rowZ[row];
          const { facing, facingSign } = slotFacing(x, z);
          slots.push({
            x,
            z,
            width: col === 0 ? 15 : 16,
            depth: row === 0 ? 13 : 15,
            facing,
            facingSign,
            landmark: col === 0 && row === 0,
            ring: col === 0 || row === 0 ? 1 : 2,
          });
        }
      }
    }
  }
  // Outer skyline ring: taller infill towers silhouetted behind the block.
  const outer: Array<[number, number]> = [
    [-80, -42],
    [80, -42],
    [-80, 42],
    [80, 42],
    [-44, -80],
    [44, -80],
    [-44, 80],
    [44, 80],
  ];
  for (const [x, z] of outer) {
    const { facing, facingSign } = slotFacing(x, z);
    slots.push({ x, z, width: 18, depth: 17, facing, facingSign, landmark: false, ring: 3 });
  }
  return slots;
}

export interface RoadCounts {
  sidewalks: number;
  crosswalks: number;
  laneMarkings: number;
  rails: number;
  patches: number;
}

export interface RoadBuild {
  group: THREE.Group;
  markings: THREE.Group;
  rails: THREE.Group;
  bikeLane: THREE.Group;
  counts: RoadCounts;
  hasTramRails: boolean;
  hasBikeLane: boolean;
}

function flatPlane(kit: WorldKit, width: number, depth: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(kit.geometry.plane(width, depth), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  return mesh;
}

/** Cobbles for the oldest era, asphalt from 1965 onwards. */
function roadSurfaceKind(eraYear: number): 'cobble' | 'asphalt' {
  return eraYear <= 1945 ? 'cobble' : 'asphalt';
}

export function createRoads(kit: WorldKit): RoadBuild {
  const { era, rng, library, geometry } = kit;
  const group = new THREE.Group();
  group.name = 'roads';
  const markings = new THREE.Group();
  markings.name = 'road-markings';
  const rails = new THREE.Group();
  rails.name = 'tram-rails';
  const bikeLane = new THREE.Group();
  bikeLane.name = 'bike-lane';

  const surfaceKind = roadSurfaceKind(era.year);
  const roadColor = surfaceKind === 'cobble' ? '#5b564c' : era.year >= 2005 ? '#3a3d42' : '#44474d';
  const roadMaterial = library.surface(roadColor, surfaceKind, [6, 6]);

  // Ground plane (dirt / packed earth, mostly hidden by roads and buildings).
  const ground = flatPlane(kit, LAYOUT.groundHalf * 2, LAYOUT.groundHalf * 2, library.surface('#4b4a44', surfaceKind, [10, 10]));
  ground.position.y = -0.02;
  group.add(ground);

  // Two crossing roadways.
  const roadX = flatPlane(kit, LAYOUT.groundHalf * 2, LAYOUT.streetHalfWidth * 2, roadMaterial);
  roadX.position.y = 0;
  const roadZ = flatPlane(kit, LAYOUT.streetHalfWidth * 2, LAYOUT.groundHalf * 2, roadMaterial);
  roadZ.position.y = 0.001;
  group.add(roadX, roadZ);

  // Sidewalk quadrants with kerbs.
  const sidewalkMaterial = library.surface('#9a978c', 'sidewalk', [8, 8]);
  const kerbMaterial = library.flat('#7d7a72', { roughness: 0.9 });
  const quadrants: Array<[number, number]> = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  let sidewalks = 0;
  for (const [sx, sz] of quadrants) {
    const inner = FRONTAGE;
    const outer = LAYOUT.groundHalf;
    const size = outer - inner;
    const centre = inner + size / 2;
    const slab = flatPlane(kit, size, size, sidewalkMaterial);
    slab.position.set(sx * centre, LAYOUT.sidewalkY, sz * centre);
    group.add(slab);
    sidewalks += 1;

    // Kerb stones along both street edges of this quadrant.
    const kerbAlongX = new THREE.Mesh(geometry.box(size, LAYOUT.curbHeight, 0.5), kerbMaterial);
    kerbAlongX.position.set(sx * centre, LAYOUT.sidewalkY - LAYOUT.curbHeight / 2, sz * inner + sz * -0.25);
    const kerbAlongZ = new THREE.Mesh(geometry.box(0.5, LAYOUT.curbHeight, size), kerbMaterial);
    kerbAlongZ.position.set(sx * inner + sx * -0.25, LAYOUT.sidewalkY - LAYOUT.curbHeight / 2, sz * centre);
    kerbAlongX.castShadow = false;
    kerbAlongZ.castShadow = false;
    group.add(kerbAlongX, kerbAlongZ);
  }

  // Crosswalks on all four approaches.
  let crosswalks = 0;
  const zebraMaterial = library.marking('#d8d5c8', 0.85);
  for (let i = 0; i < 4; i += 1) {
    const alongX = i < 2;
    const sign = i % 2 === 0 ? -1 : 1;
    for (let stripe = 0; stripe < 7; stripe += 1) {
      const offset = -LAYOUT.streetHalfWidth + 1 + stripe * 2.1;
      const bar = flatPlane(kit, alongX ? 1.2 : 13, alongX ? 13 : 1.2, zebraMaterial);
      const edge = sign * (LAYOUT.streetHalfWidth + 1.6);
      bar.position.set(alongX ? edge : offset, 0.012, alongX ? offset : edge);
      markings.add(bar);
    }
    crosswalks += 1;
  }

  // Dashed centre lines outside the intersection.
  let laneMarkings = 0;
  const lineMaterial = library.marking('#d8c66a', 0.8);
  for (const axis of ['x', 'z'] as const) {
    for (const sign of [-1, 1]) {
      for (let d = 16; d < LAYOUT.groundHalf; d += 8) {
        const bar = flatPlane(kit, axis === 'x' ? 5 : 0.35, axis === 'x' ? 0.35 : 5, lineMaterial);
        bar.position.set(axis === 'x' ? sign * (d + 2.5) : 0, 0.014, axis === 'x' ? 0 : sign * (d + 2.5));
        markings.add(bar);
        laneMarkings += 1;
      }
    }
  }

  // Tram rails (1945 / 1965): two pairs of embedded steel rails per street.
  if (era.props.tramRails) {
    const railMaterial = library.metal('#9aa0a6', 0.28);
    for (const axis of ['x', 'z'] as const) {
      // Rails run from the intersection out to the block edges on both sides.
      for (const sign of [-1, 1]) {
        for (const offset of [-3.2, -1.4, 1.4, 3.2]) {
          const length = LAYOUT.groundHalf - FRONTAGE;
          const centre = sign * (FRONTAGE + length / 2);
          const rail = new THREE.Mesh(
            geometry.box(axis === 'x' ? length : 0.22, 0.1, axis === 'x' ? 0.22 : length),
            railMaterial,
          );
          rail.position.set(axis === 'x' ? centre : offset, 0.05, axis === 'x' ? offset : centre);
          rail.castShadow = false;
          rail.receiveShadow = true;
          rails.add(rail);
        }
      }
    }
  }

  // Protected bike lane (2025).
  if (era.props.bikeLane) {
    const laneMaterial = library.surface('#2f8f5f', 'asphalt', [2, 8], 0.8);
    const offset = LAYOUT.streetHalfWidth - 1.9;
    for (const axis of ['x', 'z'] as const) {
      for (const sign of [-1, 1]) {
        const length = LAYOUT.groundHalf - FRONTAGE;
        const lane = flatPlane(kit, axis === 'x' ? length : 2.4, axis === 'x' ? 2.4 : length, laneMaterial);
        lane.position.set(
          axis === 'x' ? (FRONTAGE + length / 2) : sign * offset,
          0.02,
          axis === 'x' ? sign * offset : FRONTAGE + length / 2,
        );
        bikeLane.add(lane);
      }
    }
  }

  // Surface wear: patches, potholes, leaf litter and drain grates.
  let patches = 0;
  const patchMaterial = library.flat('#33353a', { roughness: 0.98 });
  for (let i = 0; i < 26; i += 1) {
    const onX = rng.chance(0.5);
    const position = rng.range(-LAYOUT.groundHalf + 8, LAYOUT.groundHalf - 8);
    const lateral = rng.range(-LAYOUT.streetHalfWidth + 1, LAYOUT.streetHalfWidth - 1);
    const patch = flatPlane(kit, rng.range(2, 7), rng.range(1.5, 5), patchMaterial);
    patch.position.set(onX ? position : lateral, 0.018, onX ? lateral : position);
    patch.rotation.z = rng.range(0, Math.PI);
    group.add(patch);
    patches += 1;
  }
  const grateMaterial = library.metal('#4a4d52', 0.5);
  for (const [sx, sz] of quadrants) {
    const grate = new THREE.Mesh(geometry.box(0.9, 0.08, 1.6), grateMaterial);
    grate.position.set(sx * (LAYOUT.streetHalfWidth + 0.6), 0.01, sz * rng.range(20, 70));
    grate.castShadow = false;
    group.add(grate);
  }

  // Season-appropriate litter on the sidewalks.
  const litterColor = era.year <= 1965 ? '#8a7a4f' : era.year <= 1995 ? '#7a6a3f' : '#5f7a5f';
  const litterMaterial = library.flat(litterColor, { roughness: 1, side: THREE.DoubleSide });
  for (let i = 0; i < 90; i += 1) {
    const onX = rng.chance(0.5);
    const along = rng.range(FRONTAGE + 1, LAYOUT.groundHalf - 2) * (rng.chance(0.5) ? 1 : -1);
    const lateral = rng.range(FRONTAGE + 0.5, FRONTAGE + LAYOUT.sidewalkWidth - 1) * (rng.chance(0.5) ? 1 : -1);
    const leaf = flatPlane(kit, rng.range(0.2, 0.6), rng.range(0.15, 0.45), litterMaterial);
    leaf.position.set(onX ? along : lateral, LAYOUT.sidewalkY + 0.012, onX ? lateral : along);
    leaf.rotation.z = rng.range(0, Math.PI);
    leaf.castShadow = false;
    group.add(leaf);
  }

  group.add(markings, rails, bikeLane);

  return {
    group,
    markings,
    rails,
    bikeLane,
    counts: { sidewalks, crosswalks, laneMarkings, rails: rails.children.length, patches },
    hasTramRails: era.props.tramRails,
    hasBikeLane: era.props.bikeLane,
  };
}
