import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { useBuildingLayouts } from './layout';
import { Building } from './Building';

const ROOFCAP_TINT = new THREE.Color('#7a5a3c');
const ANTENNA_TINT = new THREE.Color('#2a2a30');
const DETAIL_TINT = new THREE.Color('#b08a5a');

/**
 * Buildings container: owns the shared materials handed to every Building and
 * keeps era-tint updates in one place. Each Building owns its own facade
 * material (per-style roughness/metalness), while shared window/roof/detail
 * materials keep draw-call counts low.
 */
export function Buildings() {
  const layouts = useBuildingLayouts();

  const sharedMats = useMemo(
    () => ({
      window: new THREE.MeshStandardMaterial({
        color: '#3a3028',
        roughness: 0.35,
        metalness: 0.2,
        emissive: new THREE.Color('#ffce8f'),
        emissiveIntensity: 0.06,
      }),
      roof: new THREE.MeshStandardMaterial({
        color: '#4b4a52',
        roughness: 0.88,
      }),
      roofCap: new THREE.MeshStandardMaterial({
        color: '#5b4a3c',
        roughness: 0.7,
      }),
      detail: new THREE.MeshStandardMaterial({
        color: '#8a6a4a',
        roughness: 0.7,
      }),
      antenna: new THREE.MeshStandardMaterial({
        color: '#3f3f46',
        roughness: 0.45,
        metalness: 0.7,
      }),
    }),
    [],
  );

  const prev = useRef({
    roof: sharedMats.roof.color.clone(),
    roofCap: sharedMats.roofCap.color.clone(),
    antenna: sharedMats.antenna.color.clone(),
    detail: sharedMats.detail.color.clone(),
    windowIntensity: sharedMats.window.emissiveIntensity,
  });
  const scratch = useRef({
    roof: new THREE.Color(),
    roofCap: new THREE.Color(),
    antenna: new THREE.Color(),
    detail: new THREE.Color(),
  });

  useFrame(() => {
    const { current, dayTime } = useSceneStore.getState();
    const night = 1 - Math.max(0, Math.sin((dayTime - 0.5) * Math.PI * 2));
    const last = prev.current;
    const s = scratch.current;

    // Uniform-only color updates propagate through versioned uniform uploads,
    // so needsUpdate is only flagged when a value actually changed versus the
    // previous frame (avoids per-frame shader-recompilation churn).
    s.roof.set(current.palette.roof);
    if (!last.roof.equals(s.roof)) {
      sharedMats.roof.color.copy(s.roof);
      sharedMats.roof.needsUpdate = true;
      last.roof.copy(s.roof);
    }

    s.roofCap.set(current.palette.roof).lerp(ROOFCAP_TINT, 0.2);
    if (!last.roofCap.equals(s.roofCap)) {
      sharedMats.roofCap.color.copy(s.roofCap);
      sharedMats.roofCap.needsUpdate = true;
      last.roofCap.copy(s.roofCap);
    }

    s.antenna.set(current.palette.roof).lerp(ANTENNA_TINT, 0.55);
    if (!last.antenna.equals(s.antenna)) {
      sharedMats.antenna.color.copy(s.antenna);
      sharedMats.antenna.needsUpdate = true;
      last.antenna.copy(s.antenna);
    }

    s.detail.set(current.palette.facade).lerp(DETAIL_TINT, 0.35);
    if (!last.detail.equals(s.detail)) {
      sharedMats.detail.color.copy(s.detail);
      sharedMats.detail.needsUpdate = true;
      last.detail.copy(s.detail);
    }

    // Window shared material is driven per-Building (needs the facade) but we
    // nudge the emissive here for night response too.
    const windowIntensity = 0.06 + night * 0.8;
    if (windowIntensity !== last.windowIntensity) {
      sharedMats.window.emissiveIntensity = windowIntensity;
      sharedMats.window.needsUpdate = true;
      last.windowIntensity = windowIntensity;
    }
  });

  return (
    <group>
      {layouts.map((layout) => (
        <Building
          key={layout.id}
          layout={layout}
          bodyMat={sharedMats.roof}
          roofMat={sharedMats.roof}
          roofCapMat={sharedMats.roofCap}
          windowMat={sharedMats.window}
          detailMat={sharedMats.detail}
          antennaMat={sharedMats.antenna}
        />
      ))}
    </group>
  );
}