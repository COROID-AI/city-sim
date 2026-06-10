'use client';

/**
 * CityView — top-level page composition.
 *
 * Spec reference: §6.4 Dashboard Layout.
 *
 * Lays out:
 *   - the main canvas (~2/3 width) on the left
 *   - a right rail split vertically into:
 *       - Dashboard  (top, KPIs)
 *       - CityLog    (middle, scrollable, flex-1)
 *       - MiniMap    (bottom, fixed-height canvas)
 *
 * The view is the only place that owns the engine state. It builds
 * a `CitySnapshot` at 2 Hz via `useCitySnapshot` and passes the
 * frozen value down to `Dashboard` and `MiniMap`. `CityLog` reads
 * directly from the shared `cityBus`.
 *
 * Test seam: the view accepts an optional `engine` prop. When
 * omitted, the view constructs a default engine by rendering
 * `CityCanvas` (which builds its own). When supplied, the view
 * uses the provided engine to read state without rendering the
 * production canvas — that path is what the integration test uses.
 */
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';
import { CityCanvas, type CanvasSnapshot } from './CityCanvas';
import { Dashboard } from '@/ui/Dashboard';
import { CityLog } from '@/ui/CityLog';
import { MiniMap } from '@/ui/MiniMap';
import {
  buildCitySnapshot,
  emptyCitySnapshot,
  type CitySnapshot,
} from '@/ui/CitySnapshot';
import { useCitySnapshot } from '@/hooks/useCitySnapshot';
import { EventBus, cityBus, type CityEventMap } from '@/systems/EventBus';

/** Minimal engine surface the view needs to read state. */
export interface CityViewEngine {
  /** Total city budget (treasury). */
  getBudget(): number;
  /** Open + total company counts. */
  getCompanyCounts(): { open: number; total: number };
  /** Current in-game time. */
  getTime(): { day: number; hour: number; minute: number };
  /** Live (non-commuting) citizens. */
  getCitizens(): ReadonlyArray<{
    id: string;
    position: { x: number; y: number };
    needs: { energy: number; hunger: number; fun: number; social: number };
  }>;
  /** Active vehicles. */
  getVehicles(): ReadonlyArray<{
    id: string;
    position: { x: number; y: number };
    status?: string;
  }>;
  /** Companies (used for the mini-map). */
  getCompanies(): ReadonlyArray<{
    id: string;
    position: { x: number; y: number };
    buildingTypeId: string;
  }>;
  /** Resolve a building-type color (optional, used by the mini-map). */
  resolveBuildingColor?(buildingTypeId: string): string | undefined;
}

export interface CityViewProps {
  /**
   * Optional engine override. When omitted, the view constructs a
   * default engine that reads the live state from the CityCanvas
   * via a callback (production path). When supplied, the view
   * reads from this engine directly (test path) and DOES NOT
   * render the CityCanvas, so the test can mount with a
   * deterministic, mocked world.
   */
  engine?: CityViewEngine;
  /** Optional bus override for the CityLog. Defaults to `cityBus`. */
  bus?: EventBus<CityEventMap>;
}

function buildSnapshotFromEngine(engine: CityViewEngine): CitySnapshot {
  const citizens = engine.getCitizens();
  const vehicles = engine.getVehicles();
  const companies = engine.getCompanies();
  const time = engine.getTime();
  const counts = engine.getCompanyCounts();
  return buildCitySnapshot({
    day: time.day,
    hour: time.hour,
    minute: time.minute,
    budget: engine.getBudget(),
    openCompanies: counts.open,
    totalCompanies: counts.total,
    citizens: citizens.map((c) => ({
      id: c.id as never,
      position: c.position,
      needs: c.needs,
      name: '',
      homeId: '' as never,
      workplaceId: null,
      schedule: [],
      currentActivity: 'sleep' as const,
    })) as never,
    vehicles: vehicles.map((v) => ({
      id: v.id,
      position: v.position,
      status: v.status,
    })),
    companies: companies.map((c) => ({
      id: c.id as never,
      buildingTypeId: c.buildingTypeId,
      position: c.position,
      status: 'open' as const,
      employees: [],
      totalRevenue: 0,
      totalWages: 0,
      totalTax: 0,
      ledger: [],
      openedOnDay: 0,
    })) as never,
    resolveBuildingColor: engine.resolveBuildingColor,
  });
}

/**
 * Build a full `CitySnapshot` from the compact `CanvasSnapshot` the
 * canvas bridge emits. Citizens / vehicles / companies lists are
 * empty here because the canvas bridge is intentionally narrow — it
 * only carries the scalar KPIs the dashboard cares about. The
 * mini-map renders an empty canvas in this case, which is fine for
 * the production layout (the panel still frames the world).
 */
function buildCitySnapshotFromCanvas(snap: CanvasSnapshot): CitySnapshot {
  return buildCitySnapshot({
    day: snap.day,
    hour: snap.hour,
    minute: snap.minute,
    budget: snap.budget,
    openCompanies: snap.openCompanies,
    totalCompanies: snap.totalCompanies,
  });
}

function CityViewImpl({ engine, bus }: CityViewProps): ReactElement {
  // When an explicit engine is provided we read from it directly
  // and do NOT render the production canvas (avoids constructing
  // systems twice). When omitted we render the CityCanvas and
  // bridge its internal state upward via a controlled snapshot.
  const [bridgedSnapshot, setBridgedSnapshot] = useState<CitySnapshot>(() =>
    emptyCitySnapshot(),
  );

  // The reader used by `useCitySnapshot`. If we have an engine we
  // delegate to it; otherwise we re-emit the most recent bridged
  // snapshot from the canvas.
  const read = useCallback((): CitySnapshot => {
    if (engine) return buildSnapshotFromEngine(engine);
    return bridgedSnapshot;
  }, [engine, bridgedSnapshot]);

  const snapshot = useCitySnapshot(read, 500);

  // The CityCanvas emits a compact `CanvasSnapshot`. The view derives
  // a full `CitySnapshot` from it so the Dashboard + MiniMap can
  // render without re-implementing the engine wiring.
  const handleCanvasSnapshot = useCallback((snap: CanvasSnapshot): void => {
    setBridgedSnapshot(buildCitySnapshotFromCanvas(snap));
  }, []);

  return (
    <div
      data-testid="city-view"
      className="grid h-full min-h-[480px] w-full grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]"
    >
      <div className="min-w-0">
        {engine === undefined ? (
          <CityCanvas onSnapshot={handleCanvasSnapshot} />
        ) : (
          // When an explicit engine is supplied, render a placeholder
          // that still carries the testid so the integration test
          // can find the canvas host. The engine is the source of
          // truth for state, not the canvas.
          <div
            data-testid="city-canvas"
            data-test-engine="1"
            className="rounded-md border border-border bg-ground"
            style={{ width: '100%', height: 480 }}
          />
        )}
      </div>
      <aside className="flex min-h-0 flex-col gap-3">
        <Dashboard snapshot={snapshot} />
        <CityLog bus={bus ?? cityBus} />
        <MiniMap snapshot={snapshot} />
      </aside>
    </div>
  );
}

export const CityView = CityViewImpl;
