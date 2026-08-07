import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEraStore } from '../store/useEraStore';
import { getEraDescriptor } from '../contracts';
import { EffectsModule } from '../modules/effects';

/**
 * Base 3D canvas: an empty lit block footprint with a camera, orbit
 * controls, era-driven lighting, and the post-processing/effects module.
 * Downstream modules (buildings, vehicles, ...) plug into the same scene.
 */

/** The flat city-block footprint with a reference grid. */
function BlockFootprint() {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.05, 0]}>
        <boxGeometry args={[12, 0.1, 12]} />
        <meshStandardMaterial color="#4a4f57" />
      </mesh>
      <gridHelper
        args={[12, 12, '#6b7280', '#3f434a']}
        position={[0, 0.01, 0]}
      />
    </group>
  );
}

/** Lighting driven by the current era's lighting hints. */
function EraLighting() {
  const era = useEraStore((s) => s.currentEra);
  const desc = getEraDescriptor(era);
  return (
    <>
      <ambientLight intensity={desc.lighting.ambientIntensity} />
      <directionalLight
        position={[8, 12, 6]}
        intensity={desc.lighting.sunIntensity}
        color={desc.lighting.sunColor}
        castShadow
      />
    </>
  );
}

export function CityScene() {
  return (
    <Canvas
      shadows
      camera={{ position: [14, 14, 14], fov: 50 }}
      className="city-canvas"
      gl={{ antialias: true, powerPreference: 'high-performance' }}
    >
      <color attach="background" args={['#0b0e14']} />
      <fog attach="fog" args={['#0b0e14', 25, 60]} />
      <EraLighting />
      <BlockFootprint />
      <EffectsModule />
      <OrbitControls enableDamping makeDefault />
    </Canvas>
  );
}
