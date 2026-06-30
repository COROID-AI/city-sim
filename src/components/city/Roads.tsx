import type { FC } from 'react';
import { BLOCK_LAYOUT } from '@/config/blockLayout';

/**
 * Road network: two bitumen strips forming a crossroads through the block.
 *
 * Purely presentational — the geometry is derived from the static
 * `BLOCK_LAYOUT` so the footprint never changes between eras.
 */
const Roads: FC = () => {
  return (
    <group>
      {BLOCK_LAYOUT.roads.map((road) => {
        const w = road.axis === 'x' ? road.length : road.width;
        const d = road.axis === 'x' ? road.width : road.length;
        return (
          <mesh
            key={road.id}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[road.x, 0.02, road.z]}
            receiveShadow
          >
            <planeGeometry args={[w, d]} />
            <meshStandardMaterial color="#2a2a2e" roughness={0.95} />
          </mesh>
        );
      })}
      {/* Centre intersection marker (slightly lighter seal) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]} receiveShadow>
        <planeGeometry args={[8, 8]} />
        <meshStandardMaterial color="#33333a" roughness={0.95} />
      </mesh>
    </group>
  );
};

export default Roads;
