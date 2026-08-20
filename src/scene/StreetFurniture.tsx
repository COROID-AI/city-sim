import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { BLOCK_MAX, BLOCK_MIN, ROAD_HALF_W, TREE_SLOTS, LAMP_SLOTS } from './constants';

/**
 * StreetFurniture: era-driven lamps, trees, hydrants, benches, billboards,
 * and decorative era-only landmarks. Each instanced or low-poly group fades
 * in/out of the era timeline through the store's interpolated data.
 */
export function StreetFurniture() {
  const lampRefs = useRef<(THREE.Group | null)[]>([]);
  const treeRefs = useRef<(THREE.Group | null)[]>([]);
  const billboardRefs = useRef<(THREE.Group | null)[]>([]);

  const lampMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#55616e',
        roughness: 0.6,
        metalness: 0.35,
      }),
    [],
  );
  const lampHeadMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#f4e0a0',
        emissive: new THREE.Color('#ffd680'),
        emissiveIntensity: 1.4,
        roughness: 0.4,
      }),
    [],
  );
  const poleMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: '#3f434a', roughness: 0.5, metalness: 0.4 }),
    [],
  );
  const treeTrunkMat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4a3524', roughness: 0.9 }),
    [],
  );
  const treeLeafMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#3f6b3a',
        roughness: 0.85,
        flatShading: false,
      }),
    [],
  );
  const signMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        emissive: new THREE.Color('#66ccff'),
        emissiveIntensity: 0.4,
        roughness: 0.5,
      }),
    [],
  );

  const tmp = useMemo(() => new THREE.Color(), []);

  useFrame(() => {
    const state = useSceneStore.getState();
    const { current, dayTime, position } = state;
    const night = 1 - Math.max(0, Math.sin((dayTime - 0.5) * Math.PI * 2));
    const eraN = Math.min(1, Math.max(0, position / 5));

    lampHeadMat.emissiveIntensity = 0.4 + night * current.lampDensity * 2.6;
    lampHeadMat.emissive.set('#ffd680').multiplyScalar(0.5 + night);
    signMat.emissiveIntensity = 0.3 + night * current.neon * 1.6;

    // Trees fade with era (older eras fewer, modern more).
    treeRefs.current.forEach((tr, i) => {
      if (tr) {
        const want = current.trees;
        const inRange = i / (TREE_SLOTS - 1) < want / TREE_SLOTS + 0.04;
        const show = inRange ? 1 : 0;
        tr.visible = show > 0.01;
        tr.scale.setScalar(Math.max(0.01, show));
      }
    });
    lampRefs.current.forEach((gp, i) => {
      if (gp) {
        const want = current.lampDensity;
        const inRange = i / (LAMP_SLOTS - 1) < want + 0.04;
        gp.visible = inRange;
      }
    });
    billboardRefs.current.forEach((b, i) => {
      if (b) {
        b.visible = i < current.billboards;
      }
    });
  });

  const lamps = useMemo(() => makeLamps(), []);
  const trees = useMemo(() => makeTrees(), []);
  const billboards = useMemo(() => makeBillboards(), []);

  return (
    <group>
      {lamps.map((l, i) => (
        <group key={i} ref={(el) => (lampRefs.current[i] = el)} position={[l.x, 0, l.z]}>
          <mesh position={[0, 2.2, 0]} material={poleMat}>
            <cylinderGeometry args={[0.06, 0.09, 2.4, 8]} />
          </mesh>
          <mesh position={[0, 2.45, 0]} material={lampHeadMat}>
            <sphereGeometry args={[0.18, 12, 10]} />
          </mesh>
        </group>
      ))}

      {trees.map((t, i) => (
        <group key={`t-${i}`} ref={(el) => (treeRefs.current[i] = el)} position={[t.x, 0, t.z]}>
          <mesh position={[0, 0.8, 0]} material={treeTrunkMat}>
            <cylinderGeometry args={[0.18, 0.22, 1.6, 8]} />
          </mesh>
          <mesh position={[0, 2.0, 0]} material={treeLeafMat} scale={[t.s, t.s, t.s]}>
            <sphereGeometry args={[0.9, 10, 8]} />
          </mesh>
        </group>
      ))}

      {billboards.map((b, i) => (
        <group
          key={`b-${i}`}
          ref={(el) => (billboardRefs.current[i] = el)}
          position={[b.x, 0, b.z]}
          rotation-y={b.ry}
        >
          <mesh position={[0, 2.4, 0]} material={poleMat}>
            <cylinderGeometry args={[0.07, 0.09, 2.8, 8]} />
          </mesh>
          <mesh position={[0, 4.0, 0]} material={signMat}>
            <boxGeometry args={[3.6, 1.6, 0.2]} />
          </mesh>
          {/* Small emissive strip for neon flair */}
          <mesh position={[0, 4.05, 0.11]} material={signMat}>
            <planeGeometry args={[3.2, 0.22]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function makeLamps() {
  const rnd = mulberry32(0x1a2b);
  const out: Array<{ x: number; z: number }> = [];
  // Along north/south roads.
  for (let i = 0; i < LAMP_SLOTS; i++) {
    const side = i % 4;
    if (side === 0) out.push({ x: (i % 7) * 6 - 18, z: ROAD_HALF_W + 1.0 });
    else if (side === 1) out.push({ x: (i % 7) * 6 - 18, z: -(ROAD_HALF_W + 1.0) });
    else if (side === 2) out.push({ x: ROAD_HALF_W + 1.0, z: (i % 7) * 6 - 18 });
    else out.push({ x: -(ROAD_HALF_W + 1.0), z: (i % 7) * 6 - 18 });
  }
  return out;
}

function makeTrees() {
  const rnd = mulberry32(0x5eed);
  const out: Array<{ x: number; z: number; s: number }> = [];
  for (let i = 0; i < TREE_SLOTS; i++) {
    const x = (rnd() - 0.5) * 34;
    const z = (rnd() - 0.5) * 34;
    // Keep trees off the roads.
    if (Math.abs(x) < ROAD_HALF_W + 1.2 || Math.abs(z) < ROAD_HALF_W + 1.2) {
      out.push({ x: x < 0 ? -(ROAD_HALF_W + 1.6) : ROAD_HALF_W + 1.6, z, s: 0.9 + rnd() * 0.6 });
    } else {
      out.push({ x, z, s: 0.9 + rnd() * 0.6 });
    }
  }
  return out;
}

function makeBillboards() {
  const rnd = mulberry32(0xb1b0);
  const out: Array<{ x: number; z: number; ry: number }> = [];
  const spots: Array<[number, number, number]> = [
    [17, 12, 0.6],
    [-17, 13, -0.5],
    [18, -11, 0.8],
    [-18, -13, -0.7],
    [4, 17, 1.1],
    [-4, -17, -0.9],
    [11, -18, 1.5],
    [-11, 18, -1.4],
    [23, 2, 0],
    [-23, -2, 0],
    [2, 23, Math.PI / 2],
    [-2, -23, Math.PI / 2],
  ];
  return spots.map(([x, z, ry]) => ({ x, z, ry }));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}