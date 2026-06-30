import { useRef, type FC } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { BLOCK_LAYOUT, type SpawnPoint } from '@/config/blockLayout';
import { getEraTheme } from '@/config/eraTheme';
import type { EraId } from '@/config/years';

/**
 * Pedestrians.
 *
 * Simple capsule avatars that walk back-and-forth along their spawn axis.
 * Clothing colours are drawn from the era palette so the street life reads
 * differently per period.
 */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** A single walking pedestrian. */
const Pedestrian: FC<{
  spawn: SpawnPoint;
  color: string;
  index: number;
}> = ({ spawn, color, index }) => {
  const ref = useRef<Group>(null);
  // Travel range along the heading axis.
  const range = 12;
  const speed = 1.2 + hashSeed(spawn.id) * 0.8;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const group = ref.current;
    if (!group) return;
    // Ping-pong offset.
    const phase = Math.sin(t * speed + index) * range;
    const dx = Math.cos(spawn.heading) * phase;
    const dz = Math.sin(spawn.heading) * phase;
    group.position.x = spawn.x + dx;
    group.position.z = spawn.z + dz;
    // Face travel direction.
    group.rotation.y = spawn.heading + (phase < 0 ? Math.PI : 0);
  });

  return (
    <group ref={ref}>
      {/* Body */}
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.18, 0.6, 4, 8]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.5, 0]} castShadow>
        <sphereGeometry args={[0.14, 8, 8]} />
        <meshStandardMaterial color="#d8b89a" roughness={0.7} />
      </mesh>
    </group>
  );
};

interface PedestriansProps {
  era: EraId;
}

const Pedestrians: FC<PedestriansProps> = ({ era }) => {
  const theme = getEraTheme(era);
  const spawns = BLOCK_LAYOUT.spawnPoints.filter((s) => s.kind === 'ped');

  return (
    <group>
      {spawns.map((spawn, i) => {
        const color = theme.pedestrianColors[i % theme.pedestrianColors.length];
        return (
          <Pedestrian key={spawn.id} spawn={spawn} color={color} index={i} />
        );
      })}
    </group>
  );
};

export default Pedestrians;
