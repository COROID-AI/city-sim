import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';

/** The empty lit block footprint the city will be built on. */
function BlockFootprint() {
  return (
    <group>
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[10, 0.1, 10]} />
        <meshStandardMaterial color="#3a3f4a" roughness={0.9} />
      </mesh>
      {/* Ground plane catches shadows beneath the block. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#23262e" roughness={1} />
      </mesh>
    </group>
  );
}

/** Base 3D scene: lit block footprint, camera, orbit controls. */
export function Scene() {
  return (
    <Canvas
      shadows
      camera={{ position: [9, 9, 9], fov: 50 }}
      style={{ width: '100%', height: '100%' }}
    >
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 15, 8]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />
      <BlockFootprint />
      <OrbitControls enableDamping />
    </Canvas>
  );
}
