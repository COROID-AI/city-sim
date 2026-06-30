'use client';

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { FC } from 'react';
import Ground from './Ground';
import Lighting from './Lighting';
import CityBlock from './city/CityBlock';
import BloomEffect from './Bloom';

/**
 * Full-screen 3D city stage.
 *
 * Provides a PerspectiveCamera (via R3F defaults), OrbitControls for
 * rotate/pan/zoom navigation, a lit ground plane at y=0, and shadow-casting
 * directional + ambient lighting.
 */
const TimeCityScene: FC = () => {
  return (
    <Canvas
      shadows
      camera={{ position: [40, 35, 40], fov: 45, near: 0.1, far: 1000 }}
      gl={{ antialias: true }}
      style={{ width: '100vw', height: '100vh', background: '#1a1a2e' }}
    >
      {/* Lighting rig: directional (shadow caster) + ambient fill */}
      <Lighting />

      {/* Ground plane at y=0 */}
      <Ground />

      {/* The assembled city block — roads, sidewalks, buildings, props, peds, vehicles */}
      <CityBlock />

      {/* Bloom post-processing — era-adaptive glow on emissive surfaces */}
      <BloomEffect />

      {/*
        OrbitControls give users full 3D navigation:
        - Left drag: rotate
        - Right drag: pan
        - Scroll: zoom
        Limits keep the camera grounded and prevent clipping through the floor.
      */}
      <OrbitControls
        enablePan
        enableRotate
        enableZoom
        minDistance={10}
        maxDistance={120}
        // Prevent flipping below the ground plane (0 = horizon, ~0.5*PI = top-down)
        minPolarAngle={0.1}
        maxPolarAngle={Math.PI / 2 - 0.05}
        target={[0, 0, 0]}
        makeDefault
      />
    </Canvas>
  );
};

export default TimeCityScene;
