import { useEffect } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../store/useCameraStore';
import { FlyController } from './FlyController';

/** Default camera framing shared with the fly mode. */
const DEFAULT_POSITION: [number, number, number] = [14, 14, 14];

/**
 * Camera rig rendered inside the Canvas.
 *
 * Switches between drei {@link OrbitControls} (orbit/pan/zoom via mouse and
 * touch) and the custom {@link FlyController} walk mode. Both modes share the
 * same camera and honor the "reset view" request from the HUD.
 */
export function CameraControls() {
  const mode = useCameraStore((s) => s.mode);
  const resetSignal = useCameraStore((s) => s.resetSignal);
  // The makeDefault OrbitControls instance, when mounted.
  const controls = useThree((s) => s.controls);

  useEffect(() => {
    if (resetSignal === 0 || mode === 'fly') return;
    if (!controls) return;
    const orbit = controls as unknown as {
      object: THREE.PerspectiveCamera;
      target: THREE.Vector3;
      update: () => void;
    };
    orbit.object.position.set(...DEFAULT_POSITION);
    orbit.target.set(0, 0, 0);
    orbit.update();
  }, [resetSignal, mode, controls]);

  if (mode === 'fly') {
    return <FlyController />;
  }

  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      enablePan
      enableZoom
      minDistance={2}
      maxDistance={80}
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}
