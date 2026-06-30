/**
 * Year configuration schema and data for the time-period city.
 *
 * Each entry centralizes the visual and narrative rules that change per year.
 * All values are plain serializable data (no functions, no Three.js objects)
 * so downstream procedural systems can consume them as static config.
 */

/** A single building style descriptor used by the procedural building system. */
export interface BuildingStyle {
  /** Internal style id used to pick a generator. */
  id: string;
  /** Human-readable name for debugging / UI. */
  name: string;
  /** Minimum number of floors for buildings of this style. */
  minFloors: number;
  /** Maximum number of floors for buildings of this style. */
  maxFloors: number;
  /** Facade color palette (hex strings). */
  facadeColors: string[];
  /** Roof color palette (hex strings). */
  roofColors: string[];
  /** Window style id consumed by the window generator. */
  windowStyle: string;
}

/** A vehicle type descriptor used by the vehicle system. */
export interface VehicleType {
  /** Internal vehicle id. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Relative spawn weight (higher = more common). */
  weight: number;
  /** Body color palette (hex strings). */
  bodyColors: string[];
}

/** A storefront descriptor used by the storefront/prop system. */
export interface Storefront {
  /** Storefront name shown on signage. */
  name: string;
  /** Signage color (hex string). */
  signColor: string;
  /** Awning / accent color (hex string). */
  accentColor: string;
}

/** An advertisement descriptor used by the ad/billboard system. */
export interface AdCopy {
  /** Short headline text for the ad. */
  headline: string;
  /** Optional sub-text shown beneath the headline. */
  subtext: string;
  /** Background color for the ad panel (hex string). */
  backgroundColor: string;
  /** Text color for the ad panel (hex string). */
  textColor: string;
}

/** A pedestrian outfit palette used by the pedestrian system. */
export interface PedestrianOutfit {
  /** Outfit style id. */
  id: string;
  /** Shirt / top color palette (hex strings). */
  topColors: string[];
  /** Pants / bottom color palette (hex strings). */
  bottomColors: string[];
}

/** Aggregate configuration for a single year in the time-period city. */
export interface YearConfig {
  /** The calendar year this config represents. */
  year: number;
  /** Short human-readable label for UI display. */
  label: string;
  /** Building styles available in this year. */
  buildings: BuildingStyle[];
  /** Vehicle types available in this year. */
  vehicles: VehicleType[];
  /** Storefronts available in this year. */
  storefronts: Storefront[];
  /** Advertisements available in this year. */
  ads: AdCopy[];
  /** Pedestrian outfit palettes available in this year. */
  pedestrianOutfits: PedestrianOutfit[];
}

/**
 * The canonical list of year configurations, ordered chronologically.
 * Exactly five entries: 1945, 1965, 1985, 2005, 2025.
 */
export const YEARS: readonly YearConfig[] = [
  {
    year: 1945,
    label: 'Post-War Boom',
    buildings: [
      {
        id: 'brick-walkup',
        name: 'Brick Walkup',
        minFloors: 3,
        maxFloors: 6,
        facadeColors: ['#8b4513', '#a0522d', '#6b4226'],
        roofColors: ['#3e2723', '#4e342e'],
        windowStyle: 'double-hung',
      },
      {
        id: 'art-deco',
        name: 'Art Deco',
        minFloors: 5,
        maxFloors: 12,
        facadeColors: ['#d7ccc8', '#bcaaa4', '#9e9e9e'],
        roofColors: ['#37474f', '#263238'],
        windowStyle: 'grid',
      },
    ],
    vehicles: [
      {
        id: 'sedan-40s',
        name: 'Classic Sedan',
        weight: 10,
        bodyColors: ['#1a1a1a', '#3b2f2f', '#1e3a5f'],
      },
      {
        id: 'truck-40s',
        name: 'Delivery Truck',
        weight: 4,
        bodyColors: ['#4e342e', '#37474f'],
      },
    ],
    storefronts: [
      { name: 'Diner', signColor: '#d32f2f', accentColor: '#fffde7' },
      { name: 'Barber', signColor: '#1565c0', accentColor: '#ffffff' },
      { name: 'Bakery', signColor: '#6d4c41', accentColor: '#ffe0b2' },
    ],
    ads: [
      {
        headline: 'Victory Gardens Grow!',
        subtext: 'Plant for tomorrow',
        backgroundColor: '#2e7d32',
        textColor: '#ffffff',
      },
      {
        headline: 'Buy War Bonds',
        subtext: 'Support the troops',
        backgroundColor: '#c62828',
        textColor: '#fffde7',
      },
    ],
    pedestrianOutfits: [
      {
        id: 'suit-fedora',
        topColors: ['#37474f', '#4e342e', '#263238'],
        bottomColors: ['#1a1a1a', '#3e2723'],
      },
      {
        id: 'house-dress',
        topColors: ['#8d6e63', '#a1887f', '#bcaaa4'],
        bottomColors: ['#5d4037', '#4e342e'],
      },
    ],
  },
  {
    year: 1965,
    label: 'Space Age Optimism',
    buildings: [
      {
        id: 'mid-century-glass',
        name: 'Mid-Century Glass Tower',
        minFloors: 8,
        maxFloors: 20,
        facadeColors: ['#90a4ae', '#cfd8dc', '#78909c'],
        roofColors: ['#37474f', '#455a64'],
        windowStyle: 'ribbon',
      },
      {
        id: 'concrete-brutalist',
        name: 'Concrete Brutalist',
        minFloors: 4,
        maxFloors: 10,
        facadeColors: ['#bdbdbd', '#9e9e9e', '#757575'],
        roofColors: ['#424242', '#616161'],
        windowStyle: 'punched',
      },
    ],
    vehicles: [
      {
        id: 'muscle-car',
        name: 'Muscle Car',
        weight: 8,
        bodyColors: ['#c62828', '#1565c0', '#2e7d32', '#ff8f00'],
      },
      {
        id: 'station-wagon',
        name: 'Station Wagon',
        weight: 6,
        bodyColors: ['#37474f', '#5d4037', '#1a1a1a'],
      },
    ],
    storefronts: [
      { name: 'Diner', signColor: '#d32f2f', accentColor: '#fff59d' },
      { name: 'Records', signColor: '#7b1fa2', accentColor: '#e1bee7' },
      { name: 'Diner', signColor: '#ef6c00', accentColor: '#fff3e0' },
    ],
    ads: [
      {
        headline: 'To The Moon!',
        subtext: 'The future is now',
        backgroundColor: '#1565c0',
        textColor: '#ffffff',
      },
      {
        headline: 'Color TV Has Arrived',
        subtext: 'See the world in color',
        backgroundColor: '#6a1b9a',
        textColor: '#ffffff',
      },
    ],
    pedestrianOutfits: [
      {
        id: 'mod-suit',
        topColors: ['#1565c0', '#2e7d32', '#c62828'],
        bottomColors: ['#1a1a1a', '#37474f'],
      },
      {
        id: 'shift-dress',
        topColors: ['#f48fb1', '#fff176', '#81d4fa'],
        bottomColors: ['#5d4037', '#37474f'],
      },
    ],
  },
  {
    year: 1985,
    label: 'Neon Decade',
    buildings: [
      {
        id: 'glass-curtain-wall',
        name: 'Glass Curtain Wall',
        minFloors: 12,
        maxFloors: 30,
        facadeColors: ['#4fc3f7', '#81d4fa', '#26c6da'],
        roofColors: ['#263238', '#37474f'],
        windowStyle: 'curtain',
      },
      {
        id: 'postmodern',
        name: 'Postmodern Office',
        minFloors: 6,
        maxFloors: 15,
        facadeColors: ['#b0bec5', '#eceff1', '#cfd8dc'],
        roofColors: ['#546e7a', '#455a64'],
        windowStyle: 'grid',
      },
    ],
    vehicles: [
      {
        id: 'boxy-sedan',
        name: 'Boxy Sedan',
        weight: 9,
        bodyColors: ['#37474f', '#b71c1c', '#1a237e', '#1b5e20'],
      },
      {
        id: 'hatchback',
        name: 'Hatchback',
        weight: 5,
        bodyColors: ['#fbc02d', '#cfd8dc', '#424242'],
      },
    ],
    storefronts: [
      { name: 'Arcade', signColor: '#e91e63', accentColor: '#18ffff' },
      { name: 'Video', signColor: '#aa00ff', accentColor: '#ffea00' },
      { name: 'Pizza', signColor: '#d32f2f', accentColor: '#ffeb3b' },
    ],
    ads: [
      {
        headline: 'The Future Is Digital',
        subtext: 'Computers for everyone',
        backgroundColor: '#00838f',
        textColor: '#00e5ff',
      },
      {
        headline: 'Have A Coke And A Smile',
        subtext: 'It\u2019s the real thing',
        backgroundColor: '#b71c1c',
        textColor: '#ffffff',
      },
    ],
    pedestrianOutfits: [
      {
        id: 'power-suit',
        topColors: ['#1a1a1a', '#37474f', '#4e342e'],
        bottomColors: ['#1a1a1a', '#263238'],
      },
      {
        id: 'aerobics',
        topColors: ['#ff4081', '#00e5ff', '#ffea00'],
        bottomColors: ['#6a1b9a', '#00838f'],
      },
    ],
  },
  {
    year: 2005,
    label: 'Dot-Com Era',
    buildings: [
      {
        id: 'eco-glass-tower',
        name: 'Eco Glass Tower',
        minFloors: 15,
        maxFloors: 40,
        facadeColors: ['#81c784', '#a5d6a7', '#b2dfdb'],
        roofColors: ['#1b5e20', '#00695c'],
        windowStyle: 'curtain',
      },
      {
        id: 'loft-conversion',
        name: 'Loft Conversion',
        minFloors: 4,
        maxFloors: 8,
        facadeColors: ['#bcaaa4', '#a1887f', '#8d6e63'],
        roofColors: ['#3e2723', '#4e342e'],
        windowStyle: 'industrial',
      },
    ],
    vehicles: [
      {
        id: 'suv',
        name: 'SUV',
        weight: 10,
        bodyColors: ['#37474f', '#5d4037', '#1a1a1a', '#b0bec5'],
      },
      {
        id: 'hybrid-sedan',
        name: 'Hybrid Sedan',
        weight: 7,
        bodyColors: ['#cfd8dc', '#1b5e20', '#1565c0'],
      },
    ],
    storefronts: [
      { name: 'Cafe', signColor: '#5d4037', accentColor: '#a1887f' },
      { name: 'Wireless', signColor: '#1565c0', accentColor: '#bbdefb' },
      { name: 'Organic', signColor: '#2e7d32', accentColor: '#c8e6c9' },
    ],
    ads: [
      {
        headline: 'Stay Connected',
        subtext: 'The web is everywhere',
        backgroundColor: '#1565c0',
        textColor: '#ffffff',
      },
      {
        headline: 'Think Green',
        subtext: 'A sustainable future',
        backgroundColor: '#2e7d32',
        textColor: '#ffffff',
      },
    ],
    pedestrianOutfits: [
      {
        id: 'business-casual',
        topColors: ['#1565c0', '#2e7d32', '#5d4037'],
        bottomColors: ['#37474f', '#1a1a1a', '#5d4037'],
      },
      {
        id: 'streetwear',
        topColors: ['#ef5350', '#42a5f5', '#66bb6a'],
        bottomColors: ['#1a1a1a', '#37474f'],
      },
    ],
  },
  {
    year: 2025,
    label: 'Smart City',
    buildings: [
      {
        id: 'parametric-tower',
        name: 'Parametric Tower',
        minFloors: 20,
        maxFloors: 60,
        facadeColors: ['#e0f7fa', '#e8eaf6', '#f3e5f5'],
        roofColors: ['#006064', '#1a237e'],
        windowStyle: 'smart-glass',
      },
      {
        id: 'mass-timber',
        name: 'Mass Timber Hybrid',
        minFloors: 8,
        maxFloors: 18,
        facadeColors: ['#d7ccc8', '#a1887f', '#81c784'],
        roofColors: ['#33691e', '#1b5e20'],
        windowStyle: 'curtain',
      },
    ],
    vehicles: [
      {
        id: 'ev-sedan',
        name: 'Electric Sedan',
        weight: 10,
        bodyColors: ['#e0e0e0', '#1a1a1a', '#1565c0', '#cfd8dc'],
      },
      {
        id: 'autonomous-pod',
        name: 'Autonomous Pod',
        weight: 6,
        bodyColors: ['#f5f5f5', '#b0bec5', '#e1f5fe'],
      },
    ],
    storefronts: [
      { name: 'Robotaxi', signColor: '#00bcd4', accentColor: '#e0f7fa' },
      { name: 'Studio', signColor: '#7c4dff', accentColor: '#e8eaf6' },
      { name: 'Market', signColor: '#00c853', accentColor: '#a5d6a7' },
    ],
    ads: [
      {
        headline: 'Ride Autonomously',
        subtext: 'Your journey, automated',
        backgroundColor: '#006064',
        textColor: '#00e5ff',
      },
      {
        headline: 'Carbon Neutral By 2030',
        subtext: 'Powering a greener grid',
        backgroundColor: '#1b5e20',
        textColor: '#b9f6ca',
      },
    ],
    pedestrianOutfits: [
      {
        id: 'techwear',
        topColors: ['#263238', '#37474f', '#006064'],
        bottomColors: ['#1a1a1a', '#263238'],
      },
      {
        id: 'athleisure',
        topColors: ['#26c6da', '#66bb6a', '#ff7043'],
        bottomColors: ['#37474f', '#1a1a1a'],
      },
    ],
  },
] as const;

/** Lookup map from year number to its config. */
export const YEARS_BY_NUMBER: ReadonlyMap<number, YearConfig> = new Map(
  YEARS.map((config) => [config.year, config]),
);

/**
 * Retrieve a YearConfig by its year number.
 * @param year - The calendar year to look up.
 * @returns The matching YearConfig, or undefined if not found.
 */
export function getYearConfig(year: number): YearConfig | undefined {
  return YEARS_BY_NUMBER.get(year);
}
