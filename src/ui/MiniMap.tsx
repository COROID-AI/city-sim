/**
 * MiniMap — bottom-right city thumbnail overlay.
 *
 * Renders the full tile grid + building footprints as a small
 * thumbnail (180×120 CSS px by default) and overlays a viewport
 * rectangle that tracks the active Camera region. Clicking the
 * minimap calls `camera.panTo(x, y)` to recentre the main
 * viewport at the clicked world position.
 *
 * The tile+building layer is cached on an offscreen canvas; only
 * the viewport rect and the building-fill layer are re-stamped on
 * each 2 Hz tick. The world shape itself only changes when
 * buildings are added/removed, so we invalidate the cache when
 * `buildingCount` (or the world bounds) changes.
 *
 * Layer rule: `'use client'` React 19. Reads the engine `World`
 * and `Camera` via SimUiContext. Does NOT import from
 * `@/systems/` or `@/engine/` internals — only the public surface.
 */

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { useSimUi } from './SimUiContext';
import type { Building, Tile, TileKind } from '@/engine';

const POLL_HZ = 2;
const POLL_DELAY_MS = Math.round(1000 / POLL_HZ);

const MINIMAP_W = 180;
const MINIMAP_H = 120;

/**
 * Tile → thumbnail colour. The engine palette is the source of
 * truth for renderer hex values; the minimap uses its own
 * local-ish colours so the chrome stays a UI concern and we don't
 * pull the renderer's palette into a React component.
 */
const TILE_COLOR: Readonly<Record<TileKind, string>> = {
  ground: '#1c2536',
  road: '#3a4658',
  water: '#1e4f7a',
  park: '#5a9e6f',
  lot: '#e2e6ec',
};

const BUILDING_COLOR = '#4a5b78';
const VIEWPORT_STROKE = '#3aa0ff';
const VIEWPORT_FILL = 'rgba(58, 160, 255, 0.18)';
const BORDER_COLOR = 'rgba(255, 255, 255, 0.08)';

interface ViewportRect {
  readonly x: number; // top-left in minimap px
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function emptyRect(): ViewportRect {
  return { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Compute the viewport rect in minimap-px coordinates given the
 * current Camera state and the world bounds. Returns a zero-sized
 * rect if the camera's visible region is degenerate.
 */
function computeRect(
  worldW: number,
  worldH: number,
  cameraX: number,
  cameraY: number,
  halfW: number,
  halfH: number,
): ViewportRect {
  const scaleX = MINIMAP_W / worldW;
  const scaleY = MINIMAP_H / worldH;
  const minX = cameraX - halfW;
  const minY = cameraY - halfH;
  const maxX = cameraX + halfW;
  const maxY = cameraY + halfH;
  const x = Math.max(0, minX) * scaleX;
  const y = Math.max(0, minY) * scaleY;
  const x2 = Math.min(worldW, maxX) * scaleX;
  const y2 = Math.min(worldH, maxY) * scaleY;
  return {
    x,
    y,
    w: Math.max(0, x2 - x),
    h: Math.max(0, y2 - y),
  };
}

export function MiniMap(): React.ReactElement {
  const { world, camera } = useSimUi();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Cached "static" tile+building layer. Re-stamped only when
  // world bounds or building count changes.
  const cacheRef = useRef<{
    key: string;
    bitmap: ImageBitmap | null;
  }>({ key: '', bitmap: null });

  // Rect mirrored into React state so the overlay re-stamps at 2 Hz.
  const [rect, setRect] = useState<ViewportRect>(emptyRect);

  // World shape signature — re-stamp the offscreen cache when
  // bounds or building count changes.
  const cacheKey = useMemo(() => {
    if (!world) return '';
    return `${world.bounds.width}x${world.bounds.height}:${world.buildingCount}`;
  }, [world, world?.bounds.width, world?.bounds.height, world?.buildingCount]);

  const ensureCache = (): void => {
    if (!world || !canvasRef.current) return;
    if (cacheRef.current.key === cacheKey && cacheRef.current.bitmap) return;
    const off = document.createElement('canvas');
    off.width = MINIMAP_W;
    off.height = MINIMAP_H;
    const octx = off.getContext('2d');
    if (!octx) return;
    // Tiles
    for (const tile of world.tiles_()) {
      paintTile(octx, tile, world.bounds.width, world.bounds.height);
    }
    // Buildings — drawn as filled rects.
    for (const b of world.buildings_()) {
      paintBuilding(octx, b, world.bounds.width, world.bounds.height);
    }
    cacheRef.current = { key: cacheKey, bitmap: null /* keep as canvas ref */ };
    // We use the offscreen canvas itself; store it on the DOM
    // element's data for cheap lookup.
    (canvasRef.current as HTMLCanvasElement & { __cache?: HTMLCanvasElement }).__cache = off;
  };

  // Build the cache when the key changes.
  useEffect(() => {
    ensureCache();
    // Re-paint once on mount / key change.
    drawFrame();
  }, [cacheKey]);

  // 2 Hz tick — re-read camera state and re-paint the viewport rect.
  useInterval(() => {
    drawFrame();
  }, POLL_DELAY_MS);

  // Initial paint when world/camera become available.
  useEffect(() => {
    drawFrame();
  }, [world, camera]);

  function drawFrame(): void {
    if (!world || !camera) {
      setRect(emptyRect());
      return;
    }
    const c = canvasRef.current as
      | (HTMLCanvasElement & { __cache?: HTMLCanvasElement })
      | null;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    // Background.
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
    // Stamped tile+building layer.
    const cache = c.__cache;
    if (cache) {
      ctx.drawImage(cache, 0, 0, MINIMAP_W, MINIMAP_H);
    } else {
      // Cache miss: paint directly (first frame, no world shape change).
      for (const tile of world.tiles_()) {
        paintTile(ctx, tile, world.bounds.width, world.bounds.height);
      }
      for (const b of world.buildings_()) {
        paintBuilding(ctx, b, world.bounds.width, world.bounds.height);
      }
    }
    // Viewport rect.
    const vis = camera.visibleRect();
    const halfW = (vis.maxX - vis.minX) / 2;
    const halfH = (vis.maxY - vis.minY) / 2;
    const next = computeRect(
      world.bounds.width,
      world.bounds.height,
      camera.position.x,
      camera.position.y,
      halfW,
      halfH,
    );
    setRect(next);
    ctx.strokeStyle = VIEWPORT_STROKE;
    ctx.fillStyle = VIEWPORT_FILL;
    ctx.lineWidth = 1.5;
    ctx.fillRect(next.x, next.y, next.w, next.h);
    ctx.strokeRect(next.x, next.y, next.w, next.h);
  }

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    if (!world || !camera) return;
    const target = e.currentTarget;
    const rect = target.getBoundingClientRect();
    // Convert client coords → minimap-px → world-tile coords.
    const mx = ((e.clientX - rect.left) / rect.width) * MINIMAP_W;
    const my = ((e.clientY - rect.top) / rect.height) * MINIMAP_H;
    const wx = (mx / MINIMAP_W) * world.bounds.width;
    const wy = (my / MINIMAP_H) * world.bounds.height;
    camera.panTo(wx, wy);
  };

  return (
    <div
      role="region"
      aria-label="City minimap"
      style={containerStyle}
      data-testid="minimap"
    >
      <canvas
        ref={canvasRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        onClick={handleClick}
        style={canvasStyle}
        data-testid="minimap-canvas"
      />
      <div style={labelStyle}>Minimap · {rect.w > 0 ? 'click to recentre' : 'no world'}</div>
    </div>
  );
}

function paintTile(
  ctx: CanvasRenderingContext2D,
  tile: Tile,
  worldW: number,
  worldH: number,
): void {
  const sx = (tile.coord.x / worldW) * MINIMAP_W;
  const sy = (tile.coord.y / worldH) * MINIMAP_H;
  const sw = Math.max(1, Math.ceil(MINIMAP_W / worldW));
  const sh = Math.max(1, Math.ceil(MINIMAP_H / worldH));
  ctx.fillStyle = TILE_COLOR[tile.kind] ?? TILE_COLOR.ground;
  ctx.fillRect(sx, sy, sw, sh);
}

function paintBuilding(
  ctx: CanvasRenderingContext2D,
  b: Building,
  worldW: number,
  worldH: number,
): void {
  const x = (b.origin.x / worldW) * MINIMAP_W;
  const y = (b.origin.y / worldH) * MINIMAP_H;
  const w = Math.max(1, (b.size.width / worldW) * MINIMAP_W);
  const h = Math.max(1, (b.size.height / worldH) * MINIMAP_H);
  ctx.fillStyle = BUILDING_COLOR;
  ctx.fillRect(x, y, w, h);
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 12,
  padding: 6,
  background: 'rgba(11, 18, 32, 0.78)',
  border: `1px solid ${BORDER_COLOR}`,
  borderRadius: 8,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  pointerEvents: 'auto',
  zIndex: 10,
  userSelect: 'none',
};

const canvasStyle: React.CSSProperties = {
  display: 'block',
  width: MINIMAP_W,
  height: MINIMAP_H,
  borderRadius: 4,
  cursor: 'crosshair',
  imageRendering: 'pixelated',
};

const labelStyle: React.CSSProperties = {
  marginTop: 4,
  fontSize: 11,
  color: '#8a98ac',
  textAlign: 'center',
  letterSpacing: 0.3,
};

export default MiniMap;
