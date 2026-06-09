'use client';

/**
 * CityCanvas — top-level canvas host.
 *
 * Mounts the `Renderer`, wires pointer events for the hover tooltip,
 * and re-renders the canvas every time the city clock ticks. The host
 * owns pointer events (not the Tooltip) so the tooltip is reusable from
 * any future canvas host and we avoid the canvas-vs-DOM event-ordering
 * bug where `mousemove` on a child element stops firing on the canvas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { createRenderer, type Camera, type Renderer } from './Renderer';
import { Tooltip, clampTooltipPosition } from '@/ui/Tooltip';
import { useCityClock } from '@/hooks/useCityClock';
import {
  TimeSystem,
  NeedSystem,
  CommuteManager,
  TrafficSystem,
  EconomySystem,
  cityBus,
  generateCity,
} from '@/systems';
import { type Citizen, isCitizen } from '@/entities';
import type { ActivityId, BuildingId } from '@/types/common';

const DEFAULT_CAMERA: Camera = { origin: { x: 0, y: 0 }, scale: 1 };

/** Compact read-only view of the engine's UI-relevant state. */
export interface CanvasSnapshot {
  day: number;
  hour: number;
  minute: number;
  budget: number;
  openCompanies: number;
  totalCompanies: number;
  population: number;
  vehicleCount: number;
}

/**
 * Stub building list. The real city generator depends on the road
 * graph (downstream task); for now we hand-construct two buildings
 * and let the generator pick workplace assignments.
 */
function stubBuildings(): { id: BuildingId; position: { x: number; y: number } }[] {
  return [
    { id: 'bldg-home-0' as BuildingId, position: { x: 40, y: 40 } },
    { id: 'bldg-work-0' as BuildingId, position: { x: 120, y: 80 } },
    { id: 'bldg-work-1' as BuildingId, position: { x: 200, y: 60 } },
  ];
}

const WRAPPER_STYLE: CSSProperties = {
  position: 'relative',
  width: 800,
  height: 480,
  overflow: 'hidden',
};

export interface CityCanvasProps {
  /**
   * Optional callback invoked after every render-tick with a compact
   * read-only view of the engine. The view uses this to bridge the
   * canvas's internal state outward to a 2Hz-polled snapshot without
   * taking ownership of system construction.
   */
  onSnapshot?: (snapshot: CanvasSnapshot) => void;
}

export function CityCanvas({ onSnapshot }: CityCanvasProps = {}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const hour = useCityClock();

  // Build initial world state once. We don't need to re-run CityGenerator
  // on every tick; the NeedSystem advances the citizens in place.
  const initial = useMemo(() => {
    const buildings = stubBuildings().map((b) => ({
      id: b.id,
      position: b.position,
      capacity: 25,
    }));
    // generateCity(buildings, options) — buildings is the first positional arg.
    return generateCity(buildings, { seed: 1337, citizenCount: 75 });
  }, []);

  // The need system is a long-lived holder for the citizen list.
  // We also keep a reference to the underlying TimeSystem so the
  // snapshot bridge can read the current in-game day/hour/minute
  // (NeedSystem does not expose time itself; it only consumes it).
  const { needSystem, timeSystem } = useMemo(() => {
    const time = new TimeSystem();
    time.setBus(cityBus);
    const needs = new NeedSystem(initial.citizens, { timeProvider: time });
    return { needSystem: needs, timeSystem: time };
  }, [initial]);

  // The commute manager is the citizen<->vehicle handoff state
  // machine. It is hooked up here so the renderer has a vehicle list
  // to draw, but it is a no-op until something calls beginCommute
  // (which arrives in a follow-up task). Keeping it in the React tree
  // now means we can verify drawVehicles receives a (still empty)
  // list today and integrate handoff in the next task without
  // touching the canvas.
  const commuteManager = useMemo(() => {
    const m = new CommuteManager({ bus: cityBus });
    return m;
  }, []);

  // Traffic + economy systems. They share the city-wide bus and are
  // wired here so the dashboard / event-log / mini-map can subscribe
  // to the same events that drive the simulation. Neither system is
  // read by the renderer today; both are stable hooks for the
  // dashboard follow-up task.
  // Construct the systems so they share the city-wide bus. The
  // reference is held by the useMemo'd closure and is intentionally
  // not read by the renderer; downstream consumers (dashboard,
  // event-log, mini-map) will subscribe to the same bus to observe
  // the events these systems emit. Both systems are created exactly
  // once for the lifetime of the canvas.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const trafficSystem = useMemo(() => new TrafficSystem({ bus: cityBus }), []);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const economySystem = useMemo(
    () => new EconomySystem({ bus: cityBus, initialBudget: 50_000 }),
    [],
  );

  // Per-tick: advance the simulation and re-render. Wrapped in a
  // useCallback so the effect below doesn't re-subscribe every render.
  const renderTick = useCallback(
    (currentHour: number) => {
      void currentHour;
      const renderer = rendererRef.current;
      if (renderer === null) return;
      needSystem.update();
      // Drive the economy + time transition: when the in-game day
      // rolls over, the EconomySystem settles the ledger and emits
      // `new_day` on the bus.
      economySystem.tick(currentHour);
      // CommuteManager.tick filters in-flight citizens out of the
      // active list and restores them on arrival. Today it is a
      // pass-through (no in-flight citizens) but wiring it here
      // keeps the renderer contract stable for the follow-up task
      // that emits vehicles.
      const tickResult = commuteManager.tick(needSystem.getCitizens());
      renderer.drawCitizens(tickResult.activeCitizens, DEFAULT_CAMERA);
      renderer.drawVehicles(tickResult.activeVehicles, DEFAULT_CAMERA);
    },
    [needSystem, commuteManager, economySystem],
  );

  // Bridge state outward when a consumer (e.g. CityView) is listening.
  // Wrapped in a stable callback so the effect below can depend on it.
  const emitSnapshot = useCallback(() => {
    if (onSnapshot === undefined) return;
    const citizens = needSystem.getCitizens();
    const companies = economySystem.getCompanies();
    const open = companies.filter((c) => c.status === 'open').length;
    const elapsed = timeSystem.getElapsedMinutes();
    const day = Math.floor(elapsed / (24 * 60));
    onSnapshot({
      day,
      hour: timeSystem.getCurrentHour(),
      minute: timeSystem.getCurrentMinute(),
      budget: economySystem.getBudget(),
      openCompanies: open,
      totalCompanies: companies.length,
      population: citizens.length,
      vehicleCount: commuteManager.getVehicles().length,
    });
  }, [onSnapshot, needSystem, economySystem, commuteManager, timeSystem]);

  // Mouse hover state for the tooltip.
  const [hover, setHover] = useState<{ citizen: Citizen | null; x: number; y: number }>({
    citizen: null,
    x: 0,
    y: 0,
  });

  // Mount the renderer on first effect; dispose on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;
    const renderer = createRenderer(canvas, { width: 800, height: 480 });
    rendererRef.current = renderer;
    // Initial paint.
    renderer.drawCitizens(needSystem.getCitizens(), DEFAULT_CAMERA);
    renderer.drawVehicles(commuteManager.getVehicles(), DEFAULT_CAMERA);
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [needSystem]);

  // Re-render whenever the city clock reports a new hour.
  useEffect(() => {
    renderTick(hour);
    emitSnapshot();
  }, [hour, renderTick, emitSnapshot]);

  // Pointer move / leave on the wrapper (not the canvas) so the
  // tooltip stays usable from any future host.
  function handleMove(e: React.PointerEvent<HTMLDivElement>): void {
    const renderer = rendererRef.current;
    const wrapper = wrapperRef.current;
    if (renderer === null || wrapper === null) return;
    const rect = wrapper.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = renderer.hitTest(x, y, needSystem.getCitizens(), DEFAULT_CAMERA);
    if (hit === null) {
      setHover({ citizen: null, x, y });
      return;
    }
    const citizen = needSystem.getCitizens().find((c) => c.id === hit.id);
    if (citizen === undefined || !isCitizen(citizen)) {
      setHover({ citizen: null, x, y });
      return;
    }
    setHover({ citizen, x, y });
  }

  function handleLeave(): void {
    setHover({ citizen: null, x: 0, y: 0 });
  }

  const tooltipPos = useMemo(() => {
    if (hover.citizen === null) return null;
    const wrapper = wrapperRef.current;
    const fallbackW = (typeof WRAPPER_STYLE.width === 'number' ? WRAPPER_STYLE.width : 800);
    const fallbackH = (typeof WRAPPER_STYLE.height === 'number' ? WRAPPER_STYLE.height : 480);
    const host =
      wrapper !== null
        ? { width: wrapper.clientWidth || fallbackW, height: wrapper.clientHeight || fallbackH }
        : { width: fallbackW, height: fallbackH };
    return clampTooltipPosition({ x: hover.x, y: hover.y }, host);
  }, [hover]);

  return (
    <div
      ref={wrapperRef}
      data-testid="city-canvas"
      style={WRAPPER_STYLE}
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
      className="rounded-md border border-border bg-ground"
    >
      <canvas
        ref={canvasRef}
        aria-label="City canvas"
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
      <Tooltip citizen={hover.citizen} position={tooltipPos} />
    </div>
  );
}

// Re-export the camera + activity type for downstream test fixtures.
export type { Camera, ActivityId };
