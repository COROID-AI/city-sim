import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { useBuildingLayouts } from './layout';
import { Building } from './Building';

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

  useFrame(() => {
    const { current, dayTime } = useSceneStore.getState();
    const night = 1 - Math.max(0, Math.sin((dayTime - 0.5) * Math.PI * 2));
    sharedMats.roof.color.set(current.palette.roof);
    sharedMats.roofCap.color.set(current.palette.roof).lerp(new THREE.Color('#7a5a3c'), 0.2);
    sharedMats.antenna.color.set(current.palette.roof).lerp(new THREE.Color('#2a2a30'), 0.55);
    sharedMats.detail.color.set(current.palette.facade).lerp(new THREE.Color('#b08a5a'), 0.35);
    sharedMats.roof.needsUpdate = true;
    sharedMats.roofCap.needsUpdate = true;
    sharedMats.antenna.needsUpdate = true;
    sharedMats.detail.needsUpdate = true;
    // Window shared material is driven per-Building (needs the facade) but we
    // nudge the emissive here for night response too.
    sharedMats.window.emissiveIntensity = 0.06 + night * 0.8;
    sharedMats.window.needsUpdate = true;
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