/**
 * Era-specific storefront, billboard, and street-prop configuration.
 *
 * Each era (1945, 1965, 1985, 2005, 2025) defines its own set of business
 * names, sign colors, billboard ad copy, and which street props are present.
 * Components consume this data so the street level swaps cleanly when the
 * user changes the timeline year.
 */
import type { EraId } from './years';

/**
 * A single storefront sign: business name plus a foreground/background color
 * pair used to render the awning and sign plate.
 */
export interface StorefrontConfig {
  /** Business name shown on the sign. */
  readonly name: string;
  /** Sign plate background color (hex). */
  readonly signColor: string;
  /** Sign text / accent color (hex). */
  readonly textColor: string;
  /** Awning color (hex). */
  readonly awningColor: string;
}

/**
 * A billboard advertisement: headline plus a board background color.
 */
export interface BillboardConfig {
  /** Headline ad copy. */
 readonly headline: string;
  /** Sub-line ad copy (may be empty). */
  readonly subline: string;
  /** Board background color (hex). */
  readonly boardColor: string;
  /** Board text color (hex). */
  readonly textColor: string;
}

/**
 * Which street props exist in a given era. A `false` value means the prop is
 * absent for that period (e.g. phone booths disappear by 2025).
 */
export interface StreetPropsConfig {
  readonly lamppost: boolean;
  readonly bench: boolean;
  readonly trashCan: boolean;
  readonly phoneBooth: boolean;
}

/**
 * Aggregate per-era street-level configuration.
 */
export interface EraStreetConfig {
  /** Storefronts lining the block (left + right side). */
  readonly storefronts: readonly StorefrontConfig[];
  /** Billboards mounted above the block. */
  readonly billboards: readonly BillboardConfig[];
  /** Which props are present. */
  readonly props: StreetPropsConfig;
}

/**
 * Full street-level configuration keyed by era id.
 */
export const ERA_STREET_CONFIG: Readonly<Record<EraId, EraStreetConfig>> = {
  postwar: {
    storefronts: [
      {
        name: 'Victory Bakery',
        signColor: '#8b5a2b',
        textColor: '#f5e6c8',
        awningColor: '#a83232',
      },
      {
        name: 'Smith & Co. Grocer',
        signColor: '#3a5f3a',
        textColor: '#e8e8e8',
        awningColor: '#2a4a2a',
      },
      {
        name: 'Liberty Diner',
        signColor: '#5a4a8b',
        textColor: '#ffd700',
        awningColor: '#4a3a6b',
      },
    ],
    billboards: [
      {
        headline: 'Buy War Bonds!',
        subline: 'Support Our Troops',
        boardColor: '#1a3a5a',
        textColor: '#ffd700',
      },
      {
        headline: 'Coca-Cola',
        subline: 'Refreshment for All',
        boardColor: '#8b1a1a',
        textColor: '#ffffff',
      },
    ],
    props: {
      lamppost: true,
      bench: true,
      trashCan: true,
      phoneBooth: false,
    },
  },
  sixties: {
    storefronts: [
      {
        name: 'Mod Fashions',
        signColor: '#ff6b9d',
        textColor: '#1a1a2e',
        awningColor: '#ffd700',
      },
      {
        name: 'Vinyl Records',
        signColor: '#4a4a8b',
        textColor: '#ff6b9d',
        awningColor: '#2a2a5a',
      },
      {
        name: 'Go-Go Diner',
        signColor: '#ff8c42',
        textColor: '#ffffff',
        awningColor: '#cc6622',
      },
    ],
    billboards: [
      {
        headline: 'The Beatles Are Here!',
        subline: 'New Album Out Now',
        boardColor: '#2a2a5a',
        textColor: '#ff6b9d',
      },
      {
        headline: 'Ford Mustang',
        subline: 'Drive the Dream',
        boardColor: '#8b1a1a',
        textColor: '#ffffff',
      },
    ],
    props: {
      lamppost: true,
      bench: true,
      trashCan: true,
      phoneBooth: true,
    },
  },
  eighties: {
    storefronts: [
      {
        name: 'Video Vault',
        signColor: '#1a1a2e',
        textColor: '#00ffff',
        awningColor: '#ff00ff',
      },
      {
        name: 'Arcade Palace',
        signColor: '#2a0a3a',
        textColor: '#ffff00',
        awningColor: '#ff00aa',
      },
      {
        name: 'Neon Diner',
        signColor: '#0a0a3a',
        textColor: '#ff00ff',
        awningColor: '#00ffff',
      },
    ],
    billboards: [
      {
        headline: 'Sony Walkman',
        subline: 'Music On The Go',
        boardColor: '#0a0a3a',
        textColor: '#ff00ff',
      },
      {
        headline: 'Pac-Man Fever!',
        subline: 'Insert Coin',
        boardColor: '#000000',
        textColor: '#ffff00',
      },
    ],
    props: {
      lamppost: true,
      bench: true,
      trashCan: true,
      phoneBooth: true,
    },
  },
  twothousands: {
    storefronts: [
      {
        name: 'Cyber Café',
        signColor: '#1a4a6a',
        textColor: '#00ff88',
        awningColor: '#0a2a4a',
      },
      {
        name: 'Blockbuster Video',
        signColor: '#1a3a8b',
        textColor: '#ffd700',
        awningColor: '#0a2a6b',
      },
      {
        name: 'Wireless World',
        signColor: '#2a2a2a',
        textColor: '#00aaff',
        awningColor: '#1a1a1a',
      },
    ],
    billboards: [
      {
        headline: 'iPod: 1,000 Songs',
        subline: 'In Your Pocket',
        boardColor: '#ffffff',
        textColor: '#1a1a1a',
      },
      {
        headline: 'Google It',
        subline: 'The World Online',
        boardColor: '#1a4a6a',
        textColor: '#ffffff',
      },
    ],
    props: {
      lamppost: true,
      bench: true,
      trashCan: true,
      phoneBooth: false,
    },
  },
  present: {
    storefronts: [
      {
        name: 'Artisan Coffee',
        signColor: '#3a2a1a',
        textColor: '#f5e6c8',
        awningColor: '#2a4a3a',
      },
      {
        name: 'Organic Market',
        signColor: '#2a5a3a',
        textColor: '#ffffff',
        awningColor: '#1a3a2a',
      },
      {
        name: 'EV Charge Hub',
        signColor: '#1a2a4a',
        textColor: '#00ddff',
        awningColor: '#0a1a3a',
      },
    ],
    billboards: [
      {
        headline: 'Tesla Model S',
        subline: 'Drive Electric',
        boardColor: '#0a0a1a',
        textColor: '#dd2222',
      },
      {
        headline: 'Stream Everything',
        subline: 'On 5G Now',
        boardColor: '#1a1a3a',
        textColor: '#00ddff',
      },
    ],
    props: {
      lamppost: true,
      bench: true,
      trashCan: true,
      phoneBooth: false,
    },
  },
};

/**
 * Look up the street-level configuration for an era. Falls back to the present
 * era config when the id is unknown so the scene never renders empty.
 */
export function getEraStreetConfig(era: EraId): EraStreetConfig {
  return ERA_STREET_CONFIG[era] ?? ERA_STREET_CONFIG.present;
}
