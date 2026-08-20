import { create } from 'zustand';
import { audioEngine } from './audio';

export const ERA_MIN_YEAR = 1850;
export const ERA_MAX_YEAR = 2035;

export interface EraDef {
  year: number;
  label: string;
  short: string;
}

export const ERAS: EraDef[] = [
  { year: 1850, label: 'Frontier Town', short: '1850' },
  { year: 1890, label: "Van & Steam", short: '1890' },
  { year: 1910, label: 'Streetcars', short: '1910' },
  { year: 1930, label: 'Art Deco', short: '1930' },
  { year: 1950, label: 'Mid-Century', short: '1950' },
  { year: 1970, label: 'Auto City', short: '1970' },
  { year: 1990, label: 'Glass Towers', short: '1990' },
  { year: 2010, label: 'LED Nights', short: '2010' },
  { year: 2025, label: 'Today', short: '2025' },
  { year: 2035, label: 'Neon Future', short: '2035' },
];

/** normalized position of an era index on the 0..1 timeline */
export const eraPos = (i: number) => (ERAS.length <= 1 ? 0 : i / (ERAS.length - 1));
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function yearFromT(t: number): number {
  return Math.round(ERAS[0].year + (ERAS[ERAS.length - 1].year - ERAS[0].year) * t);
}

export function eraLabel(t: number): string {
  const raw = t * (ERAS.length - 1);
  const i = Math.min(ERAS.length - 1, Math.max(0, Math.round(raw)));
  return ERAS[i].label;
}

export function dim(lo: number, hi: number, t: number) {
  return lo + (hi - lo) * clamp01(t);
}

interface SimState {
  /** normalized 0..1 across 1850..2035 */
  t: number;
  playing: boolean;
  /** replay speed multiplier (auto timelapse) */
  speed: number;
  /** simulated hour-of-day 0..24, drives day/night */
  hour: number;
  /** sound was unlocked by a user gesture */
  soundEnabled: boolean;
  /** user explicitly muted */
  muted: boolean;
  /** webgl context lost */
  contextLost: boolean;
  /** whether WebGL was available at boot */
  webglOk: boolean;
  reducedMotion: boolean;
  setT: (t: number) => void;
  setHour: (h: number) => void;
  setPlaying: (p: boolean) => void;
  togglePlay: () => void;
  setSpeed: (s: number) => void;
  setMuted: (m: boolean) => void;
  setSoundEnabled: (v: boolean) => void;
  setContextLost: (v: boolean) => void;
  setWebglOk: (v: boolean) => void;
  setReducedMotion: (v: boolean) => void;
  toggleMuted: () => void;
  jumpToEra: (i: number) => void;
}

export const useSim = create<SimState>((set, get) => ({
  t: eraPos(5),
  playing: typeof window !== 'undefined' ? !window.matchMedia('(prefers-reduced-motion: reduce)').matches : true,
  speed: 1,
  hour: 11.5,
  soundEnabled: false,
  muted: false,
  contextLost: false,
  webglOk: true,
  reducedMotion: false,
  setT: (t) => set({ t: clamp01(t) }),
  setHour: (h) => set({ hour: h }),
  setPlaying: (p) => set({ playing: p }),
  togglePlay: () => set((s) => ({ playing: !s.playing })),
  setSpeed: (s) => set({ speed: Math.min(4, Math.max(0.25, s)) }),
  setMuted: (m) => set({ muted: m, soundEnabled: true }),
  setSoundEnabled: (v) => set({ soundEnabled: v, muted: v ? false : get().muted }),
  setContextLost: (v) => set({ contextLost: v }),
  setWebglOk: (v) => set({ webglOk: v }),
  setReducedMotion: (v) => set({ reducedMotion: v }),
  toggleMuted: () => set((s) => ({ muted: !s.muted })),
  jumpToEra: (i) => {
    const t = eraPos(Math.min(ERAS.length - 1, Math.max(0, i)));
    set({ t });
    try { audioEngine.click(); } catch {}
  },
}));