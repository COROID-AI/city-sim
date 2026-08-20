import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { usePedestrianLayouts, type PedestrianLayout } from './layout';
import { BLOCK_MAX } from './constants';

/**
 * Pedestrians: an animated sidewalk crowd. Two instanced meshes (bodies +
 * heads) move along a sidewalk ring around the block. Per-instance colors
 * dim at night and shift slightly with the era clothing palette.
 */
export function Pedestrians() {
  const layouts = usePedestrianLayouts();
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const tmpColor = useMemo(() => new THREE.Color(), []);
  const tmpMatrix = useMemo(() => new THREE.Matrix4(), []);
  const tmpQuat = useMemo(() => new THREE.Quaternion(), []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);
  const tmpScale = useMemo(() => new THREE.Vector3(), []);

  const bodyGeo = useMemo(() => new THREE.BoxGeometry(0.3, 0.62, 0.2), []);
  const headGeo = useMemo(() => new THREE.SphereGeometry(0.13, 8, 6), []);

  const bodyMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#4f6f8f',
        roughness: 0.85,
      }),
    [],
  );
  const headMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#d8a878',
        roughness: 0.75,
      }),
    [],
  );

  // Deterministic clothing palette per pedestrian (stable, era-tinted later).
  const tints = useMemo(() => {
    const palette = [
      '#5b7a9a',
      '#a05a4a',
      '#4a6d55',
      '#8a6a4a',
      '#7a4a6a',
      '#4a5a7a',
      '#a08030',
      '#3d6b70',
    ];
    return layouts.map((p) => palette[p.id % palette.length]);
  }, [layouts]);

  useFrame(() => {
    const state = useSceneStore.getState();
    const { current, dayTime } = state;
    const night = 1 - Math.max(0, Math.sin((dayTime - 0.5) * Math.PI * 2));
    const now = performance.now() / 1000;

    if (bodyRef.current && headRef.current) {
      for (let i = 0; i < layouts.length; i++) {
        const ped = layouts[i]!;
        // Walk a closed ring around the block at a sidewalk offset so the
        // crowd loops the whole block instead of bouncing on two edges.
        const ring = BLOCK_MAX + 1.7;
        const perimeter = 4 * 2 * ring;
        const t = (now * ped.speed + ped.phase * perimeter) % perimeter;
        const seg = Math.floor(t / (2 * ring));
        const u = (t % (2 * ring)) / (2 * ring);
        let x: number;
        let z: number;
        let yaw: number;
        if (seg === 0) {
          x = -ring + u * 2 * ring;
          z = ring;
          yaw = Math.PI / 2; // facing +x
        } else if (seg === 1) {
          x = ring;
          z = ring - u * 2 * ring;
          yaw = Math.PI; // facing -z
        } else if (seg === 2) {
          x = ring - u * 2 * ring;
          z = -ring;
          yaw = -Math.PI / 2; // facing -x
        } else {
          x = -ring;
          z = -ring + u * 2 * ring;
          yaw = 0; // facing +z
        }
        // Slight per-person lateral jitter.
        x += Math.sin(now * 3 + i) * 0.06;
        z += Math.cos(now * 2.7 + i) * 0.06;

        tmpPos.set(x, 0, z);
        tmpQuat.setFromEuler(new THREE.Euler(0, yaw, 0));
        tmpScale.set(1, 1, 1);
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        bodyRef.current.setMatrixAt(i, tmpMatrix);

        // Head sits on top of the body.
        tmpPos.y = 0.38;
        tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
        headRef.current.setMatrixAt(i, tmpMatrix);

        // Tint.
        const base = tints[i]!;
        tmpColor.set(base).multiplyScalar(0.55 + 0.45 * (1 - night));
        bodyRef.current.setColorAt(i, tmpColor);
      }
      bodyRef.current.instanceMatrix.needsUpdate = true;
      headRef.current.instanceMatrix.needsUpdate = true;
      if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
      if (headRef.current.instanceColor) headRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[bodyGeo, bodyMat, layouts.length]} castShadow />
      <instancedMesh ref={headRef} args={[headGeo, headMat, layouts.length]} castShadow />
    </group>
  );
}