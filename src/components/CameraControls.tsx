import { OrbitControls } from '@react-three/drei';
import { useCameraStore } from '../store/useCameraStore';
import { FlyCamera } from './FlyCamera';

/**
 * Camera controller that switches between orbit and fly modes based on the
 * shared camera store. Orbit is the default; fly enables first-person
 * fly-through navigation.
 */
export function CameraControls() {
  const mode = useCameraStore((s) => s.mode);

  if (mode === 'fly') {
    return <FlyCamera />;
  }
  return <OrbitControls enableDamping makeDefault />;
}
