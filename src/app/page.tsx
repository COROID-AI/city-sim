'use client';

import { useEffect, useRef } from 'react';
import { GameEngine } from '@/engine/GameEngine';

/**
 * Root page — fullscreen city-sim shell.
 *
 * Mounts a single fullscreen <canvas> that the GameEngine renders into,
 * plus four absolute-positioned overlay containers (top bar, event log,
 * time controls, minimap) that downstream tasks populate with the actual
 * React UI components per spec 5.5 / 6.4.
 */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new GameEngine(canvas);
    return () => {
      engine.dispose();
    };
  }, []);

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* Fullscreen canvas — the HTML5 renderer target (spec 5.5) */}
      <canvas
        ref={canvasRef}
        id="city-canvas"
        data-testid="city-canvas"
        className="fixed inset-0 h-screen w-screen"
      />

      {/* UI overlay containers — absolute-positioned placeholders.
          Downstream tasks populate these with real components. */}

      {/* Top dashboard bar (spec 6.4) */}
      <div
        data-testid="ui-top-bar"
        className="pointer-events-none absolute top-0 left-0 right-0"
      />

      {/* Event log — bottom-right (spec 6.4) */}
      <div
        data-testid="ui-event-log"
        className="pointer-events-none absolute bottom-4 right-4"
      />

      {/* Time controls — bottom-center (spec 6.4) */}
      <div
        data-testid="ui-time-controls"
        className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2"
      />

      {/* Minimap — bottom-left, hidden below md breakpoint (spec 6.4) */}
      <div
        data-testid="ui-minimap"
        className="pointer-events-none absolute bottom-4 left-4 hidden md:block"
      />
    </main>
  );
}
