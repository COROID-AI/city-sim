'use client';

import { useEffect, useRef } from 'react';
import type { Camera } from '@/engine/Camera';
import type { World } from '@/engine/World';

/**
 * MiniMap — bottom-left thumbnail canvas with a viewport rectangle (spec §6.4).
 *
 * Renders a small canvas (MINI_SIZE × MINI_SIZE px) showing a scaled-down
 * representation of the world with a white rectangle indicating the current
 * camera viewport. The rectangle moves as the camera pans or zooms.
 *
 * Canvas↔React bridge (spec §5.5):
 *  - The minimap redraws at 2 Hz via setInterval(500ms), reading camera
 *    position/zoom directly. No React state is mutated inside the rAF loop.
 *
 * Responsive: hidden below the `md` breakpoint (768px) via `hidden md:block`.
 *
 * Viewport rectangle sizing:
 *  - Camera does not expose viewportWidth/Height publicly, so we use
 *    window.innerWidth/innerHeight as a proxy. This is accurate because the
 *    main canvas fills the full screen (absolute inset-0 h-full w-full).
 */

/** Polling interval (ms) for redrawing the minimap. 2 Hz. */
const POLL_INTERVAL_MS = 500;

/** Edge length of the square minimap canvas, in CSS pixels. */
export const MINI_SIZE = 40;

export interface MiniMapProps {
  /** Engine camera (for viewport rectangle position/size). */
  camera: Camera;
  /** Engine world (for world dimensions). */
  world: World;
}

export default function MiniMap({ camera, world }: MiniMapProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /**
     * Draw the minimap: dark background + white viewport rectangle.
     * The world is mapped into the MINI_SIZE square; the viewport rectangle
     * is the portion of the world currently visible on screen.
     */
    const draw = () => {
      const worldW = camera.worldWidth;
      const worldH = camera.worldHeight;
      if (worldW <= 0 || worldH <= 0) return;

      // Scale factor: world px → minimap px. Use the smaller axis so the
      // entire world fits inside the square without distortion.
      const scale = Math.min(MINI_SIZE / worldW, MINI_SIZE / worldH);

      // Clear + dark background.
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, MINI_SIZE, MINI_SIZE);

      // Viewport rectangle in world px (top-left + size).
      // Use window dimensions as the viewport proxy (main canvas is full-screen).
      const vpW = typeof window !== 'undefined' ? window.innerWidth : 0;
      const vpH = typeof window !== 'undefined' ? window.innerHeight : 0;
      const visibleW = camera.zoom > 0 ? vpW / camera.zoom : 0;
      const visibleH = camera.zoom > 0 ? vpH / camera.zoom : 0;

      const rectX = camera.x * scale;
      const rectY = camera.y * scale;
      const rectW = visibleW * scale;
      const rectH = visibleH * scale;

      // White viewport rectangle (stroke).
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.strokeRect(rectX, rectY, rectW, rectH);
    };

    // Initial draw + 2 Hz redraw.
    draw();
    const id = window.setInterval(draw, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [camera, world]);

  return (
    <div
      className="pointer-events-none fixed bottom-4 left-4 z-20 hidden md:block"
      data-testid="minimap"
    >
      <canvas
        ref={canvasRef}
        width={MINI_SIZE}
        height={MINI_SIZE}
        className="rounded border border-slate-600 bg-slate-900"
        data-testid="minimap-canvas"
      />
    </div>
  );
}
