'use client';

/**
 * Tooltip
 *
 * Presentational tooltip card that renders hover info (title, category,
 * description) at a fixed screen position. Positioned by the parent
 * `TooltipOverlay` which reads the pointer coordinates from the hover store.
 */
import type { FC } from 'react';
import type { HoverInfo } from '@/store/hoverStore';

interface TooltipProps {
  readonly info: HoverInfo;
  readonly x: number;
  readonly y: number;
}

const Tooltip: FC<TooltipProps> = ({ info, x, y }) => {
  // Offset the tooltip slightly from the cursor and keep it on-screen.
  // We use a transform so the card's right/bottom edge flips near the viewport
  // boundary.
  const offsetX = 16;
  const offsetY = 16;
  const flipX = x > window.innerWidth - 280;
  const flipY = y > window.innerHeight - 140;

  const left = flipX ? x - 260 : x + offsetX;
  const top = flipY ? y - 110 : y + offsetY;

  return (
    <div
      className="pointer-events-none fixed z-40 w-[260px] max-w-[80vw] rounded-xl border border-white/10 bg-black/80 p-3 shadow-2xl backdrop-blur-md"
      style={{ left, top }}
      role="tooltip"
      data-testid="hover-tooltip"
    >
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
        {info.category}
      </p>
      <p className="mb-1.5 text-sm font-semibold leading-snug text-white">
        {info.title}
      </p>
      <p className="text-xs leading-relaxed text-gray-300">{info.description}</p>
    </div>
  );
};

export default Tooltip;
