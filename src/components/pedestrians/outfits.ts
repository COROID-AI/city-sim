/**
 * Era outfit definitions for the pedestrians module.
 *
 * Each era exposes a crowd density (count) and a weighted list of outfit
 * variants. A variant encodes the *silhouette* (torso width/height, leg
 * length, optional shoulder pads) plus headwear, hair, and an accessory.
 * Outfit colours are randomised per instance from era-appropriate pools so
 * the crowd reads as varied but period-correct.
 */
import type { EraId } from '../../contracts';

/** Body part keys used by the shared rig. */
export type PartKey =
  | 'leftLeg'
  | 'rightLeg'
  | 'torso'
  | 'leftArm'
  | 'rightArm'
  | 'head'
  | 'hair'
  | 'hat'
  | 'accessory';

export type HatType =
  'none' | 'fedora' | 'flatcap' | 'pillbox' | 'cap' | 'widebrim';

export type HairStyle = 'short' | 'flat' | 'bob' | 'big' | 'long' | 'ponytail';

export type AccessoryType =
  | 'none'
  | 'handbag'
  | 'briefcase'
  | 'camera'
  | 'phone'
  | 'flip'
  | 'smartphone'
  | 'earbuds'
  | 'mask'
  | 'coffee';

export interface OutfitVariant {
  /** Stable identifier, e.g. "1945-suit". */
  id: string;
  /** Human label for debugging / future UI. */
  label: string;
  /** Multiplier on the base torso width (1 = slim, >1 = broad shoulders). */
  torsoWidth: number;
  /** Multiplier on the base torso height (dresses / shift dresses). */
  torsoHeight: number;
  /** Multiplier on the base leg length (dresses read shorter legs). */
  legLength: number;
  /** Broad-shouldered 80s silhouette (adds shoulder pad blocks). */
  shoulderPads?: boolean;
  hat: HatType;
  hair: HairStyle;
  accessory: AccessoryType;
  /** Weight used when randomly assigning pedestrians to variants. */
  weight: number;
  /** Per-part colour pools used to randomise each instance. */
  colorPools: Partial<Record<PartKey, string[]>>;
}

export interface EraPedestrianConfig {
  /** Crowd density for the era. */
  count: number;
  variants: OutfitVariant[];
}

const SUITS = ['#3b4654', '#4a4a44', '#5a5348', '#37424e', '#56504a'];
const SKINS = [
  '#c98d6f',
  '#b57a5f',
  '#a96f52',
  '#8f5a42',
  '#d9a183',
  '#6e4a33',
];
const HAIRS = [
  '#2b2118',
  '#3a2d20',
  '#4a3624',
  '#1d1a17',
  '#5a4630',
  '#8a6a44',
];

/** 1945 — formal / period attire, conservative palette. */
const CONFIG_1945: EraPedestrianConfig = {
  count: 24,
  variants: [
    {
      id: '1945-suit',
      label: 'Post-war suit',
      torsoWidth: 1.15,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'fedora',
      hair: 'short',
      accessory: 'briefcase',
      weight: 5,
      colorPools: {
        torso: [...SUITS],
        leftLeg: ['#33383f', '#3d3d3a', '#46403a', '#2f3944'],
        rightLeg: ['#33383f', '#3d3d3a', '#46403a', '#2f3944'],
        hat: ['#3b3b37', '#4a453e', '#33383f', '#5a5348'],
        accessory: ['#4a3b2b', '#5a4a35', '#3d3a33'],
      },
    },
    {
      id: '1945-overcoat',
      label: 'Wool overcoat',
      torsoWidth: 1.3,
      torsoHeight: 1.12,
      legLength: 0.95,
      hat: 'fedora',
      hair: 'short',
      accessory: 'briefcase',
      weight: 3,
      colorPools: {
        torso: ['#4a4a44', '#5a5348', '#3b4654', '#56504a'],
        leftLeg: ['#33383f', '#3d3d3a', '#2f3944'],
        rightLeg: ['#33383f', '#3d3d3a', '#2f3944'],
        hat: ['#3b3b37', '#4a453e'],
        accessory: ['#4a3b2b', '#3d3a33'],
      },
    },
    {
      id: '1945-dress',
      label: 'Day dress & hat',
      torsoWidth: 1.0,
      torsoHeight: 1.35,
      legLength: 0.5,
      hat: 'widebrim',
      hair: 'bob',
      accessory: 'handbag',
      weight: 4,
      colorPools: {
        torso: [
          '#6b4a3a',
          '#5a4a50',
          '#4a5a52',
          '#7a5a4a',
          '#5a4a3a',
          '#6a5a62',
        ],
        leftLeg: ['#cba886', '#b99a7a', '#d0b090', '#a98866'],
        rightLeg: ['#cba886', '#b99a7a', '#d0b090', '#a98866'],
        hat: ['#5a4a3a', '#6b4a3a', '#4a5a52'],
        accessory: ['#4a3b2b', '#3d3a33', '#5a4a3a'],
      },
    },
    {
      id: '1945-uniform',
      label: 'Service uniform',
      torsoWidth: 1.15,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'flatcap',
      hair: 'short',
      accessory: 'none',
      weight: 2,
      colorPools: {
        torso: ['#4a5a4a', '#5a5a52', '#3f4f3f', '#4a4a52'],
        leftLeg: ['#3d3d3a', '#33383f', '#4a4a44'],
        rightLeg: ['#3d3d3a', '#33383f', '#4a4a44'],
        hat: ['#4a5a4a', '#3f4f3f'],
      },
    },
  ],
};

/** 1965 — smart-casual with mod influences, brighter accents. */
const CONFIG_1965: EraPedestrianConfig = {
  count: 30,
  variants: [
    {
      id: '1965-mod-suit',
      label: 'Mod suit',
      torsoWidth: 1.05,
      torsoHeight: 1.02,
      legLength: 1.02,
      hat: 'none',
      hair: 'flat',
      accessory: 'none',
      weight: 4,
      colorPools: {
        torso: ['#3f7d8c', '#2f6f6a', '#5a7d8c', '#3f6f8c', '#4a6f7a'],
        leftLeg: ['#2f5a5a', '#3a5f6f', '#334f5a', '#2f4f4a'],
        rightLeg: ['#2f5a5a', '#3a5f6f', '#334f5a', '#2f4f4a'],
      },
    },
    {
      id: '1965-shift-dress',
      label: 'Shift dress',
      torsoWidth: 1.05,
      torsoHeight: 1.4,
      legLength: 0.55,
      hat: 'pillbox',
      hair: 'bob',
      accessory: 'handbag',
      weight: 5,
      colorPools: {
        torso: [
          '#d9a441',
          '#d96f41',
          '#d94a6f',
          '#4aa4d9',
          '#7ad941',
          '#d941a4',
        ],
        leftLeg: ['#e8c9a4', '#f0d0b0', '#d9b090'],
        rightLeg: ['#e8c9a4', '#f0d0b0', '#d9b090'],
        hat: ['#d9a441', '#d96f41', '#e8e3d8', '#d94a6f'],
        accessory: ['#d9a441', '#d96f41', '#4aa4d9'],
      },
    },
    {
      id: '1965-mod-dress',
      label: 'A-line mod dress',
      torsoWidth: 1.1,
      torsoHeight: 1.32,
      legLength: 0.5,
      hat: 'none',
      hair: 'ponytail',
      accessory: 'handbag',
      weight: 3,
      colorPools: {
        torso: ['#2f6f8c', '#d94a6f', '#7a8c4a', '#8c2f6f', '#d96f41'],
        leftLeg: ['#e0c0a0', '#d9b090'],
        rightLeg: ['#e0c0a0', '#d9b090'],
        accessory: ['#2f6f8c', '#d94a6f'],
      },
    },
    {
      id: '1965-casual',
      label: 'Smart casual',
      torsoWidth: 1.0,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'flatcap',
      hair: 'flat',
      accessory: 'none',
      weight: 3,
      colorPools: {
        torso: ['#d9a441', '#3f7d8c', '#8a7a5a', '#d96f41', '#4a7a5a'],
        leftLeg: ['#4a5a4a', '#5a5a52', '#3f4f3f'],
        rightLeg: ['#4a5a4a', '#5a5a52', '#3f4f3f'],
        hat: ['#5a5a52', '#4a5a4a', '#6a5a4a'],
      },
    },
  ],
};

/** 1985 — bold 80s fashion, shoulder silhouettes, denim, bright colours, big hair. */
const CONFIG_1985: EraPedestrianConfig = {
  count: 34,
  variants: [
    {
      id: '1985-power-suit',
      label: 'Power suit',
      torsoWidth: 1.5,
      torsoHeight: 1.02,
      legLength: 1.0,
      shoulderPads: true,
      hat: 'none',
      hair: 'big',
      accessory: 'camera',
      weight: 4,
      colorPools: {
        torso: [
          '#ff2d95',
          '#7a3bff',
          '#00bfff',
          '#e63946',
          '#ff8c00',
          '#2d9bff',
        ],
        leftLeg: ['#2b3a4a', '#3a2b4a', '#4a2b3a', '#2b3a3a'],
        rightLeg: ['#2b3a4a', '#3a2b4a', '#4a2b3a', '#2b3a3a'],
        accessory: ['#2b3a4a', '#4a2b3a'],
      },
    },
    {
      id: '1985-denim',
      label: 'Denim jacket & jeans',
      torsoWidth: 1.2,
      torsoHeight: 1.0,
      legLength: 1.0,
      shoulderPads: true,
      hat: 'none',
      hair: 'big',
      accessory: 'none',
      weight: 4,
      colorPools: {
        torso: ['#3a5a8c', '#4a6a9a', '#2f4f7a', '#5a7aa4'],
        leftLeg: ['#3a5a8c', '#4a6a9a', '#2f4f7a'],
        rightLeg: ['#3a5a8c', '#4a6a9a', '#2f4f7a'],
      },
    },
    {
      id: '1985-neon',
      label: 'Neon streetwear',
      torsoWidth: 1.15,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'none',
      hair: 'big',
      accessory: 'phone',
      weight: 3,
      colorPools: {
        torso: ['#00e5ff', '#ff2d95', '#b1ff2d', '#ff5a2d', '#7a3bff'],
        leftLeg: ['#1a1030', '#2b1a4a', '#3a2b5a', '#1a2b3a'],
        rightLeg: ['#1a1030', '#2b1a4a', '#3a2b5a', '#1a2b3a'],
        accessory: ['#1a1030', '#2b1a4a'],
      },
    },
    {
      id: '1985-leather',
      label: 'Leather jacket',
      torsoWidth: 1.25,
      torsoHeight: 1.02,
      legLength: 1.0,
      shoulderPads: true,
      hat: 'none',
      hair: 'big',
      accessory: 'none',
      weight: 2,
      colorPools: {
        torso: ['#2b2b33', '#3a3a44', '#4a2b2b', '#2b2b44'],
        leftLeg: ['#2b2b33', '#3a3a44', '#33333d'],
        rightLeg: ['#2b2b33', '#3a3a44', '#33333d'],
      },
    },
  ],
};

/** 2005 — casual 2000s streetwear, hoodies, low-rise denim, early tech. */
const CONFIG_2005: EraPedestrianConfig = {
  count: 38,
  variants: [
    {
      id: '2005-hoodie',
      label: 'Hoodie & low-rise',
      torsoWidth: 1.15,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'none',
      hair: 'flat',
      accessory: 'flip',
      weight: 4,
      colorPools: {
        torso: [
          '#5a7a8c',
          '#8c5a7a',
          '#6a8c5a',
          '#8c8c5a',
          '#4a6a8c',
          '#7a7a7a',
        ],
        leftLeg: ['#3a5a8c', '#4a6a9a', '#2f4f7a', '#5a6a8c'],
        rightLeg: ['#3a5a8c', '#4a6a9a', '#2f4f7a', '#5a6a8c'],
        accessory: ['#2f2f2f', '#3a3a3a', '#e0e8ec'],
      },
    },
    {
      id: '2005-track',
      label: 'Track suit',
      torsoWidth: 1.1,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'cap',
      hair: 'short',
      accessory: 'phone',
      weight: 3,
      colorPools: {
        torso: ['#b8c4cc', '#8fb7c9', '#7a9aa8', '#c9c9b8', '#a8a8b8'],
        leftLeg: ['#5a6a7a', '#6a7a8a', '#4a5a6a', '#7a8a9a'],
        rightLeg: ['#5a6a7a', '#6a7a8a', '#4a5a6a', '#7a8a9a'],
        hat: ['#5a6a7a', '#6a7a8a', '#4a5a6a'],
      },
    },
    {
      id: '2005-polo',
      label: 'Polo & denim',
      torsoWidth: 1.0,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'none',
      hair: 'short',
      accessory: 'none',
      weight: 3,
      colorPools: {
        torso: ['#2f6f8f', '#5a8f9a', '#7a9a6a', '#9a7a5a', '#c94a6f'],
        leftLeg: ['#3a5a8c', '#4a6a9a', '#2f4f7a'],
        rightLeg: ['#3a5a8c', '#4a6a9a', '#2f4f7a'],
      },
    },
    {
      id: '2005-skater',
      label: 'Skater & cargo',
      torsoWidth: 1.05,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'cap',
      hair: 'long',
      accessory: 'flip',
      weight: 2,
      colorPools: {
        torso: ['#4a6a8c', '#8c6a4a', '#6a7a8c', '#5a8c6a', '#8c4a5a'],
        leftLeg: ['#6a7a4a', '#7a6a4a', '#5a6a4a', '#8a8a6a'],
        rightLeg: ['#6a7a4a', '#7a6a4a', '#5a6a4a', '#8a8a6a'],
        hat: ['#6a7a4a', '#7a6a4a', '#4a5a6a'],
      },
    },
  ],
};

/** 2025 — contemporary athleisure, smart devices, masks/earbuds, varied streetwear. */
const CONFIG_2025: EraPedestrianConfig = {
  count: 44,
  variants: [
    {
      id: '2025-athleisure',
      label: 'Athleisure',
      torsoWidth: 1.1,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'none',
      hair: 'flat',
      accessory: 'earbuds',
      weight: 4,
      colorPools: {
        torso: [
          '#1f2a44',
          '#4f6d8a',
          '#2f4f6f',
          '#5a6a8c',
          '#3a4a6a',
          '#6a7a8a',
        ],
        leftLeg: ['#2b3450', '#3a4460', '#2f3f5a', '#4a5470'],
        rightLeg: ['#2b3450', '#3a4460', '#2f3f5a', '#4a5470'],
        accessory: ['#1f1f1f', '#2f2f2f'],
      },
    },
    {
      id: '2025-puffer',
      label: 'Puffer jacket',
      torsoWidth: 1.3,
      torsoHeight: 1.02,
      legLength: 1.0,
      hat: 'none',
      hair: 'long',
      accessory: 'smartphone',
      weight: 3,
      colorPools: {
        torso: ['#4f6d8a', '#8a5a6a', '#5a8a7a', '#6a5a8a', '#8a8a5a'],
        leftLeg: ['#2b3450', '#3a4460', '#2f3f5a'],
        rightLeg: ['#2b3450', '#3a4460', '#2f3f5a'],
        accessory: ['#1f1f1f', '#2f2f2f', '#e0e8ec'],
      },
    },
    {
      id: '2025-mask',
      label: 'Masked streetwear',
      torsoWidth: 1.15,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'cap',
      hair: 'short',
      accessory: 'mask',
      weight: 3,
      colorPools: {
        torso: ['#2f4f6f', '#4a6a8a', '#5a6a7a', '#3a4a6a', '#6a7a8a'],
        leftLeg: ['#2b3450', '#3a4460', '#2f3f5a'],
        rightLeg: ['#2b3450', '#3a4460', '#2f3f5a'],
        hat: ['#2b3450', '#3a4460', '#1f2a44'],
        accessory: ['#d8dee6', '#c9d4de', '#9fb4c8'],
      },
    },
    {
      id: '2025-hoodie',
      label: 'Modern hoodie',
      torsoWidth: 1.2,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'none',
      hair: 'ponytail',
      accessory: 'coffee',
      weight: 3,
      colorPools: {
        torso: ['#4f6d8a', '#6a4f8a', '#5a8a6a', '#8a5a4f', '#3a4a6a'],
        leftLeg: ['#2b3450', '#3a4460', '#2f3f5a', '#4a5470'],
        rightLeg: ['#2b3450', '#3a4460', '#2f3f5a', '#4a5470'],
        accessory: ['#5a3a2b', '#6a4a3a', '#e0e8ec'],
      },
    },
    {
      id: '2025-tech',
      label: 'Techwear',
      torsoWidth: 1.1,
      torsoHeight: 1.0,
      legLength: 1.0,
      hat: 'none',
      hair: 'flat',
      accessory: 'earbuds',
      weight: 2,
      colorPools: {
        torso: ['#1f2a44', '#2f3f5a', '#3a4a6a', '#2b3450'],
        leftLeg: ['#1f2a44', '#2f3f5a', '#3a4a6a'],
        rightLeg: ['#1f2a44', '#2f3f5a', '#3a4a6a'],
        accessory: ['#1f1f1f', '#2f2f2f'],
      },
    },
  ],
};

/** Registry of pedestrian configs keyed by era. */
export const PEDESTRIAN_CONFIG: Record<EraId, EraPedestrianConfig> = {
  1945: CONFIG_1945,
  1965: CONFIG_1965,
  1985: CONFIG_1985,
  2005: CONFIG_2005,
  2025: CONFIG_2025,
};

/** Shared skin / hair pools reused across every era. */
export const SHARED_POOLS = { skins: SKINS, hairs: HAIRS };
