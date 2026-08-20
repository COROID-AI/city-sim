import { Canvas } from '@react-three/fiber';
import { OrbitControls, Preload } from '@react-three/drei';
import { SkyDome } from './SkyDome';
import { Lighting } from './Lighting';
import { Ground } from './Ground';
import { Streets } from './Streets';
import { Buildings } from './Buildings';
import { Vehicles } from './Vehicles';
import { Pedestrians } from './Pedestrians';
import { StreetFurniture } from './StreetFurniture';
import { Effects } from './Effects';
import { useSceneStore } from '../state/useSceneStore';

/**
 * SceneRoot composes every 3D system inside the R3F Canvas. Camera is owned
 * declaratively via drei's OrbitControls; all state flows from the Zustand
 * store.
 */
export function SceneRoot() {
  const dayTime = useSceneStore((s) => s.dayTime);
  const cameraDistance = useSceneStore((s) => s.cameraDistance);

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [24, 15, 26], fov: 42, near: 0.5, far: 260 }}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      onCreated={({ camera }) => {
        camera.lookAt(0, 2, 0);
      }}
    >
      <color attach="background" args={['#9fc2d8']} />
      <fog attach="fog" args={['#cfd6e0', 80, 210]} />

      <SkyDome />
      <Lighting />
      <Ground />
      <Streets />
      <Buildings />
      <Vehicles />
      <Pedestrians />
      <StreetFurniture />
      <Effects />

      <OrbitControls
        target={[0, 4, 0]}
        enableDamping
        dampingFactor={0.08}
        minDistance={6}
        maxDistance={70}
        maxPolarAngle={Math.PI / 2 - 0.05}
        makeDefault
      />
      <Preload all />
    </Canvas>
  );
}