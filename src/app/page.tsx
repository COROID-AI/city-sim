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
 *
 * Time integration: a `TimeSystem` is created alongside the engine
 * and advanced from the fixed-step callback at 20Hz. The page holds
 * React state for the coarse UI summary (paused/speed/hour/day) and
 * forwards user actions from `TimeControls` to the TimeSystem.
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  FIXED_DT,
  GameLoop,
  Renderer,
  TILE_PIXELS,
  tryLoadSprites,
  World,
} from '@/engine';
import { TimeSystem } from '@/systems';
import { TimeControls } from '@/ui/TimeControls';

export default function CitySimPage(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Hold the active loop and renderer across renders so the effect
  // cleanup can stop / dispose them.
  const cleanupRef = useRef<(() => void) | null>(null);

  // Coarse React state for the TimeControls HUD. We intentionally keep
  // the tick-driven values in refs and only mirror them into React
  // state at a throttled cadence so the rAF loop never re-renders.
  const [paused, setPaused] = useState(false);
  const [speed, setSpeedState] = useState(1);
  const [hour, setHour] = useState(8);
  const [day, setDay] = useState(1);

  // Mirror refs (mutated by the rAF loop) so we can re-render the HUD
  // without re-rendering the canvas.
  const timeRef = useRef<TimeSystem | null>(null);

  const handleTogglePause = useCallback((): void => {
    const t = timeRef.current;
    if (!t) return;
    t.togglePause();
    setPaused(t.isPaused());
  }, []);

  const handleSetSpeed = useCallback((multiplier: number): void => {
    const t = timeRef.current;
    if (!t) return;
    t.setSpeed(multiplier);
    // setSpeed(0) also implies a paused state for the UI.
    setPaused(t.isPaused());
    setSpeedState(t.getSpeed());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    // Augment the real canvas context with createRadialGradient so
    // the renderer's lighting passes work in the browser. The
    // augmented object is a thin wrapper that proxies every call to
    // the underlying context but exposes `createRadialGradient` as a
    // regular method (the real DOM type already has it, but TypeScript
    // widens RendererContext to an optional signature, so we cast).
    const ctx = ctx2d as unknown as Parameters<Renderer['draw']>[0] & {
      createRadialGradient: NonNullable<
        Parameters<Renderer['draw']>[0]['createRadialGradient']
      >;
    };

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

    // Build the world, camera, renderer, and time system. In a real
    // game this is where you'd seed the generator and load save data.
    const world = new World({ width: 64, height: 64 });
    const camera = new Camera(world.bounds);
    camera.setViewport(window.innerWidth, window.innerHeight);
    const sprites = tryLoadSprites();
    const renderer = new Renderer({ tilePixels: TILE_PIXELS, sprites });
    const time = new TimeSystem();
    timeRef.current = time;
    // Sync initial HUD state.
    setPaused(time.isPaused());
    setSpeedState(time.getSpeed());
    {
      const initial = time.getTime();
      setHour(initial.hour);
      setDay(initial.day);
    }

    const loop = new GameLoop();
    let lastHudUpdate = 0;
    loop.setFixedStepCallback((dt: number) => {
      time.tick(dt);
    });
    loop.setFrameCallback((realDt: number) => {
      camera.update(realDt);
      const t = time.getTime();
      const daylight = time.daylightFactor();
      renderer.drawWithLighting(ctx, world, camera, daylight);
      // Throttle HUD mirror to ~5Hz to avoid React re-renders on
      // every animation frame. The minute-level precision is plenty
      // for a clock readout.
      lastHudUpdate += realDt;
      if (lastHudUpdate > 0.2) {
        lastHudUpdate = 0;
        setHour(t.hour);
        setDay(t.day);
        setPaused(time.isPaused());
        setSpeedState(time.getSpeed());
      }
    });
    loop.start();

    cleanupRef.current = () => {
      loop.stop();
      window.removeEventListener('resize', resize);
      timeRef.current = null;
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
      <TimeControls
        paused={paused}
        speed={speed}
        hour={hour}
        day={day}
        onTogglePause={handleTogglePause}
        onSetSpeed={handleSetSpeed}
      />
    </main>
  );
}

// `FIXED_DT` is re-exported via `@/engine`; importing it here keeps
// the dependency on the engine barrel explicit for tooling that
// statically analyses the page module.
export { FIXED_DT };
