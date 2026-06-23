/**
 * Tooltip — hover tooltip overlay (spec §6.4).
 *
 * Renders a small dark translucent card near the cursor showing details about
 * the entity currently under the mouse:
 *  - Citizen: name + current activity
 *  - Building: name + occupancy (count / capacity)
 *
 * The tooltip is positioned at the cursor + a 12px offset on each axis and
 * uses a dark translucent background per spec §6.4. It is purely presentational:
 * the parent (page.tsx) performs hit-testing and decides what (if anything) to
 * show by passing a non-null `content` prop.
 */
import type { Citizen } from '@/entities/Citizen';
import type { Building } from '@/engine/types';

/** Cursor offset (px) so the tooltip does not sit directly under the pointer. */
export const TOOLTIP_OFFSET = 12;

/** Discriminated union of tooltip payloads. */
export type TooltipContent =
  | { kind: 'citizen'; citizen: Citizen; x: number; y: number }
  | { kind: 'building'; building: Building; occupancy: number; x: number; y: number };

export interface TooltipProps {
  /** What to show, or null to render nothing. */
  content: TooltipContent | null;
}

/** Capitalize the first letter of an activity for display. */
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

export default function Tooltip({ content }: TooltipProps): JSX.Element | null {
  if (!content) return null;

  const left = content.x + TOOLTIP_OFFSET;
  const top = content.y + TOOLTIP_OFFSET;

  return (
    <div
      className="pointer-events-none absolute z-20 max-w-xs rounded-md px-3 py-2 text-sm text-white shadow-lg"
      style={{
        left,
        top,
        backgroundColor: 'rgba(15, 23, 42, 0.85)',
      }}
      data-testid="tooltip"
      role="tooltip"
    >
      {content.kind === 'citizen' ? (
        <div>
          <div className="font-semibold" data-testid="tooltip-citizen-name">
            {content.citizen.name}
          </div>
          <div className="text-xs text-slate-300" data-testid="tooltip-citizen-activity">
            {capitalize(content.citizen.activity)}
          </div>
        </div>
      ) : (
        <div>
          <div className="font-semibold" data-testid="tooltip-building-name">
            {content.building.def.name}
          </div>
          <div className="text-xs text-slate-300" data-testid="tooltip-building-occupancy">
            Occupancy: {content.occupancy}/{content.building.def.capacity}
          </div>
        </div>
      )}
    </div>
  );
}
