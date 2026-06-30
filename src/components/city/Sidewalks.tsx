import type { FC } from 'react';
import { BLOCK_LAYOUT } from '@/config/blockLayout';

/**
 * Raised concrete sidewalks bordering every road edge.
 */
const Sidewalks: FC = () => {
  return (
    <group>
      {BLOCK_LAYOUT.sidewalks.map((sw) => (
        <mesh
          key={sw.id}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[sw.x, 0.1, sw.z]}
          receiveShadow
        >
          <planeGeometry args={[sw.width, sw.depth]} />
          <meshStandardMaterial color="#9a9a9e" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
};

export default Sidewalks;
