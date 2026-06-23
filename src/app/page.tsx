'use client';

import { useEffect, useRef } from 'react';

/**
 * Root page for the City Simulation.
 *
 * Establishes the Canvas↔React bridge boundary (spec §5.5):
 * - A full-screen <canvas> rendered and controlled imperatively via a ref.
 * - A React UI overlay layered above the canvas (pointer-events-none so events
 *   pass through to the canvas for future Camera pan/zoom).
 * - A mount-only useEffect that will instantiate the engine.
 *
 * No React state is used here: the rAF loop and game state live in the engine
 * and communicate with React via refs, never via useState (prevents 60fps
 * re-renders).
 */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // TODO: Instantiate the engine (Renderer, Camera, GameLoop, Grid) here.
    // The engine owns the rAF loop and draws directly to `canvas` via the
    // 2D context. React must not drive per-frame updates.
    //
    // When the engine is wired up, store its rAF handle on this variable so
    // the cleanup below can cancel it on unmount (safe under StrictMode and
    // HMR). Initialized to 0, which cancelAnimationFrame treats as a no-op.
    const animationFrameId = 0;

    return () => {
      cancelAnimationFrame(animationFrameId);
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
        <p className="mt-4 text-lg text-gray-400">Loading the city…</p>
      </div>
    </main>
  );
}
