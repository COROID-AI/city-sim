/**
 * Pedestrians — a self-contained R3F module keyed off the foundation era
 * registry. It renders a crowd of era-correct pedestrians that walk along
 * simple looping sidewalk paths with idle variation.
 *
 * Crowd efficiency comes from instancing: each outfit variant builds its
 * shared part geometries once, and every pedestrian is an instance of those
 * meshes. Per-instance colours are applied through instanceColor so each
 * figure reads as a distinct, era-appropriate person.
 *
 * The component is independent — it is not wired into CityScene; Phase 4
 * integration composes it by rendering `<Pedestrians era={currentEra} />`.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { EraId } from '../../contracts';
import type { OutfitVariant, PartKey } from './outfits';
import { PEDESTRIAN_CONFIG, SHARED_POOLS } from './outfits';
import { LOOP_DATA, sampleLoop } from './paths';
import { buildPartGeometry, computePartLocal, variantParts } from './rig';

export interface PedestriansProps {
  /** The era whose crowd should be rendered. */
  era: EraId;
  /** Optional crowd size override (defaults to the era's density). */
  count?: number;
}

interface CrowdInstance {
  variantId: string;
  pathIndex: number;
  /** Starting parameter along the loop (0..1). */
  phase: number;
  /** Walking speed in world units / second. */
  speed: number;
  /** Travel direction along the loop (+1 / -1). */
  dir: 1 | -1;
  /** Idle variation: this figure stands and bobs instead of walking. */
  idle: boolean;
  /** Fixed facing yaw (used when idle). */
  facingYaw: number;
  /** Per-part colours for this instance. */
  colors: Partial<Record<PartKey, string>>;
}

interface VariantGroup {
  variant: OutfitVariant;
  instances: CrowdInstance[];
  parts: PartKey[];
}

const DEFAULT_PART_COLOR = '#c9c9c9';

function pick<T>(arr: T[], rand: () => number): T {
  return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))];
}

function pickVariant(
  variants: OutfitVariant[],
  rand: () => number,
): OutfitVariant {
  const total = variants.reduce((s, v) => s + v.weight, 0);
  let r = rand() * total;
  for (const v of variants) {
    r -= v.weight;
    if (r <= 0) return v;
  }
  return variants[variants.length - 1];
}

function pickColors(
  variant: OutfitVariant,
  rand: () => number,
): Partial<Record<PartKey, string>> {
  const colors: Partial<Record<PartKey, string>> = {};
  for (const part of variantParts(variant)) {
    const pool = variant.colorPools[part];
    if (pool && pool.length > 0) {
      colors[part] = pick(pool, rand);
    }
  }
  // Skin and hair are shared across eras.
  colors.head = pick(SHARED_POOLS.skins, rand);
  colors.hair = pick(SHARED_POOLS.hairs, rand);
  if (variant.hat !== 'none') {
    colors.hat = variant.colorPools.hat?.[0] ?? DEFAULT_PART_COLOR;
  }
  return colors;
}

function buildCrowd(variants: OutfitVariant[], n: number): CrowdInstance[] {
  let seed = 1337;
  const rand = () => {
    // Deterministic LCG so the crowd is stable across renders.
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const instances: CrowdInstance[] = [];
  for (let i = 0; i < n; i += 1) {
    const variant = pickVariant(variants, rand);
    const pathIndex = i % LOOP_DATA.length;
    const phase = rand();
    const idle = rand() < 0.16;
    // Facing derived from the loop tangent at the initial position.
    const s = sampleLoop(LOOP_DATA[pathIndex], phase);
    const dir: 1 | -1 = rand() < 0.5 ? 1 : -1;
    const facingYaw = Math.atan2(s.tx, s.tz) + (dir < 0 ? Math.PI : 0);
    instances.push({
      variantId: variant.id,
      pathIndex,
      phase,
      speed: 0.5 + rand() * 0.7,
      dir,
      idle,
      facingYaw,
      colors: pickColors(variant, rand),
    });
  }
  return instances;
}

function groupByVariant(
  instances: CrowdInstance[],
  variants: OutfitVariant[],
): VariantGroup[] {
  const byId = new Map<string, CrowdInstance[]>();
  for (const inst of instances) {
    const list = byId.get(inst.variantId);
    if (list) list.push(inst);
    else byId.set(inst.variantId, [inst]);
  }
  return variants
    .filter((v) => byId.has(v.id))
    .map((v) => ({
      variant: v,
      instances: byId.get(v.id)!,
      parts: variantParts(v),
    }));
}

function computeInstanceMatrix(
  inst: CrowdInstance,
  part: PartKey,
  variant: OutfitVariant,
  t: number,
  out: THREE.Matrix4,
): THREE.Matrix4 {
  const loop = LOOP_DATA[inst.pathIndex];

  let u: number;
  let yaw: number;
  let bob: number;
  let gait: number;

  if (inst.idle) {
    u = inst.phase;
    yaw = inst.facingYaw;
    bob = Math.sin(t * 1.6 + inst.phase * Math.PI * 2) * 0.02;
    gait = 0;
  } else {
    const travel = t * inst.speed * inst.dir;
    u = (((inst.phase + travel / loop.total) % 1) + 1) % 1;
    const s = sampleLoop(loop, u);
    yaw = Math.atan2(s.tx, s.tz) + (inst.dir < 0 ? Math.PI : 0);
    const gaitPhase = t * inst.speed * 2.6 + inst.phase * Math.PI * 2;
    gait = Math.sin(gaitPhase) * 0.5;
    bob = Math.abs(Math.cos(gaitPhase)) * 0.03;
  }

  const s = sampleLoop(loop, u);
  const local = computePartLocal(part, { variant, gait, bob });

  // Compose world * local without per-frame allocations.
  scratchPosition.set(s.x, bob, s.z);
  scratchQuat.setFromEuler(scratchEuler.set(0, yaw, 0));
  scratchWorld.compose(scratchPosition, scratchQuat, scratchOne);
  scratchLocal.compose(
    scratchLocalPos.fromArray(local.position),
    scratchLocalQuat.setFromEuler(scratchLocalEuler.set(...local.rotation)),
    scratchLocalScale.fromArray(local.scale),
  );
  return out.multiplyMatrices(scratchWorld, scratchLocal);
}

// Scratch objects reused across the whole crowd each frame (GC-free hot loop).
const scratchPosition = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchEuler = new THREE.Euler();
const scratchWorld = new THREE.Matrix4();
const scratchOne = new THREE.Vector3(1, 1, 1);
const scratchLocal = new THREE.Matrix4();
const scratchLocalPos = new THREE.Vector3();
const scratchLocalQuat = new THREE.Quaternion();
const scratchLocalEuler = new THREE.Euler();
const scratchLocalScale = new THREE.Vector3();
const scratchMatrix = new THREE.Matrix4();

export function Pedestrians({ era, count }: PedestriansProps) {
  const config = useMemo(() => PEDESTRIAN_CONFIG[era], [era]);
  const n = count ?? config.count;

  const crowd = useMemo(() => buildCrowd(config.variants, n), [config, n]);
  const groups = useMemo(
    () => groupByVariant(crowd, config.variants),
    [crowd, config],
  );

  const geometries = useMemo(() => {
    const map = new Map<string, THREE.BufferGeometry>();
    for (const group of groups) {
      for (const part of group.parts) {
        map.set(
          `${group.variant.id}:${part}`,
          buildPartGeometry(group.variant, part),
        );
      }
    }
    return map;
  }, [groups]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.85,
        metalness: 0.05,
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
        const mesh = meshRefs.current.get(`${group.variant.id}:${part}`);
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

  // Animate the crowd.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (const group of groups) {
      for (const part of group.parts) {
        const mesh = meshRefs.current.get(`${group.variant.id}:${part}`);
        if (!mesh) continue;
        group.instances.forEach((inst, j) => {
          computeInstanceMatrix(inst, part, group.variant, t, scratchMatrix);
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
        <group key={group.variant.id}>
          {group.parts.map((part) => (
            <instancedMesh
              key={part}
              ref={setMeshRef(`${group.variant.id}:${part}`)}
              args={[
                geometries.get(`${group.variant.id}:${part}`),
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

export default Pedestrians;
