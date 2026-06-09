'use client';

/**
 * shadcn-style tooltip primitive passthrough.
 *
 * This file exists so `src/components/ui/` has a working tooltip
 * primitive available for future shadcn-style usage. It is NOT the
 * same component as `src/ui/Tooltip.tsx` (the canvas citizen hover
 * tooltip); it is a general-purpose Radix-style primitive wrapper.
 *
 * For now we re-export the city tooltip from `src/ui` so the surface
 * is non-empty. A Radix-based implementation can replace this in a
 * later iteration without touching `src/ui/Tooltip.tsx`.
 */
export { Tooltip, type TooltipProps, clampTooltipPosition } from '@/ui/Tooltip';
