/**
 * City simulation page.
 *
 * Mounts a full-viewport <canvas>, instantiates a `Renderer` in a
 * `useEffect`, resizes the canvas on `window.resize`, and tears the
 * renderer down on unmount. This file is conditional: it requires
 * `next` to be in the project's `dependencies` (the core engine is
 * UI-framework-agnostic and is fully testable without it).
 *
 * If your checkout does not yet have Next.js installed, the engine
 * layer (Renderer, Camera, World, GameLoop) is still consumable from
 * any other UI shell — the renderer takes a raw 2D context, not a
 * React component.
 */

'use client';

import { useEffect, useRef } from 'react';
import { Camera, GameLoop, Renderer, TILE_PIXELS, tryLoadSprites, World } from '@/engine';

export default function CitySimPage(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Hold the active loop and renderer across renders so the effect
  // cleanup can stop / dispose them.
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize the canvas backing store to match its CSS size, accounting
    // for devicePixelRatio for crisp rendering on hi-DPI displays.
    const resize = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = window.innerWidth;
      const cssH = window.innerHeight;
      canvas.width = Math.max(1, Math.floor(cssW * dpr));
      canvas.height = Math.max(1, Math.floor(cssH * dpr));
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    };
    resize();
    window.addEventListener('resize', resize);

    // Build the world, camera, and renderer. In a real game this is
    // where you'd seed the generator and load save data.
    const world = new World({ width: 64, height: 64 });
    const camera = new Camera(world.bounds);
    camera.setViewport(window.innerWidth, window.innerHeight);
    const sprites = tryLoadSprites();
    const renderer = new Renderer({ tilePixels: TILE_PIXELS, sprites });

    const loop = new GameLoop();
    loop.setFrameCallback((realDt: number) => {
      camera.update(realDt);
      renderer.draw(ctx, world, camera);
    });
    loop.start();

    cleanupRef.current = () => {
      loop.stop();
      window.removeEventListener('resize', resize);
    };
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  return (
    <main
      style={{
        position: 'fixed',
        inset: 0,
        margin: 0,
        background: 'var(--surface, #0b1220)',
      }}
    >
      <canvas
        ref={canvasRef}
        aria-label="City simulation"
        style={{ display: 'block', width: '100vw', height: '100vh' }}
      />
    </main>
  );
}
