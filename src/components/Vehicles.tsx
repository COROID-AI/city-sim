/**
 * Vehicle entities.
 *
 * Renders period-appropriate vehicles driving along the road loop. Supports
 * four silhouette archetypes — classic car, boxy sedan, modern EV, and truck —
 * each built from primitive geometries. Vehicles use instanced meshes grouped
 * by silhouette so repeated geometry is batched for performance.
 */
'use client';

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { EraId } from '@/config/years';
import {
  getStreetLifeConfig,
  MAX_AGENTS,
  type VehicleStyle,
  type VehicleSilhouette,
} from '@/config/streetLife';
import {
  ROAD_PATH,
  createAgents,
  headingOnPath,
  pathPerimeter,
  positionOnPath,
  stepAgents,
  withLaneOffset,
  type MovementAgent,
} from '@/systems/movement';

/** Vehicle drive speed range (world units / second). */
const DRIVE_SPEED: readonly [number, number] = [4.0, 7.0];

/**
 * Props for the {@link Vehicles} component.
 */
export interface VehiclesProps {
  /** Active era; determines vehicle palette and traffic density. */
  readonly era: EraId;
}

/**
 * Group vehicle styles by silhouette archetype so each group can use a
 * single instanced mesh batch.
 */
interface SilhouetteGroup {
  readonly silhouette: VehicleSilhouette;
  readonly styles: VehicleStyle[];
  readonly agents: MovementAgent[];
}

function groupBySilhouette(
  styles: readonly VehicleStyle[],
  agents: MovementAgent[],
): SilhouetteGroup[] {
  const map = new Map<VehicleSilhouette, SilhouetteGroup>();
  for (let i = 0; i < styles.length; i++) {
    const style = styles[i];
    const agent = agents[i];
    const existing = map.get(style.silhouette);
    if (existing) {
      existing.styles.push(style);
      existing.agents.push(agent);
    } else {
      map.set(style.silhouette, {
        silhouette: style.silhouette,
        styles: [style],
        agents: [agent],
      });
    }
  }
  return Array.from(map.values());
}

/**
 * Renders a single silhouette group as an instanced mesh batch.
 * Geometry dimensions vary by archetype to give distinct silhouettes.
 */
const SilhouetteBatch: React.FC<{
  readonly group: SilhouetteGroup;
  readonly perimeter: number;
}> = ({ group, perimeter }) => {
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const color = useMemo(() => new THREE.Color(), []);

  const dims = useMemo(() => {
    switch (group.silhouette) {
      case 'classic':
        // Long, low, rounded — 1940s/50s cruiser
        return {
          bodyArgs: [2.2, 0.5, 0.9] as [number, number, number],
          roofArgs: [1.2, 0.45, 0.85] as [number, number, number],
          bodyY: 0.55,
          roofY: 1.0,
        };
      case 'sedan':
        // Boxy 80s/90s sedan
        return {
          bodyArgs: [2.0, 0.55, 0.95] as [number, number, number],
          roofArgs: [1.5, 0.55, 0.9] as [number, number, number],
          bodyY: 0.6,
          roofY: 1.1,
        };
      case 'ev':
        // Sleek, low, modern EV — tall greenhouse, short hood
        return {
          bodyArgs: [2.1, 0.5, 0.95] as [number, number, number],
          roofArgs: [1.8, 0.65, 0.92] as [number, number, number],
          bodyY: 0.55,
          roofY: 1.05,
        };
      case 'truck':
        // Tall, long utility truck/van
        return {
          bodyArgs: [2.8, 0.7, 1.0] as [number, number, number],
          roofArgs: [1.6, 0.8, 1.0] as [number, number, number],
          bodyY: 0.75,
          roofY: 1.5,
        };
    }
  }, [group.silhouette]);
  const { bodyArgs, roofArgs, roofY, bodyY } = dims;

  // Set per-instance colours when styles change.
  useMemo(() => {
    queueMicrotask(() => {
      if (!bodyRef.current || !roofRef.current) return;
      for (let i = 0; i < group.styles.length; i++) {
        color.set(group.styles[i].body);
        bodyRef.current.setColorAt(i, color);
        color.set(group.styles[i].roof);
        roofRef.current.setColorAt(i, color);
      }
      if (bodyRef.current.instanceColor)
        bodyRef.current.instanceColor.needsUpdate = true;
      if (roofRef.current.instanceColor)
        roofRef.current.instanceColor.needsUpdate = true;
    });
  }, [group.styles, color]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    stepAgents(group.agents, dt, perimeter);

    for (let i = 0; i < group.agents.length; i++) {
      const agent = group.agents[i];
      const style = group.styles[i];
      const lane = withLaneOffset(ROAD_PATH, agent.laneOffset);
      const [x, , z] = positionOnPath(lane, agent.progress);
      const heading = headingOnPath(lane, agent.progress);

      const len = style.length;
      const hgt = style.height;

      dummy.position.set(x, bodyY * hgt, z);
      dummy.rotation.set(0, heading, 0);
      dummy.scale.set(len, hgt, 1);
      dummy.updateMatrix();
      bodyRef.current?.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x, roofY * hgt, z);
      dummy.scale.set(len, hgt, 1);
      dummy.updateMatrix();
      roofRef.current?.setMatrixAt(i, dummy.matrix);
    }

    bodyRef.current!.instanceMatrix.needsUpdate = true;
    roofRef.current!.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={bodyRef}
        args={[undefined, undefined, group.styles.length]}
        castShadow
      >
        <boxGeometry args={bodyArgs} />
        <meshStandardMaterial />
      </instancedMesh>
      <instancedMesh
        ref={roofRef}
        args={[undefined, undefined, group.styles.length]}
        castShadow
      >
        <boxGeometry args={roofArgs} />
        <meshStandardMaterial />
      </instancedMesh>
    </group>
  );
};

/**
 * Vehicles component: renders all silhouette groups for the active era.
 */
const Vehicles: React.FC<VehiclesProps> = ({ era }) => {
  const config = getStreetLifeConfig(era);

  const perimeter = useMemo(() => pathPerimeter(ROAD_PATH), []);

  const { groups, styles } = useMemo(() => {
    // Assign a vehicle style to each agent slot.
    const agentCount = Math.min(config.vehicleCount, MAX_AGENTS);
    const pickedStyles: VehicleStyle[] = [];
    for (let i = 0; i < agentCount; i++) {
      pickedStyles.push(config.vehicles[i % config.vehicles.length]);
    }
    const agents = createAgents(agentCount, DRIVE_SPEED, MAX_AGENTS);
    const grps = groupBySilhouette(pickedStyles, agents);
    return { groups: grps, styles: pickedStyles };
  }, [config.vehicleCount, config.vehicles]);

  // Reference styles to satisfy exhaustive-deps; styles drives regrouping.
  void styles;

  return (
    <group>
      {groups.map((group, idx) => (
        <SilhouetteBatch
          key={`${group.silhouette}-${idx}`}
          group={group}
          perimeter={perimeter}
        />
      ))}
    </group>
  );
};

export default Vehicles;
