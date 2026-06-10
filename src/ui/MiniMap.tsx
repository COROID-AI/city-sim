'use client';

/**
 * MiniMap — small overhead canvas of the city.
 *
 * Spec reference: §6.4 Dashboard Layout.
 *
 * Renders a fixed-size canvas with:
 *   - filled circles for citizens (citizen token)
 *   - small triangles for vehicles (accent token)
 *   - filled squares for buildings (building token, type-colored)
 *
 * The component is presentational: it reads a `CitySnapshot` and
 * draws it on every prop change. Drawing is done with a `<canvas>`
 * element using a 2D context ref (jsdom provides a stub 2D context,
 * so tests can mount it without throwing).
 */
import { memo, useEffect, useRef } from 'react';
import type { ReactElement } from 'react';
import type { CitySnapshot } from '@/ui/CitySnapshot';

export interface MiniMapProps {
  snapshot: CitySnapshot;
  /** Pixel size of the canvas. Defaults to 220x140. */
  width?: number;
  height?: number;
}

const DEFAULT_W = 220;
const DEFAULT_H = 140;

const BG_FILL = '#161b22';

function drawSnapshot(
  canvas: HTMLCanvasElement,
  snapshot: CitySnapshot,
  width: number,
  height: number,
): void {
  const ctx = canvas.getContext('2d');
  if (ctx === null) return;
  ctx.fillStyle = BG_FILL;
  ctx.fillRect(0, 0, width, height);

  const { min, max } = snapshot.worldBounds;
  const spanX = Math.max(1, max.x - min.x);
  const spanY = Math.max(1, max.y - min.y);
  const scaleX = (width - 8) / spanX;
  const scaleY = (height - 8) / spanY;
  const scale = Math.min(scaleX, scaleY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;

  const project = (x: number, y: number): { x: number; y: number } => ({
    x: (x - min.x) * scale + offsetX,
    y: (y - min.y) * scale + offsetY,
  });

  // Buildings (squares).
  for (const b of snapshot.buildings) {
    const p = project(b.position.x, b.position.y);
    ctx.fillStyle = b.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }

  // Citizens (small filled circles).
  for (const c of snapshot.citizens) {
    const p = project(c.position.x, c.position.y);
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // Vehicles (small triangles, accent color).
  for (const v of snapshot.vehicles) {
    const p = project(v.position.x, v.position.y);
    ctx.fillStyle = v.color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 2);
    ctx.lineTo(p.x - 1.5, p.y + 1.5);
    ctx.lineTo(p.x + 1.5, p.y + 1.5);
    ctx.closePath();
    ctx.fill();
  }
}

function MiniMapImpl({
  snapshot,
  width = DEFAULT_W,
  height = DEFAULT_H,
}: MiniMapProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    drawSnapshot(canvas, snapshot, width, height);
  }, [snapshot, width, height]);

  return (
    <section
      data-testid="city-minimap"
      aria-label="City mini-map"
      className="rounded-md border border-border bg-surface p-2"
    >
      <h2 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Mini-map
      </h2>
      <canvas
        ref={canvasRef}
        data-testid="city-minimap-canvas"
        width={width}
        height={height}
        className="block w-full"
        style={{ width: '100%', maxWidth: width, height: 'auto' }}
        aria-hidden
      />
    </section>
  );
}

function areMiniMapPropsEqual(
  prev: MiniMapProps,
  next: MiniMapProps,
): boolean {
  const a = prev.snapshot;
  const b = next.snapshot;
  if (a.day !== b.day) return false;
  if (a.population !== b.population) return false;
  if (a.vehicleCount !== b.vehicleCount) return false;
  if (a.citizens.length !== b.citizens.length) return false;
  if (a.vehicles.length !== b.vehicles.length) return false;
  if (a.buildings.length !== b.buildings.length) return false;
  if (a.worldBounds.min.x !== b.worldBounds.min.x) return false;
  if (a.worldBounds.min.y !== b.worldBounds.min.y) return false;
  if (a.worldBounds.max.x !== b.worldBounds.max.x) return false;
  if (a.worldBounds.max.y !== b.worldBounds.max.y) return false;
  return true;
}

export const MiniMap = memo(MiniMapImpl, areMiniMapPropsEqual);
