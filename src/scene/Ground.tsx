import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';

export function Ground() {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const baseColor = useMemo(() => new THREE.Color('#3a3f46'), []);
  const nightColor = useMemo(() => new THREE.Color('#0d1016'), []);
  const tmp = useMemo(() => new THREE.Color(), []);

  // Slow ambient nightfall tinting rather than hard switching.
  useFrame((_, delta) => {
    const dayTime = useSceneStore.getState().dayTime;
    const sunAngle = (dayTime - 0.5) * Math.PI * 2; // -PI..PI
    const dayFactor = Math.max(0, Math.sin(sunAngle));
    const night = 1 - dayFactor;
    tmp.copy(baseColor).lerp(nightColor, night * 0.72);
    if (matRef.current) {
      matRef.current.color.copy(tmp);
      matRef.current.emissiveIntensity = 0.04 + night * 0.04;
    }
  });

  return (
    <mesh rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial
        ref={matRef}
        color="#3a3f46"
        roughness={0.95}
        metalness={0.0}
      />
    </mesh>
  );
}