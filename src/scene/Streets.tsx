import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { ROAD_HALF_W, ROAD_WIDTH } from './constants';

/**
 * Streets: a pair of crossing roads with lane paint, crosswalks, and
 * sidewalks. Materials are re-tinted per era and time of day via the store.
 */
export function Streets() {
  const roadMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#3a3f46', roughness: 0.92 }),
    [],
  );
  const paintMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#e8e0c8', roughness: 0.6 }),
    [],
  );
  const crossMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#cfc4ad', roughness: 0.7 }),
    [],
  );
  const tmp = useMemo(() => new THREE.Color(), []);

  const roadGeo = useMemo(() => new THREE.PlaneGeometry(120, ROAD_WIDTH), []);
  const roadGeoV = useMemo(() => new THREE.PlaneGeometry(ROAD_WIDTH, 120), []);
  const laneGeo = useMemo(() => new THREE.PlaneGeometry(54, 0.22), []);
  const laneGeoV = useMemo(() => new THREE.PlaneGeometry(0.22, 54), []);
  const crossGeo = useMemo(() => new THREE.PlaneGeometry(2.6, 0.5), []);

  const crosswalks = useMemo(() => {
    const list: { x: number; z: number; ry?: number }[] = [];
    const offsets = [-1.2, -3.6, -6.0, -9.6, -13.2];
    for (const off of offsets) {
      list.push({ x: off, z: 0 });
      list.push({ x: -off, z: 0 });
      list.push({ x: 0, z: off, ry: Math.PI / 2 });
      list.push({ x: 0, z: -off, ry: Math.PI / 2 });
    }
    return list;
  }, []);

  useFrame(() => {
    const { current, dayTime } = useSceneStore.getState();
    const sun = (dayTime - 0.5) * Math.PI * 2;
    const dayFactor = Math.max(0, Math.sin(sun));
    const night = 1 - dayFactor;

    tmp.set(current.palette.asphalt).multiplyScalar(0.55 + 0.45 * dayFactor);
    roadMat.color.copy(tmp);
    roadMat.emissive.copy(tmp).multiplyScalar(0.06 + night * 0.1);
    roadMat.needsUpdate = true;

    tmp.set(current.palette.lanePaint);
    paintMat.color.copy(tmp);
    paintMat.emissive.set(tmp).multiplyScalar(0.1 + night * 0.55);
    paintMat.needsUpdate = true;

    tmp.set(current.palette.crosswalk);
    crossMat.color.copy(tmp);
    crossMat.emissive.set(tmp).multiplyScalar(0.08 + night * 0.5);
    crossMat.needsUpdate = true;
  });

  return (
    <group>
      {/* Asphalt roads */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0.005, 0]}
        receiveShadow
        material={roadMat}
        geometry={roadGeo}
      />
      <mesh
        rotation-x={-Math.PI / 2}
        position={[0, 0.005, 0]}
        receiveShadow
        material={roadMat}
        geometry={roadGeoV}
      />

      {/* Lane markings */}
      {[ROAD_HALF_W * 0.45, -ROAD_HALF_W * 0.45].map((z) => (
        <mesh
          key={`hz-${z}`}
          rotation-x={-Math.PI / 2}
          position={[0, 0.02, z]}
          material={paintMat}
          geometry={laneGeo}
        />
      ))}
      {[ROAD_HALF_W * 0.45, -ROAD_HALF_W * 0.45].map((x) => (
        <mesh
          key={`vx-${x}`}
          rotation-x={-Math.PI / 2}
          position={[x, 0.02, 0]}
          material={paintMat}
          geometry={laneGeoV}
        />
      ))}

      {/* Crosswalks */}
      {crosswalks.map((c) => (
        <mesh
          key={`cw-${c.x}-${c.z}`}
          rotation-x={-Math.PI / 2}
          rotation-z={c.ry ?? 0}
          position={[c.x, 0.021, c.z]}
          material={crossMat}
          geometry={crossGeo}
        />
      ))}

      {/* Sidewalk slabs around the block */}
      {[
        { x: 0, z: ROAD_HALF_W + 0.45, w: 54, d: 1.1 },
        { x: 0, z: -(ROAD_HALF_W + 0.45), w: 54, d: 1.1 },
        { x: ROAD_HALF_W + 0.45, z: 0, w: 1.1, d: 54 },
        { x: -(ROAD_HALF_W + 0.45), z: 0, w: 1.1, d: 54 },
      ].map((s, i) => (
        <mesh
          key={`side-${i}`}
          rotation-x={-Math.PI / 2}
          position={[s.x, 0.008, s.z]}
          receiveShadow
        >
          <planeGeometry args={[s.w, s.d]} />
          <meshStandardMaterial color="#8a7a68" roughness={0.92} />
        </mesh>
      ))}

      {/* Block corner plazas (simple pavers) */}
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`plaza-${sx}-${sz}`}
            rotation-x={-Math.PI / 2}
            position={[sx * 13.5, 0.006, sz * 13.5]}
          >
            <planeGeometry args={[4.2, 4.2]} />
            <meshStandardMaterial color="#9a8d7a" roughness={0.9} />
          </mesh>
        )),
      )}
    </group>
  );
}