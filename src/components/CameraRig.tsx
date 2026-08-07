import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useCameraStore } from '../store/useCameraStore';

/** Free-fly keyboard state (transient, not React state to avoid re-renders). */
interface FlyKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  boost: boolean;
}

/** Pointer-look state used while flying. */
interface LookState {
  yaw: number;
  pitch: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

const LOOK_SENSITIVITY = 0.005;
const WALK_SPEED = 8;
const BOOST_SPEED = 24;

/**
 * Free camera navigation rig.
 *
 * Two modes, shared with the header toggle through {@link useCameraStore}:
 *
 * - `orbit` (default): mouse drag to orbit/look, wheel to zoom, touch drag /
 *   pinch to orbit + pan (drei OrbitControls). Accessible via mouse & touch.
 * - `fly` (toggled with the `F` key or the header button): first-person free
 *   flight. WASD / arrow keys move in the camera's local plane, Q/E move down
 *   / up, Shift boosts speed, and mouse drag (or touch drag) looks around.
 *
 * Because orbit already covers mouse + touch and fly covers keyboard + mouse,
 * the full camera surface is reachable from mouse, touch and keyboard.
 */
export function CameraRig() {
  const mode = useCameraStore((s) => s.mode);
  const setMode = useCameraStore((s) => s.setMode);

  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const keys = useRef<FlyKeys>({
    forward: false,
    back: false,
    left: false,
    right: false,
    up: false,
    down: false,
    boost: false,
  });
  const look = useRef<LookState>({ yaw: 0, pitch: 0, dragging: false, lastX: 0, lastY: 0 });

  // Seed the fly look angles from the camera's current orientation.
  useEffect(() => {
    if (mode === 'fly') {
      const e = camera.rotation;
      look.current.yaw = e.y;
      look.current.pitch = e.x;
    }
  }, [mode, camera]);

  // Global keyboard: mode toggle + fly movement keys.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'f' || e.key === 'F') {
        setMode(mode === 'orbit' ? 'fly' : 'orbit');
        return;
      }
      const k = keys.current;
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          k.forward = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          k.back = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          k.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          k.right = true;
          break;
        case 'KeyQ':
          k.down = true;
          break;
        case 'KeyE':
        case 'Space':
          k.up = true;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          k.boost = true;
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      const k = keys.current;
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          k.forward = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          k.back = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          k.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          k.right = false;
          break;
        case 'KeyQ':
          k.down = false;
          break;
        case 'KeyE':
        case 'Space':
          k.up = false;
          break;
        case 'ShiftLeft':
        case 'ShiftRight':
          k.boost = false;
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [mode, setMode]);

  // Pointer-look while in fly mode (mouse + touch drag).
  useEffect(() => {
    if (mode !== 'fly') return;
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      look.current.dragging = true;
      look.current.lastX = e.clientX;
      look.current.lastY = e.clientY;
      el.setPointerCapture?.(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!look.current.dragging) return;
      const dx = e.clientX - look.current.lastX;
      const dy = e.clientY - look.current.lastY;
      look.current.lastX = e.clientX;
      look.current.lastY = e.clientY;
      look.current.yaw -= dx * LOOK_SENSITIVITY;
      look.current.pitch -= dy * LOOK_SENSITIVITY;
      look.current.pitch = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, look.current.pitch),
      );
    };
    const onUp = () => {
      look.current.dragging = false;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [mode, gl]);

  // Fly movement each frame.
  useFrame((_, delta) => {
    if (mode !== 'fly') return;
    const k = keys.current;
    const lk = look.current;
    const speed = (k.boost ? BOOST_SPEED : WALK_SPEED) * Math.min(delta, 0.05);

    const euler = new THREE.Euler(lk.pitch, lk.yaw, 0, 'YXZ');
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
    const right = new THREE.Vector3(1, 0, 0).applyEuler(euler);

    const move = new THREE.Vector3();
    if (k.forward) move.add(forward);
    if (k.back) move.sub(forward);
    if (k.right) move.add(right);
    if (k.left) move.sub(right);
    if (k.up) move.y += 1;
    if (k.down) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      camera.position.add(move);
    }
    camera.quaternion.setFromEuler(euler);
  });

  return (
    <>{mode === 'orbit' ? <OrbitControls makeDefault enableDamping dampingFactor={0.08} /> : null}</>
  );
}
