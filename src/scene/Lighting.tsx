import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';

const SUN_AXIS = new THREE.Vector3(0.45, 1, 0.12).normalize();

/**
 * Era + time-of-day lighting. The sun direction sweeps across the sky with
 * the day/night cycle; era palettes tint ambient/fill intensity. No direct
 * renderer ownership — we only drive scene-level lights and a hemisphere.
 */
export function Lighting() {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const fillRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);

  const sunColor = useMemo(() => new THREE.Color('#fff2dc'), []);
  const fillColor = useMemo(() => new THREE.Color('#b9d4ff'), []);
  const groundColor = useMemo(() => new THREE.Color('#3f3a33'), []);

  useFrame(() => {
    const { current, dayTime } = useSceneStore.getState();
    const sunAngle = (dayTime - 0.5) * Math.PI * 2;
    const dayFactor = Math.max(0, Math.sin(sunAngle));
    const night = 1 - dayFactor;

    // Sun elevation + azimuth.
    const elevation = Math.sin(sunAngle);
    const azimuth = Math.cos(sunAngle);
    const dir = new THREE.Vector3(
      SUN_AXIS.x * azimuth,
      Math.max(-0.25, elevation),
      SUN_AXIS.z * azimuth,
    ).normalize();

    if (sunRef.current) {
      sunRef.current.position.copy(dir).multiplyScalar(40);
      sunRef.current.intensity = 0.2 + dayFactor * 2.4 + night * 0.12;
      sunColor
        .set(current.palette.sun)
        .lerp(new THREE.Color('#2b2f4a'), night * 0.75);
      sunRef.current.color.copy(sunColor);
    }
    if (fillRef.current) {
      fillRef.current.position.copy(dir).multiplyScalar(-30);
      fillRef.current.intensity = 0.12 + night * 0.4;
      fillColor.set(current.palette.fill).lerp(new THREE.Color('#20243a'), night * 0.6);
      fillRef.current.color.copy(fillColor);
    }
    if (hemiRef.current) {
      const skyCol = new THREE.Color(current.palette.sky)
        .lerp(new THREE.Color('#08101d'), night * 0.7);
      hemiRef.current.color.copy(skyCol);
      groundColor.copy(new THREE.Color(current.palette.asphalt)).lerp(new THREE.Color('#0c0f16'), night * 0.55);
      hemiRef.current.groundColor.copy(groundColor);
      hemiRef.current.intensity = 0.45 + dayFactor * 0.55;
    }
  });

  return (
    <>
      <hemisphereLight
        ref={hemiRef}
        args={['#9fc2d8', '#3f3a33', 1.0]}
        position={[0, 30, 0]}
      />
      <directionalLight
        ref={sunRef}
        castShadow
        position={[26, 34, 8]}
        intensity={2.4}
        color="#fff2dc"
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={90}
        shadow-bias={-0.0004}
      />
      <directionalLight
        ref={fillRef}
        position={[-16, 6, -20]}
        intensity={0.5}
        color="#b9d4ff"
      />
    </>
  );
}