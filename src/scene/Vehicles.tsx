import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { useVehicleLayouts, type VehicleLayout } from './layout';
import { ROAD_HALF_W } from './constants';

const TRAVEL_LENGTH = 88;
const TRAVEL_HALF = TRAVEL_LENGTH / 2;
const ERA_MAX = 5; // position range is 0..ERA_COUNT-1 = 0..5

interface LaneCfg {
  axis: 'x' | 'z';
  off: number;
}

const LANE_CFG: Record<VehicleLayout['lane'], LaneCfg> = {
  xPlus: { axis: 'x', off: ROAD_HALF_W * 0.5 },
  xMinus: { axis: 'x', off: -ROAD_HALF_W * 0.5 },
  zPlus: { axis: 'z', off: ROAD_HALF_W * 0.5 },
  zMinus: { axis: 'z', off: -ROAD_HALF_W * 0.5 },
};

const YAW: Record<VehicleLayout['lane'], number> = {
  xPlus: 0,
  xMinus: Math.PI,
  zPlus: Math.PI / 2,
  zMinus: -Math.PI / 2,
};

const BODY_DIMS: Record<VehicleLayout['kind'], [number, number, number]> = {
  car: [1.8, 0.6, 0.95],
  taxi: [1.85, 0.65, 0.98],
  bus: [2.8, 0.9, 1.15],
  truck: [2.6, 0.72, 1.0],
  limo: [2.45, 0.82, 1.02],
  van: [2.0, 0.72, 1.05],
};

const BASE_TINT: Record<VehicleLayout['kind'], string> = {
  car: '#4a5a68',
  bus: '#4a7ab5',
  truck: '#5d5148',
  limo: '#2c2f36',
  taxi: '#f4c942',
  van: '#7c93a0',
};

export function Vehicles() {
  const vehicles = useVehicleLayouts();
  const groupRefs = useRef<(THREE.Group | null)[]>([]);

  const bodyMats = useMemo(() => {
    const map = new Map<VehicleLayout['kind'], THREE.MeshStandardMaterial>();
    (Object.keys(BASE_TINT) as VehicleLayout['kind'][]).forEach((k) => {
      map.set(
        k,
        new THREE.MeshStandardMaterial({
          color: BASE_TINT[k],
          roughness: 0.42,
          metalness: 0.3,
        }),
      );
    });
    return map;
  }, []);

  const headMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#fff6d0',
        emissive: new THREE.Color('#ffdea0'),
        emissiveIntensity: 1.6,
        roughness: 0.3,
      }),
    [],
  );
  const tailMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ff4f3f',
        emissive: new THREE.Color('#ff2a12'),
        emissiveIntensity: 1.2,
        roughness: 0.4,
      }),
    [],
  );
  const wheelMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#15151a', roughness: 0.9 }),
    [],
  );
  const glassMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#18242e',
        roughness: 0.1,
        metalness: 0.5,
      }),
    [],
  );

  const geos = useMemo(() => {
    const head = new THREE.BoxGeometry(0.3, 0.2, 0.07);
    const tail = new THREE.BoxGeometry(0.34, 0.16, 0.07);
    return { head, tail };
  }, []);

  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const state = useSceneStore.getState();
    const { current, dayTime, position } = state;
    const night = 1 - Math.max(0, Math.sin((dayTime - 0.5) * Math.PI * 2));
    const eraN = Math.min(1, Math.max(0, position / ERA_MAX));

    vehicles.forEach((v) => {
      const mat = bodyMats.get(v.kind);
      if (mat) {
        tmp.set(BASE_TINT[v.kind]).lerp(new THREE.Color(current.vehicles.color), 0.5);
        mat.color.copy(tmp);
        mat.roughness = current.vehicles.roughness;
        mat.needsUpdate = true;
      }
    });
    headMat.emissiveIntensity = 0.2 + night * 2.6;
    headMat.color.set(current.vehicles.light);
    headMat.needsUpdate = true;
    tailMat.emissiveIntensity = 0.12 + night * 2.2;
    tailMat.needsUpdate = true;

    const now = performance.now() / 1000;
    vehicles.forEach((v, idx) => {
      const cfg = LANE_CFG[v.lane];
      // In 2050 (eraN>0.9) a subset of vehicles become hovering Aero taxis.
      const fly = eraN > 0.9 && v.id % 3 === 0;
      const hover = fly ? 3.2 + Math.sin(now * 1.4 + v.id) * 0.6 : 0;

      const progress = (v.startPhase + now * v.speed) % 1;
      const d = progress * TRAVEL_LENGTH;
      let x: number;
      let z: number;
      if (cfg.axis === 'x') {
        x = -TRAVEL_HALF + d;
        z = cfg.off;
      } else {
        x = cfg.off;
        z = -TRAVEL_HALF + d;
      }

      const g = groupRefs.current[idx];
      if (g) {
        g.position.set(x, hover + 0.14, z);
        g.rotation.y = YAW[v.lane];
        g.visible = true;
      }
    });
  });

  return (
    <group>
      {vehicles.map((v, i) => {
        const [bw, bh, bd] = BODY_DIMS[v.kind];
        const halfW = bw / 2 - 0.3;
        const wheels: Array<[number, number]> = [
          [halfW, bd * 0.3],
          [-halfW, bd * 0.3],
          [halfW, -bd * 0.3],
          [-halfW, -bd * 0.3],
        ];
        return (
          <group key={v.id} ref={(el) => (groupRefs.current[i] = el)}>
            {/* Body */}
            <mesh castShadow material={bodyMats.get(v.kind)}>
              <boxGeometry args={[bw, bh, bd]} />
            </mesh>
            {/* Glass cabin */}
            <mesh position={[0, bh / 2 + 0.06, 0]} material={glassMat}>
              <boxGeometry
                args={[
                  bw * (v.kind === 'bus' || v.kind === 'van' ? 0.82 : 0.7),
                  bh * 0.34,
                  bd * 0.96,
                ]}
              />
            </mesh>
            {/* Wheels */}
            {wheels.map(([wx, wz], wi) => (
              <mesh key={wi} position={[wx, bh / 4, wz]} material={wheelMat}>
                <boxGeometry args={[0.34, 0.14, 0.5]} />
              </mesh>
            ))}
            {/* Headlights at front local +z */}
            <mesh
              position={[bw * 0.26, bh * 0.22, bd / 2]}
              material={headMat}
              geometry={geos.head}
            />
            <mesh
              position={[-bw * 0.26, bh * 0.22, bd / 2]}
              material={headMat}
              geometry={geos.head}
            />
            {/* Taillights at rear local -z */}
            <mesh
              position={[bw * 0.26, bh * 0.26, -bd / 2]}
              material={tailMat}
              geometry={geos.tail}
            />
            <mesh
              position={[-bw * 0.26, bh * 0.26, -bd / 2]}
              material={tailMat}
              geometry={geos.tail}
            />
          </group>
        );
      })}
    </group>
  );
}