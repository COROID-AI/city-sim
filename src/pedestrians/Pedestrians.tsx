import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { EraId } from '../contracts/era';
import { ERA_PEDESTRIAN_CONFIG } from './eraConfig';
import { buildFigureGeometry } from './geometry';
import type { FigureStyle, OutfitScheme } from './geometry';
import { SIDEWALK_LOOPS, sampleSidewalk } from './sidewalkPaths';

/**
 * Pedestrians R3F component.
 *
 * Renders the era-appropriate pedestrian crowd for the given EraId. Every
 * figure is a shared "rig" geometry built once per outfit color scheme and
 * drawn as an InstancedMesh, so a large crowd is cheap to render. Each
 * instance walks a closed sidewalk ring on a seamless looping path with a
 * per-instance walking bob for idle variation.
 */

interface InstanceParam {
  loopIndex: number;
  /** Normalized starting position around the loop (0..1). */
  phase: number;
  /** Walking speed in world units per second. */
  speed: number;
}

const tmpMatrix = new THREE.Matrix4();
const tmpQuat = new THREE.Quaternion();
const tmpEuler = new THREE.Euler();
const tmpPos = new THREE.Vector3();
const tmpScale = new THREE.Vector3(1, 1, 1);

function SchemeInstances({
  style,
  scheme,
  count,
  era,
}: {
  style: FigureStyle;
  scheme: OutfitScheme;
  count: number;
  era: EraId;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const config = ERA_PEDESTRIAN_CONFIG[era];

  const geometry = useMemo(() => buildFigureGeometry(style, scheme), [style, scheme]);

  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        metalness: config.material.metalness,
        roughness: config.material.roughness,
      }),
    [config.material.metalness, config.material.roughness],
  );

  const params = useMemo<InstanceParam[]>(() => {
    const arr: InstanceParam[] = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        loopIndex: i % SIDEWALK_LOOPS.length,
        phase: i / count,
        speed:
          config.speedRange[0] +
          Math.random() * (config.speedRange[1] - config.speedRange[0]),
      });
    }
    return arr;
  }, [count, config.speedRange]);

  // Per-instance bob phase so the crowd walks out of sync.
  const bobPhase = useMemo(
    () => Array.from({ length: count }, () => Math.random() * Math.PI * 2),
    [count],
  );

  // Initialize matrices once so the first frame is already correct.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < count; i++) {
      const p = params[i];
      const loop = SIDEWALK_LOOPS[p.loopIndex];
      const tt = (p.phase + (t * p.speed) / loop.total) % 1;
      const s = sampleSidewalk(loop, tt);
      tmpEuler.set(0, s.heading, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpPos.set(s.x, s.y, s.z);
      tmpScale.set(1, 1, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [params, count]);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const p = params[i];
      const loop = SIDEWALK_LOOPS[p.loopIndex];
      const tt = (p.phase + (t * p.speed) / loop.total) % 1;
      const s = sampleSidewalk(loop, tt);
      const bob = Math.sin(tt * Math.PI * 2 * 1.6 + bobPhase[i]) * 0.03;
      tmpEuler.set(0, s.heading, 0);
      tmpQuat.setFromEuler(tmpEuler);
      tmpPos.set(s.x, s.y + bob, s.z);
      tmpScale.set(1, 1 + bob * 0.5, 1);
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, count]}
      castShadow
      frustumCulled={false}
    />
  );
}

export function Pedestrians({ era }: { era: EraId }) {
  const config = ERA_PEDESTRIAN_CONFIG[era];
  const total = config.count;

  const variants = useMemo(() => {
    const list: { style: FigureStyle; scheme: OutfitScheme }[] = [];
    for (const style of config.styles) {
      for (const scheme of style.schemes) {
        list.push({ style, scheme });
      }
    }
    return list;
  }, [config.styles]);

  const base = Math.floor(total / variants.length);

  return (
    <group>
      {variants.map(({ style, scheme }, i) => {
        const isLast = i === variants.length - 1;
        const count = isLast ? total - base * (variants.length - 1) : base;
        return (
          <SchemeInstances
            key={`${style.id}:${scheme.id}`}
            style={style}
            scheme={scheme}
            count={count}
            era={era}
          />
        );
      })}
    </group>
  );
}