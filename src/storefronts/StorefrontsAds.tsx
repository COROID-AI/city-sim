/**
 * Era-variant storefronts & advertisements module.
 *
 * A self-contained R3F layer keyed off the foundation era registry (`EraId`).
 * It renders era-correct storefronts and advertisements around the city block
 * for all five periods using procedural geometry and canvas-generated
 * signage/poster textures:
 *
 * - 1945: hand-painted signage, striped awnings, neon-once-emerging, period
 *   typography and sepia-toned ad posters.
 * - 1965: bold mid-century signage, more neon, glossy enamel, Pop-art posters.
 * - 1985: backlit plastic signs, fluorescent storefronts, neon/light-box ads.
 * - 2005: digital-print light boxes, large-format vinyl banners, LED accents,
 *   modern corporate signage.
 * - 2025: dynamic LED/digital screens, animated media facades, minimal signage.
 *
 * Signage renders via emissive materials whose intensity scales with
 * `timeOfDay`, so lit signage reads clearly at night and recedes by day.
 *
 * The module is independent — integration into the main scene happens in
 * Phase 4. Drop `<StorefrontsAds era={currentEra} />` into a `<Canvas>`.
 */
import { useMemo } from 'react';
import type { EraId } from '../contracts';
import { Storefront, type TimeOfDay } from './Storefront';
import { Billboard } from './Billboard';
import { generateStorefronts, generateBillboards } from './storefrontEras';
import { getStorefrontConfig } from './storefrontEras';

export interface StorefrontsAdsProps {
  /** The era whose storefronts & advertisements should be displayed. */
  era: EraId;
  /**
   * Time of day driving the emissive response of signage: `night` boosts
   * emissive intensity so lit signs read clearly; `day` dims it. Default
   * `night`.
   */
  timeOfDay?: TimeOfDay;
  /** Optional explicit seed for reproducible placements. */
  seed?: number;
}

/**
 * Era-variant storefronts & advertisements module.
 *
 * Accepts the current era and renders the matching storefronts and
 * advertisements. Self-contained and independent; integrates into the main
 * scene in a later phase.
 */
export function StorefrontsAds({ era, timeOfDay = 'night', seed }: StorefrontsAdsProps) {
  const config = getStorefrontConfig(era);
  const storefronts = useMemo(() => generateStorefronts(era, seed), [era, seed]);
  const billboards = useMemo(() => generateBillboards(era, seed), [era, seed]);

  return (
    <group>
      {storefronts.map((spec) => (
        <Storefront
          key={spec.id}
          config={config}
          spec={spec}
          timeOfDay={timeOfDay}
        />
      ))}
      {billboards.map((spec) => (
        <Billboard
          key={spec.id}
          config={config}
          spec={spec}
          timeOfDay={timeOfDay}
        />
      ))}
    </group>
  );
}