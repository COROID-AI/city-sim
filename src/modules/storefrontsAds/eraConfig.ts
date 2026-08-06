import type { EraId } from '../../contracts/era';

/**
 * Era-variant storefront signage medium.
 *
 * Tracks the temporally plausible progression of advertising media:
 * hand-painted -> neon -> backlit plastic -> digital print -> dynamic LED.
 */
export type SignageStyle =
  | 'handpainted'
  | 'neon'
  | 'backlit'
  | 'digital'
  | 'led';

/** Era-variant advertisement poster treatment. */
export type PosterStyle =
  | 'sepia'
  | 'popart'
  | 'neon80s'
  | 'digitalprint'
  | 'dynamic';

/** Whether the storefront has a striped canvas awning (1945). */
export type AwningStyle = 'striped' | 'none';

/** Complete signage + advertisement configuration for a single era. */
export interface StoreConfig {
  /** Primary storefront signage medium. */
  signageStyle: SignageStyle;
  /** Advertisement poster / screen treatment. */
  posterStyle: PosterStyle;
  /** Canvas awning presence + style. */
  awning: AwningStyle;
  /** Facade colour palette — one colour picked per storefront. */
  facadeColors: string[];
  /** Storefront window / glass tint. */
  windowTint: string;
  /** Sign panel background colour. */
  signBackground: string;
  /** Sign text colour. */
  signTextColor: string;
  /** CSS font stack used for signage typography. */
  signFont: string;
  /** Emissive intensity of signage in day conditions (night is boosted). */
  emissiveIntensity: number;
  /** Neon / accent colour used for glow tubes and logo marks. */
  neonColor: string;
  /** Whether poster panels are emissive digital screens (2005/2025). */
  posterEmissive: boolean;
  /** Whether a small logo disc is mounted beside the signage (1965+). */
  showLogo: boolean;
  /** Whether the digital media facade animates its ad loop (2025). */
  animated: boolean;
  /** Store names — one assigned per storefront in the row. */
  stores: string[];
  /** Advertisement copy drawn onto posters / screens. */
  ads: string[];
}

/**
 * Era-to-storefront configuration.
 *
 * Typography, palettes and lighting values intentionally mirror the
 * foundation `ERA_REGISTRY` mood hints (muted/somber 1945, bright pastel
 * 1965, electric 1985, sleek/cool 2005, clean/futuristic 2025).
 */
export const STORE_CONFIG: Record<EraId, StoreConfig> = {
  1945: {
    signageStyle: 'handpainted',
    posterStyle: 'sepia',
    awning: 'striped',
    facadeColors: ['#8a7f72', '#6b625a', '#7d7264', '#5f574e', '#8f8477'],
    windowTint: '#3a332b',
    signBackground: '#d9cbb4',
    signTextColor: '#3a2f22',
    signFont: 'bold 58px Georgia, "Times New Roman", serif',
    emissiveIntensity: 0.55,
    neonColor: '#ffb347',
    posterEmissive: false,
    showLogo: false,
    animated: false,
    stores: ['GROCER', 'BARBER', 'CAFÉ', 'DRUGS', 'TAILOR'],
    ads: ['VICTORY', 'FRESH BREAD', 'WAR BONDS', 'OPEN', 'QUALITY'],
  },
  1965: {
    signageStyle: 'neon',
    posterStyle: 'popart',
    awning: 'none',
    facadeColors: ['#c96f5a', '#e0b34f', '#5b7f9e', '#7fa05b', '#c98a5a'],
    windowTint: '#7f8a95',
    signBackground: '#1a1a1a',
    signTextColor: '#ff4d6d',
    signFont: 'bold 58px Impact, "Arial Black", sans-serif',
    emissiveIntensity: 1.6,
    neonColor: '#ff4d6d',
    posterEmissive: false,
    showLogo: true,
    animated: false,
    stores: ['DINER', 'MOTEL', 'SODA', 'AUTO', 'TV'],
    ads: ['POP!', 'NEW!', 'GO', 'FRESH', 'HOT'],
  },
  1985: {
    signageStyle: 'backlit',
    posterStyle: 'neon80s',
    awning: 'none',
    facadeColors: ['#2b2b45', '#3a2b4a', '#2e2e3a', '#402b3a', '#33334d'],
    windowTint: '#ffd319',
    signBackground: '#fff3e0',
    signTextColor: '#111111',
    signFont: 'bold 56px "Arial Black", Arial, sans-serif',
    emissiveIntensity: 2.0,
    neonColor: '#00e5ff',
    posterEmissive: false,
    showLogo: true,
    animated: false,
    stores: ['VIDEO', 'ARCADE', 'PIZZA', 'SOUND', 'MEGA'],
    ads: ['NEON', 'NEW', 'SALE', 'HOT!', 'MAX'],
  },
  2005: {
    signageStyle: 'digital',
    posterStyle: 'digitalprint',
    awning: 'none',
    facadeColors: ['#8b9bb4', '#4f6d7a', '#6a7a8c', '#5c6b7a', '#7d8b9c'],
    windowTint: '#bfe0f0',
    signBackground: '#0d2b3a',
    signTextColor: '#e8f6ff',
    signFont: 'bold 54px Arial, Helvetica, sans-serif',
    emissiveIntensity: 1.8,
    neonColor: '#00c8ff',
    posterEmissive: true,
    showLogo: true,
    animated: false,
    stores: ['COFFEE', 'WIRELESS', 'BANK', 'GYM', 'TECH'],
    ads: ['FAST', 'GO 3G', 'OPEN 24', 'FRESH', 'SAVE'],
  },
  2025: {
    signageStyle: 'led',
    posterStyle: 'dynamic',
    awning: 'none',
    facadeColors: ['#2f6f8f', '#1f3a4a', '#3a5a6a', '#2a4a5a', '#274b5c'],
    windowTint: '#d8e6ef',
    signBackground: '#020a12',
    signTextColor: '#7fe8ff',
    signFont: '300 50px "Helvetica Neue", Arial, sans-serif',
    emissiveIntensity: 2.2,
    neonColor: '#7fe8ff',
    posterEmissive: true,
    showLogo: true,
    animated: true,
    stores: ['Café', 'TECH', 'STUDIO', 'MARKET', 'LAB'],
    ads: ['LIVE', 'NOW', 'SALE', 'OPEN', 'HELLO'],
  },
};
