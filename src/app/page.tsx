'use client';

import { useEffect, useRef } from 'react';
import { GameLoop } from '@/engine/GameLoop';
import { Renderer } from '@/engine/Renderer';
import { generateCity } from '@/generation/CityGenerator';

/**
 * Root page for the City Simulation.
 *
 * Establishes the Canvas↔React bridge boundary (spec §5.5):
 * - A full-screen <canvas> rendered and controlled imperatively via a ref.
 * - A React UI overlay layered above the canvas (pointer-events-none so events
 *   pass through to the canvas for future Camera pan/zoom).
 * - A mount-only useEffect that instantiates the engine (Renderer + GameLoop)
 *   and tears it down on unmount (no rAF leak).
 *
 * No React state is used for per-frame data: the rAF loop and game state live
 * in the engine and draw directly to the canvas via the 2D context.
 */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Size the backing store to the displayed element so the city fills the
    // viewport without scaling/blur (default canvas is 300x150 otherwise).
    const resize = () => {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Generate the city and build the renderer + loop.
    const world = generateCity(80, 80);
    const renderer = new Renderer(ctx, world);
    const loop = new GameLoop({
      update: () => {
        // No simulation systems yet; the loop is render-only for now.
      },
      render: (alpha) => renderer.render(alpha),
    });

    loop.start();

    return () => {
      window.removeEventListener('resize', resize);
      loop.stop();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-city-bg">
      {/* Full-screen render target. All drawing is imperative via the ref. */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        data-testid="city-canvas"
      />

      {/* React UI overlay. pointer-events-none lets mouse events reach the
          canvas; interactive children opt back in with pointer-events-auto. */}
      <div
        className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center"
        data-testid="ui-overlay"
      >
        <h1 className="text-4xl font-bold text-white">City Simulation</h1>
      </div>
    </main>
  );
}
