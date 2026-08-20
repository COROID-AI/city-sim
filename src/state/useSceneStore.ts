import { create } from 'zustand';
import { TIME_PERIODS, ERA_COUNT, lerpTimePeriods } from './timePeriods';
import type { TimePeriod } from './types';

export interface SceneSettings {
  /** False = manual control, true = auto-play progression. */
  playing: boolean;
  /** Muted output (master gain 0) but audio graph still runs. */
  muted: boolean;
  /** Master output volume in [0, 1]. */
  volume: number;
  /** Fractional era position in [0, ERA_COUNT - 1]. */
  position: number;
  /** Snapshot of the interpolated TimePeriod at the current position. */
  current: TimePeriod;
  /** Day-night cycle time in [0, 1] (0 = dawn, 0.5 = solar noon). */
  dayTime: number;
  /** Whether the day/night cycle advances autonomously. */
  dayCycleEnabled: boolean;
  /** Camera target orbit distance around the city. */
  cameraDistance: number;
  /** Width of each timeline bucket (px), used by the slider. */
  timelineWidth: number;
}

export const DEFAULT_DAY_TIME = 0.72; /* warm late-afternoon */

export function getInitialState(): SceneSettings {
  return {
    playing: false,
    muted: false,
    volume: 0.8,
    position: 1,
    current: TIME_PERIODS[1] ?? TIME_PERIODS[0],
    dayTime: DEFAULT_DAY_TIME,
    dayCycleEnabled: true,
    cameraDistance: 19,
    timelineWidth: 480,
  };
}

interface SceneActions {
  setEraIndex: (index: number) => void;
  scrubTo: (position: number) => void;
  togglePlayback: () => void;
  toggleMute: () => void;
  setVolume: (v: number) => void;
  setDayTime: (t: number) => void;
  setDayCycleEnabled: (b: boolean) => void;
  setCameraDistance: (d: number) => void;
  setTimelineWidth: (w: number) => void;
}

export type SceneStore = SceneSettings & SceneActions;

export const useSceneStore = create<SceneStore>()((set) => ({
  ...getInitialState(),

  setEraIndex: (index) => {
    const i = Math.min(ERA_COUNT - 1, Math.max(0, Math.round(index)));
    const p = TIME_PERIODS[i]?.progress ?? 0;
    const current = TIME_PERIODS[i] ?? TIME_PERIODS[0];
    set({ position: i, current });
  },

  scrubTo: (position) => {
    const p = Math.min(ERA_COUNT - 1, Math.max(0, position));
    const lo = Math.floor(p);
    const hi = Math.min(ERA_COUNT - 1, lo + 1);
    const t = p - lo;
    const from = TIME_PERIODS[lo] ?? TIME_PERIODS[0];
    const to = TIME_PERIODS[hi] ?? from;
    const current = lerpTimePeriods(from, to, t);
    set({ position: p, current });
  },

  togglePlayback: () => set((s) => ({ playing: !s.playing })),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setVolume: (v) => set({ volume: Math.min(1, Math.max(0, v)) }),
  setDayTime: (t) => set({ dayTime: ((t % 1) + 1) % 1 }),
  setDayCycleEnabled: (b) => set({ dayCycleEnabled: b }),
  setCameraDistance: (d) =>
    set({ cameraDistance: Math.min(40, Math.max(8, d)) }),
  setTimelineWidth: (w) => set({ timelineWidth: Math.max(240, w) }),
}));