/**
 * SimUiContext — typed handle bag that the page exposes to its
 * dashboard / log / minimap overlays.
 *
 * The page instantiates the engine, time system, economy system,
 * and event bus; the React UI never reaches into the engine
 * internals directly. Instead, it consumes a stable ref-object
 * containing the *handles* it needs. The handle object is created
 * once at mount and never re-created, so consumers (Dashboard,
 * CityLog, MiniMap) can read from it freely without triggering
 * re-renders.
 *
 * Layer rule: this file lives in `src/ui/` and may import from
 * `src/hooks/`, `src/systems/`, `src/engine/` types, and
 * `src/constants/`. It must NOT be imported by `src/systems/` or
 * `src/engine/`.
 */

import { createContext, useContext } from 'react';
import type { Camera, World } from '@/engine';
import { EconomySystem, EventBus, TimeSystem } from '@/systems';
import type { SimEventMap } from '@/systems';

/**
 * The full set of typed handles the UI overlays need. A `null` for
 * any field means the engine is still mounting (or has been torn
 * down) — overlays should render a neutral placeholder in that
 * case rather than throwing.
 */
export interface SimUiHandles {
  readonly world: World | null;
  readonly camera: Camera | null;
  readonly time: TimeSystem | null;
  readonly economy: EconomySystem | null;
  readonly bus: EventBus<SimEventMap> | null;
  /** Display name of the city. */
  readonly cityName: string;
}

/**
 * Default value used when no `<SimUiProvider>` is mounted. Every
 * handle is `null` so consumers that accidentally render outside
 * the provider get a safe no-op rather than a crash. They should
 * still check for `null` and render a placeholder.
 */
export const DEFAULT_SIM_UI_HANDLES: SimUiHandles = {
  world: null,
  camera: null,
  time: null,
  economy: null,
  bus: null,
  cityName: 'New City',
};

export const SimUiContext = createContext<SimUiHandles>(DEFAULT_SIM_UI_HANDLES);

/**
 * Read the typed handle bag. Throws if used outside a
 * `<SimUiProvider>` and the handle bag is not the default — in
 * practice, overlays always render inside the page, so the
 * default-with-null-handles is a graceful fallback.
 */
export function useSimUi(): SimUiHandles {
  return useContext(SimUiContext);
}

export { EconomySystem, EventBus, TimeSystem };
export type { SimEventMap };
