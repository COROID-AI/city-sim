import * as THREE from 'three';
import { memo, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sparkles, Html } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, Noise } from '@react-three/postprocessing';
import { generateCity } from './city';
import { blendEra, lerpHex } from './era';
import { useSim, yearFromT } from './sim';
import type { BuildingDatum, CityLayout } from './types';
import SimClock from './SimClock';

const scratch = new THREE.Color();
const scratch2 = new THREE.Color();

function clamp01(v: number) {
  return Math.min(1, Math.max(0, v));
}

/** 128x128 window grid texture; returns { map, emissive } canvases */
function makeWindowTextures() {
  const size = 128;
  const mk = (bg: string, win: string, winPb: number) => {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, size, size);
    const cols = 8;
    const rows = 8;
    const cw = size / cols;
    const ch = size / rows;
    ctx.fillStyle = win;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (Math.random() < winPb) {
          ctx.fillRect(x * cw + 2, y * ch + 2, cw - 4, ch - 4);
        }
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 4;
    return tex;
  };
  const map = mk('#4a4438', '#c8bfae', 0.42);
  const emissive = mk('#000000', '#ffd9a0', 0.5);
  return { map, emissive };
}

function BuildingMesh({ data }: { data: BuildingDatum[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tex = useMemo(() => makeWindowTextures(), []);
  const count = data.length;

  useFrame(() => {
    const m = ref.current;
    const mat = matRef.current;
    if (!m || !mat) return;
    const s = useSim.getState();
    const t = s.t;
    const { p } = blendEra(t);
    const daylight = clamp01((s.hour - 5) / 13);
    const night = 1 - daylight;

    mat.emissive.set(p.windowNight);
    mat.emissiveIntensity = night * 0.6;
    mat.color.set('#ffffff');

    const year = yearFromT(t);
    data.forEach((b, i) => {
      // building appears once its built year has arrived (with a hint of future growth)
      const builtAmt = clamp01((year - b.built) / 2);
      const h = Math.max(0.1, b.h * (1 + 0.45 * b.modern * t)) * builtAmt;
      dummy.position.set(b.cx, h / 2, b.cz);
      dummy.scale.set(b.w, h, b.d);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      scratch.set(b.color);
      scratch2.set(p.buildingA);
      scratch.lerp(scratch2, 0.25);
      m.setColorAt(i, scratch);
    });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, count]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        ref={matRef}
        map={tex.map}
        emissiveMap={tex.emissive}
        emissive="#ffffff"
        emissiveIntensity={0.1}
        roughness={0.75}
        metalness={0.18}
      />
    </instancedMesh>
  );
}

function Lighting() {
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const moonRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const ambRef = useRef<THREE.AmbientLight>(null);
  const bgRef = useRef<THREE.Color>(null);
  const fogRef = useRef<THREE.Fog>(null);

  useFrame(() => {
    const s = useSim.getState();
    const { p } = blendEra(s.t);
    const daylight = clamp01((s.hour - 5) / 13);
    const night = 1 - daylight;
    const ang = ((s.hour - 6) / 12) * Math.PI;
    const sx = Math.cos(ang) * 130;
    const sy = Math.sin(ang) * 130;
    const mx = -Math.cos(ang) * 120;
    const my = -Math.sin(ang) * 120;

    const sun = sunRef.current;
    const moon = moonRef.current;
    const hemi = hemiRef.current;
    const amb = ambRef.current;

    if (sun) {
      sun.position.set(sx, sy, 30);
      sun.intensity = p.sunIntensity * (0.12 + 0.88 * daylight);
      sun.color.set(p.sun);
    }
    if (moon) {
      moon.position.set(mx, my, -20);
      moon.intensity = p.sunIntensity * 0.3 * night * night;
      moon.color.set(p.moon);
    }
    if (hemi) {
      hemi.color.set(lerpHex('#d8d4c8', p.hemi, 0.5));
      hemi.intensity = p.hemiIntensity * (0.5 + 0.5 * daylight);
    }
    if (amb) {
      amb.color.set(p.ambient);
      amb.intensity = p.ambientIntensity * (0.4 + 0.6 * daylight);
    }
    if (bgRef.current) bgRef.current.set(p.skyTop);
    if (fogRef.current) fogRef.current.color.set(p.fog);
  });

  return (
    <>
      <color ref={bgRef} attach="background" args={['#000000']} />
      <fog ref={fogRef} attach="fog" args={['#aab0b8', 70, 300]} />
      <ambientLight ref={ambRef} color="#8899aa" intensity={0.5} />
      <hemisphereLight ref={hemiRef} color="#f0ead8" groundColor="#6a5a4a" intensity={0.9} />
      <directionalLight
        ref={sunRef}
        position={[60, 80, 40]}
        intensity={2.4}
        color="#fff4d8"
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-110}
        shadow-camera-right={110}
        shadow-camera-top={110}
        shadow-camera-bottom={-110}
        shadow-camera-far={300}
        shadow-bias={-0.0005}
      />
      <directionalLight ref={moonRef} position={[-60, 60, -40]} intensity={0.35} color="#8898c8" />
      <CelestialDisc />
    </>
  );
}

function CelestialDisc() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const s = useSim.getState();
    const daylight = clamp01((s.hour - 5) / 13);
    const ang = ((s.hour - 6) / 12) * Math.PI;
    const pos = daylight > 0.5
      ? new THREE.Vector3(Math.cos(ang) * 135, Math.sin(ang) * 135, 30)
      : new THREE.Vector3(-Math.cos(ang) * 120, -Math.sin(ang) * 120, -20);
    if (ref.current) {
      ref.current.position.lerp(pos, 0.1);
      const lit = daylight > 0.5;
      const c = lit ? blendEra(s.t).p.sun : blendEra(s.t).p.moon;
      (ref.current.material as THREE.MeshBasicMaterial).color.set(c);
      (ref.current.material as THREE.MeshBasicMaterial).opacity = lit ? 1 : 0.65;
    }
  });
  return (
    <mesh ref={ref} position={[100, 80, 0]}>
      <sphereGeometry args={[5, 20, 20]} />
      <meshBasicMaterial color="#ffe9c0" toneMapped={false} transparent fog={false} />
    </mesh>
  );
}

function Grounds({ city }: { city: CityLayout }) {
  const roadRefs = useRef<(THREE.MeshStandardMaterial | null)[]>([]);
  const parkMat = useRef<THREE.MeshStandardMaterial>(null);
  const groundMat = useRef<THREE.MeshStandardMaterial>(null);

  useFrame(() => {
    const { p } = blendEra(useSim.getState().t);
    roadRefs.current.forEach((m) => m && m.color.set(p.road));
    if (parkMat.current) parkMat.current.color.set(p.park);
    if (groundMat.current) groundMat.current.color.set(p.ground);
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.04, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial ref={groundMat} color="#3a3632" roughness={1} />
      </mesh>
      {city.roads.map((r, i) => (
        <mesh key={`r${i}`} rotation-x={-Math.PI / 2} position={[r.cx, 0.01, r.cz]} receiveShadow>
          <planeGeometry args={[r.w, r.d]} />
          <meshStandardMaterial
            ref={(el) => { roadRefs.current[i] = el as unknown as THREE.MeshStandardMaterial | null; }}
            color="#34302c"
            roughness={0.95}
          />
        </mesh>
      ))}
      {city.sidewalks.map((r, i) => (
        <mesh key={`s${i}`} rotation-x={-Math.PI / 2} position={[r.cx, 0.02, r.cz]} receiveShadow>
          <planeGeometry args={[r.w, r.d]} />
          <meshStandardMaterial color="#7c766e" roughness={0.9} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[city.park.cx, 0.015, city.park.cz]} receiveShadow>
        <planeGeometry args={[city.park.w, city.park.d]} />
        <meshStandardMaterial ref={parkMat} color="#4a7a4a" roughness={1} />
      </mesh>
    </group>
  );
}

function TreesAndLamps({ city }: { city: CityLayout }) {
  const lampMat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const { p } = blendEra(useSim.getState().t);
    if (lampMat.current) {
      lampMat.current.emissive.set(p.lamp);
      lampMat.current.emissiveIntensity = p.lampIntensity * clamp01((1 - (useSim.getState().hour - 5) / 13) * 1.1);
    }
  });
  return (
    <group>
      {city.trees.map((t, i) => (
        <group key={`t${i}`} position={[t.x, 0, t.z]} scale={[t.s, t.s, t.s]}>
          <mesh position={[0, 1, 0]} castShadow>
            <cylinderGeometry args={[0.18, 0.3, 2, 6]} />
            <meshStandardMaterial color="#5a4632" roughness={1} />
          </mesh>
          <mesh position={[0, 2.6, 0]} castShadow>
            <coneGeometry args={[1.1, 2.2, 7]} />
            <meshStandardMaterial color="#3c6a44" roughness={1} />
          </mesh>
          <mesh position={[0.6, 2.1, 0]} castShadow>
            <coneGeometry args={[0.8, 1.6, 7]} />
            <meshStandardMaterial color="#467a50" roughness={1} />
          </mesh>
        </group>
      ))}
      {city.lamps.map((l, i) => (
        <group key={`l${i}`} position={[l.x, 0, l.z]}>
          <mesh position={[0, 2.1, 0]} castShadow>
            <cylinderGeometry args={[0.08, 0.12, 4.2, 6]} />
            <meshStandardMaterial color="#403c36" roughness={0.6} metalness={0.4} />
          </mesh>
          <mesh position={[0, 4.4, 0]}>
            <sphereGeometry args={[0.28, 8, 8]} />
            <meshStandardMaterial ref={lampMat} color="#201c18" emissive="#ffd890" emissiveIntensity={1} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Landmarks({ city }: { city: CityLayout }) {
  const landmarks = city.buildings.filter((b) => b.landmark);
  return (
    <group>
      {landmarks.map((b) => (
        <group key={b.id} position={[b.cx, b.h * (1 + 0.3 * b.modern) + 2, b.cz]}>
          <Html center distanceFactor={18} occlude style={{ pointerEvents: 'none', userSelect: 'none' }}>
            <div className="landmark-label">{b.label ?? 'Landmark'}</div>
          </Html>
        </group>
      ))}
    </group>
  );
}

function SparkleNight() {
  const ref = useRef<THREE.Points>(null);
  useFrame(() => {
    const night = 1 - clamp01((useSim.getState().hour - 5) / 13);
    if (ref.current) {
      (ref.current.material as THREE.PointsMaterial).opacity = night * 0.55;
      ref.current.visible = night > 0.08;
    }
  });
  return (
    <Sparkles ref={ref} count={120} scale={[140, 50, 140]} size={1.8} speed={0.3} color="#ffe9b0" opacity={0.5} />
  );
}

export const CityTimelapseScene = memo(function CityTimelapseScene() {
  const city = useMemo(() => generateCity(), []);
  const reducedMotion = useSim((s) => s.reducedMotion);
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      camera={{ position: [86, 52, 96], fov: 42, near: 0.5, far: 600 }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener('webglcontextlost', (e) => {
          e.preventDefault();
          useSim.getState().setContextLost(true);
        });
        gl.domElement.addEventListener('webglcontextrestored', () => {
          useSim.getState().setContextLost(false);
        });
      }}
    >
      <SimClock />
      <Lighting />
      <BuildingMesh data={city.buildings} />
      <Grounds city={city} />
      <TreesAndLamps city={city} />
      <Landmarks city={city} />
      <Stars radius={190} depth={80} count={1800} factor={5} saturation={0} fade speed={0.5} />
      <SparkleNight />
      <OrbitControls
        makeDefault
        enableDamping={!reducedMotion}
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={12}
        maxDistance={260}
        target={[0, 8, 0]}
      />
      <EffectComposer>
        <Bloom luminanceThreshold={0.65} luminanceSmoothing={0.9} intensity={0.9} mipmapBlur />
        <Vignette eskil={false} offset={0.25} darkness={0.75} />
        <Noise opacity={0.035} />
      </EffectComposer>
    </Canvas>
  );
});