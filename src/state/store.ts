/**
 * Tiny observable app state.
 *
 * Deliberately framework-free and DOM-free (the URL-hash helpers are pure
 * string functions) so the whole app state machine can be unit-tested in Node.
 * UI, audio and the transition controller all subscribe to this store instead
 * of talking to each other.
 */

import { isYear, YEARS, type Year } from '../config/types';

export type QualityTier = 'high' | 'medium' | 'low';

export interface TransitionSnapshot {
  active: boolean;
  from: Year;
  to: Year;
  /** 0..1 blend progress. */
  progress: number;
}

export type FocusKind = 'building' | 'vehicle' | 'pedestrian' | 'prop' | 'storefront' | 'advertisement';

/** Something the user clicked and flew the camera to. */
export interface FocusTarget {
  kind: FocusKind;
  id: string;
  label: string;
  /** Era-aware description shown in the info card. */
  detail: string;
  /** Period micro-copy, e.g. "1958 - tenement walk-up". */
  period: string;
  position: [number, number, number];
}

export interface AppState {
  year: Year;
  transition: TransitionSnapshot;
  /** Fractional slider index while dragging, `null` when idle. */
  scrubIndex: number | null;
  muted: boolean;
  quality: QualityTier;
  focus: FocusTarget | null;
  helpOpen: boolean;
  audioUnlocked: boolean;
  /** True while the autoplay policy still blocks playback. */
  soundPromptVisible: boolean;
  fps: number;
  loading: { active: boolean; progress: number; message: string };
  error: string | null;
}

export type Listener = (state: Readonly<AppState>, changed: ReadonlyArray<keyof AppState>) => void;

function initialState(year: Year = 1945): AppState {
  return {
    year,
    transition: { active: false, from: year, to: year, progress: 1 },
    scrubIndex: null,
    muted: false,
    quality: 'high',
    focus: null,
    helpOpen: false,
    audioUnlocked: false,
    soundPromptVisible: true,
    fps: 60,
    loading: { active: true, progress: 0, message: 'Preparing the block...' },
    error: null,
  };
}

export class Store {
  private state: AppState;
  private readonly listeners = new Set<Listener>();

  constructor(year: Year = 1945) {
    this.state = initialState(year);
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Shallow merge; returns the list of keys that actually changed. */
  patch(patch: Partial<AppState>): ReadonlyArray<keyof AppState> {
    const changed: Array<keyof AppState> = [];
    for (const key of Object.keys(patch) as Array<keyof AppState>) {
      const next = patch[key];
      if (next === undefined) continue;
      if (this.state[key] !== next) {
        (this.state as unknown as Record<string, unknown>)[key] = next;
        changed.push(key);
      }
    }
    if (changed.length > 0) this.emit(changed);
    return changed;
  }

  setYear(year: Year): ReadonlyArray<keyof AppState> {
    return this.patch({ year });
  }

  setTransition(transition: TransitionSnapshot): ReadonlyArray<keyof AppState> {
    return this.patch({ transition });
  }

  setScrub(index: number | null): ReadonlyArray<keyof AppState> {
    return this.patch({ scrubIndex: index });
  }

  toggleMute(): boolean {
    const muted = !this.state.muted;
    this.patch({ muted });
    return muted;
  }

  setFocus(focus: FocusTarget | null): ReadonlyArray<keyof AppState> {
    return this.patch({ focus });
  }

  private emit(changed: ReadonlyArray<keyof AppState>): void {
    const snapshot = this.state;
    for (const listener of Array.from(this.listeners)) listener(snapshot, changed);
  }
}

/* ---------------------------------------------------- URL deep linking ---- */

/** `1945` → `#year=1985` style hash for the current era. */
export function formatYearHash(year: Year): string {
  return `#year=${year}`;
}

/** Parse `#year=1985` (tolerant of extra params and missing `#`). */
export function parseYearHash(hash: string | undefined | null): Year | null {
  if (!hash) return null;
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(clean);
  const raw = params.get('year');
  if (!raw) return null;
  const value = Number.parseInt(raw, 10);
  return isYear(value) ? value : null;
}

/** Next era in timeline order, wrapping at the ends. */
export function cycleYear(year: Year, direction: 1 | -1 = 1): Year {
  const index = YEARS.indexOf(year);
  const next = (index + direction + YEARS.length) % YEARS.length;
  return YEARS[next];
}
