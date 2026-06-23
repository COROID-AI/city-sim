'use client';

import { useEffect, useState } from 'react';
import type { World } from '@/engine/World';
import type { TimeSystem } from '@/systems/TimeSystem';
import type { CityTime } from '@/engine/types';

/**
 * Dashboard — top-bar overlay showing live city stats (spec §6.4).
 *
 * Renders a fixed top bar (h-14, bg-slate-900/80, backdrop-blur, text-white)
 * with: city name, sim-time clock (HH:MM + Day N), population, employment
 * rate %, budget, and a "Built by Coroid" badge.
 *
 * Canvas↔React bridge (spec §5.5):
 *  - All displayed values are polled at 2 Hz via setInterval(500ms).
 *  - No React state is mutated inside the rAF loop. The engine mutates its
 *    own state each frame; this component simply reads a snapshot twice per
 *    second and re-renders, decoupling React from the render loop.
 *
 * Budget derivation (no EconomySystem exists yet):
 *  - Budget = STARTING_BUDGET minus cumulative building upkeep accrued since
 *    the city was founded. Upkeep accrues in sim-minutes derived from the
 *    TimeSystem totalMs, so the budget decreases monotonically over time.
 *  - A future EconomySystem task can replace {@link deriveBudget} cleanly.
 */

/** Polling interval (ms) for syncing displayed stats. 2 Hz. */
const POLL_INTERVAL_MS = 500;

/** City name shown in the top-left of the bar. */
const CITY_NAME = 'Coroid City';

/**
 * Starting treasury. Used as the budget baseline because no EconomySystem
 * exists yet. Exported so a future EconomySystem task can replace the
 * derivation without magic numbers.
 */
export const STARTING_BUDGET = 50000;

/**
 * Upkeep accrual rate: currency units per real second of simulation.
 * Tuned so the budget visibly decreases over a short play session without
 * draining to zero within the 60s E2E run.
 */
const UPKEEP_PER_REAL_SECOND = 5;

/**
 * Derive the current budget from the simulation clock.
 *
 * Budget = STARTING_BUDGET - (elapsed real seconds * upkeep rate), where
 * elapsed real seconds = totalSimMs / TIME_COMPRESSION (288). This keeps the
 * value tied to sim progress and responsive to the speed multiplier.
 */
function deriveBudget(totalSimMs: number): number {
  const TIME_COMPRESSION = 288;
  const elapsedRealSeconds = totalSimMs / TIME_COMPRESSION / 1000;
  return Math.max(0, STARTING_BUDGET - elapsedRealSeconds * UPKEEP_PER_REAL_SECOND);
}

/** Zero-pad a number to 2 digits for the HH:MM clock. */
function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Snapshot of all values displayed by the Dashboard. */
interface DashboardSnapshot {
  /** Formatted clock string, e.g. "08:30". */
  clock: string;
/** Day label, e.g. "Day 3". */
  dayLabel: string;
  /** Total population count. */
  population: number;
  /** Employment rate as a percentage [0..100]. */
  employmentRate: number;
  /** Current budget (currency units). */
  budget: number;
}

/**
 * Read a fresh snapshot of all displayed values from the engine.
 * Pure read — does not mutate engine state.
 */
function readSnapshot(world: World, timeSystem: TimeSystem): DashboardSnapshot {
  const time: CityTime = timeSystem.getTime();
  const citizens = world.citizens;
  const population = citizens.length;
  const employed = population > 0
    ? citizens.filter((c) => c.employed).length
    : 0;
  const employmentRate = population > 0 ? Math.round((employed / population) * 100) : 0;
  const budget = deriveBudget(timeSystem.getTotalMs());

  return {
    clock: `${pad2(time.hour)}:${pad2(time.minute)}`,
    dayLabel: `Day ${time.day + 1}`,
    population,
    employmentRate,
    budget: Math.round(budget),
  };
}

export interface DashboardProps {
  /** Engine world (for population / employment). */
  world: World;
  /** Engine time system (for clock / day / budget derivation). */
  timeSystem: TimeSystem;
}

export default function Dashboard({
  world,
  timeSystem,
}: DashboardProps): JSX.Element {
  const [snap, setSnap] = useState<DashboardSnapshot>(() =>
    readSnapshot(world, timeSystem),
  );

  // Poll engine state at 2 Hz. No rAF coupling (spec §5.5).
  useEffect(() => {
    const id = window.setInterval(() => {
      setSnap(readSnapshot(world, timeSystem));
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [world, timeSystem]);

  return (
    <div
      className="pointer-events-none fixed left-0 top-0 z-20 flex h-14 w-full items-center gap-6 bg-slate-900/80 px-4 text-white backdrop-blur"
      data-testid="dashboard"
    >
      <span className="text-lg font-bold" data-testid="dashboard-city-name">
        {CITY_NAME}
      </span>

      <span className="font-mono text-sm" data-testid="dashboard-time">
        {snap.clock}
      </span>
      <span className="text-sm text-slate-300" data-testid="dashboard-day">
        {snap.dayLabel}
      </span>

      <span className="text-sm" data-testid="dashboard-population">
        👥 {snap.population}
      </span>
      <span className="text-sm" data-testid="dashboard-employment">
        💼 {snap.employmentRate}%
      </span>
      <span className="text-sm" data-testid="dashboard-budget">
        💰 {snap.budget.toLocaleString()}
      </span>

      <span
        className="ml-auto rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold"
        data-testid="dashboard-badge"
      >
        Built by Coroid
      </span>
    </div>
  );
}
