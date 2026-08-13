import * as THREE from 'three';

// Era configurations for all five years
export const eraConfigs = {
  '1945': {
    year: 1945,
    buildingColors: {
      primary: '#8B4513', // Brownstone/brick
      secondary: '#A0522D',
    },
    vehicleStyles: ['vintage1940s'],
    storefrontStyle: 'art_deco',
    billboardStyle: 'retro',
    pedestrianOutfit: '1940s',
    buildingHeightFactor: 2.5,
    vehicleDensity: 0.8,
    pedestrianDensity: 1.2,
  },
  '1965': {
    year: 1965,
    buildingColors: {
      primary: '#D2691E', // Orange brick
      secondary: '#F0E68C',
    },
    vehicleStyles: ['vintage1960s'],
    storefrontStyle: 'mid_century',
    billboardStyle: 'neon',
    pedestrianOutfit: '1960s',
    buildingHeightFactor: 3.0,
    vehicleDensity: 1.0,
    pedestrianDensity: 1.0,
  },
  '1985': {
    year: 1985,
    buildingColors: {
      primary: '#8B0000', // Red brick
      secondary: '#FFD700',
    },
    vehicleStyles: ['vintage1980s'],
    storefrontStyle: '80s_commercial',
    billboardStyle: 'digital',
    pedestrianOutfit: '1980s',
    buildingHeightFactor: 3.5,
    vehicleDensity: 1.2,
    pedestrianDensity: 0.8,
  },
  '2005': {
    year: 2005,
    buildingColors: {
      primary: '#2F4F4F', // Dark slate
      secondary: '#5F9EA0',
    },
    vehicleStyles: ['early2000s'],
    storefrontStyle: 'modern',
    billboardStyle: 'led',
    pedestrianOutfit: 'early2000s',
    buildingHeightFactor: 4.0,
    vehicleDensity: 1.5,
    pedestrianDensity: 0.6,
  },
  '2025': {
    year: 2025,
    buildingColors: {
      primary: '#1A1A2E', // Dark blue-gray
      secondary: '#16213E',
    },
    vehicleStyles: ['modern_ev'],
    storefrontStyle: 'contemporary',
    billboardStyle: 'digital',
    pedestrianOutfit: 'modern',
    buildingHeightFactor: 4.5,
    vehicleDensity: 2.0,
    pedestrianDensity: 0.4,
  },
} as const;

export type EraKey = keyof typeof eraConfigs;
export type EraConfig = typeof eraConfigs[EraKey];

// Helper to get era config by year number
export function getEraConfig(year: number): EraConfig | undefined {
  return eraConfigs[`${year}` as EraKey];
}

// Era transition animation settings
export const eraTransition = {
  duration: 1000, // ms
  fadeOut: 500, // ms
  fadeIn: 500, // ms
  resetPosition: true,
} as const;