'use client';

/**
 * TooltipOverlay
 *
 * Reads the hover store and renders a `Tooltip` at the current pointer
 * position whenever an entity is hovered. Mounted once at the page level so
 * it floats above the 3D canvas.
 */
import type { FC } from 'react';
import { useHoverStore } from '@/store/hoverStore';
import Tooltip from './Tooltip';

const TooltipOverlay: FC = () => {
  const hovered = useHoverStore((s) => s.hovered);
  const pointerX = useHoverStore((s) => s.pointerX);
  const pointerY = useHoverStore((s) => s.pointerY);

  if (!hovered) return null;

  return <Tooltip info={hovered} x={pointerX} y={pointerY} />;
};

export default TooltipOverlay;
