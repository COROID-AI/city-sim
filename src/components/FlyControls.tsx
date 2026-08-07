import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Keys that would otherwise scroll the page; swallowed while flying. */
const PREVENT_DEFAULT = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

/** Seconds to move one world unit at base speed. */
const MOVE_SPEED = 6;
/** Radians of yaw/pitch per pixel of drag. */
const LOOK_SENSITIVITY = 0.0032;

/**
 * A small first-person fly/walk controller used instead of OrbitControls when
 * the user picks "Fly" mode.
 *
 * - Keyboard: WASD / arrow keys move forward/back/strafe; Space/E rise and
 *   Shift/Q descend (clamped above the block so you can't fly through ground).
 * - Mouse / touch: drag to look around (yaw + clamped pitch).
 *
 * Renders nothing; it drives the shared canvas camera each frame.
 */
export function FlyControls() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const pressed = useRef<Set<string>>(new Set());
  const look = useRef({ yaw: 0, pitch: 0 });
  const dragging = useRef(false);
  const last = useRef({ x: 0, y: 0 });

  // Seed the look angles from the camera's current orientation when fly mode
  // mounts, so switching from orbit doesn't snap the view.
  useEffect(() => {
    camera.updateMatrixWorld();
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    look.current.yaw = euler.y;
    look.current.pitch = euler.x;
  }, [camera]);

  // Keyboard state.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      pressed.current.add(e.code);
      if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    };
    const up = (e: KeyboardEvent) => {
      pressed.current.delete(e.code);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // Drag-to-look on the canvas (also works for touch drags via Pointer Events).
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      last.current = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - last.current.x;
      const dy = e.clientY - last.current.y;
      last.current = { x: e.clientX, y: e.clientY };
      look.current.yaw -= dx * LOOK_SENSITIVITY;
      look.current.pitch = Math.max(
        -Math.PI / 2,
        Math.min(Math.PI / 2, look.current.pitch - dy * LOOK_SENSITIVITY),
      );
    };
    const onUp = () => {
      dragging.current = false;
    };
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const k = pressed.current;

    // Movement direction projected on the horizontal plane.
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();

    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (k.has('Space') || k.has('KeyE')) move.y += 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ')) move.y -= 1;

    if (move.lengthSq() > 0) move.normalize().multiplyScalar(MOVE_SPEED * dt);
    camera.position.add(move);

    // Keep the camera above the block footprint (ground sits at y ~ -0.5).
    if (camera.position.y < 0.4) camera.position.y = 0.4;

    // Apply look rotation (YXZ order so yaw then pitch behave like a head).
    camera.rotation.order = 'YXZ';
    camera.rotation.y = look.current.yaw;
    camera.rotation.x = look.current.pitch;
  });

  return null;
}
