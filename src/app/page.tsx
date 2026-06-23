'use client';

import { useEffect, useRef } from 'react';
import { Camera } from '@/engine/Camera';
import { GameLoop, SIMULATION_STEP } from '@/engine/GameLoop';
import { Renderer } from '@/engine/Renderer';
import { TILE_SIZE } from '@/engine/World';
import { generateCity } from '@/generation/CityGenerator';
import { TimeSystem } from '@/systems/TimeSystem';

/**
 * Root page for the City Simulation.
 *
 * Establishes the Canvas↔React bridge boundary (spec §5.5):
 * - A full-screen <canvas> rendered and controlled imperatively via a ref.
 * - A React UI overlay layered above the canvas (pointer-events-none so events
 *   pass through to the canvas for Camera pan/zoom).
 * - A mount-only useEffect that instantiates the engine (Renderer + GameLoop +
 *   Camera) and tears it down on unmount (no rAF leak, no listener leak).
 *
 * Camera input (spec §6.3):
 * - Pan via click-drag (mousedown/mousemove/mouseup).
 * - Zoom via wheel, anchored at the cursor, clamped to [0.25, 3.0].
 * - Pinch-zoom via touch (two-finger distance ratio at the midpoint).
 * - One-finger touch drag pans.
 *
 * No React state is used for per-frame data: the rAF loop and game state live
 * in the engine and draw directly to the canvas via the 2D context. Each frame,
 * renderer.setCamera(camera.getTransform()) is called BEFORE render so camera
 * changes are reflected live.
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
      camera.setViewport(canvas.clientWidth, canvas.clientHeight);
    };

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Generate the city and build the renderer + camera + loop.
    const world = generateCity(80, 80);
    const renderer = new Renderer(ctx, world);
    // TimeSystem drives the day/night cycle; start at 1x speed.
    const timeSystem = new TimeSystem();
    timeSystem.setSpeed(1);
    const worldPixelWidth = world.width * TILE_SIZE;
    const worldPixelHeight = world.height * TILE_SIZE;
    const camera = new Camera(worldPixelWidth, worldPixelHeight, {
      viewportWidth: canvas.clientWidth,
      viewportHeight: canvas.clientHeight,
      initialZoom: 1,
    });

    resize();
    window.addEventListener('resize', resize);

    // --- Mouse pan (click-drag) ---
    let dragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    const onMouseDown = (e: MouseEvent) => {
      dragging = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      canvas.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      camera.pan(dx, dy);
    };

    const endDrag = () => {
      dragging = false;
      canvas.style.cursor = 'grab';
    };

    // --- Wheel zoom (anchored at cursor) ---
    // Attached via addEventListener with { passive: false } so preventDefault
    // works and the page does not scroll (React onWheel is passive in some
    // browsers and would log console warnings).
    const ZOOM_SPEED = 0.0015;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      // Negative deltaY (scroll up) zooms in; positive zooms out.
      const factor = Math.exp(-e.deltaY * ZOOM_SPEED);
      camera.zoomAt(factor, cursorX, cursorY);
    };

    // --- Touch pan + pinch-zoom ---
    let touchDragging = false;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let pinchActive = false;
    let pinchStartDistance = 0;
    let pinchStartZoom = 1;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchDragging = true;
        pinchActive = false;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        touchDragging = false;
        pinchActive = true;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchStartDistance = Math.hypot(dx, dy) || 1;
        pinchStartZoom = camera.zoom;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 1 && touchDragging) {
        e.preventDefault();
        const dx = e.touches[0].clientX - lastTouchX;
        const dy = e.touches[0].clientY - lastTouchY;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
        camera.pan(dx, dy);
      } else if (e.touches.length === 2 && pinchActive) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const distance = Math.hypot(dx, dy) || 1;
        const rect = canvas.getBoundingClientRect();
        const midX =
          (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
        const midY =
          (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
        const targetZoom = pinchStartZoom * (distance / pinchStartDistance);
        camera.setZoom(targetZoom, midX, midY);
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchDragging = false;
        pinchActive = false;
      } else if (e.touches.length === 1) {
        pinchActive = false;
        touchDragging = true;
        lastTouchX = e.touches[0].clientX;
        lastTouchY = e.touches[0].clientY;
      }
    };

    canvas.style.cursor = 'grab';
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);

    const loop = new GameLoop({
      update: () => {
        // Advance the simulation clock by one fixed step. TimeSystem applies
        // its own speed multiplier, so GameLoop stays at speed 1.
        timeSystem.update(SIMULATION_STEP);
      },
      render: (alpha) => {
        // Push the latest camera AND time state into the renderer BEFORE
        // drawing so pan/zoom and day/night lighting update live each frame.
        renderer.setCamera(camera.getTransform());
        renderer.setTime(timeSystem.getTime());
        renderer.render(alpha);
      },
    });

    loop.start();

    return () => {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
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
