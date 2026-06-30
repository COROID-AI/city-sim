import { useMemo, type FC } from 'react';
import { BLOCK_LAYOUT } from '@/config/blockLayout';
import { getEraTheme } from '@/config/eraTheme';
import type { EraId } from '@/config/years';

/**
 * Storefronts & advertisements.
 *
 * Places a glowing advert panel on the ground floor of select buildings.
 * Later eras get brighter, more saturated neon signage.
 */

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

interface StorefrontsProps {
  era: EraId;
}

const Storefronts: FC<StorefrontsProps> = ({ era }) => {
  const panels = useMemo(() => {
    const theme = getEraTheme(era);
    return BLOCK_LAYOUT.plots.map((plot, idx) => {
      const seed = hashSeed(`${plot.id}-ad-${era}`);
      // ~70% of plots get an advert.
      if (seed > 0.7) return null;
      const ad = theme.ads[idx % theme.ads.length];
      // Alternate which face the advert sits on.
      const faceZ = idx % 2 === 0;
      const offset = plot.depth / 2 + 0.05;
      return {
        id: `ad-${plot.id}`,
        x: plot.x,
        z: plot.z + (faceZ ? offset : 0),
        x2: plot.x + (faceZ ? 0 : plot.width / 2 + 0.05),
        z2: plot.z,
        faceZ,
        ad,
      };
    }).filter((p): p is NonNullable<typeof p> => p !== null);
  }, [era]);

  return (
    <group>
      {panels.map((p) => (
        <group key={p.id}>
          {p.faceZ ? (
            <mesh position={[p.x, 2, p.z]}>
              <planeGeometry args={[4, 1.5]} />
              <meshStandardMaterial
                color={p.ad.background}
                emissive={p.ad.background}
                emissiveIntensity={0.6}
              />
            </mesh>
          ) : (
            <mesh position={[p.x2, 2, p.z2]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[4, 1.5]} />
              <meshStandardMaterial
                color={p.ad.background}
                emissive={p.ad.background}
                emissiveIntensity={0.6}
              />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
};

export default Storefronts;
