import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { EraId } from '../contracts/era';
import { ERA_VEHICLE_CONFIG } from './eraConfig';
import { buildVehicleGeometry, type VehicleStyle } from './geometry';
import { ROAD_LOOPS, sampleLoop } from './roadPaths';

/**
 * Vehicles R3F component.
 *
 * Renders the era-appropriate traffic for the given EraId. Every vehicle style
 * is built once into a shared merged geometry and drawn as an InstancedMesh,
 * so multiple vehicles per era are cheap to render. Each instance cruises a
 * closed road loop on a seamless looping path.
 */

interface InstanceParam {
  loopIndex: number;
  /** Normalized starting position around the loop (0..1). */
  phase: number;
  /** Cruising speed in world units per second. */
  speed: number;
}

const tmpMatrix = new THREE.Matrix4();

function StyleInstances({
  style,
  count,
  era,
}: {
  style: VehicleStyle;
  count: number;
  era: EraId;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const config = ERA_VEHICLE_CONFIG[era];

  const geometry = useMemo(() => buildVehicleGeometry(style), [style]);

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
        loopIndex: i % ROAD_LOOPS.length,
        phase: i / count,
        speed:
          config.speedRange[0] +
          Math.random() * (config.speedRange[1] - config.speedRange[0]),
      });
    }
    return arr;
  }, [count, config.speedRange]);

  // Initialize matrices once so the first frame is already correct.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const t = performance.now() / 1000;
    for (let i = 0; i < count; i++) {
      const p = params[i];
      const loop = ROAD_LOOPS[p.loopIndex];
      const tt = (p.phase + (t * p.speed) / loop.total) % 1;
      const s = sampleLoop(loop, tt);
      tmpMatrix.makeRotationY(s.heading);
      tmpMatrix.setPosition(s.x, s.y, s.z);
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
      const loop = ROAD_LOOPS[p.loopIndex];
      const tt = (p.phase + (t * p.speed) / loop.total) % 1;
      const s = sampleLoop(loop, tt);
      tmpMatrix.makeRotationY(s.heading);
      tmpMatrix.setPosition(s.x, s.y, s.z);
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

export function Vehicles({ era }: { era: EraId }) {
  const config = ERA_VEHICLE_CONFIG[era];
  const total = config.count;
  const perStyle = Math.floor(total / config.styles.length);

  return (
    <group>
      {config.styles.map((style, i) => {
        const isLast = i === config.styles.length - 1;
        const count = isLast
          ? total - perStyle * (config.styles.length - 1)
          : perStyle;
        return <StyleInstances key={style.id} style={style} count={count} era={era} />;
      })}
    </group>
  );
}
