import { useMemo } from 'react';
import { Instances, Instance } from '@react-three/drei';
import type { RoadConfig } from './streetConfig';

/** Road geometry (world units). The road runs along Z, centered on the origin. */
const ROAD_WIDTH = 7;
const ROAD_LENGTH = 46;
const ROAD_TOP = 0;
const SIDEWALK_WIDTH = 1.4;
const SIDEWALK_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH / 2 + 0.15;

/** Dashed center line segments (1985+). */
function CenterLine() {
  const dashes = useMemo(() => {
    const segs: { z: number }[] = [];
    for (let z = -ROAD_LENGTH / 2 + 1.2; z < ROAD_LENGTH / 2 - 1.2; z += 3) {
      segs.push({ z });
    }
    return segs;
  }, []);

  return (
    <group position={[0, ROAD_TOP + 0.01, 0]}>
      <Instances limit={dashes.length} range={dashes.length}>
        <boxGeometry args={[0.16, 0.02, 1.6]} />
        <meshStandardMaterial color="#d8b94a" roughness={0.6} />
        {dashes.map((d, i) => (
          <Instance key={i} position={[0, 0, d.z]} />
        ))}
      </Instances>
    </group>
  );
}

/** Lane markings (2005+): two crisp white lane lines + edge lines. */
function LaneMarkings() {
  return (
    <group position={[0, ROAD_TOP + 0.012, 0]}>
      {[-1.9, 1.9].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.12, 0.015, ROAD_LENGTH - 1]} />
          <meshStandardMaterial color="#e8e8e8" roughness={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** Colored bike lanes at the road edges (2005+). */
function BikeLanes({ color }: { color: string }) {
  return (
    <group position={[0, ROAD_TOP + 0.008, 0]}>
      {[-2.95, 2.95].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.9, 0.012, ROAD_LENGTH - 1]} />
          <meshStandardMaterial color={color} roughness={0.7} />
        </mesh>
      ))}
    </group>
  );
}

/** 2025 smart road: emissive LED guide strips + embedded sensor nodes. */
function SmartRoad() {
  return (
    <group position={[0, ROAD_TOP + 0.02, 0]}>
      {[-2.9, 0, 2.9].map((x) => (
        <mesh key={x} position={[x, 0, 0]}>
          <boxGeometry args={[0.06, 0.02, ROAD_LENGTH - 1]} />
          <meshStandardMaterial
            color="#7fd4ff"
            emissive="#4fc3f7"
            emissiveIntensity={2.2}
            roughness={0.3}
          />
        </mesh>
      ))}
      {[-6, -3, 0, 3, 6].map((z) => (
        <mesh key={z} position={[0, 0.015, z]}>
          <cylinderGeometry args={[0.09, 0.09, 0.02, 12]} />
          <meshStandardMaterial
            color="#20242c"
            emissive="#9bdcff"
            emissiveIntensity={1.6}
            roughness={0.4}
          />
        </mesh>
      ))}
    </group>
  );
}

/** 1945 worn cobblestone setts laid across the asphalt. */
function Cobblestones() {
  const stones = useMemo(() => {
    const out: { x: number; z: number; r: number; rot: number }[] = [];
    for (let z = -ROAD_LENGTH / 2 + 0.8; z < ROAD_LENGTH / 2 - 0.8; z += 0.85) {
      for (let x = -ROAD_WIDTH / 2 + 0.4; x < ROAD_WIDTH / 2 - 0.4; x += 0.85) {
        out.push({ x, z, r: 0.18 + Math.random() * 0.1, rot: Math.random() * Math.PI });
      }
    }
    return out;
  }, []);

  // A single instanced mesh replaces the ~400 individual sett meshes that
  // previously each carried their own geometry + material (one draw call each).
  return (
    <group position={[0, ROAD_TOP + 0.01, 0]}>
      <Instances limit={stones.length} range={stones.length}>
        <boxGeometry args={[1, 0.09, 1]} />
        <meshStandardMaterial color="#4a4a4e" roughness={0.95} metalness={0.05} />
        {stones.map((s, i) => (
          <Instance
            key={i}
            position={[s.x, 0, s.z]}
            rotation={[0, s.rot, 0]}
            scale={[s.r, 1, s.r]}
          />
        ))}
      </Instances>
    </group>
  );
}

/**
 * Era-variant road surface. Renders the asphalt slab, sidewalks, and the
 * per-era markings (cobblestone, painted lines, bike lanes, smart road).
 */
export function Road({ config }: { config: RoadConfig }) {
  const bikeColor = config.smartRoad ? '#4f9bff' : '#3f9e6b';

  return (
    <group>
      {/* Road slab */}
      <mesh position={[0, -0.125, 0]} receiveShadow>
        <boxGeometry args={[ROAD_WIDTH, 0.25, ROAD_LENGTH]} />
        <meshStandardMaterial
          color={config.surfaceColor}
          roughness={config.roughness}
          metalness={0.05}
        />
      </mesh>

      {/* Sidewalks */}
      {[-SIDEWALK_OFFSET, SIDEWALK_OFFSET].map((x) => (
        <mesh key={x} position={[x, -0.09, 0]} receiveShadow>
          <boxGeometry args={[SIDEWALK_WIDTH, 0.18, ROAD_LENGTH]} />
          <meshStandardMaterial color="#9a9a9e" roughness={0.9} />
        </mesh>
      ))}

      {config.cobblestone && <Cobblestones />}
      {config.paintedCenterLine && <CenterLine />}
      {config.laneMarkings && <LaneMarkings />}
      {config.bikeLanes && <BikeLanes color={bikeColor} />}
      {config.smartRoad && <SmartRoad />}
    </group>
  );
}

// Re-export for consumers that want the raw geometry constants.
export const ROAD_GEOMETRY = {
  width: ROAD_WIDTH,
  length: ROAD_LENGTH,
  top: ROAD_TOP,
  sidewalkOffset: SIDEWALK_OFFSET,
} as const;
