/**
 * Tooltip — hover overlay that surfaces a citizen's name and
 * current activity.
 *
 * Layer rule: this component is in the `ui` layer. It must NOT
 * import the engine runtime (no `Renderer`, no `World`) and must
 * NOT import from `src/systems` (the systems layer is pure TS).
 * It may import engine *types* (erased at runtime) so the prop
 * surface can be typed against `Citizen`.
 *
 * 'use client' is required because we forward DOM event handlers
 * (the parent page wires `mousemove` to update the hovered
 * citizen's screen position).
 *
 * Positioning: the tooltip is rendered at `(x + 12, y + 12)` in
 * screen space, with a viewport clamp so it never falls off the
 * right or bottom edge. We use a transform on a position:fixed
 * wrapper for cheap updates.
 */

'use client';

import { type CSSProperties, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { Citizen, CitizenState } from '@/engine/types';

/* -------------------------------------------------------------------------- */
/* Activity label                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Human-readable label for a citizen's `CitizenState`. The labels
 * match the vocabulary used elsewhere in the simulation (e.g. the
 * `Activity` union in `src/entities/Citizen.ts`).
 */
export function activityLabel(state: CitizenState): string {
  switch (state) {
    case 'idle':
      return 'Idle';
    case 'commuting':
      return 'Commuting';
    case 'working':
      return 'Working';
    case 'shopping':
      return 'Errand';
    case 'resting':
      return 'Sleeping';
    case 'leisure':
      return 'Leisure';
  }
}

/* -------------------------------------------------------------------------- */
/* Props                                                                      */
/* -------------------------------------------------------------------------- */

export interface TooltipProps {
  /** The citizen to display. `null` hides the tooltip. */
  citizen: Citizen | null;
  /** Screen-space x of the mouse cursor. */
  x: number;
  /** Screen-space y of the mouse cursor. */
  y: number;
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Render the citizen tooltip. The component is intentionally
 * presentation-only: it never holds simulation state, never queries
 * the world, and never registers event listeners of its own. The
 * parent (the city sim page) computes which citizen is hovered and
 * passes the result in.
 */
export function Tooltip(props: TooltipProps): ReactNode {
  const { citizen, x, y } = props;
  const ref = useRef<HTMLDivElement | null>(null);
  // We keep a clamped copy of the position in state so the tooltip
  // can react to viewport resize without the parent re-passing
  // different props. `useLayoutEffect` runs synchronously after
  // mount and before paint so the user never sees an off-screen
  // flash.
  const [clamped, setClamped] = useState<{ left: number; top: number }>({
    left: x + 12,
    top: y + 12,
  });

  useLayoutEffect(() => {
    if (!citizen) return;
    const node = ref.current;
    if (!node) {
      setClamped({ left: x + 12, top: y + 12 });
      return;
    }
    const rect = node.getBoundingClientRect();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    // 16px margin so the tooltip never touches the edge of the viewport.
    const margin = 16;
    const desiredLeft = x + 12;
    const desiredTop = y + 12;
    const maxLeft = Math.max(margin, vw - rect.width - margin);
    const maxTop = Math.max(margin, vh - rect.height - margin);
    const left = Math.min(Math.max(margin, desiredLeft), maxLeft);
    const top = Math.min(Math.max(margin, desiredTop), maxTop);
    setClamped({ left, top });
  }, [citizen, x, y]);

  if (!citizen) return null;

  const style: CSSProperties = {
    position: 'fixed',
    left: 0,
    top: 0,
    transform: `translate(${clamped.left}px, ${clamped.top}px)`,
    zIndex: 20,
    pointerEvents: 'none',
    background: 'rgba(11, 18, 32, 0.92)',
    color: '#e6ecf5',
    padding: '6px 10px',
    borderRadius: 6,
    font: '12px/1.3 system-ui, -apple-system, Segoe UI, sans-serif',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.12)',
    maxWidth: 240,
    whiteSpace: 'nowrap',
  };

  return (
    <div ref={ref} role="tooltip" data-testid="citizen-tooltip" style={style}>
      <div style={{ fontWeight: 600 }}>{citizen.name}</div>
      <div style={{ opacity: 0.85 }}>{activityLabel(citizen.state)}</div>
    </div>
  );
}
