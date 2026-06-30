/**
 * Hover state store.
 *
 * Tracks the currently hovered scene object (building, prop, etc.) and the
 * screen-space pointer position so the tooltip overlay can follow the cursor.
 * Built with Zustand so it can be consumed imperatively inside the R3F event
 * handlers without triggering React re-render storms in the 3D tree.
 */
import { create } from 'zustand';

/** Describes the hovered entity for tooltip display. */
export interface HoverInfo {
  /** Stable identifier for the hovered object. */
 readonly id: string;
  /** Human-readable title shown in the tooltip header. */
 readonly title: string;
  /** Short descriptive body text (era-specific). */
 readonly description: string;
  /** Category label, e.g. "Building" or "Prop". */
 readonly category: string;
}

/** Shape of the hover state plus the actions that mutate it. */
export interface HoverState {
  /** The currently hovered entity, or `null` when nothing is hovered. */
 readonly hovered: HoverInfo | null;
  /** Screen-space X of the pointer (clientX). */
 readonly pointerX: number;
  /** Screen-space Y of the pointer (clientY). */
 readonly pointerY: number;

  /** Set the hovered entity and pointer position. */
  setHover: (info: HoverInfo, x: number, y: number) => void;
  /** Update only the pointer position (used on pointer move). */
  setPointer: (x: number, y: number) => void;
  /** Clear the hovered entity (pointer leave). */
  clearHover: () => void;
}

/**
 * Zustand store creator. Exported for unit tests that need a fresh instance.
 */
export const createHoverStore = () =>
  create<HoverState>((set) => ({
    hovered: null,
    pointerX: 0,
    pointerY: 0,

    setHover: (info, x, y) => set({ hovered: info, pointerX: x, pointerY: y }),
    setPointer: (x, y) => set({ pointerX: x, pointerY: y }),
    clearHover: () => set({ hovered: null }),
  }));

/**
 * Shared singleton store consumed by React components via `useHoverStore`.
 */
export const useHoverStore = createHoverStore();
