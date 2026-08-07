import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Instances, Instance } from '@react-three/drei';
import type { GridOpts } from './grid';

/**
 * Procedural 3D parts that make up era-variant buildings.
 *
 * Repeated facade units (windows, cladding bands, greenery, fire-escape
 * landings) are rendered through `drei`'s <Instances>/<Instance> so every
 * repeated unit shares one draw call and one PBR material per era, keeping
 * the module performant while still producing detailed geometry.
 */

export type { GridOpts };

/* ---------------------------------------------------------------------------
 * Instanced window grid
 * ------------------------------------------------------------------------- */

export interface WindowGridProps {
  positions: Array<[number, number, number]>;
  size: [number, number];
  material: {
    color: string;
    emissive: string;
    emissiveIntensity: number;
    roughness: number;
    metalness: number;
  };
}

/** An instanced grid of window panes sharing one geometry + PBR material. */
export function WindowGrid({ positions, size, material }: WindowGridProps) {
  return (
    <Instances limit={positions.length} range={positions.length} frames={1} castShadow>
      <boxGeometry args={[size[0], size[1], 0.06]} />
      <meshStandardMaterial
        color={material.color}
        emissive={material.emissive}
        emissiveIntensity={material.emissiveIntensity}
        roughness={material.roughness}
        metalness={material.metalness}
      />
      {positions.map((p, i) => (
        <Instance key={i} position={p} />
      ))}
    </Instances>
  );
}

/* ---------------------------------------------------------------------------
 * Building shell + roof
 * ------------------------------------------------------------------------- */

export interface BuildingShellProps {
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  material: {
    color: string;
    roughness: number;
    metalness: number;
    emissive?: string;
    emissiveIntensity?: number;
  };
}

/** The main wall box of a building. */
export function BuildingShell({
  width,
  depth,
  height,
  x,
  z,
  material,
}: BuildingShellProps) {
  return (
    <mesh position={[x, height / 2, z]} castShadow receiveShadow>
      <boxGeometry args={[width, height, depth]} />
      <meshStandardMaterial
        color={material.color}
        roughness={material.roughness}
        metalness={material.metalness}
        emissive={material.emissive ?? '#000000'}
        emissiveIntensity={material.emissiveIntensity ?? 0}
      />
    </mesh>
  );
}

export interface RoofCapProps {
  width: number;
  depth: number;
  height: number;
  x: number;
  z: number;
  style: 'flat' | 'parapet' | 'curtain';
  color: string;
}

/** Roof treatment: flat slab, brick parapet cap, or curtain-wall crown. */
export function RoofCap({ width, depth, height, x, z, style, color }: RoofCapProps) {
  if (style === 'parapet') {
    return (
      <group position={[x, height, z]}>
        <mesh position={[0, 0.35, 0]}>
          <boxGeometry args={[width, 0.7, depth]} />
          <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
        </mesh>
        <mesh position={[0, 0.55, 0]}>
          <boxGeometry args={[width + 0.12, 0.18, depth + 0.12]} />
          <meshStandardMaterial color="#6f6a5e" roughness={0.9} metalness={0.05} />
        </mesh>
      </group>
    );
  }
  if (style === 'curtain') {
    return (
      <group position={[x, height, z]}>
        <mesh position={[0, 0.18, 0]}>
          <boxGeometry args={[width + 0.1, 0.36, depth + 0.1]} />
          <meshStandardMaterial color="#c8d6e0" roughness={0.3} metalness={0.7} />
        </mesh>
      </group>
    );
  }
  // flat
  return (
    <group position={[x, height, z]}>
      <mesh position={[0, 0.16, 0]}>
        <boxGeometry args={[width, 0.32, depth]} />
        <meshStandardMaterial color="#b9b4a8" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* small mechanical penthouse */}
      <mesh position={[width * 0.22, 0.75, depth * 0.18]}>
        <boxGeometry args={[width * 0.3, 1.0, depth * 0.4]} />
        <meshStandardMaterial color="#9a958a" roughness={0.8} metalness={0.15} />
      </mesh>
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * 1945 fire escape
 * ------------------------------------------------------------------------- */

export interface FireEscapeProps {
  width: number;
  height: number;
  floors: number;
  x: number;
  z: number;
}

/** A simple wrought-iron fire escape: ladder rails + per-floor landings. */
export function FireEscape({ width, height, floors, x, z }: FireEscapeProps) {
  const railX = -width / 2 + 0.55;
  const floorH = height / floors;
  const landings = Array.from({ length: floors }, (_, f) => (f + 1) * floorH - 0.35);
  return (
    <group position={[x, 0, z]}>
      {/* ladder rails (shared geometry) */}
      <Instances limit={2} range={2} frames={1} castShadow>
        <boxGeometry args={[0.06, height, 0.06]} />
        <meshStandardMaterial color="#2a2d31" metalness={0.7} roughness={0.5} />
        <Instance position={[railX - 0.06, height / 2, 0]} />
        <Instance position={[railX + 0.06, height / 2, 0]} />
      </Instances>
      {/* per-floor landings (shared geometry) */}
      <Instances limit={landings.length} range={landings.length} frames={1} castShadow>
        <boxGeometry args={[0.34, 0.08, 0.62]} />
        <meshStandardMaterial color="#33363b" metalness={0.7} roughness={0.5} />
        {landings.map((y, i) => (
          <Instance key={i} position={[railX, y, 0]} />
        ))}
      </Instances>
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * 1985 curtain-wall mullions
 * ------------------------------------------------------------------------- */

export interface MullionsProps {
  width: number;
  height: number;
  depth: number;
  x: number;
  z: number;
  spacingX: number;
  spacingY: number;
}

/** Steel mullion grid over a glass curtain wall. */
export function Mullions({ width, height, x, z, spacingX, spacingY }: MullionsProps) {
  const countX = Math.max(1, Math.floor(width / spacingX));
  const countY = Math.max(1, Math.floor(height / spacingY));
  const xs = Array.from({ length: countX }, (_, i) => -width / 2 + ((i + 0.5) * width) / countX);
  const ys = Array.from({ length: countY }, (_, i) => ((i + 0.5) * height) / countY);
  return (
    <group position={[x, 0, z]}>
      {/* vertical mullions */}
      <Instances limit={countX} range={countX} frames={1} castShadow>
        <boxGeometry args={[0.06, height, 0.06]} />
        <meshStandardMaterial color="#b8c4ce" metalness={0.9} roughness={0.3} />
        {xs.map((mx, i) => (
          <Instance key={`v${i}`} position={[mx, height / 2, 0]} />
        ))}
      </Instances>
      {/* horizontal mullions */}
      <Instances limit={countY} range={countY} frames={1} castShadow>
        <boxGeometry args={[width, 0.05, 0.06]} />
        <meshStandardMaterial color="#b8c4ce" metalness={0.9} roughness={0.3} />
        {ys.map((my, i) => (
          <Instance key={`h${i}`} position={[0, my, 0]} />
        ))}
      </Instances>
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * 2005 cladding panels + storefront glazing
 * ------------------------------------------------------------------------- */

export interface CladdingPanelsProps {
  width: number;
  height: number;
  floors: number;
  x: number;
  z: number;
  color: string;
}

/** Horizontal cladding panel bands wrapping the facade at each floor. */
export function CladdingPanels({ width, height, floors, x, z, color }: CladdingPanelsProps) {
  const floorH = height / floors;
  const bands = Array.from({ length: floors }, (_, f) => (f + 0.5) * floorH);
  return (
    <group position={[x, 0, z]}>
      <Instances limit={bands.length} range={bands.length} frames={1} castShadow>
        <boxGeometry args={[width + 0.08, 0.18, 0.12]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.25} />
        {bands.map((y, i) => (
          <Instance key={i} position={[0, y, 0]} />
        ))}
      </Instances>
    </group>
  );
}

export interface StorefrontGlazingProps {
  width: number;
  height: number;
  x: number;
  z: number;
}

/** Large glazed storefront panels at the base of a mixed-use tower. */
export function StorefrontGlazing({ width, x, z }: StorefrontGlazingProps) {
  const count = Math.max(1, Math.floor(width / 1.2));
  const paneW = width / count;
  const xs = Array.from({ length: count }, (_, i) => -width / 2 + (i + 0.5) * paneW);
  return (
    <group position={[x, 0, z]}>
      <Instances limit={count} range={count} frames={1}>
        <boxGeometry args={[paneW - 0.08, 2.0, 0.08]} />
        <meshStandardMaterial
          color="#a8c8dc"
          roughness={0.15}
          metalness={0.4}
          transparent
          opacity={0.85}
        />
        {xs.map((px, i) => (
          <Instance key={i} position={[px, 1.0, 0]} />
        ))}
      </Instances>
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * 2025 greenery + LED media facade
 * ------------------------------------------------------------------------- */

export interface GreeneryProps {
  width: number;
  height: number;
  floors: number;
  x: number;
  z: number;
  color: string;
}

/** Planted balcony boxes along the facade at each floor. */
export function Greenery({ width, height, floors, x, z, color }: GreeneryProps) {
  const floorH = height / floors;
  const rows = Array.from({ length: floors }, (_, f) => (f + 0.7) * floorH);
  const count = Math.max(1, Math.floor(width / 1.4));
  const xs = Array.from({ length: count }, (_, i) => -width / 2 + ((i + 0.5) * width) / count);
  const total = rows.length * xs.length;
  const positions: Array<[number, number, number]> = [];
  rows.forEach((y) => xs.forEach((px) => positions.push([px, y, 0])));
  return (
    <group position={[x, 0, z]}>
      <Instances limit={total} range={total} frames={1} castShadow>
        <boxGeometry args={[0.85, 0.3, 0.5]} />
        <meshStandardMaterial color={color} roughness={0.9} metalness={0.05} />
        {positions.map((p, i) => (
          <Instance key={i} position={p} />
        ))}
      </Instances>
    </group>
  );
}

export interface LedFacadeProps {
  width: number;
  height: number;
  x: number;
  z: number;
}

/** Animated LED media facade panel with a slowly cycling hue. */
export function LedFacade({ width, height, x, z }: LedFacadeProps) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const t = clock.getElapsedTime();
    mat.emissive.setHSL((t * 0.04) % 1, 0.85, 0.55);
  });
  return (
    <mesh ref={ref} position={[x, height / 2, z]}>
      <planeGeometry args={[width * 0.6, height * 0.72]} />
      <meshStandardMaterial
        color="#0a0f14"
        emissive="#00e5ff"
        emissiveIntensity={1.4}
        toneMapped={false}
      />
    </mesh>
  );
}

/* ---------------------------------------------------------------------------
 * Building-mounted signage
 * ------------------------------------------------------------------------- */

export interface BuildingSignProps {
  width: number;
  height: number;
  x: number;
  z: number;
  signage: {
    color: string;
    emissive: string;
    emissiveIntensity: number;
    label: string;
  };
}

/** A small roof / facade sign with era-appropriate emissive material. */
export function BuildingSign({ height, x, z, signage }: BuildingSignProps) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = signage.color;
      ctx.fillRect(0, 0, 256, 96);
      ctx.fillStyle = '#101418';
      ctx.font = 'bold 52px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(signage.label, 128, 52);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }, [signage]);

  return (
    <mesh position={[x, height + 1.3, z]} rotation={[0, Math.PI / 2, 0]}>
      <planeGeometry args={[1.6, 0.6]} />
      <meshStandardMaterial
        map={texture}
        emissive={signage.emissive}
        emissiveMap={texture}
        emissiveIntensity={signage.emissiveIntensity}
        toneMapped={false}
      />
    </mesh>
  );
}
