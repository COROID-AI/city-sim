'use client';

/**
 * Procedural buildings with cross-era morph.
 *
 * Each plot receives a deterministic height (seeded from its id + era) and a
 * colour drawn from the era palette. Taller, denser, glassier buildings appear
 * in later eras — the same plot footprint therefore reads very differently
 * across the timeline.
 *
 * During a year transition the buildings morph imperatively: a `useFrame` loop
 * lerps each building's height (scale.y), position, and material colours
 * between the `from` and `to` era values using the store's `transitionProgress`.
 * This keeps the animation loop entirely outside React's render cycle (no
 * per-frame re-renders) while still producing a smooth cinematic morph.
 */
import { useMemo, useRef, type FC } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { BLOCK_LAYOUT, type Plot } from '@/config/blockLayout';
import { getEraTheme } from '@/config/eraTheme';
import { getYearConfig } from '@/config/years';
import type { EraId } from '@/config/years';
import { useYearStore } from '@/store/yearStore';
import { lerp } from '@/utils/easing';
import { lerpColor } from '@/utils/color';

/** Tiny deterministic hash → [0, 1). */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/**
 * Resolve the deterministic per-era building attributes for a plot.
 * Heights scale with the era's `maxHeight` + `density`; colours come from the
 * era palette. The same seed is used across eras so a given plot "remembers"
 * its identity while its proportions evolve.
 */
function resolveBuilding(
  plot: Plot,
  era: EraId,
): { height: number; color: string; windowColor: string; floors: number } {
  const theme = getEraTheme(era);
  const config = getYearConfig(era);
  const maxHeight = config?.maxHeight ?? 32;
  const density = config?.density ?? 1;

  const seed = hashSeed(`${plot.id}-${era}`);
  const seed2 = hashSeed(`${plot.id}-${era}-b`);
  const h = Math.max(
    4,
    maxHeight * (0.35 + seed * 0.65) * (0.6 + density * 0.4),
  );
  const palette = theme.buildingColors;
  const c = palette[Math.floor(seed2 * palette.length) % palette.length];
  const f = Math.max(1, Math.round(h / 3));
  return { height: h, color: c, windowColor: theme.windowColor, floors: f };
}

interface BuildingProps {
  plot: Plot;
  fromEra: EraId;
  toEra: EraId;
}

/**
 * A single procedural building that morphs between two eras.
 *
 * Refs are captured for the main mass mesh + its material so the `useFrame`
 * loop can mutate scale/position/colour directly without triggering React.
 */
const Building: FC<BuildingProps> = ({ plot, fromEra, toEra }) => {
  const massRef = useRef<THREE.Mesh>(null);
  const massMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const roofMatRef = useRef<THREE.MeshStandardMaterial>(null);

  // Pre-compute both endpoint states once per (plot, fromEra, toEra).
  const from = useMemo(() => resolveBuilding(plot, fromEra), [plot, fromEra]);
  const to = useMemo(() => resolveBuilding(plot, toEra), [plot, toEra]);

  // Static geometry derived from the plot footprint (does not change per era).
  const inset = 1;
  const w = plot.width - inset * 2;
  const d = plot.depth - inset * 2;

  // Window bands are placed relative to the *from* height; they fade with the
  // transition via the group opacity handled by the frame loop on materials.
  const floors = Math.max(from.floors, to.floors);

  useFrame(() => {
    const { transitionProgress } = useYearStore.getState();
    const mass = massRef.current;
    const mat = massMatRef.current;
    if (!mass || !mat) return;

    // Interpolated height for this frame.
    const height = lerp(from.height, to.height, transitionProgress);

    // Scale the unit box (height 1) to the interpolated height and re-seat
    // it so the base stays on the ground (y = height / 2).
    mass.scale.y = height;
    mass.position.y = height / 2;

    // Lerp wall colour.
    const color = lerpColor(from.color, to.color, transitionProgress);
    mat.color.set(color);

    // Roof tracks the interpolated height too.
    if (mass.parent) {
      const roof = mass.parent.getObjectByName('roof');
      if (roof) {
        roof.position.y = height + 0.15;
      }
    }
  });

  return (
    <group position={[plot.x, 0, plot.z]}>
      {/* Main mass — unit box scaled per-frame by the morph loop */}
      <mesh ref={massRef} position={[0, from.height / 2, 0]} scale={[1, from.height, 1]} castShadow receiveShadow>
        <boxGeometry args={[w, 1, d]} />
        <meshStandardMaterial ref={massMatRef} color={from.color} roughness={0.8} metalness={0.05} />
      </mesh>

      {/* Window grid — thin emissive strips per floor */}
      {Array.from({ length: floors }, (_, i) => {
        const y = 2 + i * 3;
        return (
          <group key={`floor-${i}`}>
            {/* Front + back window bands */}
            <mesh position={[0, y, d / 2 + 0.01]}>
              <planeGeometry args={[w * 0.8, 1]} />
              <meshStandardMaterial
                color={from.windowColor}
                emissive={from.windowColor}
                emissiveIntensity={0.35}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0, y, -d / 2 - 0.01]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[w * 0.8, 1]} />
              <meshStandardMaterial
                color={from.windowColor}
                emissive={from.windowColor}
                emissiveIntensity={0.35}
                roughness={0.4}
              />
            </mesh>
          </group>
        );
      })}

      {/* Roof cap — named so the frame loop can reposition it */}
      <mesh name="roof" position={[0, from.height + 0.15, 0]} castShadow>
        <boxGeometry args={[w * 0.9, 0.3, d * 0.9]} />
        <meshStandardMaterial ref={roofMatRef} color={getEraTheme(fromEra).roofColor} roughness={0.9} />
      </mesh>
    </group>
  );
};

interface BuildingsProps {
  era: EraId;
}

/**
 * Renders one procedural building per plot in the block layout. Reads both the
 * settled era and the transition target from the store so each building can
 * morph between them.
 */
const Buildings: FC<BuildingsProps> = ({ era }) => {
  const targetYear = useYearStore((s) => s.targetYear);

  return (
    <group>
      {BLOCK_LAYOUT.plots.map((plot) => (
        <Building key={plot.id} plot={plot} fromEra={era} toEra={targetYear} />
      ))}
    </group>
  );
};

export default Buildings;
