/**
 * Pedestrian entities.
 *
 * Renders an instanced crowd of low-poly pedestrians that walk along the
 * sidewalk loop. Each pedestrian picks an era-specific outfit from the
 * street-life config so the crowd's colour palette matches the selected
 * year. Bodies are built from primitive geometries and updated each frame
 * via instanced meshes for performance.
 */
'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EraId } from '@/config/years';
import {
  getStreetLifeConfig,
  type PedestrianOutfit,
} from '@/config/streetLife';
import {
  SIDEWALK_PATH,
  createAgents,
  headingOnPath,
  pathPerimeter,
  positionOnPath,
  stepAgents,
  withLaneOffset,
  type MovementAgent,
} from '@/systems/movement';
import { MAX_AGENTS } from '@/config/streetLife';

/** Pedestrian walk speed range (world units / second). */
const WALK_SPEED: readonly [number, number] = [1.2, 2.0];

/** Fixed Y offset so feet sit on the ground plane. */
const BODY_Y = 0.9;

/**
 * Props for the {@link Pedestrians} component.
 */
export interface PedestriansProps {
  /** Active era; determines outfit palette and crowd size. */
  readonly era: EraId;
}

/**
 * Assigns a deterministic outfit to each agent based on its index.
 */
function assignOutfits(
  count: number,
  pool: readonly PedestrianOutfit[],
): PedestrianOutfit[] {
  const result: PedestrianOutfit[] = [];
  for (let i = 0; i < count; i++) {
    result.push(pool[i % pool.length]);
  }
  return result;
}

/**
 * Pedestrian crowd component.
 *
 * Uses four instanced meshes (legs, torso, head, hair) so all pedestrians
 * share geometry/material batches. Per-instance colours are set via
 * `setColorAt`; transforms are updated each frame in `useFrame`.
 */
const Pedestrians: React.FC<PedestriansProps> = ({ era }) => {
  const config = getStreetLifeConfig(era);

  // Reserve enough slots for the largest era so instanced mesh counts are
  // stable and we avoid reallocation when switching eras.
  const maxCount = useMemo(() => {
    return Math.max(20, config.pedestrianCount);
  }, [config.pedestrianCount]);

  const agents = useMemo<MovementAgent[]>(
    () => createAgents(config.pedestrianCount, WALK_SPEED, MAX_AGENTS),
    [config.pedestrianCount],
  );

  const outfits = useMemo(
    () => assignOutfits(agents.length, config.outfits),
    [agents.length, config.outfits],
  );

  const perimeter = useMemo(() => pathPerimeter(SIDEWALK_PATH), []);

  // Instanced mesh refs.
  const legsRef = useRef<THREE.InstancedMesh>(null);
  const torsoRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);

  // Reusable scratch objects (avoid per-frame allocation).
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  // Initialise per-instance colours once outfits change.
  useMemo(() => {
    const setColors = (
      ref: React.RefObject<THREE.InstancedMesh | null>,
      pick: (o: PedestrianOutfit) => string,
    ) => {
      if (!ref.current) return;
      for (let i = 0; i < outfits.length; i++) {
        color.set(pick(outfits[i]));
        ref.current.setColorAt(i, color);
      }
      if (ref.current.instanceColor) {
        ref.current.instanceColor.needsUpdate = true;
      }
    };
    // Deferred to after mount via useFrame first-tick guard below.
    queueMicrotask(() => {
      setColors(legsRef, (o) => o.pants);
      setColors(torsoRef, (o) => o.shirt);
      setColors(headRef, (o) => o.skin);
    });
  }, [outfits, color]);

  useFrame((_, delta) => {
    // Clamp delta to avoid huge jumps after tab switches.
    const dt = Math.min(delta, 0.1);
    stepAgents(agents, dt, perimeter);

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const outfit = outfits[i];
      const lane = withLaneOffset(SIDEWALK_PATH, agent.laneOffset);
      const [x, , z] = positionOnPath(lane, agent.progress);
      const heading = headingOnPath(lane, agent.progress);
      const yScale = outfit.heightScale;

      // Subtle vertical bob to simulate walking.
      const bob = Math.sin(agent.progress * perimeter * 2) * 0.05;

      // Legs
      dummy.position.set(x, BODY_Y * 0.35 * yScale + bob, z);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(1, yScale, 1);
      dummy.updateMatrix();
      legsRef.current?.setMatrixAt(i, dummy.matrix);

      // Torso
      dummy.position.set(x, BODY_Y * 0.75 * yScale + bob, z);
      dummy.updateMatrix();
      torsoRef.current?.setMatrixAt(i, dummy.matrix);

      // Head
      dummy.position.set(x, BODY_Y * 1.15 * yScale + bob, z);
      dummy.scale.set(0.8, 0.8, 0.8);
      dummy.updateMatrix();
      headRef.current?.setMatrixAt(i, dummy.matrix);
      dummy.scale.set(1, 1, 1);
    }

    // Hide unused instances.
    for (let i = agents.length; i < maxCount; i++) {
      dummy.position.set(0, -100, 0);
      dummy.scale.set(0, 0, 0);
      dummy.updateMatrix();
      legsRef.current?.setMatrixAt(i, dummy.matrix);
      torsoRef.current?.setMatrixAt(i, dummy.matrix);
      headRef.current?.setMatrixAt(i, dummy.matrix);
    }

    legsRef.current!.instanceMatrix.needsUpdate = true;
    torsoRef.current!.instanceMatrix.needsUpdate = true;
    headRef.current!.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {/* Legs — box geometry */}
      <instancedMesh
        ref={legsRef}
        args={[undefined, undefined, maxCount]}
        castShadow
      >
        <boxGeometry args={[0.3, 0.7, 0.25]} />
        <meshStandardMaterial />
      </instancedMesh>

      {/* Torso */}
      <instancedMesh
        ref={torsoRef}
        args={[undefined, undefined, maxCount]}
        castShadow
      >
        <boxGeometry args={[0.5, 0.6, 0.3]} />
        <meshStandardMaterial />
      </instancedMesh>

      {/* Head */}
      <instancedMesh
        ref={headRef}
        args={[undefined, undefined, maxCount]}
        castShadow
      >
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshStandardMaterial />
      </instancedMesh>
    </group>
  );
};

export default Pedestrians;
