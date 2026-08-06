/**
 * Era-variant vehicles module.
 *
 * A self-contained R3F module that renders an era-appropriate fleet of
 * procedurally-authored vehicles driving on simple looping paths around the
 * city block. It is keyed off the foundation era registry (`EraId`): switching
 * the `era` prop swaps the body shapes, colours, two-tone accents, livery and
 * traffic density for that time period.
 *
 * Efficiency: each vehicle type's part geometries/materials are built once and
 * shared by every instance of that type, and each part is drawn through an
 * `InstancedMesh` (per-instance colour + matrix), so a whole era fleet renders
 * in very few draw calls.
 *
 * The module is independent — integration into the main scene happens in a
 * later phase. Drop `<Vehicles era={currentEra} />` into a `<Canvas>` to use
 * it.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EraId } from '../contracts';
import {
  VEHICLE_TYPES,
  createPartGeometry,
  createPartMaterial,
  resolvePartColor,
  type VehicleInstance,
  type VehicleTypeId,
} from './vehicleTypes';
import { ERA_VEHICLE_CONFIG, generateInstances } from './vehicleEras';
import { ROAD_LOOPS, pointOnLoop, type RectLoop } from './paths';

const ROAD_WIDTH = 1.1;
const ONE = new THREE.Vector3(1, 1, 1);
const UP = new THREE.Vector3(0, 1, 0);

/** Renders the road strips that the fleet drives on (self-contained preview). */
function RoadLoop({ loop }: { loop: RectLoop }) {
  const { corners } = loop;
  return (
    <group>
      {corners.map((_, i) => {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        const mx = (a[0] + b[0]) / 2;
        const mz = (a[1] + b[1]) / 2;
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
        return (
          <mesh key={i} position={[mx, -0.06, mz]} rotation={[0, -angle, 0]} receiveShadow>
            <boxGeometry args={[len, 0.12, ROAD_WIDTH]} />
            <meshStandardMaterial color="#383b40" roughness={0.95} metalness={0} />
          </mesh>
        );
      })}
    </group>
  );
}

interface VehicleTypeGroupProps {
  typeId: VehicleTypeId;
  instances: VehicleInstance[];
}

/**
 * Renders all instances of a single vehicle type via shared geometry +
 * InstancedMesh. One InstancedMesh per part of the body.
 */
function VehicleTypeGroup({ typeId, instances }: VehicleTypeGroupProps) {
  const parts = VEHICLE_TYPES[typeId];
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  const geometries = useMemo(() => parts.map((p) => createPartGeometry(p)), [parts]);
  const materials = useMemo(() => parts.map((p) => createPartMaterial(p)), [parts]);

  // Static vehicle-local transform for each part (position/rotation/scale).
  const partLocalMatrices = useMemo(
    () =>
      parts.map((p) => {
        const m = new THREE.Matrix4();
        const e = new THREE.Euler(p.rotation?.[0] ?? 0, p.rotation?.[1] ?? 0, p.rotation?.[2] ?? 0);
        const s = p.scale ?? [1, 1, 1];
        m.compose(
          new THREE.Vector3(p.position[0], p.position[1], p.position[2]),
          new THREE.Quaternion().setFromEuler(e),
          new THREE.Vector3(s[0], s[1], s[2]),
        );
        return m;
      }),
    [parts],
  );

  // Set per-instance colours once (body / accent / livery / trim / lights).
  useLayoutEffect(() => {
    instances.forEach((inst, i) => {
      parts.forEach((part, pi) => {
        const mesh = meshRefs.current[pi];
        if (!mesh) return;
        mesh.setColorAt(i, new THREE.Color(resolvePartColor(part, inst)));
      });
    });
    meshRefs.current.forEach((m) => {
      if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }, [instances, parts]);

  // Animate: advance each vehicle along its loop and write instance matrices.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const vehicleMatrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scratch = new THREE.Matrix4();

    instances.forEach((inst, i) => {
      const loop = ROAD_LOOPS[inst.loopIndex % ROAD_LOOPS.length];
      const { position, heading } = pointOnLoop(loop.corners, inst, t);
      quat.setFromAxisAngle(UP, heading);
      vehicleMatrix.compose(position, quat, ONE);

      for (let pi = 0; pi < parts.length; pi++) {
        const mesh = meshRefs.current[pi];
        if (!mesh) continue;
        scratch.copy(vehicleMatrix).multiply(partLocalMatrices[pi]);
        mesh.setMatrixAt(i, scratch);
      }
    });

    meshRefs.current.forEach((m) => {
      if (m) m.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <group>
      {parts.map((_, pi) => (
        <instancedMesh
          key={pi}
          ref={(node) => {
            meshRefs.current[pi] = node;
          }}
          args={[geometries[pi], materials[pi], instances.length]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}

export interface VehiclesProps {
  /** The era whose fleet should be displayed. */
  era: EraId;
  /** Render the looping road strips (self-contained preview). Default true. */
  showRoads?: boolean;
  /** Optional explicit seed for reproducible fleets. */
  seed?: number;
}

/**
 * Era-variant vehicles module.
 *
 * Accepts the current era and renders the matching fleet. Self-contained and
 * independent; integrates into the main scene in a later phase.
 */
export function Vehicles({ era, showRoads = true, seed }: VehiclesProps) {
  const config = ERA_VEHICLE_CONFIG[era];
  const instances = useMemo(() => generateInstances(config, era, seed), [config, era, seed]);

  const byType = useMemo(() => {
    const map = new Map<VehicleTypeId, VehicleInstance[]>();
    for (const inst of instances) {
      const arr = map.get(inst.type) ?? [];
      arr.push(inst);
      map.set(inst.type, arr);
    }
    return Array.from(map.entries());
  }, [instances]);

  return (
    <group>
      {showRoads && ROAD_LOOPS.map((loop, i) => <RoadLoop key={i} loop={loop} />)}
      {byType.map(([typeId, groupInstances]) => (
        <VehicleTypeGroup key={typeId} typeId={typeId} instances={groupInstances} />
      ))}
    </group>
  );
}
