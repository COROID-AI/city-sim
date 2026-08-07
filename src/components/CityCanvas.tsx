import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { BlockFootprint } from './BlockFootprint';
import { EraSwitcherStub } from './EraSwitcherStub';

/**
 * Base R3F canvas: lighting, the block footprint, camera controls, and the
 * era-switching stub. Runs standalone so the app is usable from the start.
 */
export function CityCanvas() {
  return (
    <Canvas
      shadows
      camera={{ position: [14, 10, 14], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      {/* Lighting */}
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[12, 16, 10]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />

      <BlockFootprint />

      <OrbitControls target={[0, 0, 0]} enableDamping />

      <EraSwitcherStub />
    </Canvas>
  );
}
