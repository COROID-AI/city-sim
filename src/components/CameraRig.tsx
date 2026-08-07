import { OrbitControls } from '@react-three/drei';
import { useNavStore } from '../store/useNavStore';
import { FlyControls } from './FlyControls';

/**
 * Swaps between the two camera navigation modes based on the shared nav store.
 *
 * - `orbit`: drei OrbitControls (orbit / pan / zoom with mouse + touch).
 * - `fly`  : the custom {@link FlyControls} first-person controller.
 *
 * Only one controller is mounted at a time so they never fight over the
 * camera. Switching modes keeps the current camera position; orbit mode
 * re-targets the block origin.
 */
export function CameraRig() {
  const mode = useNavStore((s) => s.mode);

  if (mode === 'fly') {
    return <FlyControls />;
  }

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      minDistance={3}
      maxDistance={60}
      maxPolarAngle={Math.PI / 2 - 0.05}
    />
  );
}
