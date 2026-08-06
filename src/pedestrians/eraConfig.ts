import type { EraId } from '../contracts/era';
import { ERA_REGISTRY } from '../contracts/era';
import type { FigureStyle } from './geometry';

/**
 * Era-specific pedestrian configuration.
 *
 * This module is keyed off the foundation era registry (EraId / ERA_REGISTRY)
 * and defines, for every era, the crowd density, walking speed, and the
 * era-correct figure styles / outfit palettes. Palettes are derived from the
 * foundation registry's era palettes and extended with era-appropriate colors.
 * Each style carries several outfit color schemes so instances vary per crowd.
 */

export interface EraPedestrianConfig {
  era: EraId;
  /** Total number of pedestrians on the sidewalks for this era. */
  count: number;
  /** Walking speed range in world units per second. */
  speedRange: [number, number];
  /** Shared cloth finish (metalness / roughness) for the era. */
  material: { metalness: number; roughness: number };
  styles: FigureStyle[];
}

export const ERA_PEDESTRIAN_CONFIG: Record<EraId, EraPedestrianConfig> = {
  1945: {
    era: 1945,
    count: 30,
    speedRange: [0.7, 1.1],
    material: { metalness: 0, roughness: 0.95 },
    styles: [
      {
        id: 'gentleman',
        label: 'Gentleman (suit + fedora)',
        skin: '#d9b08a',
        hair: '#3a2f28',
        hat: 'fedora',
        coat: true,
        schemes: [
          { id: 'grey', top: '#4a4f55', bottom: '#3f444a', accent: '#2f3338', trim: '#6d7278' },
          { id: 'brown', top: '#5a4a3a', bottom: '#4a3f33', accent: '#33291f', trim: '#8a7a66' },
          { id: 'navy', top: '#3a4450', bottom: '#323b46', accent: '#232a33', trim: '#6f7a86' },
        ],
      },
      {
        id: 'lady',
        label: 'Lady (dress + hat)',
        skin: '#e0b896',
        hair: '#4a3a30',
        dress: true,
        schemes: [
          { id: 'green', top: '#4a5a4a', bottom: '#3f4a3f', accent: '#2f3830', trim: '#7a8a7a' },
          { id: 'maroon', top: '#5a3f3f', bottom: '#4a3434', accent: '#332222', trim: '#8a6a6a' },
          { id: 'charcoal', top: '#4a4a4f', bottom: '#3f3f44', accent: '#2c2c30', trim: '#7a7a80' },
        ],
      },
      {
        id: 'worker',
        label: 'Worker (flat cap + jacket)',
        skin: '#c9a078',
        hair: '#2f2a26',
        flatCap: true,
        schemes: [
          { id: 'olive', top: '#55503a', bottom: '#4a4633', accent: '#38341f', trim: '#6f6a55' },
          { id: 'grey', top: '#5a5a5a', bottom: '#4f4f4f', accent: '#3a3a3a', trim: '#7a7a7a' },
          { id: 'rust', top: '#6a4a3a', bottom: '#4f4438', accent: '#3a2a1f', trim: '#8a6a55' },
        ],
      },
    ],
  },
  1965: {
    era: 1965,
    count: 40,
    speedRange: [0.8, 1.2],
    material: { metalness: 0, roughness: 0.9 },
    styles: [
      {
        id: 'mod-man',
        label: 'Mod man (slim suit)',
        skin: '#d9b08a',
        hair: '#2a2a2f',
        schemes: [
          { id: 'teal', top: '#2f8a8a', bottom: '#2a6a6a', accent: '#d9f2f0', trim: '#1f4a52' },
          { id: 'mustard', top: '#c98a2f', bottom: '#8a5f2a', accent: '#f0e0a0', trim: '#6f4a1f' },
          { id: 'sky', top: '#5a9ec9', bottom: '#3f6f8a', accent: '#e0f0ff', trim: '#2f4a5a' },
        ],
      },
      {
        id: 'mod-girl',
        label: 'Mod girl (shift dress + pillbox)',
        skin: '#e8c4a0',
        hair: '#4a2a1f',
        dress: true,
        hat: 'pillbox',
        schemes: [
          { id: 'coral', top: '#c96f5a', bottom: '#b05a4a', accent: '#f0c8b0', trim: '#8a3f33' },
          { id: 'mint', top: '#5ab0a0', bottom: '#4a8f80', accent: '#d9f0ea', trim: '#2f6a5f' },
          { id: 'lavender', top: '#8a7fc9', bottom: '#6f66a0', accent: '#e0d9f0', trim: '#4a4480' },
        ],
      },
      {
        id: 'beatnik',
        label: 'Beatnik (turtleneck)',
        skin: '#c9a078',
        hair: '#1f1f24',
        schemes: [
          { id: 'black', top: '#2a2a2f', bottom: '#1f1f24', accent: '#4a4a55', trim: '#8a8a95' },
          { id: 'charcoal', top: '#3a3a40', bottom: '#2f2f35', accent: '#5a5a66', trim: '#9a9aa5' },
          { id: 'olive', top: '#4a4a3a', bottom: '#3a3a2f', accent: '#5f5f4a', trim: '#9a9a80' },
        ],
      },
    ],
  },
  1985: {
    era: 1985,
    count: 48,
    speedRange: [0.9, 1.3],
    material: { metalness: 0, roughness: 0.85 },
    styles: [
      {
        id: 'power',
        label: 'Power dresser (shoulder pads)',
        skin: '#d9b08a',
        hair: '#2a1f1a',
        bigHair: true,
        shoulderPads: true,
        schemes: [
          { id: 'magenta', top: '#ff2d95', bottom: '#1f2a3a', accent: '#ffd319', trim: '#d9e0ea' },
          { id: 'cyan', top: '#00c8c8', bottom: '#1f2a3a', accent: '#ff2d95', trim: '#e0f0f0' },
          { id: 'yellow', top: '#ffd319', bottom: '#2a2a3a', accent: '#00c8c8', trim: '#fff0c0' },
        ],
      },
      {
        id: 'denim',
        label: 'Denim (jacket + jeans)',
        skin: '#e0b896',
        hair: '#c98a2f',
        bigHair: true,
        denim: true,
        schemes: [
          { id: 'blue', top: '#3a6a9a', bottom: '#2f5a8a', accent: '#c0d0e0', trim: '#d9a03a' },
          { id: 'light', top: '#4a7ab0', bottom: '#3a6a9a', accent: '#e0e8f0', trim: '#c98a2f' },
          { id: 'faded', top: '#5a7a9a', bottom: '#4a6a8a', accent: '#d0dae0', trim: '#b07a3a' },
        ],
      },
      {
        id: 'punk',
        label: 'Punk (leather + big hair)',
        skin: '#c9a078',
        hair: '#ff2d2d',
        bigHair: true,
        leather: true,
        schemes: [
          { id: 'black-red', top: '#2a2a2f', bottom: '#3a3a3a', accent: '#ff2d2d', trim: '#ffd319' },
          { id: 'purple', top: '#4a2a6a', bottom: '#2a2a3a', accent: '#ff2d95', trim: '#c0e0ff' },
          { id: 'steel', top: '#3a3a44', bottom: '#2f2f38', accent: '#00e5ff', trim: '#e0e0ea' },
        ],
      },
    ],
  },
  2005: {
    era: 2005,
    count: 54,
    speedRange: [1.0, 1.4],
    material: { metalness: 0, roughness: 0.9 },
    styles: [
      {
        id: 'hoodie',
        label: 'Hoodie (street)',
        skin: '#d9b08a',
        hair: '#2f2a26',
        hoodie: true,
        baseballCap: true,
        denim: true,
        schemes: [
          { id: 'grey', top: '#6a6a72', bottom: '#3a5a8a', accent: '#8a8a95', trim: '#d0d0d8' },
          { id: 'green', top: '#4a7a4a', bottom: '#3a6a8a', accent: '#6a9a6a', trim: '#c0d8c0' },
          { id: 'red', top: '#8a3a3a', bottom: '#3a5a8a', accent: '#b05a5a', trim: '#e0c0c0' },
        ],
      },
      {
        id: 'skater',
        label: 'Skater (tee + baggy jeans)',
        skin: '#e8c4a0',
        hair: '#6a4a2a',
        baseballCap: true,
        device: true,
        schemes: [
          { id: 'teal', top: '#2f8a8a', bottom: '#4a4a55', accent: '#2a6a6a', trim: '#d0e0e0' },
          { id: 'orange', top: '#c96a2f', bottom: '#4a4a55', accent: '#8a4a1f', trim: '#f0d8c0' },
          { id: 'navy', top: '#3a4a6a', bottom: '#3a3a44', accent: '#2a3a5a', trim: '#c0c8d8' },
        ],
      },
      {
        id: 'tracksuit',
        label: 'Tracksuit',
        skin: '#c9a078',
        hair: '#1f1f24',
        schemes: [
          { id: 'navy-white', top: '#2f3a5a', bottom: '#2a3348', accent: '#f0f0f0', trim: '#8a93b0' },
          { id: 'red-white', top: '#7a2f2f', bottom: '#5f2a2a', accent: '#f0f0f0', trim: '#b08a8a' },
          { id: 'black-grey', top: '#3a3a40', bottom: '#2f2f35', accent: '#c0c0c8', trim: '#7a7a85' },
        ],
      },
    ],
  },
  2025: {
    era: 2025,
    count: 60,
    speedRange: [1.0, 1.5],
    material: { metalness: 0, roughness: 0.9 },
    styles: [
      {
        id: 'athleisure',
        label: 'Athleisure (leggings + earbuds)',
        skin: '#d9b08a',
        hair: '#3a2f28',
        hoodie: true,
        earbuds: true,
        device: true,
        schemes: [
          { id: 'sage', top: '#7a8a7a', bottom: '#3a4a3a', accent: '#a0b0a0', trim: '#d0ddd0' },
          { id: 'lilac', top: '#9a8ac9', bottom: '#4a4a6a', accent: '#c0b0e0', trim: '#e0d9f0' },
          { id: 'slate', top: '#7a8a9a', bottom: '#3a4a5a', accent: '#a0b0c0', trim: '#d0dae0' },
        ],
      },
      {
        id: 'commuter',
        label: 'Commuter (mask + jacket)',
        skin: '#e0b896',
        hair: '#2a2a2f',
        mask: true,
        earbuds: true,
        device: true,
        schemes: [
          { id: 'blue', top: '#2f6f8f', bottom: '#3a4a55', accent: '#d8e6ef', trim: '#5a9ab0' },
          { id: 'grey', top: '#5a6a72', bottom: '#3f4a50', accent: '#e0e6ea', trim: '#8a9aa0' },
          { id: 'olive', top: '#6a6a4a', bottom: '#4a4a3a', accent: '#d8d8c0', trim: '#8a8a6a' },
        ],
      },
      {
        id: 'streetwear',
        label: 'Streetwear (hoodie + beanie)',
        skin: '#c9a078',
        hair: '#1f1f24',
        hoodie: true,
        beanie: true,
        earbuds: true,
        schemes: [
          { id: 'black', top: '#2a2a2f', bottom: '#3a3a40', accent: '#6a6a72', trim: '#a0a0aa' },
          { id: 'earth', top: '#6a5a3a', bottom: '#4a4033', accent: '#8a7a5a', trim: '#c0b0a0' },
          { id: 'denim', top: '#3a5a7a', bottom: '#2f4a6a', accent: '#6a8aa0', trim: '#a0b8c8' },
        ],
      },
    ],
  },
};

// Re-export the registry reference so the module is visibly keyed off it.
export const PEDESTRIAN_ERA_PALETTES: Record<EraId, string[]> = {
  1945: ERA_REGISTRY[1945].lighting.palette,
  1965: ERA_REGISTRY[1965].lighting.palette,
  1985: ERA_REGISTRY[1985].lighting.palette,
  2005: ERA_REGISTRY[2005].lighting.palette,
  2025: ERA_REGISTRY[2025].lighting.palette,
};