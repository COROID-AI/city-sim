'use client';

import type { FC } from 'react';

/**
 * Scene lighting rig.
 *
 * - DirectionalLight: primary light source that casts shadows.
 * - AmbientLight: soft fill that prevents fully black shadow areas.
 *
 * The directional light is positioned high and to the side to produce
 * natural-looking shadow falloff across the city block.
 */
const Lighting: FC = () => {
  return (
    <>
      <ambientLight intensity={0.4} color="#ffffff" />

      <directionalLight
        position={[50, 60, 30]}
        intensity={1.2}
        color="#fff5e1"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={200}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
        shadow-bias={-0.0005}
      />
    </>
  );
};

export default Lighting;
