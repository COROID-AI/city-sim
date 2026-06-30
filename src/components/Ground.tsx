'use client';

import type { FC } from 'react';

/**
 * Ground plane rendered at y=0.
 *
 * A large flat plane that receives shadows from the directional light,
 * giving the city block a visible stage to sit on.
 */
const Ground: FC = () => {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0, 0]}
      receiveShadow
    >
      <planeGeometry args={[200, 200]} />
      <meshStandardMaterial color="#3a5a40" />
    </mesh>
  );
};

export default Ground;
