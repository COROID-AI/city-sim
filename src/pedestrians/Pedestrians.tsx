/**
 * Era-variant pedestrians module.
 *
 * A self-contained R3F module that renders an era-appropriate sidewalk crowd
 * around the city block. It is keyed off the foundation era registry
 * (`EraId`): switching the `era` prop swaps crowd density, outfit palettes,
 * gait and heights for that time period.
 *
 * Efficiency: the figure parts (torso, head, legs, hat) are drawn through
 * `InstancedMesh`es with per-instance colours and matrices, so a whole era
 * crowd renders in a handful of draw calls. Figures walk their sidewalk loops
 * with a procedural two-leg gait and a slight body bob.
 *
 * The module is independent — integration into the main scene happens in
 * Phase 4. Drop `<Pedestrians era={currentEra} />` into a `<Canvas>` to use
 * it.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { EraId } from '../contracts';
import { SIDEWALK_LOOPS, generatePedestrians, getPedestrianConfig } from './pedestrianConfig';
import type { PedestrianInstance } from './pedestrianConfig';

const BASE_HEIGHT = 1.7;
const HIP_Y = 0.82;
const SWING_AMPLITUDE = 0.45;
const BOB_AMPLITUDE = 0.04;
const UP = new THREE.Vector3(0, 1, 0);

type PartKind = 'torso' | 'head' | 'legL' | 'legR' | 'hat';

interface PedestrianPart {
  kind: PartKind;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  color: (inst: PedestrianInstance) => string;
}

/** Shared figure geometry, authored relative to a feet origin at y = 0. */
function createPartGeometry(kind: PartKind): THREE.BufferGeometry {
  switch (kind) {
    case 'torso': {
      const g = new THREE.BoxGeometry(0.34, 0.6, 0.2);
      g.translate(0, HIP_Y + 0.3, 0);
      return g;
    }
    case 'head': {
      const g = new THREE.SphereGeometry(0.11, 10, 8);
      g.translate(0, HIP_Y + 0.66, 0);
      return g;
    }
    case 'legL':
    case 'legR': {
      // Pivot at the hip (origin); the leg hangs downward from it.
      const g = new THREE.BoxGeometry(0.12, 0.82, 0.15);
      g.translate(0, -0.41, 0);
      return g;
    }
    case 'hat': {
      const g = new THREE.CylinderGeometry(0.14, 0.15, 0.08, 10);
      g.translate(0, HIP_Y + 0.72, 0);
      return g;
    }
  }
}

/** Resolve a position + heading on a closed rectangular loop at time t. */
function pointOnLoop(
  corners: [number, number][],
  inst: Pick<PedestrianInstance, 'phase' | 'speed' | 'direction'>,
  t: number,
): { position: THREE.Vector3; heading: number } {
  const segLen = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  let total = 0;
  for (let i = 0; i < corners.length; i++) {
    total += segLen(corners[i], corners[(i + 1) % corners.length]);
  }
  const phase = inst.phase + inst.direction * inst.speed * t;
  let d = (((phase % 1) + 1) % 1) * total;

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const len = segLen(a, b);
    if (d <= len) {
      const tt = len === 0 ? 0 : d / len;
      return {
        position: new THREE.Vector3(a[0] + (b[0] - a[0]) * tt, 0, a[1] + (b[1] - a[1]) * tt),
        heading: Math.atan2(b[1] - a[1], b[0] - a[0]),
      };
    }
    d -= len;
  }

  return { position: new THREE.Vector3(corners[0][0], 0, corners[0][1]), heading: 0 };
}

export interface PedestriansProps {
  /** The era whose crowd should be displayed. */
  era: EraId;
  /** Optional explicit seed for reproducible crowds. */
  seed?: number;
}

/**
 * Era-variant pedestrians module.
 *
 * Accepts the current era and renders the matching sidewalk crowd.
 * Self-contained and independent; integrates into the main scene in a later
 * phase.
 */
export function Pedestrians({ era, seed }: PedestriansProps) {
  const cfg = useMemo(() => getPedestrianConfig(era), [era]);
  const instances = useMemo(() => generatePedestrians(era, seed), [era, seed]);

  const parts = useMemo<PedestrianPart[]>(() => {
    const base: PedestrianPart[] = [
      {
        kind: 'torso',
        geometry: createPartGeometry('torso'),
        material: new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }),
        color: (inst) => inst.coat,
      },
      {
        kind: 'head',
        geometry: createPartGeometry('head'),
        material: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0 }),
        color: (inst) => inst.skin,
      },
      {
        kind: 'legL',
        geometry: createPartGeometry('legL'),
        material: new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
        color: (inst) => inst.pants,
      },
      {
        kind: 'legR',
        geometry: createPartGeometry('legR'),
        material: new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 }),
        color: (inst) => inst.pants,
      },
    ];
    if (cfg.hats) {
      base.push({
        kind: 'hat',
        geometry: createPartGeometry('hat'),
        material: new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 }),
        color: (inst) => inst.coat,
      });
    }
    return base;
  }, [cfg]);

  // Dispose shared part geometry + materials on unmount.
  useLayoutEffect(() => {
    return () => {
      for (const part of parts) {
        part.geometry.dispose();
        part.material.dispose();
      }
    };
  }, [parts]);

  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);

  // Set per-instance colours once.
  useLayoutEffect(() => {
    instances.forEach((inst, i) => {
      parts.forEach((part, pi) => {
        const mesh = meshRefs.current[pi];
        if (!mesh) return;
        mesh.setColorAt(i, new THREE.Color(part.color(inst)));
      });
    });
    meshRefs.current.forEach((m) => {
      if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }, [instances, parts]);

  // Animate: advance each figure along its sidewalk loop and write matrices.
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const walkFreq = (2 * Math.PI) / cfg.strideSeconds;

    const pedMatrix = new THREE.Matrix4();
    const legLMatrix = new THREE.Matrix4();
    const legRMatrix = new THREE.Matrix4();
    const legLRot = new THREE.Matrix4();
    const legRRot = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const pos = new THREE.Vector3();

    instances.forEach((inst, i) => {
      const loop = SIDEWALK_LOOPS[inst.loopIndex % SIDEWALK_LOOPS.length];
      const { position, heading } = pointOnLoop(loop, inst, t);
      const walkPhase = inst.walkOffset + t * walkFreq;
      const swing = Math.sin(walkPhase) * SWING_AMPLITUDE;
      const bob = Math.abs(Math.cos(walkPhase)) * BOB_AMPLITUDE;
      const h = inst.height / BASE_HEIGHT;

      quat.setFromAxisAngle(UP, heading);
      scale.set(h, h, h);
      pedMatrix.compose(pos.set(position.x, bob, position.z), quat, scale);

      legLRot.makeRotationX(swing);
      legRRot.makeRotationX(-swing);
      legLMatrix.multiplyMatrices(pedMatrix, legLRot);
      legRMatrix.multiplyMatrices(pedMatrix, legRRot);

      parts.forEach((part, pi) => {
        const mesh = meshRefs.current[pi];
        if (!mesh) return;
        if (part.kind === 'legL') {
          mesh.setMatrixAt(i, legLMatrix);
        } else if (part.kind === 'legR') {
          mesh.setMatrixAt(i, legRMatrix);
        } else {
          mesh.setMatrixAt(i, pedMatrix);
        }
      });
    });

    meshRefs.current.forEach((m) => {
      if (m) m.instanceMatrix.needsUpdate = true;
    });
  });

  return (
    <group>
      {parts.map((part, pi) => (
        <instancedMesh
          key={part.kind}
          ref={(node) => {
            meshRefs.current[pi] = node;
          }}
          args={[part.geometry, part.material, instances.length]}
          frustumCulled={false}
          castShadow
          receiveShadow
        />
      ))}
    </group>
  );
}
