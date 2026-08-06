import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { EraId } from '../contracts';
import { Buildings } from '../modules/buildings';
import { Vehicles } from '../vehicles';
import { StorefrontsAds } from '../modules/storefrontsAds';
import { Pedestrians } from '../pedestrians';
import { StreetEnvironment } from '../modules/streetEnvironment';
import { Effects } from '../effects';
import { TransitionManager } from './TransitionManager';

/** Ground plane that catches shadows outside the road and sidewalks. */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#23262e" roughness={1} />
    </mesh>
  );
}

/**
 * One era's full city: street environment (sky + lighting + road + furniture),
 * buildings, storefronts + ads, vehicles and pedestrians — all composed around
 * the shared block footprint.
 */
function CityLayer({ era }: { era: EraId }) {
  return (
    <group>
      <StreetEnvironment era={era} />
      <Buildings era={era} />
      <StorefrontsAds era={era} environment="day" />
      <Vehicles era={era} />
      <Pedestrians era={era} />
    </group>
  );
}

/**
 * Base 3D scene.
 *
 * Composes every module (Buildings, Vehicles, StorefrontsAds, Pedestrians,
 * StreetEnvironment), the PostProcessing stack (`Effects`) and the era
 * transition orchestration (`TransitionManager`). The transition manager
 * crossfades both eras while a morph is in flight so the whole city
 * transforms smoothly instead of popping.
 */
export function Scene({ onReady }: { onReady?: () => void }) {
  return (
    <Canvas
      shadows
      camera={{ position: [9, 9, 9], fov: 50 }}
      onCreated={onReady}
      style={{ width: '100%', height: '100%' }}
    >
      <Ground />
      <TransitionManager>{(era) => <CityLayer era={era} />}</TransitionManager>
      <Effects />
      <OrbitControls enableDamping />
    </Canvas>
  );
}