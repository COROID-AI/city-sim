import { useEffect, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { EraId } from '../contracts';
import { Buildings } from '../modules/buildings';
import { Vehicles } from '../vehicles';
import { StorefrontsAds } from '../modules/storefrontsAds';
import { Pedestrians } from '../pedestrians';
import { StreetEnvironment } from '../modules/streetEnvironment';
import { Effects } from '../effects';
import { TransitionManager } from './TransitionManager';
import { useNavStore } from '../store/useNavStore';

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
 * Custom fly / walk camera mode.
 *
 * WASD or arrow keys move the camera along its facing direction, Q/E (or
 * Shift/Space) move it vertically, dragging rotates the view (works with
 * pointer / touch) and the scroll wheel changes speed. The camera is clamped
 * above the ground so you never fall through the street.
 */
function FlyControls({ enabled }: { enabled: boolean }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const keys = useRef<Record<string, boolean>>({});
  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });
  const speed = useRef(6);

  // Seed yaw/pitch from the current camera orientation when enabled.
  useEffect(() => {
    if (!enabled) {
      return;
    }
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    yaw.current = euler.y;
    pitch.current = euler.x;
  }, [enabled, camera]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const el = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      keys.current[e.code] = true;
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    const onPointerDown = (e: PointerEvent) => {
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) {
        return;
      }
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      yaw.current -= dx * 0.005;
      pitch.current = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, pitch.current - dy * 0.005),
      );
    };
    const onPointerUp = () => {
      dragging.current = false;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      speed.current = Math.max(1, Math.min(30, speed.current + e.deltaY * 0.01));
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('wheel', onWheel);
    };
  }, [enabled, gl]);

  useFrame((_, delta) => {
    if (!enabled) {
      return;
    }
    const euler = new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      camera.quaternion,
    );
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
      camera.quaternion,
    );
    const move = new THREE.Vector3();
    const k = keys.current;

    if (k['KeyW'] || k['ArrowUp']) move.add(forward);
    if (k['KeyS'] || k['ArrowDown']) move.sub(forward);
    if (k['KeyD'] || k['ArrowRight']) move.add(right);
    if (k['KeyA'] || k['ArrowLeft']) move.sub(right);
    if (k['KeyE'] || k['Space']) move.y += 1;
    if (k['KeyQ'] || k['ShiftLeft'] || k['ShiftRight']) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed.current * delta);
      camera.position.add(move);
    }

    // Keep the camera above the street.
    camera.position.y = Math.max(camera.position.y, 0.5);
  });

  return null;
}

/**
 * Camera rig that owns the active navigation mode.
 *
 * Orbit mode uses drei's OrbitControls (mouse drag to rotate, right-drag /
 * two-finger to pan, scroll / pinch to zoom). Fly mode swaps in the custom
 * {@link FlyControls}. The mode is read from the shared navigation store so
 * the on-canvas UI can toggle it. The camera is independent of the era
 * transition manager, so navigation stays usable during transitions.
 */
function CameraRig() {
  const mode = useNavStore((s) => s.mode);
  return (
    <>
      <OrbitControls enableDamping enabled={mode === 'orbit'} />
      <FlyControls enabled={mode === 'fly'} />
    </>
  );
}

/**
 * Base 3D scene.
 *
 * Composes every module (Buildings, Vehicles, StorefrontsAds, Pedestrians,
 * StreetEnvironment), the PostProcessing stack (`Effects`), the era
 * transition orchestration (`TransitionManager`) and the navigable camera
 * rig (`CameraRig`). The transition manager crossfades both eras while a
 * morph is in flight so the whole city transforms smoothly instead of
 * popping.
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
      <CameraRig />
    </Canvas>
  );
}
