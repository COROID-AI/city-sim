/**
 * Hover event handler factories.
 *
 * Produces stable `onPointerOver` / `onPointerOut` / `onPointerMove` callbacks
 * for R3F meshes so buildings and props can feed the hover store without each
 * component reimplementing the wiring. The handlers translate Three.js
 * pointer events into screen-space coordinates for the HTML tooltip overlay.
 */
import { useCallback } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import { useHoverStore, type HoverInfo } from '@/store/hoverStore';
import { getHistoricalBlurb } from '@/config/historicalBlurbs';
import type { EraId } from '@/config/years';

/**
 * Build a `HoverInfo` object for a building.
 *
 * @param id      Stable object id.
 * @param era     Active era for year-specific text.
 * @param label   Building label (e.g. plot id).
 * @returns       A `HoverInfo` with era-appropriate description.
 */
export function buildingHoverInfo(
  id: string,
  era: EraId,
  label: string,
): HoverInfo {
  const blurb = getHistoricalBlurb(era);
  return {
    id,
    title: `${label} — ${blurb.title}`,
    category: 'Building',
    description: blurb.body,
  };
}

/**
 * Build a `HoverInfo` object for a sidewalk prop.
 *
 * @param id      Stable object id.
 * @param era     Active era for year-specific text.
 * @param kind    Prop kind label.
 * @returns       A `HoverInfo` with era-appropriate description.
 */
export function propHoverInfo(
  id: string,
  era: EraId,
  kind: string,
): HoverInfo {
  const blurb = getHistoricalBlurb(era);
  return {
    id,
    title: `${kind} (${blurb.title})`,
    category: 'Street Prop',
    description: blurb.highlight,
  };
}

/**
 * A hook returning pointer event handlers that drive the hover store for a
 * generic hoverable object. Pass a factory that builds the `HoverInfo` lazily
 * (so the era is resolved at event time, not at render time).
 *
 * Usage inside an R3F mesh:
 * ```tsx
 * const { onPointerOver, onPointerOut, onPointerMove } = useHoverHandlers(
 *   () => buildingHoverInfo(plot.id, getCurrentEra(), plot.id),
 * );
 * <mesh onPointerOver={onPointerOver} onPointerOut={onPointerOut} onPointerMove={onPointerMove} />
 * ```
 */
export function useHoverHandlers(infoFactory: () => HoverInfo): {
  onPointerOver: (e: ThreeEvent<PointerEvent>) => void;
  onPointerOut: (e: ThreeEvent<PointerEvent>) => void;
  onPointerMove: (e: ThreeEvent<PointerEvent>) => void;
} {
  const setHover = useHoverStore((s) => s.setHover);
  const setPointer = useHoverStore((s) => s.setPointer);
  const clearHover = useHoverStore((s) => s.clearHover);

  const onPointerOver = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      const info = infoFactory();
      setHover(info, e.clientX, e.clientY);
    },
    [infoFactory, setHover],
  );

  const onPointerOut = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      e.stopPropagation();
      clearHover();
    },
    [clearHover],
  );

  const onPointerMove = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      setPointer(e.clientX, e.clientY);
    },
    [setPointer],
  );

  return { onPointerOver, onPointerOut, onPointerMove };
}
