'use client';

/**
 * Tooltip — presentational hover tooltip for citizen details.
 *
 * The tooltip is intentionally a "dumb" component: it does not own
 * pointer events. The host (`CityCanvas`) is responsible for detecting
 * hover, computing the screen position, and passing the relevant
 * `Citizen` (or null) down as a prop. This keeps the tooltip reusable
 * from any future host (e.g. a minimap) and avoids the canvas-vs-DOM
 * event-ordering bug where `mousemove` on a child element stops firing
 * on the canvas.
 *
 * The tooltip is rendered into a wrapper `<div>` inside the host so
 * positioning can be done with absolute CSS coordinates relative to
 * the host's bounding box.
 */
import { type Citizen, type Needs } from '@/entities';
import type { CSSProperties, ReactElement } from 'react';

export interface TooltipProps {
  /** The hovered citizen, or null to hide the tooltip. */
  citizen: Citizen | null;
  /** Screen-space (CSS pixel) coordinates relative to the host wrapper. */
  position: { x: number; y: number } | null;
}

const NEED_KEYS: ReadonlyArray<{ key: keyof Needs; label: string }> = [
  { key: 'energy', label: 'Energy' },
  { key: 'hunger', label: 'Hunger' },
  { key: 'fun', label: 'Fun' },
  { key: 'social', label: 'Social' },
];

/** Clamp a tooltip into the host's bounding box so it never overflows. */
export function clampTooltipPosition(
  pos: { x: number; y: number },
  host: { width: number; height: number },
  tooltip: { width: number; height: number } = { width: 180, height: 96 },
): { x: number; y: number } {
  const x = pos.x + tooltip.width > host.width ? pos.x - tooltip.width - 8 : pos.x + 8;
  const y = pos.y + tooltip.height > host.height ? pos.y - tooltip.height - 8 : pos.y + 8;
  return { x, y };
}

export function Tooltip({ citizen, position }: TooltipProps): ReactElement | null {
  if (citizen === null || position === null) return null;
  const style: CSSProperties = {
    position: 'absolute',
    left: position.x,
    top: position.y,
    pointerEvents: 'none',
    zIndex: 10,
  };
  return (
    <div
      data-testid="city-tooltip"
      role="tooltip"
      style={style}
      className="rounded-md border border-border bg-surface/95 px-3 py-2 text-xs text-foreground shadow-lg"
    >
      <div className="font-semibold text-citizen">{citizen.name}</div>
      <div className="text-muted">Activity: {citizen.currentActivity}</div>
      <div className="mt-1 space-y-0.5">
        {NEED_KEYS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2" data-need={key}>
            <span className="w-12 text-muted">{label}</span>
            <span
              className="h-1.5 rounded bg-accent"
              style={{ width: `${Math.max(0, Math.min(100, citizen.needs[key]))}px` }}
              aria-hidden
            />
            <span className="ml-1 text-foreground">{Math.round(citizen.needs[key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
