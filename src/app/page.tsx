'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera } from '@/engine/Camera';
import { GameLoop, SIMULATION_STEP } from '@/engine/GameLoop';
import { Renderer } from '@/engine/Renderer';
import { spriteLoader } from '@/engine/SpriteLoader';
import { BenchmarkReporter } from '@/engine/BenchmarkReporter';
import { TILE_SIZE } from '@/engine/World';
import { generateCity } from '@/generation/CityGenerator';
import { extractRoadGraph } from '@/entities/Road';
import { EventBus } from '@/systems/EventBus';
import { TrafficSystem } from '@/systems/TrafficSystem';
import { CommuteSystem } from '@/systems/CommuteSystem';
import { MovementSystem } from '@/systems/MovementSystem';
import { TimeSystem } from '@/systems/TimeSystem';
import { BusinessHoursSystem } from '@/systems/BusinessHoursSystem';
import TimeControls from '@/ui/TimeControls';
import Tooltip, { type TooltipContent } from '@/ui/Tooltip';
import Dashboard from '@/ui/Dashboard';
import CityLog from '@/ui/CityLog';
import MiniMap from '@/ui/MiniMap';
import LoadingScreen from '@/ui/LoadingScreen';
import type { Building } from '@/engine/types';
import type { World } from '@/engine/World';

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
 * Camera input (spec §6.3, Phase 7 smooth lerp):
 * - Pan via click-drag using camera target methods (smooth lerp at 0.1/frame).
 * - Zoom via wheel, anchored at the cursor, using target methods.
 * - Pinch-zoom via touch (two-finger distance ratio at the midpoint).
 * - One-finger touch drag pans.
 * - camera.update() is called each render frame to apply the lerp.
 *
 * Loading screen (spec §8 Phase 7):
 * - A loading overlay is shown on mount and hidden after city generation
 *   completes (deferred via setTimeout so the overlay paints first).
 */
export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeSystemRef = useRef<TimeSystem | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const worldRef = useRef<World | null>(null);
  const cameraRef = useRef<Camera | null>(null);
  const [engineReady, setEngineReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<TooltipContent | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Defer city generation so the loading screen has a chance to paint
    // before the synchronous generateCity call blocks the main thread
    // (spec §8 Phase 7). setTimeout gives React time to render the overlay.
    const initTimeout = setTimeout(() => {
      // Size the backing store to the displayed element.
      const resize = () => {
        canvas.width = canvas.clientWidth;
        canvas.height = canvas.clientHeight;
        cameraRef.current?.setViewport(canvas.clientWidth, canvas.clientHeight);
      };

      // Generate the city and build the renderer + camera + loop.
      const world = generateCity(80, 80);
      worldRef.current = world;
      const renderer = new Renderer(ctx, world, { spriteLoader });

      // EventBus — central pub/sub hub for all city events (spec §3.1).
      const eventBus = new EventBus();
      eventBusRef.current = eventBus;

      // Build the road graph + traffic + commute systems for vehicle handoff.
      const graph = extractRoadGraph(world.grid);
      const traffic = new TrafficSystem({ graph, eventBus });
      const commute = new CommuteSystem(world, { graph, traffic, eventBus });
      const movement = new MovementSystem();
      const businessHours = new BusinessHoursSystem(world, { eventBus });
      const timeSystem = new TimeSystem(eventBus);
      timeSystem.setSpeed(1);
      timeSystemRef.current = timeSystem;
      setEngineReady(true);

      const worldPixelWidth = world.width * TILE_SIZE;
      const worldPixelHeight = world.height * TILE_SIZE;
      const camera = new Camera(worldPixelWidth, worldPixelHeight, {
        viewportWidth: canvas.clientWidth,
        viewportHeight: canvas.clientHeight,
        initialZoom: 1,
      });
      cameraRef.current = camera;

      resize();
      window.addEventListener('resize', resize);

      // --- Mouse pan (click-drag) — uses smooth lerp target methods ---
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
        if (dragging) {
          const dx = e.clientX - lastMouseX;
          const dy = e.clientY - lastMouseY;
          lastMouseX = e.clientX;
          lastMouseY = e.clientY;
          // Smooth lerp pan: update target, camera.update() applies motion.
          camera.panTarget(dx, dy);
          return;
        }

        // Hover detection (spec §6.4).
        const rect = canvas.getBoundingClientRect();
        const screenX = e.clientX - rect.left;
        const screenY = e.clientY - rect.top;
        const worldPos = camera.screenToWorld(screenX, screenY);

        const HIT_RADIUS = 6;
        let nearestCitizen = null;
        let nearestDist = HIT_RADIUS;
        for (const c of world.citizens) {
          const p = c.getPosition();
          const d = Math.hypot(p.x - worldPos.x, p.y - worldPos.y);
          if (d <= nearestDist) {
            nearestDist = d;
            nearestCitizen = c;
          }
        }
        if (nearestCitizen) {
          setTooltip({ kind: 'citizen', citizen: nearestCitizen, x: screenX, y: screenY });
          return;
        }

        let hitBuilding: Building | null = null;
        for (const b of world.buildings.values()) {
          const bx = b.x * TILE_SIZE;
          const by = b.y * TILE_SIZE;
          const bw = b.width * TILE_SIZE;
          const bh = b.height * TILE_SIZE;
          if (
            worldPos.x >= bx &&
            worldPos.x < bx + bw &&
            worldPos.y >= by &&
            worldPos.y < by + bh
          ) {
            hitBuilding = b;
            break;
          }
        }
        if (hitBuilding) {
          let occupancy = 0;
          for (const c of world.citizens) {
            if (c.homeId === hitBuilding.id || c.workplaceId === hitBuilding.id) {
              occupancy++;
            }
          }
          setTooltip({
            kind: 'building',
            building: hitBuilding,
            occupancy,
            x: screenX,
            y: screenY,
          });
          return;
        }

        setTooltip(null);
      };

      const endDrag = () => {
        dragging = false;
        canvas.style.cursor = 'grab';
      };

      // --- Wheel zoom (anchored at cursor) — smooth lerp target ---
      const ZOOM_SPEED = 0.0015;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * ZOOM_SPEED);
        camera.zoomTargetAt(factor, cursorX, cursorY);
      };

      // --- Touch pan + pinch-zoom — smooth lerp targets ---
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
          pinchStartZoom = camera.targetZoom;
        }
      };

      const onTouchMove = (e: TouchEvent) => {
        if (e.touches.length === 1 && touchDragging) {
          e.preventDefault();
          const dx = e.touches[0].clientX - lastTouchX;
          const dy = e.touches[0].clientY - lastTouchY;
          lastTouchX = e.touches[0].clientX;
          lastTouchY = e.touches[0].clientY;
          camera.panTarget(dx, dy);
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
          camera.setZoomTarget(targetZoom, midX, midY);
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
          timeSystem.update(SIMULATION_STEP);
          const time = timeSystem.getTime();
          const hour = time.hour;
          movement.update(world.citizens, SIMULATION_STEP, {
            buildings: world.buildings,
            eventBus,
            time,
          });
          traffic.update(SIMULATION_STEP, time);
          commute.update(hour, time);
          businessHours.update(time);
        },
        render: (alpha) => {
          // Apply smooth camera lerp toward target (spec §6.3 Phase 7).
          camera.update();
          // Push the latest camera AND time state into the renderer BEFORE
          // drawing so pan/zoom and day/night lighting update live each frame.
          renderer.setCamera(camera.getTransform());
          renderer.setTime(timeSystem.getTime());
          renderer.setViewport(canvas.width, canvas.height);
          renderer.render(alpha);
        },
      });

      loop.start();

      // BenchmarkReporter writes window.__CITY_BENCHMARK__ every 10s (spec §8).
      const benchmark = new BenchmarkReporter({
        gameLoop: loop,
        world,
        eventBus,
      });
      benchmark.start();

      // City generation complete — hide the loading screen.
      setLoading(false);

      // Store cleanup function on the canvas for the outer return.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (canvas as any).__cleanup = () => {
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
        benchmark.stop();
      };
    }, 50);

    return () => {
      clearTimeout(initTimeout);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cleanup = (canvas as any).__cleanup;
      if (typeof cleanup === 'function') cleanup();
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
        <h1 className="city-title font-bold text-white">City Simulation</h1>
      </div>

      {/* Dashboard top bar (spec §6.4). */}
      {engineReady && worldRef.current && timeSystemRef.current ? (
        <Dashboard world={worldRef.current} timeSystem={timeSystemRef.current} />
      ) : null}

      {/* Time controls overlay (spec §6.4). */}
      {engineReady && timeSystemRef.current ? (
        <TimeControls timeSystem={timeSystemRef.current} />
      ) : null}

      {/* City event log (spec §6.4). */}
      {engineReady && eventBusRef.current ? (
        <CityLog eventBus={eventBusRef.current} />
      ) : null}

      {/* Mini-map (spec §6.4). Hidden below the md breakpoint. */}
      {engineReady && cameraRef.current && worldRef.current ? (
        <MiniMap camera={cameraRef.current} world={worldRef.current} />
      ) : null}

      {/* Hover tooltip (spec §6.4). */}
      <Tooltip content={tooltip} />

      {/* Loading screen overlay (spec §8 Phase 7). */}
      <LoadingScreen visible={loading} />
    </main>
  );
}
