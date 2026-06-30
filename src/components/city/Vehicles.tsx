import { useRef, type FC } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { BLOCK_LAYOUT, type SpawnPoint } from '@/config/blockLayout';
import { getEraTheme, type EraTheme } from '@/config/eraTheme';
import type { EraId } from '@/config/years';

/**
 * Vehicles.
 *
 * Era-styled vehicles (boxy → sedan → suv → pod) that drive along the road
 * axis defined by their spawn point. Body colours come from the era palette.
 */

/** Render a vehicle body matching the era style. */
const VehicleBody: FC<{ style: EraTheme['vehicleStyle']; color: string }> = ({
  style,
  color,
}) => {
  const mat = <meshStandardMaterial color={color} roughness={0.4} metalness={0.5} />;
  switch (style) {
    case 'boxy':
      return (
        <group>
          <mesh position={[0, 0.5, 0]} castShadow>
            <boxGeometry args={[2.2, 1, 1]} />
            {mat}
          </mesh>
          <mesh position={[0, 1.2, 0]} castShadow>
            <boxGeometry args={[1.6, 0.6, 0.9]} />
            {mat}
          </mesh>
        </group>
      );
    case 'sedan':
      return (
        <group>
          <mesh position={[0, 0.45, 0]} castShadow>
            <boxGeometry args={[2.4, 0.7, 1]} />
            {mat}
          </mesh>
          <mesh position={[-0.1, 1, 0]} castShadow>
            <boxGeometry args={[1.4, 0.55, 0.9]} />
            {mat}
          </mesh>
        </group>
      );
    case 'suv':
      return (
        <group>
          <mesh position={[0, 0.6, 0]} castShadow>
            <boxGeometry args={[2.5, 1.1, 1.05]} />
            {mat}
          </mesh>
          <mesh position={[0, 1.4, 0]} castShadow>
            <boxGeometry args={[2, 0.5, 0.95]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.3} />
            </mesh>
        </group>
      );
    case 'pod':
      return (
        <group>
          <mesh position={[0, 0.5, 0]} castShadow>
            <capsuleGeometry args={[0.5, 1.8, 8, 16]} />
            {mat}
          </mesh>
          {/* Glow undercarriage */}
          <mesh position={[0, 0.1, 0]}>
            <boxGeometry args={[2.2, 0.05, 0.8]} />
            <meshStandardMaterial color="#00ccff" emissive="#00ccff" emissiveIntensity={0.8} />
          </mesh>
        </group>
      );
    default:
      return null;
  }
};

/** A single driving vehicle. */
const Vehicle: FC<{
  spawn: SpawnPoint;
  style: EraTheme['vehicleStyle'];
  color: string;
  index: number;
}> = ({ spawn, style, color, index }) => {
  const ref = useRef<Group>(null);
  const speed = 4 + index * 1.5;
  const range = 30;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const group = ref.current;
    if (!group) return;
    const phase = ((t * speed + index * 10) % (range * 2)) - range;
    const dx = Math.cos(spawn.heading) * phase;
    const dz = Math.sin(spawn.heading) * phase;
    group.position.x = spawn.x + dx;
    group.position.z = spawn.z + dz;
    group.rotation.y = spawn.heading;
  });

  return (
    <group ref={ref}>
      <VehicleBody style={style} color={color} />
    </group>
  );
};

interface VehiclesProps {
  era: EraId;
}

const Vehicles: FC<VehiclesProps> = ({ era }) => {
  const theme = getEraTheme(era);
  const spawns = BLOCK_LAYOUT.spawnPoints.filter((s) => s.kind === 'vehicle');

  return (
    <group>
      {spawns.map((spawn, i) => {
        const color = theme.vehicleColors[i % theme.vehicleColors.length];
        return (
          <Vehicle
            key={spawn.id}
            spawn={spawn}
            style={theme.vehicleStyle}
            color={color}
            index={i}
          />
        );
      })}
    </group>
  );
};

export default Vehicles;
