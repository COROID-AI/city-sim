import type { TimePeriod } from './types';

/**
 * The six historical eras of the city block. Ordered from oldest (1900) to
 * newest (2050); the timeline slider and autoplay loop traverse this order.
 */
export const TIME_PERIODS: TimePeriod[] = [
  {
    id: '1900',
    label: 'Turn of the Century',
    shortLabel: '1900',
    year: 1900,
    description: 'Horse carts, gas lamps, and quiet brick storefronts.',
    progress: 0,
    order: 0.35,
    lampDensity: 0.45,
    windowGlow: 0.5,
    haze: 0.28,
    neon: 0,
    billboards: 1,
    trees: 6,
    scale: [1, 0.62, 1],
    facadeTile: 1.4,
    palette: {
      sky: '#b99c74',
      skyZenith: '#7a86a8',
      sun: '#f2c9a0',
      ambient: '#8a735f',
      fill: '#9a8f78',
      facade: '#9a7b5e',
      roof: '#4f3a2c',
      sidewalk: '#8a7a68',
      asphalt: '#5b534b',
      lanePaint: '#c9bea8',
      crosswalk: '#cfc4ad',
    },
    vehicles: {
      color: '#4a3224',
      accent: '#241a12',
      light: '#f0c37b',
      roughness: 0.7,
    },
    sounding: {
      level: 0.75,
      tag: 'steam & soot',
      wind: 0.55,
      birds: 0.2,
      crowd: 0.25,
      traffic: 0.18,
      hum: 0.12,
      tonal: 0.2,
      sweeps: 0,
      weather: 0.15,
      mode: 0,
      lfoRate: 0.7,
    },
  },
  {
    id: '1920',
    label: 'Roaring Twenties',
    shortLabel: '1920',
    year: 1920,
    description: 'Sleek art-deco towers, electric signage, and streetcars.',
    progress: 0.2,
    order: 0.52,
    lampDensity: 0.6,
    windowGlow: 0.6,
    haze: 0.24,
    neon: 0.5,
    billboards: 3,
    trees: 9,
    scale: [1, 0.85, 1],
    facadeTile: 2.4,
    palette: {
      sky: '#a9b7c8',
      skyZenith: '#6f84b0',
      sun: '#f4cf9f',
      ambient: '#989aa0',
      fill: '#b4b3b0',
      facade: '#9b9ba6',
      roof: '#393543',
      sidewalk: '#9d9486',
      asphalt: '#4f4a46',
      lanePaint: '#e8e0c8',
      crosswalk: '#e5dcc3',
    },
    vehicles: {
      color: '#31404d',
      accent: '#161b22',
      light: '#e0c17a',
      roughness: 0.5,
    },
    sounding: {
      level: 0.55,
      tag: 'jazz & brass',
      wind: 0.4,
      birds: 0.12,
      crowd: 0.42,
      traffic: 0.28,
      hum: 0.18,
      tonal: 0.32,
      sweeps: 0,
      weather: 0.08,
      mode: 1,
      lfoRate: 1.1,
    },
  },
  {
    id: '1950',
    label: 'Postwar Boom',
    shortLabel: '1950',
    year: 1950,
    description: 'Mid-century modernity, chrome, and optimism.',
    progress: 0.4,
    order: 0.68,
    lampDensity: 0.72,
    windowGlow: 0.68,
    haze: 0.18,
    neon: 0.7,
    billboards: 5,
    trees: 12,
    scale: [1, 1.06, 1],
    facadeTile: 3.4,
    palette: {
      sky: '#9fc2d8',
      skyZenith: '#5c87b2',
      sun: '#f6dcae',
      ambient: '#96a6b2',
      fill: '#c9ced3',
      facade: '#a6b4be',
      roof: '#4b5c60',
      sidewalk: '#a8a296',
      asphalt: '#3e3b3a',
      lanePaint: '#f1e9c8',
      crosswalk: '#eef3e6',
    },
    vehicles: {
      color: '#3e7e8c',
      accent: '#c8dcee',
      light: '#f4d7a0',
      roughness: 0.45,
    },
    sounding: {
      level: 0.5,
      tag: 'chrome & radio',
      wind: 0.32,
      birds: 0.1,
      crowd: 0.5,
      traffic: 0.4,
      hum: 0.2,
      tonal: 0.28,
      sweeps: 0,
      weather: 0.06,
      mode: 1,
      lfoRate: 1.3,
    },
  },
  {
    id: '1980',
    label: 'Neon Nights',
    shortLabel: '1980',
    year: 1980,
    description: 'Synthwave glow, boxy towers, and relentless neon.',
    progress: 0.6,
    order: 0.42,
    lampDensity: 0.68,
    windowGlow: 0.85,
    haze: 0.35,
    neon: 1,
    billboards: 8,
    trees: 7,
    scale: [1, 1.34, 1],
    facadeTile: 5.2,
    palette: {
      sky: '#22163a',
      skyZenith: '#0b0c1c',
      sun: '#ff6ce0',
      ambient: '#7a4a9c',
      fill: '#e86cff',
      facade: '#523a66',
      roof: '#181024',
      sidewalk: '#6d6a76',
      asphalt: '#211f28',
      lanePaint: '#b0e0ff',
      crosswalk: '#f0c4ff',
    },
    vehicles: {
      color: '#a2b7c8',
      accent: '#3a5a76',
      light: '#5ee8ff',
      roughness: 0.38,
    },
    sounding: {
      level: 0.6,
      tag: 'synthwave',
      wind: 0.45,
      birds: 0.05,
      crowd: 0.55,
      traffic: 0.5,
      hum: 0.55,
      tonal: 0.42,
      sweeps: 0.4,
      weather: 0.16,
      mode: 0,
      lfoRate: 1.8,
    },
  },
  {
    id: '2010',
    label: 'Digital Era',
    shortLabel: '2010',
    year: 2010,
    description: 'Glass towers, LED screens, and a cleaner skyline.',
    progress: 0.8,
    order: 0.6,
    lampDensity: 0.9,
    windowGlow: 0.72,
    haze: 0.2,
    neon: 0.5,
    billboards: 10,
    trees: 16,
    scale: [1, 1.5, 1],
    facadeTile: 6.4,
    palette: {
      sky: '#9fe0e8',
      skyZenith: '#4f87b8',
      sun: '#ffe3a2',
      ambient: '#9cc7cf',
      fill: '#c9e3e8',
      facade: '#a8c4ca',
      roof: '#4e6c74',
      sidewalk: '#b8b8b0',
      asphalt: '#34363c',
      lanePaint: '#e8f0e8',
      crosswalk: '#eef4ef',
    },
    vehicles: {
      color: '#8ab0c4',
      accent: '#4b7288',
      light: '#9fd8ff',
      roughness: 0.35,
    },
    sounding: {
      level: 0.5,
      tag: 'glass & hum',
      wind: 0.3,
      birds: 0.08,
      crowd: 0.65,
      traffic: 0.6,
      hum: 0.5,
      tonal: 0.32,
      sweeps: 0.15,
      weather: 0.07,
      mode: 1,
      lfoRate: 2.1,
    },
  },
  {
    id: '2050',
    label: 'Aero City',
    shortLabel: '2050',
    year: 2050,
    description: 'Flying taxis, drone lights, and a kinetic skyline.',
    progress: 1,
    order: 0.75,
    lampDensity: 1,
    windowGlow: 0.9,
    haze: 0.12,
    neon: 0.65,
    billboards: 6,
    trees: 18,
    scale: [1, 1.9, 1],
    facadeTile: 8.4,
    palette: {
      sky: '#bfd9ff',
      skyZenith: '#5d87c8',
      sun: '#fff3c0',
      ambient: '#c2d3e8',
      fill: '#e8f2ff',
      facade: '#9fbed8',
      roof: '#3c5a74',
      sidewalk: '#cfd2d8',
      asphalt: '#2f3440',
      lanePaint: '#f0f6f0',
      crosswalk: '#e6f7ff',
    },
    vehicles: {
      color: '#cfe8f0',
      accent: '#7aa0c0',
      light: '#b8eeff',
      roughness: 0.28,
    },
    sounding: {
      level: 0.68,
      tag: 'electric hum',
      wind: 0.5,
      birds: 0.1,
      crowd: 0.72,
      traffic: 0.62,
      hum: 0.72,
      tonal: 0.4,
      sweeps: 0.42,
      weather: 0.05,
      mode: 1,
      lfoRate: 2.6,
    },
  },
];

/** Total number of eras (6). */
export const ERA_COUNT = TIME_PERIODS.length;

/** Labels in order — used by the slider rail and keyboard help. */
export const ERA_LABELS = TIME_PERIODS.map((p) => p.shortLabel);

/**
 * Linear interpolation of two hex colors in linear sRGB space. Returns a
 * `#rrggbb` string. Invalid input falls back to `#808080`.
 */
export function lerpColorHex(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const p = Math.min(1, Math.max(0, t));
  if (!pa || !pb) return '#808080';
  const ch = (i: number) =>
    Math.round(pa[i] + (pb[i] - pa[i]) * p)
      .toString(16)
      .padStart(2, '0');
  return `#${ch(0)}${ch(1)}${ch(2)}`;
}

function parseHex(hex: string): [number, number, number] | null {
  let h = hex.trim().replace('#', '');
  if (h.length === 3) {
    h = h
      .split('')
      .map((c) => c + c)
      .join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Interpolate the time-period data between two eras.
 *
 * Uses normalized progress in [0, 1] between two adjacent eras. If `from`
 * equals `to` (same era), returns a snapshot of that era. Numeric fields are
 * lerped; colors are lerped in RGB space; the palette object is recreated so
 * callers can hand it directly to uniforms/materials. Scale is lerped
 * per-axis.
 */
export function lerpTimePeriods(
  from: TimePeriod,
  to: TimePeriod,
  t: number,
): TimePeriod {
  const p = Math.min(1, Math.max(0, t));
  const lerp = (a: number, b: number) => a + (b - a) * p;
  const lerpColor = (a: string, b: string, _t?: number) => lerpColorHex(a, b, p);

  return {
    ...from,
    id: from.id,
    label: `${from.label} → ${to.label}`,
    shortLabel: from.shortLabel,
    year: Math.round(lerp(from.year, to.year)),
    progress: lerp(from.progress, to.progress),
    order: lerp(from.order, to.order),
    lampDensity: lerp(from.lampDensity, to.lampDensity),
    windowGlow: lerp(from.windowGlow, to.windowGlow),
    haze: lerp(from.haze, to.haze),
    neon: lerp(from.neon, to.neon),
    billboards: Math.round(lerp(from.billboards, to.billboards)),
    trees: Math.round(lerp(from.trees, to.trees)),
    scale: [
      lerp(from.scale[0], to.scale[0]),
      lerp(from.scale[1], to.scale[1]),
      lerp(from.scale[2], to.scale[2]),
    ] as [number, number, number],
    facadeTile: lerp(from.facadeTile, to.facadeTile),
    palette: {
      sky: lerpColor(from.palette.sky, to.palette.sky, p),
      skyZenith: lerpColor(from.palette.skyZenith, to.palette.skyZenith, p),
      sun: lerpColor(from.palette.sun, to.palette.sun, p),
      ambient: lerpColor(from.palette.ambient, to.palette.ambient, p),
      fill: lerpColor(from.palette.fill, to.palette.fill, p),
      facade: lerpColor(from.palette.facade, to.palette.facade, p),
      roof: lerpColor(from.palette.roof, to.palette.roof, p),
      sidewalk: lerpColor(from.palette.sidewalk, to.palette.sidewalk, p),
      asphalt: lerpColor(from.palette.asphalt, to.palette.asphalt, p),
      lanePaint: lerpColor(from.palette.lanePaint, to.palette.lanePaint, p),
      crosswalk: lerpColor(from.palette.crosswalk, to.palette.crosswalk, p),
    },
    vehicles: {
      color: lerpColor(from.vehicles.color, to.vehicles.color, p),
      accent: lerpColor(from.vehicles.accent, to.vehicles.accent, p),
      light: lerpColor(from.vehicles.light, to.vehicles.light, p),
      roughness: lerp(from.vehicles.roughness, to.vehicles.roughness),
    },
    sounding: {
      level: lerp(from.sounding.level, to.sounding.level),
      tag: p < 0.5 ? from.sounding.tag : to.sounding.tag,
      wind: lerp(from.sounding.wind, to.sounding.wind),
      birds: lerp(from.sounding.birds, to.sounding.birds),
      crowd: lerp(from.sounding.crowd, to.sounding.crowd),
      traffic: lerp(from.sounding.traffic, to.sounding.traffic),
      hum: lerp(from.sounding.hum, to.sounding.hum),
      tonal: lerp(from.sounding.tonal, to.sounding.tonal),
      sweeps: lerp(from.sounding.sweeps, to.sounding.sweeps),
      weather: lerp(from.sounding.weather, to.sounding.weather),
      mode: Math.round(lerp(from.sounding.mode, to.sounding.mode)),
      lfoRate: lerp(from.sounding.lfoRate, to.sounding.lfoRate),
    },
  };
}

/**
 * Given a fractional era position in [0, ERA_COUNT - 1], return
 * [fromPeriod, toPeriod, t] for smooth interpolation. Values outside the
 * bounds clamp to the endpoint eras.
 */
export function getInterpolationWindow(
  position: number,
): { from: TimePeriod; to: TimePeriod; t: number } {
  const clamped = Math.min(ERA_COUNT - 1, Math.max(0, position));
  const idx = Math.min(ERA_COUNT - 2, Math.floor(clamped));
  const t = clamped - idx;
  return {
    from: TIME_PERIODS[idx],
    to: TIME_PERIODS[idx + 1],
    t: Math.min(1, Math.max(0, t)),
  };
}