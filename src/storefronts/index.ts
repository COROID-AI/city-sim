/**
 * Storefronts & advertisements module.
 *
 * Self-contained R3F layer keyed off the shared era registry (EraId). It
 * renders era-correct storefronts and advertisements for every era using
 * procedural geometry and canvas-generated signage/poster textures. Expose
 * `<StorefrontsAds era={...} />` to place it in any canvas (integration
 * happens in Phase 4).
 */
export { StorefrontsAds, type StorefrontsAdsProps } from './StorefrontsAds';
export { Storefront, type TimeOfDay } from './Storefront';
export { Billboard } from './Billboard';
export {
  ERA_STOREFRONT_CONFIG,
  generateStorefronts,
  generateBillboards,
  getStorefrontConfig,
} from './storefrontEras';
export type { EraStorefrontConfig, StorefrontSpec, BillboardSpec } from './storefrontTypes';
export {
  SIGN_W,
  SIGN_H,
  POSTER_W,
  POSTER_H,
  createCanvas,
  canvasToTexture,
  buildSignCanvas,
  buildPosterCanvas,
} from './signage';
export type { SignSpec } from './signage';