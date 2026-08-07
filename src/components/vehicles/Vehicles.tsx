/**
 * Vehicles — a self-contained R3F module keyed off the foundation era
 * registry. It renders a fleet of era-correct vehicles that drive along
 * simple looping road paths.
 *
 * Fleet efficiency comes from instancing: each body type builds its shared
 * part geometries once, and every vehicle is an instance of those meshes.
 * Per-instance colours are applied through instanceColor so each vehicle
 * reads as a distinct, era-appropriate machine.
 *
 * The component is independent — it is not wired into CityScene; Phase 4
 * integration composes it by rendering `<Vehicles era={currentEra} />`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { EraId } from '../../contracts';
import type { PartKey, VehicleType } from './vehicles';
import { VEHICLE_CONFIG } from './vehicles';
import { ROAD_LOOPS, sampleLoop } from './paths';
import { buildPartGeometry } from './rig';

export interface VehiclesProps {
  /** The era whose traffic should be rendered. */
  era: EraId;
  /** Optional fleet size override (defaults to the era's density). */
  count?: number;
}

interface VehicleInstance {
  typeId: string;
  pathIndex: number;
  /** Starting parameter along the loop (0..1). */
  phase: number;
  /** Driving speed in world units / second. */
  speed: number;
  /** Travel direction along the loop (+1 / -1). */
  dir: 1 | -1;
  /** Per-part colours for this instance. */
  colors: Partial<Record<PartKey, string>>;
}

interface TypeGroup {
  type: VehicleType;
  instances: VehicleInstance[];
  parts: PartKey[];
}

const ALL_PARTS: PartKey[] = ['wheels', 'body', 'cabin', 'trim', 'lights'];
const DEFAULT_PART_COLOR = '#c9c9c9';

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

function pickType(types: VehicleType[], rand: () => number): VehicleType {
  const total = types.reduce((s, t) => s + t.weight, 0);
  let r = rand() * total;
  for (const t of types) {
    r -= t.weight;
    if (r <= 0) return t;
  }
  return types[types.length - 1];
}

function pickColors(
  type: VehicleType,
  rand: () => number,
): Partial<Record<PartKey, string>> {
  const colors: Partial<Record<PartKey, string>> = {};
  for (const part of ALL_PARTS) {
    const pool = type.colorPools[part];
    if (pool && pool.length > 0) {
      colors[part] = pick(pool, rand);
    }
  }
  return colors;
}

function buildFleet(
  types: VehicleType[],
  n: number,
  speedRange: [number, number],
): VehicleInstance[] {
  let seed = 2025;
  const rand = () => {
    // Deterministic LCG so the fleet is stable across renders.
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const instances: VehicleInstance[] = [];
  for (let i = 0; i < n; i += 1) {
    const type = pickType(types, rand);
    instances.push({
      typeId: type.id,
      pathIndex: i % ROAD_LOOPS.length,
      phase: rand(),
      speed: speedRange[0] + rand() * (speedRange[1] - speedRange[0]),
      dir: rand() < 0.5 ? 1 : -1,
      colors: pickColors(type, rand),
    });
  }
  return instances;
}

function groupByType(
  instances: VehicleInstance[],
  types: VehicleType[],
): TypeGroup[] {
  const byId = new Map<string, VehicleInstance[]>();
  for (const inst of instances) {
    const list = byId.get(inst.typeId);
    if (list) list.push(inst);
    else byId.set(inst.typeId, [inst]);
  }
  return types
    .filter((t) => byId.has(t.id))
    .map((t) => ({
      type: t,
      instances: byId.get(t.id)!,
      parts: ALL_PARTS,
    }));
}

function computeInstanceMatrix(
  inst: VehicleInstance,
  t: number,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const loop = ROAD_LOOPS[inst.pathIndex];
  const travel = t * inst.speed * inst.dir;
  const u = (((inst.phase + travel / loop.total) % 1) + 1) % 1;
  const s = sampleLoop(loop, u);
  const yaw = Math.atan2(s.tx, s.tz) + (inst.dir < 0 ? Math.PI : 0);

  // Wheels bottom out at y = 0, so vehicles sit on the road surface.
  scratchPosition.set(s.x, 0, s.z);
  scratchQuat.setFromEuler(scratchEuler.set(0, yaw, 0));
  return out.compose(scratchPosition, scratchQuat, scratchOne);
}

// Scratch objects reused across the whole fleet each frame (GC-free hot loop).
const scratchPosition = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchOne = new THREE.Vector3(1, 1, 1);
const scratchMatrix = new THREE.Matrix4();

export function Vehicles({ era, count }: VehiclesProps) {
  const config = useMemo(() => VEHICLE_CONFIG[era], [era]);
  const n = count ?? config.count;

  const fleet = useMemo(
    () => buildFleet(config.types, n, config.speedRange),
    [config, n],
  );
  const groups = useMemo(
    () => groupByType(fleet, config.types),
    [fleet, config],
  );

  const geometries = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    for (const group of groups) {
      for (const part of group.parts) {
        map.set(
          `${group.type.id}:${part}`,
          buildPartGeometry(group.type, part),
        );
      }
    }
    return map;
  }, [groups]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.35,
        metalness: 0.55,
      }),
    [],
  );

  const meshRefs = useRef(new Map<string, THREE.InstancedMesh>());
  const setMeshRef = (key: string) => (mesh: THREE.InstancedMesh | null) => {
    if (mesh) meshRefs.current.set(key, mesh);
    else meshRefs.current.delete(key);
  };

  // Apply per-instance colours once after mounting.
  useLayoutEffect(() => {
    for (const group of groups) {
      for (const part of group.parts) {
        const mesh = meshRefs.current.get(`${group.type.id}:${part}`);
        if (!mesh) continue;
        group.instances.forEach((inst, j) => {
          mesh.setColorAt(
            j,
            new THREE.Color(inst.colors[part] ?? DEFAULT_PART_COLOR),
          );
        });
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }, [groups]);

  // Animate the fleet.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const group of groups) {
      for (const part of group.parts) {
        const mesh = meshRefs.current.get(`${group.type.id}:${part}`);
        if (!mesh) continue;
        group.instances.forEach((inst, j) => {
          computeInstanceMatrix(inst, t, scratchMatrix);
          mesh.setMatrixAt(j, scratchMatrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
    }
  });

  // Dispose geometries/materials on unmount.
  useEffect(() => {
    return () => {
      for (const geometry of geometries.values()) geometry.dispose();
      material.dispose();
    };
  }, [geometries, material]);

  return (
    <group>
      {groups.map((group) => (
        <group key={group.type.id}>
          {group.parts.map((part) => (
            <instancedMesh
              key={part}
              ref={setMeshRef(`${group.type.id}:${part}`)}
              args={[
                geometries.get(`${group.type.id}:${part}`),
                material,
                group.instances.length,
              ]}
              castShadow
              receiveShadow
            />
          ))}
        </group>
      ))}
    </group>
  );
}

export default Vehicles;
