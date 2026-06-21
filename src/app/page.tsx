'use client';

import { useEffect, useRef } from 'react';
import { TopBar } from '@/ui/TopBar';
import { CityLog } from '@/ui/CityLog';
import { TimeControls } from '@/ui/TimeControls';
import { MiniMap } from '@/ui/MiniMap';
import { Tooltip } from '@/ui/Tooltip';
import { GameEngine } from '@/engine/GameEngine';

/**
 * Home page — city simulation mount point.
 *
 * Per spec section 5.5, the <canvas> and the React UI overlay are decoupled:
 * the canvas is driven imperatively by the GameEngine via its own rAF loop,
 * NOT by React state. A single useEffect boots the GameEngine on mount
 * (generating the city + starting the render loop) and disposes it on unmount.
 */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Boot the engine: generates the city, creates camera/renderer/loop,
    // and attaches pan/zoom input handlers. start() begins the rAF loop.
    const engine = new GameEngine(canvas);
    engine.start();

    return () => {
      engine.dispose();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-900">
      {/*
       * Full-screen simulation canvas. The id="city-canvas" and
       * data-testid="city-canvas" are stable contracts consumed by the
       * scaffold unit test and the Playwright E2E smoke test.
       */}
      <canvas
        ref={canvasRef}
        id="city-canvas"
        data-testid="city-canvas"
        className="absolute inset-0 h-full w-full"
        aria-label="City simulation canvas"
      />

      {/* React UI overlay layer. Purely presentational placeholders; the
       * engine wiring task will populate these without changing the DOM
       * contract (stable data-testid attributes). */}
      <div className="pointer-events-none absolute inset-0">
        <TopBar />
        <CityLog />
        <TimeControls />
        <MiniMap />
        <Tooltip />
      </div>
    </main>
  );
}
