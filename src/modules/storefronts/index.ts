/**
 * Storefronts & advertisements module barrel.
 *
 * The module is self-contained and keyed off the foundation era registry.
 * Integration into the main scene happens in a later phase.
 */
export { StorefrontsAds } from './StorefrontsAds';
export type { StorefrontsAdsProps } from './StorefrontsAds';
export { STOREFRONTS_BY_ERA } from './eraConfig';
export type {
  AdConfig,
  AdStyle,
  EraStorefrontsConfig,
  LogoKind,
  SignStyle,
  StorefrontConfig,
} from './eraConfig';
export {
  createAwningTexture,
  createLedFrameTexture,
  createNeonTexture,
  createPosterTexture,
  createSignTexture,
  drawLedFrame,
  fontForSignStyle,
} from './canvas';
export type { PosterTextureConfig, SignTextureConfig } from './canvas';
