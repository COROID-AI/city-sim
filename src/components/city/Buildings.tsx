import { useMemo, type FC } from 'react';
import { BLOCK_LAYOUT, type Plot } from '@/config/blockLayout';
import { getEraTheme } from '@/config/eraTheme';
import type { EraId } from '@/config/years';

/**
 * Procedural buildings.
 *
 * Each plot receives a deterministic height (seeded from its id + era) and a
 * colour drawn from the era palette. Taller, denser, glassier buildings appear
 * in later eras — the same plot footprint therefore reads very differently
 * across the timeline.
 */

/** Tiny deterministic hash → [0, 1). */
function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

interface BuildingProps {
  plot: Plot;
  era: EraId;
  /** Max height multiplier from the active year config. */
  maxHeight: number;
  /** Density multiplier (0..1) — lower density shrinks buildings. */
  density: number;
}

/**
 * A single procedural building: extruded box with a window-grid emissive
 * facade and a flat roof cap.
 */
const Building: FC<BuildingProps> = ({ plot, era, maxHeight, density }) => {
  const theme = getEraTheme(era);

  const { height, color, windowColor, floors } = useMemo(() => {
    const seed = hashSeed(`${plot.id}-${era}`);
    const seed2 = hashSeed(`${plot.id}-${era}-b`);
    // Scale height by era maxHeight + density; keep a sensible floor.
    const h = Math.max(4, maxHeight * (0.35 + seed * 0.65) * (0.6 + density * 0.4));
    const palette = theme.buildingColors;
    const c = palette[Math.floor(seed2 * palette.length) % palette.length];
    const wc = theme.windowColor;
    const f = Math.max(1, Math.round(h / 3));
    return { height: h, color: c, windowColor: wc, floors: f };
  }, [plot.id, era, maxHeight, density, theme]);

  // Inset the building slightly inside the plot footprint.
  const inset = 1;
  const w = plot.width - inset * 2;
  const d = plot.depth - inset * 2;

  return (
    <group position={[plot.x, 0, plot.z]}>
      {/* Main mass */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, height, d]} />
        <meshStandardMaterial color={color} roughness={0.8} metalness={0.05} />
      </mesh>

      {/* Window grid — thin emissive strips per floor */}
      {Array.from({ length: floors }, (_, i) => {
        const y = 2 + i * 3;
        if (y > height - 1) return null;
        return (
          <group key={`floor-${i}`}>
            {/* Front + back window bands */}
            <mesh position={[0, y, d / 2 + 0.01]}>
              <planeGeometry args={[w * 0.8, 1]} />
              <meshStandardMaterial
                color={windowColor}
                emissive={windowColor}
                emissiveIntensity={0.35}
                roughness={0.4}
              />
            </mesh>
            <mesh position={[0, y, -d / 2 - 0.01]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[w * 0.8, 1]} />
              <meshStandardMaterial
                color={windowColor}
                emissive={windowColor}
                emissiveIntensity={0.35}
                roughness={0.4}
              />
            </mesh>
          </group>
        );
      })}

      {/* Roof cap */}
      <mesh position={[0, height + 0.15, 0]} castShadow>
        <boxGeometry args={[w * 0.9, 0.3, d * 0.9]} />
        <meshStandardMaterial color={theme.roofColor} roughness={0.9} />
      </mesh>
    </group>
  );
};

interface BuildingsProps {
  era: EraId;
  maxHeight: number;
  density: number;
}

/**
 * Renders one procedural building per plot in the block layout.
 */
const Buildings: FC<BuildingsProps> = ({ era, maxHeight, density }) => {
  return (
    <group>
      {BLOCK_LAYOUT.plots.map((plot) => (
        <Building
          key={plot.id}
          plot={plot}
          era={era}
          maxHeight={maxHeight}
          density={density}
        />
      ))}
    </group>
  );
};

export default Buildings;
