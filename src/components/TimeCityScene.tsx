import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { FC } from 'react';
import Ground from './Ground';
import Lighting from './Lighting';
import Storefront from './Storefront';
import Billboard from './Billboard';
import StreetProps from './StreetProps';
import { useYearStore } from '@/store/yearStore';
import { getEraStreetConfig } from '@/config/storefronts';

/**
 * Street-level content that swaps per era: storefronts, billboards, and props.
 *
 * Reads the active era from the year store and renders the matching
 * configuration. Kept as a child of the R3F Canvas so it lives inside the
 * WebGL context.
 */
const StreetContent: FC = () => {
  const selectedYear = useYearStore((state) => state.selectedYear);
  const streetConfig = getEraStreetConfig(selectedYear);

  return (
    <>
      {/* Storefronts along the north edge of the block */}
      {streetConfig.storefronts.map((sf, i) => (
        <Storefront
          key={`sf-${i}`}
          position={[-12 + i * 8, 0, -14]}
          config={sf}
          rotationY={0}
        />
      ))}

      {/* Storefronts along the south edge of the block (rotated to face in) */}
      {streetConfig.storefronts.map((sf, i) => (
        <Storefront
          key={`sf-s-${i}`}
          position={[-12 + i * 8, 0, 14]}
          config={sf}
          rotationY={Math.PI}
        />
      ))}

      {/* Billboards flanking the block */}
      {streetConfig.billboards.map((bb, i) => (
        <Billboard
          key={`bb-${i}`}
          position={[-18 + i * 36, 0, 0]}
          config={bb}
          rotationY={i === 0 ? Math.PI / 2 : -Math.PI / 2}
        />
      ))}

      {/* Era-dependent street props */}
      <StreetProps config={streetConfig.props} />
    </>
  );
};

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

      {/* Era-dependent storefronts, billboards, and street props */}
      <StreetContent />

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
