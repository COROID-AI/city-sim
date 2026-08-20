import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useSceneStore } from '../state/useSceneStore';
import { ERA_COUNT } from '../state/timePeriods';
import type { BuildingLayout } from './layout';

interface BuildingProps {
  layout: BuildingLayout;
  bodyMat: THREE.MeshStandardMaterial;
  roofMat: THREE.MeshStandardMaterial;
  roofCapMat: THREE.MeshStandardMaterial;
  windowMat: THREE.MeshStandardMaterial;
  detailMat: THREE.MeshStandardMaterial;
  antennaMat: THREE.MeshStandardMaterial;
}

const WINDOW_W = 0.5;
const WINDOW_H = 0.52;
const WINDOW_D = 0.06;

/**
 * Deterministic era-evolution signature for a building. Every building gets a
 * stable "built" / "growPeak" pair derived from its id, so as the timeline
 * scrubs from 1900 to 2050 different buildings rise at different moments
 * (old brick blocks stay low, newer glass towers spring up late).
 */
interface Evolved {
  built: number;
  growPeak: number;
}

const EVOLVED_CACHE = new Map<number, Evolved>();

function evolvedFor(id: number): Evolved {
  const cached = EVOLVED_CACHE.get(id);
  if (cached) return cached;
  const r = mulberry32(0x9e3779b9 ^ id);
  const ev: Evolved = { built: 0.05 + r() * 0.9, growPeak: 0.2 + r() * 0.75 };
  EVOLVED_CACHE.set(id, ev);
  return ev;
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

/** Deterministic lit-window subset for a building face. */
function lit(layout: BuildingLayout, a: number, b: number, y: number): boolean {
  const h = layout.lit * 10000 + a * 31 + b * 17 + y * 13;
  return h % 10 < 7;
}

function buildWindowMatrices(layout: BuildingLayout): THREE.Matrix4[] {
  const cols = Math.max(2, Math.min(5, Math.round(layout.baseW / 1.5)));
  const rows = Math.max(2, Math.min(5, Math.round(layout.baseD / 1.5)));
  const floorRows = layout.floors;

  const alongX: number[] = [];
  for (let i = 0; i < cols; i++) {
    const t = cols === 1 ? 0 : i / (cols - 1) - 0.5;
    alongX.push(t * (layout.baseW - 0.7));
  }
  const alongZ: number[] = [];
  for (let i = 0; i < rows; i++) {
    const t = rows === 1 ? 0 : i / (rows - 1) - 0.5;
    alongZ.push(t * (layout.baseD - 0.7));
  }
  const yArr: number[] = [];
  for (let f = 0; f < floorRows; f++) {
    yArr.push((f + 0.62) * (layout.baseH / floorRows));
  }

  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(WINDOW_W, WINDOW_H, WINDOW_D);
  const pos = new THREE.Vector3();
  const out: THREE.Matrix4[] = [];

  const addFace = (axis: 'x' | 'z', sign: 1 | -1) => {
    const along = axis === 'x' ? alongZ : alongX;
    const across = axis === 'x' ? alongX : alongZ;
    euler.set(
      0,
      axis === 'x' ? (sign === 1 ? Math.PI / 2 : -Math.PI / 2) : sign === 1 ? 0 : Math.PI,
      0,
    );
    quat.setFromEuler(euler);
    for (let i = 0; i < along.length; i++) {
      for (let j = 0; j < across.length; j++) {
        for (let k = 0; k < yArr.length; k++) {
          if (!lit(layout, i, j, k)) continue;
          const x =
            axis === 'x' ? sign * (layout.baseW / 2 + WINDOW_D / 2) : along[i];
          const z =
            axis === 'x' ? across[j] : sign * (layout.baseD / 2 + WINDOW_D / 2);
          pos.set(x, yArr[k], z);
          matrix.compose(pos, quat, scale);
          out.push(matrix.clone());
        }
      }
    }
  };
  addFace('x', 1);
  addFace('x', -1);
  addFace('z', 1);
  addFace('z', -1);
  return out;
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function Building({
  layout,
  bodyMat,
  roofMat,
  roofCapMat,
  windowMat,
  detailMat,
  antennaMat,
}: BuildingProps) {
  const groupRef = useRef<THREE.Group>(null);
  const windowRef = useRef<THREE.InstancedMesh>(null);
  const towerRef = useRef<THREE.Group>(null);
  const antennaRef = useRef<THREE.Mesh>(null);
  const placedRef = useRef(false);

  const winMats = useMemo(() => buildWindowMatrices(layout), [layout]);
  const windowGeo = useMemo(
    () => new THREE.BoxGeometry(WINDOW_W, WINDOW_H, WINDOW_D),
    [],
  );
  const baseHeight = useMemo(() => layout.baseH * layout.floors, [layout]);
  const evo = useMemo(() => evolvedFor(layout.id), [layout]);

  const facadeMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#9a9aa6',
        roughness: layout.style === 'glass' ? 0.16 : 0.62,
        metalness: layout.style === 'glass' ? 0.55 : 0.05,
        emissive: new THREE.Color('#000000'),
      }),
    [layout],
  );

  // Place window instances once after the mesh is mounted.
  useEffect(() => {
    const win = windowRef.current;
    if (win && !placedRef.current) {
      for (let i = 0; i < winMats.length; i++) {
        win.setMatrixAt(i, winMats[i]);
      }
      win.instanceMatrix.needsUpdate = true;
      placedRef.current = true;
    }
  }, [winMats]);

  useFrame(() => {
    const { current, dayTime, position } = useSceneStore.getState();
    const eraN = Math.min(1, Math.max(0, position / (ERA_COUNT - 1)));
    const sun = (dayTime - 0.5) * Math.PI * 2;
    const night = 1 - Math.max(0, Math.sin(sun));

    const grow = smoothstep(evo.built, evo.growPeak, eraN);
    if (groupRef.current) {
      groupRef.current.scale.y = Math.max(0.12, grow);
    }

    facadeMat.color.set(current.palette.facade);
    facadeMat.emissive
      .set(current.palette.roof)
      .multiplyScalar(0.02 + night * 0.12);
    facadeMat.needsUpdate = true;

    windowMat.emissiveIntensity = 0.06 + night * current.windowGlow * 1.5;
    windowMat.emissive.set('#ffce8f');
    windowMat.needsUpdate = true;

    if (towerRef.current && layout.waterTower) {
      const show = 1 - smoothstep(0.08, 0.42, eraN);
      towerRef.current.scale.setScalar(Math.max(0, show));
      towerRef.current.visible = show > 0.02;
    }
    if (antennaRef.current && layout.antenna) {
      const show = smoothstep(0.55, 0.92, eraN);
      antennaRef.current.scale.y = Math.max(0.05, show);
      antennaRef.current.visible = show > 0.02;
    }
  });

  return (
    <group
      ref={groupRef}
      position={[layout.x, 0, layout.z]}
      rotation-y={layout.rot}
    >
      <mesh castShadow receiveShadow material={facadeMat}>
        <boxGeometry args={[layout.baseW, baseHeight, layout.baseD]} />
      </mesh>

      {winMats.length > 0 && (
        <instancedMesh
          ref={windowRef}
          args={[windowGeo, windowMat, winMats.length]}
          frustumCulled={false}
        />
      )}

      <mesh
        position={[0, baseHeight / 2 + 0.05, 0]}
        material={roofCapMat}
        receiveShadow
      >
        <boxGeometry args={[layout.baseW * 1.02, 0.28, layout.baseD * 1.02]} />
      </mesh>
      <mesh position={[0, baseHeight / 2 + 0.21, 0]} material={roofMat} receiveShadow>
        <boxGeometry args={[layout.baseW * 0.92, 0.16, layout.baseD * 0.92]} />
      </mesh>

      {layout.waterTower && (
        <group ref={towerRef} position={[0, baseHeight / 2 + 1.3, 0]}>
          <mesh material={detailMat}>
            <cylinderGeometry args={[0.68, 0.68, 1.3, 12]} />
          </mesh>
          <mesh position={[0, 0.72, 0]} material={roofCapMat}>
            <coneGeometry args={[0.86, 0.5, 12]} />
          </mesh>
          <mesh position={[0.5, 1.05, 0]} material={antennaMat}>
            <cylinderGeometry args={[0.045, 0.045, 1.1, 6]} />
          </mesh>
        </group>
      )}
      {layout.antenna && (
        <mesh
          ref={antennaRef}
          position={[0, baseHeight / 2 + 1.3, 0]}
          material={antennaMat}
        >
          <cylinderGeometry args={[0.05, 0.06, 2.4, 6]} />
        </mesh>
      )}
    </group>
  );
}