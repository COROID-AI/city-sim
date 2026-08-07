import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

/**
 * First-person fly camera.
 *
 * Keyboard: W/A/S/D (or arrow keys) to move, Q/E (or Space / Ctrl) to
 * descend/ascend, Shift to boost speed. Mouse or touch drag to look.
 *
 * Renders nothing; it drives the active camera every frame while mounted.
 */
const FORWARD_SPEED = 5.5;
const BOOST_MULT = 3;
const LOOK_SPEED = 0.0032;

// Scratch objects reused every frame (GC-free hot loop).
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();

const keys = new Set<string>();

export function FlyCamera() {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  const yaw = useRef(0);
  const pitch = useRef(0);
  const dragging = useRef(false);
  const lastX = useRef(0);
  const lastY = useRef(0);

  // Seed yaw/pitch from the current camera orientation on mount.
  useEffect(() => {
    _euler.setFromQuaternion(camera.quaternion, 'YXZ');
    yaw.current = _euler.y;
    pitch.current = _euler.x;
  }, [camera]);

  // Keyboard state.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code.startsWith('Key') || e.code.startsWith('Arrow')) {
        keys.add(e.code);
      }
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.clear();
    };
  }, []);

  // Pointer look (mouse + touch).
  useEffect(() => {
    const el = gl.domElement;
    const onPointerDown = (e: PointerEvent) => {
      dragging.current = true;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dx = e.clientX - lastX.current;
      const dy = e.clientY - lastY.current;
      lastX.current = e.clientX;
      lastY.current = e.clientY;
      yaw.current -= dx * LOOK_SPEED;
      pitch.current -= dy * LOOK_SPEED;
      pitch.current = Math.max(
        -Math.PI / 2 + 0.01,
        Math.min(Math.PI / 2 - 0.01, pitch.current),
      );
    };
    const onPointerUp = () => {
      dragging.current = false;
    };
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [gl]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);

    // Apply look orientation.
    _quat.setFromEuler(_euler.set(pitch.current, yaw.current, 0, 'YXZ'));
    camera.quaternion.slerp(_quat, 0.6);
    camera.quaternion.normalize();

    const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = FORWARD_SPEED * (boost ? BOOST_MULT : 1);

    camera.getWorldDirection(_dir);
    _right.setFromMatrixColumn(camera.matrixWorld, 0);

    if (keys.has('KeyW') || keys.has('ArrowUp')) {
      camera.position.addScaledVector(_dir, speed * dt);
    }
    if (keys.has('KeyS') || keys.has('ArrowDown')) {
      camera.position.addScaledVector(_dir, -speed * dt);
    }
    if (keys.has('KeyD') || keys.has('ArrowRight')) {
      camera.position.addScaledVector(_right, speed * dt);
    }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) {
      camera.position.addScaledVector(_right, -speed * dt);
    }
    if (keys.has('KeyE') || keys.has('Space')) {
      camera.position.y += speed * dt;
    }
    if (keys.has('KeyQ') || keys.has('ControlLeft')) {
      camera.position.y -= speed * dt;
    }

    // Prevent flying below the street plane.
    if (camera.position.y < 1.2) camera.position.y = 1.2;
  });

  return null;
}
