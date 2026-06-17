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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  FIXED_DT,
  GameLoop,
  Renderer,
  TILE_PIXELS,
  World,
} from '@/engine';
import {
  EconomySystem,
  EventBus,
  MovementSystem,
  NeedSystem,
  TimeSystem,
  DEFAULT_REAL_TO_SIM_RATIO,
  type SimEventMap,
} from '@/systems';
import type { Schedule } from '@/systems/ScheduleGenerator';
import { CityGenerator } from '@/generation';
import { TimeControls } from '@/ui/TimeControls';
import { Tooltip } from '@/ui/Tooltip';
import { Dashboard } from '@/ui/Dashboard';
import { CityLog } from '@/ui/CityLog';
import { MiniMap } from '@/ui/MiniMap';
import { SimUiContext, type SimUiHandles } from '@/ui/SimUiContext';
import type { Citizen } from '@/entities/Citizen';
import type { Vector2 } from '@/engine/types';

export default function CitySimPage(): React.ReactElement {
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

  // Hover state for the citizen tooltip. We intentionally keep these
  // in React state (not refs) so the Tooltip can re-render, but the
  // canvas itself never re-renders — the mousemove handler updates
  // state only, the frame loop keeps calling `renderer.draw*` on the
  // same canvas ref.
  const [hover, setHover] = useState<{ citizen: Citizen | null; x: number; y: number }>({
    citizen: null,
    x: 0,
    y: 0,
  });

  // Mirror refs (mutated by the rAF loop) so we can re-render the HUD
  // without re-rendering the canvas.
  const timeRef = useRef<TimeSystem | null>(null);
  // Camera ref for the hover hit-test. Lives outside the rAF loop so
  // the mousemove handler can read the latest viewport / pan / zoom.
  const cameraRef = useRef<Camera | null>(null);
  // EventBus + EconomySystem + World refs, populated by the mount
  // effect. Downstream UI components (Dashboard, CityLog, MiniMap)
  // read these via SimUiContext. Refs (not React state) are used so
  // the rAF loop can drive them without re-rendering.
  const simBusRef = useRef<EventBus<SimEventMap> | null>(null);
  const economyRef = useRef<EconomySystem | null>(null);
  const worldRef = useRef<World | null>(null);
  // Latest hover state, used by the mousemove handler to detect
  // transitions without invoking the React state setter on every
  // mousemove.
  const hoverRef = useRef<{ citizen: Citizen | null; x: number; y: number }>({
    citizen: null,
    x: 0,
    y: 0,
  });
  // Keep the ref in sync with state so the handler can read it.
  hoverRef.current = hover;

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

    // Generate a full procedural city (roads, zones, buildings, citizens).
    const city = new CityGenerator().generate({ seed: 42 });
    const world = city.world;
    worldRef.current = world;
    const camera = new Camera(world.bounds);
    camera.setViewport(window.innerWidth, window.innerHeight);
    camera.panTo(world.bounds.width / 2, world.bounds.height / 2);
    const renderer = new Renderer({ tilePixels: TILE_PIXELS });
    const time = new TimeSystem();
    timeRef.current = time;

    const movement = new MovementSystem();
    const needSystem = new NeedSystem();
    const schedules = city.schedules;

    // EventBus + EconomySystem. The bus is the single integration
    // point between the sim and the React UI: producers (economy,
    // time, traffic) emit typed events; downstream UI components
    // subscribe via `useEffect`. We expose the system via refs (not
    // React state) so the rAF loop can drive it without re-rendering.
    // `World` already conforms to the structural
    // `EconomySystemWorldView` shape, so passing it directly is
    // type-safe and zero-cost.
    const simBus = new EventBus<SimEventMap>();
    const economy = new EconomySystem(simBus, world);
    simBusRef.current = simBus;
    economyRef.current = economy;

    // Seed commute targets from citizen schedules.
    updateCommuteTargets(world, movement, schedules, time.getTime().hour);
    cameraRef.current = camera;
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
      const t = time.getTime();
      const simSeconds = dt * time.getSpeed() * DEFAULT_REAL_TO_SIM_RATIO;
      const simHours = simSeconds / 3600;
      economy.tick(t.day, t.hour);
      needSystem.tick(world, simHours, schedules, t.hour);
      updateCommuteTargets(world, movement, schedules, t.hour);
      movement.update(world, simSeconds);
    });
    loop.setFrameCallback((realDt: number) => {
      camera.update(realDt);
      const t = time.getTime();
      const daylight = time.daylightFactor();
      renderer.drawWithLighting(ctx, world, camera, daylight, t.hour);
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

    // Hover hit-test: convert a screen-space mouse coord to a citizen
    // by checking every citizen's projected world position. We do NOT
    // call `setState` for the no-hover case so React skips re-render
    // churn when the cursor moves over empty space — only the actual
    // hover transition triggers a re-render.
    const handleMouseMove = (e: MouseEvent): void => {
      const cam = cameraRef.current;
      if (!cam) return;
      const hit = pickCitizenAtScreen(world, cam, e.clientX, e.clientY, 6);
      if (hit) {
        setHover({ citizen: hit, x: e.clientX, y: e.clientY });
      } else if (hoverRef.current.citizen !== null) {
        setHover({ citizen: null, x: e.clientX, y: e.clientY });
      }
    };
    const handleMouseLeave = (): void => {
      if (hoverRef.current.citizen !== null) {
        setHover({ citizen: null, x: 0, y: 0 });
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseleave', handleMouseLeave);

    cleanupRef.current = () => {
      loop.stop();
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseleave', handleMouseLeave);
      timeRef.current = null;
      cameraRef.current = null;
      worldRef.current = null;
      // Drop all bus listeners — useful for hot-reload and the
      // React strict-mode double-effect that runs cleanup once
      // before the second mount.
      simBus.clear();
      simBusRef.current = null;
      economyRef.current = null;
    };
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  // The handle bag is rebuilt on every render so it always points
  // at the *current* refs. This costs nothing (no allocations
  // beyond a 6-field object) and means we never have to coordinate
  // a "handles ready" setState with the mount effect that creates
  // the refs.
  const handles = useMemo<SimUiHandles>(
    () => ({
      world: worldRef.current,
      camera: cameraRef.current,
      time: timeRef.current,
      economy: economyRef.current,
      bus: simBusRef.current,
      cityName: 'Coroid City',
    }),
    // Re-derive after the mount effect has run by depending on the
    // refs themselves. They are stable objects once populated; the
    // re-render is triggered once on mount.
    [timeRef.current, cameraRef.current, worldRef.current, simBusRef.current, economyRef.current],
  );

  return (
    <SimUiContext.Provider value={handles}>
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
        <Dashboard />
        <CityLog />
        <MiniMap />
        <TimeControls
          paused={paused}
          speed={speed}
          hour={hour}
          day={day}
          onTogglePause={handleTogglePause}
          onSetSpeed={handleSetSpeed}
        />
        <Tooltip citizen={hover.citizen} x={hover.x} y={hover.y} />
      </main>
    </SimUiContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/* Hover hit-test                                                             */
/* -------------------------------------------------------------------------- */

interface WorldWithCitizens {
  citizens_(): IterableIterator<Citizen>;
}

/**
 * Find the citizen closest to a screen-space (sx, sy) within `tolPx`
 * pixels. Linear scan — fine for the current scale (tens to a few
 * hundred citizens). Returns `null` if no citizen is within
 * tolerance.
 */
function pickCitizenAtScreen(
  world: WorldWithCitizens,
  camera: Camera,
  sx: number,
  sy: number,
  tolPx: number,
): Citizen | null {
  const halfW = camera.viewport.width / 2;
  const halfH = camera.viewport.height / 2;
  // World → screen: scale by tilePixels * zoom, then offset.
  const scale = TILE_PIXELS * camera.zoom;
  let best: Citizen | null = null;
  let bestDist = tolPx;
  for (const c of world.citizens_()) {
    const csx = (c.position.x - camera.position.x) * scale + halfW;
    const csy = (c.position.y - camera.position.y) * scale + halfH;
    const d = Math.hypot(sx - csx, sy - csy);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function buildingCenter(
  world: { getBuilding(id: string): { origin: { x: number; y: number }; size: { width: number; height: number } } | null },
  buildingId: string | null,
): Vector2 | null {
  if (!buildingId) return null;
  const b = world.getBuilding(buildingId);
  if (!b) return null;
  return {
    x: b.origin.x + b.size.width / 2,
    y: b.origin.y + b.size.height / 2,
  };
}

function isInWorkBlock(hour: number, schedule: Schedule): boolean {
  const work = schedule.work;
  if (!work) return false;
  return hour >= work.start && hour < work.end;
}

function updateCommuteTargets(
  world: { citizens_(): IterableIterator<Citizen>; getBuilding(id: string): { origin: { x: number; y: number }; size: { width: number; height: number } } | null },
  movement: MovementSystem,
  schedules: ReadonlyMap<string, Schedule>,
  hour: number,
): void {
  for (const citizen of world.citizens_()) {
    const schedule = schedules.get(citizen.id);
    const atWork = schedule ? isInWorkBlock(hour, schedule) : false;
    const destId = atWork ? citizen.workId : citizen.homeId;
    const target = buildingCenter(world, destId);
    if (target) {
      movement.setTarget(citizen, target.x, target.y);
    } else {
      movement.clearTarget(citizen);
    }
  }
}

// `FIXED_DT` is re-exported via `@/engine`; importing it here keeps
// the dependency on the engine barrel explicit for tooling that
// statically analyses the page module.
export { FIXED_DT };
