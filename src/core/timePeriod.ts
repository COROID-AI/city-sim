export const TIME_PERIODS = [1945, 1965, 1985, 2005, 2025] as const;
export type TimePeriod = (typeof TIME_PERIODS)[number];

export const DEFAULT_PERIOD: TimePeriod = 2025;

export type PeriodIndex = 0 | 1 | 2 | 3 | 4;

export function periodToIndex(period: TimePeriod): PeriodIndex {
  return (TIME_PERIODS.indexOf(period) as PeriodIndex);
}

export function clampPeriod(period: number): TimePeriod {
  const sorted = [...TIME_PERIODS].sort((a, b) => a - b);
  if (period <= sorted[0]) return sorted[0] as TimePeriod;
  if (period >= sorted[sorted.length - 1]) return sorted[sorted.length - 1] as TimePeriod;
  return period as TimePeriod;
}

export function isTransitioningBackward(from: TimePeriod, to: TimePeriod): boolean {
  return periodToIndex(to) < periodToIndex(from);
}

export interface PeriodPalette {
  skyTop: number;
  skyBottom: number;
  fogColor: number;
  fogDensity: number;
  ambient: number;
  sunColor: number;
  sunIntensity: number;
  ground: number;
  accent: number;
}

export const PERIOD_PALETTES: Record<TimePeriod, PeriodPalette> = {
  1945: {
    skyTop: 0x9fb8c4,
    skyBottom: 0xcdbb9a,
    fogColor: 0xc8b89c,
    fogDensity: 0.012,
    ambient: 0xb0a890,
    sunColor: 0xffe8c4,
    sunIntensity: 1.05,
    ground: 0x8a7a5a,
    accent: 0x9a5a3a,
  },
  1965: {
    skyTop: 0x8fa0b0,
    skyBottom: 0xc0b8a0,
    fogColor: 0xb8b0a0,
    fogDensity: 0.011,
    ambient: 0xa8a098,
    sunColor: 0xfff0d0,
    sunIntensity: 1.1,
    ground: 0x7a7568,
    accent: 0xc88a3a,
  },
  1985: {
    skyTop: 0x6f88a0,
    skyBottom: 0xb0a898,
    fogColor: 0xa8a098,
    fogDensity: 0.01,
    ambient: 0x98a0a8,
    sunColor: 0xfff4e0,
    sunIntensity: 1.15,
    ground: 0x6a6a6a,
    accent: 0xe8a040,
  },
  2005: {
    skyTop: 0x5a7a98,
    skyBottom: 0xa0a8b0,
    fogColor: 0x9aa0a8,
    fogDensity: 0.009,
    ambient: 0x90a0b0,
    sunColor: 0xfff8f0,
    sunIntensity: 1.2,
    ground: 0x5a5a5e,
    accent: 0x40a0e0,
  },
  2025: {
    skyTop: 0x2a4060,
    skyBottom: 0x607090,
    fogColor: 0x404858,
    fogDensity: 0.008,
    ambient: 0x8090b0,
    sunColor: 0xfffaf0,
    sunIntensity: 1.25,
    ground: 0x3a3a44,
    accent: 0x20c0e0,
  },
};

export function lerpPalette(from: PeriodPalette, to: PeriodPalette, t: number): PeriodPalette {
  const hex = (h: number) => [(h >> 16) & 0xff, (h >> 8) & 0xff, h & 0xff];
  const mix = (a: number, b: number) => {
    const [ar, ag, ab] = hex(a);
    const [br, bg, bb] = hex(b);
    const r = Math.round(ar + (br - ar) * t);
    const g = Math.round(ag + (bg - ag) * t);
    const bl = Math.round(ab + (bb - ab) * t);
    return (r << 16) | (g << 8) | bl;
  };
  return {
    skyTop: mix(from.skyTop, to.skyTop),
    skyBottom: mix(from.skyBottom, to.skyBottom),
    fogColor: mix(from.fogColor, to.fogColor),
    fogDensity: from.fogDensity + (to.fogDensity - from.fogDensity) * t,
    ambient: mix(from.ambient, to.ambient),
    sunColor: mix(from.sunColor, to.sunColor),
    sunIntensity: from.sunIntensity + (to.sunIntensity - from.sunIntensity) * t,
    ground: mix(from.ground, to.ground),
    accent: mix(from.accent, to.accent),
  };
}

export function paletteForPeriod(period: TimePeriod): PeriodPalette {
  return PERIOD_PALETTES[period];
}
