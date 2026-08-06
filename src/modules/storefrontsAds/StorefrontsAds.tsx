import type { EraId } from '../../contracts/era';
import { STORE_CONFIG } from './eraConfig';
import { Storefront, type Environment } from './storefront';

export interface StorefrontsAdsProps {
  /** The era whose storefronts and advertisements to render. */
  era: EraId;
  /**
   * Day or night lighting. Night boosts signage emissive intensity so the
   * neon / backlit / LED signage reads clearly in dim conditions.
   * @default 'day'
   */
  environment?: Environment;
}

/** World-space x positions of the storefront row (facing the road). */
const STORE_XS = [-5, -2.6, 0, 2.6, 5];

/**
 * Self-contained storefronts + advertisements layer.
 *
 * Renders, for the given era, a row of storefront buildings with
 * era-correct signage (hand-painted -> neon -> backlit -> digital -> LED),
 * awnings, ad posters / digital screens, typography and logos — all built
 * from procedural geometry and canvas-generated textures + emissive
 * materials. No external image assets are required.
 *
 * Designed to be mounted inside a `<Canvas>`; Phase 4 owns wiring it into
 * the shared scene.
 */
export function StorefrontsAds({
  era,
  environment = 'day',
}: StorefrontsAdsProps) {
  const config = STORE_CONFIG[era];

  return (
    <group>
      {STORE_XS.map((x, i) => (
        <Storefront
          key={x}
          x={x}
          index={i}
          storeName={config.stores[i % config.stores.length]}
          ad={config.ads[i % config.ads.length]}
          config={config}
          environment={environment}
        />
      ))}
    </group>
  );
}

export { STORE_CONFIG } from './eraConfig';
export type { StoreConfig, SignageStyle, PosterStyle } from './eraConfig';
export {
  createSignTexture,
  createPosterTexture,
  createLogoTexture,
  createAwningTexture,
} from './textures';
export { Storefront } from './storefront';
export type { StorefrontProps, Environment } from './storefront';
