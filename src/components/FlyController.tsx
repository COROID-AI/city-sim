import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useCameraStore } from '../store/useCameraStore';
import { flyKeys, isInteractiveTarget } from '../store/flyInput';

/** Default camera framing shared with the orbit mode. */
const DEFAULT_POSITION = new THREE.Vector3(14, 14, 14);

/**
 * Custom first-person fly/walk controller.
 *
 * - Mouse/touch: drag to look around.
 * - Keyboard: WASD / arrow keys to move, Space to ascend, Shift to descend.
 * - Touch: on-screen movement buttons (rendered by the HUD) write to the
 *   shared {@link flyKeys} set, so touch drives the same movement as the
 *   keyboard.
 */
export function FlyController() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const resetSignal = useCameraStore((s) => s.resetSignal);

  // Orient the camera toward the origin from the default framing.
  const yaw = useRef(Math.PI / 4);
  const pitch = useRef(Math.asin(-1 / Math.sqrt(3)));
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  // Global keyboard + window blur handling.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isInteractiveTarget(e.target)) return;
      flyKeys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => flyKeys.delete(e.code);
    const onBlur = () => flyKeys.clear();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Pointer (mouse + touch) drag-to-look.
  useEffect(() => {
    const el = gl.domElement;

    const onPointerDown = (e: PointerEvent) => {
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* pointer capture is optional */
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      yaw.current -= dx * 0.003;
      pitch.current = THREE.MathUtils.clamp(
        pitch.current - dy * 0.003,
        -Math.PI / 2 + 0.02,
        Math.PI / 2 - 0.02,
      );
    };

    const endDrag = (e: PointerEvent) => {
      dragging.current = false;
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* not captured */
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [gl]);

  // Reset view on demand.
  useEffect(() => {
    if (resetSignal === 0) return;
    camera.position.copy(DEFAULT_POSITION);
    yaw.current = Math.PI / 4;
    pitch.current = Math.asin(-1 / Math.sqrt(3));
  }, [resetSignal, camera]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // Apply orientation.
    const euler = new THREE.Euler(pitch.current, yaw.current, 0, 'YXZ');
    camera.quaternion.setFromEuler(euler);

    // Movement basis (forward/right projected onto the ground plane).
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const forward = new THREE.Vector3(dir.x, 0, dir.z);
    if (forward.lengthSq() > 0) forward.normalize();
    const right = new THREE.Vector3()
      .crossVectors(forward, new THREE.Vector3(0, 1, 0))
      .normalize();

    const move = new THREE.Vector3();
    if (flyKeys.has('KeyW') || flyKeys.has('ArrowUp')) move.add(forward);
    if (flyKeys.has('KeyS') || flyKeys.has('ArrowDown')) move.addScaledVector(forward, -1);
    if (flyKeys.has('KeyA') || flyKeys.has('ArrowLeft')) move.addScaledVector(right, -1);
    if (flyKeys.has('KeyD') || flyKeys.has('ArrowRight')) move.add(right);
    if (flyKeys.has('Space')) move.y += 1;
    if (flyKeys.has('ShiftLeft') || flyKeys.has('ShiftRight')) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(6 * dt);
      camera.position.add(move);
    }
  });

  return null;
}
