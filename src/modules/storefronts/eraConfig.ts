import type { EraId } from '../../contracts';

/**
 * Era-specific storefront & advertisement content.
 *
 * Every era is keyed off the foundation `EraId` registry and describes the
 * storefronts, ads, signage language, and day/night emissive behavior that
 * the `StorefrontsAds` module renders procedurally.
 */

/** Visual language of a storefront sign. */
export type SignStyle =
  'handPainted' | 'midCentury' | 'backlit' | 'digitalPrint' | 'led';

/** Visual language of an advertisement poster. */
export type AdStyle = 'sepia' | 'popart' | 'neon80s' | 'corporate' | 'digital';

/** Simple vector logo drawn on a sign. */
export type LogoKind = 'circle' | 'star' | 'diamond' | 'bolt' | 'wave';

/** A single storefront facade configuration. */
export interface StorefrontConfig {
  /** Store name shown on the sign. */
  name: string;
  /** Secondary descriptor, e.g. 'GROCERY'. */
  type: string;
  /** Storefront wall color. */
  wallColor: string;
  /** Trim / frame color. */
  trimColor: string;
  /** Sign background color. */
  signBg: string;
  /** Sign text color. */
  signFg: string;
  /** Sign accent color (subtext / logo). */
  signAccent: string;
  signStyle: SignStyle;
  /** Optional vector logo. */
  logo?: LogoKind;
  /** Canvas awning over the display window. */
  awning?: boolean;
  awningColors?: [string, string];
  /** Emissive color of the sign. */
  signEmissive: string;
  /** Optional neon sign text (1945 / 1965). */
  neonText?: string;
  neonColor?: string;
  /** Number of ad posters inside the display window. */
  windowPosters?: number;
}

/** An advertisement poster / billboard configuration. */
export interface AdConfig {
  headline: string;
  subhead: string;
  cta: string;
  style: AdStyle;
  bg: string;
  fg: string;
  accent: string;
}

/** Complete storefronts + advertisements config for one era. */
export interface EraStorefrontsConfig {
  storefronts: StorefrontConfig[];
  ads: AdConfig[];
  /** Signage emissive intensity in day vs night. */
  emissive: { day: number; night: number };
  /** Wide street banner text (2005). */
  banner?: string;
}

export const STOREFRONTS_BY_ERA: Record<EraId, EraStorefrontsConfig> = {
  1945: {
    storefronts: [
      {
        name: "WILSON'S",
        type: 'GROCERY',
        wallColor: '#6b5b47',
        trimColor: '#8a7a5c',
        signBg: '#d8cdb4',
        signFg: '#3c3328',
        signAccent: '#6b5b47',
        signStyle: 'handPainted',
        awning: true,
        awningColors: ['#a03a2f', '#e8dcc0'],
        signEmissive: '#ffd9a0',
        neonText: 'GROCERY',
        neonColor: '#ffb04d',
        windowPosters: 2,
      },
      {
        name: 'BARBER',
        type: 'SHOP',
        wallColor: '#7a6a50',
        trimColor: '#c8b896',
        signBg: '#efe6d2',
        signFg: '#4a3a2a',
        signAccent: '#9a2f22',
        signStyle: 'handPainted',
        awning: true,
        awningColors: ['#2f6b5a', '#efe6d2'],
        signEmissive: '#fff0c0',
        windowPosters: 1,
      },
      {
        name: 'DRUG',
        type: 'STORE',
        wallColor: '#5f6a72',
        trimColor: '#9fb0ba',
        signBg: '#dde6ea',
        signFg: '#1f3a4a',
        signAccent: '#b04a2a',
        signStyle: 'handPainted',
        signEmissive: '#cfe6ff',
        windowPosters: 2,
      },
      {
        name: "JOE'S",
        type: 'DINER',
        wallColor: '#6f5a4a',
        trimColor: '#b08a5a',
        signBg: '#e8d8b8',
        signFg: '#4a2f1a',
        signAccent: '#8a2f1f',
        signStyle: 'handPainted',
        awning: true,
        awningColors: ['#8a2f1f', '#e8d8b8'],
        signEmissive: '#ffe0b0',
        neonText: 'OPEN',
        neonColor: '#ff9a3c',
        windowPosters: 1,
      },
    ],
    ads: [
      {
        headline: 'FRESH',
        subhead: 'From the Farm',
        cta: "WILSON'S GROCERY",
        style: 'sepia',
        bg: '#c9b896',
        fg: '#3a2f1f',
        accent: '#7a2f1f',
      },
      {
        headline: 'VICTORY',
        subhead: 'Bond Drive',
        cta: 'BUY NOW',
        style: 'sepia',
        bg: '#b8a87c',
        fg: '#2f2a1f',
        accent: '#8a2f1f',
      },
      {
        headline: 'COFFEE',
        subhead: 'Fresh Roasted Daily',
        cta: "JOE'S DINER",
        style: 'sepia',
        bg: '#a8946b',
        fg: '#3a2f1f',
        accent: '#6b3a1f',
      },
    ],
    emissive: { day: 0.25, night: 2.2 },
  },

  1965: {
    storefronts: [
      {
        name: 'DINER',
        type: 'MID-CENTURY',
        wallColor: '#2e6f7a',
        trimColor: '#d9a441',
        signBg: '#d9a441',
        signFg: '#2e2a24',
        signAccent: '#7a1f2f',
        signStyle: 'midCentury',
        awning: true,
        awningColors: ['#d9a441', '#2e6f7a'],
        signEmissive: '#ffd76a',
        logo: 'wave',
        neonText: 'DINER',
        neonColor: '#ff5a3c',
        windowPosters: 2,
      },
      {
        name: 'RECORDS',
        type: 'HI-FI',
        wallColor: '#7a2f4a',
        trimColor: '#e8e3d8',
        signBg: '#e8e3d8',
        signFg: '#2f2a24',
        signAccent: '#2e6f7a',
        signStyle: 'midCentury',
        signEmissive: '#ffd0e0',
        logo: 'circle',
        windowPosters: 2,
      },
      {
        name: 'DEPARTMENT',
        type: 'STORE',
        wallColor: '#3a5f7a',
        trimColor: '#d9a441',
        signBg: '#d9a441',
        signFg: '#1f3a4a',
        signAccent: '#3a5f7a',
        signStyle: 'midCentury',
        signEmissive: '#ffe08a',
        windowPosters: 1,
      },
      {
        name: 'TRAVEL',
        type: 'AGENCY',
        wallColor: '#2f6f5a',
        trimColor: '#e8e3d8',
        signBg: '#2f6f5a',
        signFg: '#e8e3d8',
        signAccent: '#d9a441',
        signStyle: 'midCentury',
        signEmissive: '#c8ffe0',
        logo: 'diamond',
        windowPosters: 2,
      },
    ],
    ads: [
      {
        headline: 'POP',
        subhead: 'Taste the Color',
        cta: 'SODA NOW',
        style: 'popart',
        bg: '#ff2d55',
        fg: '#ffffff',
        accent: '#00c8ff',
      },
      {
        headline: 'GO!',
        subhead: 'The Future is Here',
        cta: 'TRAVEL CO.',
        style: 'popart',
        bg: '#00c8ff',
        fg: '#ffffff',
        accent: '#ffd700',
      },
      {
        headline: 'NEW',
        subhead: 'Faster. Brighter.',
        cta: 'HI-FI RECORDS',
        style: 'popart',
        bg: '#ffd700',
        fg: '#111111',
        accent: '#ff2d55',
      },
    ],
    emissive: { day: 0.3, night: 2.4 },
  },

  1985: {
    storefronts: [
      {
        name: 'ARCADE',
        type: 'VIDEO',
        wallColor: '#1a1030',
        trimColor: '#ff2d95',
        signBg: '#ff2d95',
        signFg: '#ffffff',
        signAccent: '#00e5ff',
        signStyle: 'backlit',
        logo: 'bolt',
        signEmissive: '#ff2d95',
        windowPosters: 2,
      },
      {
        name: 'ELECTRONICS',
        type: 'STEREO',
        wallColor: '#10182a',
        trimColor: '#00e5ff',
        signBg: '#10182a',
        signFg: '#00e5ff',
        signAccent: '#ff2d95',
        signStyle: 'backlit',
        signEmissive: '#00e5ff',
        windowPosters: 2,
      },
      {
        name: 'PIZZA',
        type: 'PALACE',
        wallColor: '#2a1018',
        trimColor: '#ffd700',
        signBg: '#ffd700',
        signFg: '#2a1018',
        signAccent: '#ff2d95',
        signStyle: 'backlit',
        logo: 'star',
        signEmissive: '#ffd700',
        windowPosters: 1,
      },
      {
        name: 'FIRST',
        type: 'BANK',
        wallColor: '#1a1a2a',
        trimColor: '#7a3bff',
        signBg: '#7a3bff',
        signFg: '#ffffff',
        signAccent: '#00e5ff',
        signStyle: 'backlit',
        signEmissive: '#7a3bff',
        windowPosters: 1,
      },
    ],
    ads: [
      {
        headline: 'NEON',
        subhead: 'NIGHTS',
        cta: 'ARCADE 84',
        style: 'neon80s',
        bg: '#120a22',
        fg: '#00e5ff',
        accent: '#ff2d95',
      },
      {
        headline: 'STEREO',
        subhead: 'Blast the Bass',
        cta: 'NOW IN STORE',
        style: 'neon80s',
        bg: '#0a1222',
        fg: '#ff2d95',
        accent: '#00e5ff',
      },
      {
        headline: 'SAVE',
        subhead: 'Biggest Sale',
        cta: 'FIRST BANK',
        style: 'neon80s',
        bg: '#220a12',
        fg: '#ffd700',
        accent: '#7a3bff',
      },
    ],
    emissive: { day: 0.45, night: 3.0 },
  },

  2005: {
    storefronts: [
      {
        name: 'NETCAFE',
        type: 'INTERNET',
        wallColor: '#1f3a4a',
        trimColor: '#8fb7c9',
        signBg: '#2f6f8f',
        signFg: '#ffffff',
        signAccent: '#8fb7c9',
        signStyle: 'digitalPrint',
        logo: 'circle',
        signEmissive: '#2f6f8f',
        windowPosters: 2,
      },
      {
        name: 'MOBILE',
        type: 'PHONES',
        wallColor: '#2a2f3a',
        trimColor: '#8fb7c9',
        signBg: '#e0e8ec',
        signFg: '#1f3a4a',
        signAccent: '#2f6f8f',
        signStyle: 'digitalPrint',
        signEmissive: '#bfe0f0',
        windowPosters: 2,
      },
      {
        name: 'COFFEE',
        type: 'CAFE',
        wallColor: '#3a2f2a',
        trimColor: '#d9c8a0',
        signBg: '#2f6f8f',
        signFg: '#ffffff',
        signAccent: '#d9c8a0',
        signStyle: 'digitalPrint',
        logo: 'wave',
        signEmissive: '#2f6f8f',
        windowPosters: 1,
      },
      {
        name: 'CITY',
        type: 'BANK',
        wallColor: '#1f2a3a',
        trimColor: '#8fb7c9',
        signBg: '#ffffff',
        signFg: '#1f3a4a',
        signAccent: '#2f6f8f',
        signStyle: 'digitalPrint',
        signEmissive: '#e8f0f5',
        windowPosters: 1,
      },
    ],
    ads: [
      {
        headline: 'FASTER',
        subhead: 'Broadband Internet',
        cta: 'NETCAFE',
        style: 'corporate',
        bg: '#2f6f8f',
        fg: '#ffffff',
        accent: '#8fb7c9',
      },
      {
        headline: 'NEW',
        subhead: 'Camera Phones',
        cta: 'MOBILE',
        style: 'corporate',
        bg: '#e0e8ec',
        fg: '#1f3a4a',
        accent: '#2f6f8f',
      },
      {
        headline: 'GO DIGITAL',
        subhead: 'Connect Today',
        cta: 'CITY BANK',
        style: 'corporate',
        bg: '#ffffff',
        fg: '#1f3a4a',
        accent: '#2f6f8f',
      },
    ],
    banner: 'GRAND OPENING • FREE WI-FI',
    emissive: { day: 0.4, night: 2.6 },
  },

  2025: {
    storefronts: [
      {
        name: 'TECH',
        type: 'STORE',
        wallColor: '#141a26',
        trimColor: '#7fd1ff',
        signBg: '#05070a',
        signFg: '#7fd1ff',
        signAccent: '#7fd1ff',
        signStyle: 'led',
        logo: 'bolt',
        signEmissive: '#7fd1ff',
        windowPosters: 2,
      },
      {
        name: 'BOUTIQUE',
        type: 'FASHION',
        wallColor: '#1f2a44',
        trimColor: '#e8e3d8',
        signBg: '#05070a',
        signFg: '#e8e3d8',
        signAccent: '#7fd1ff',
        signStyle: 'led',
        signEmissive: '#e8e3d8',
        windowPosters: 2,
      },
      {
        name: 'CAFE',
        type: 'SPECIALTY',
        wallColor: '#2a241f',
        trimColor: '#7fd1ff',
        signBg: '#05070a',
        signFg: '#7fd1ff',
        signAccent: '#e8a45a',
        signStyle: 'led',
        logo: 'wave',
        signEmissive: '#7fd1ff',
        windowPosters: 1,
      },
      {
        name: 'NOVA',
        type: 'BANK',
        wallColor: '#101820',
        trimColor: '#7fd1ff',
        signBg: '#05070a',
        signFg: '#7fd1ff',
        signAccent: '#ffffff',
        signStyle: 'led',
        signEmissive: '#7fd1ff',
        windowPosters: 1,
      },
    ],
    ads: [
      {
        headline: 'NEXT',
        subhead: 'The Future, Now',
        cta: 'TECH STORE',
        style: 'digital',
        bg: '#05070a',
        fg: '#7fd1ff',
        accent: '#ffffff',
      },
      {
        headline: 'LOOP',
        subhead: 'Smart Living',
        cta: 'NOVA BANK',
        style: 'digital',
        bg: '#0a0f18',
        fg: '#ffffff',
        accent: '#7fd1ff',
      },
      {
        headline: 'PURE',
        subhead: 'Minimal. Clean.',
        cta: 'BOUTIQUE',
        style: 'digital',
        bg: '#141a26',
        fg: '#e8e3d8',
        accent: '#7fd1ff',
      },
    ],
    emissive: { day: 0.5, night: 3.0 },
  },
};
