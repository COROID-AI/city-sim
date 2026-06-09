'use client';

/**
 * Dashboard — top-of-rail KPI panel.
 *
 * Spec reference: §6.4 Dashboard Layout.
 *
 * Renders a small grid of headline numbers (day, hour, population,
 * budget, companies, traffic) sourced from a `CitySnapshot`. The
 * component is presentational — it does not subscribe to the bus,
 * poll the engine, or own systems. `CityView` is responsible for
 * building the snapshot and passing it down.
 *
 * Re-render strategy: React.memo with a custom areEqual that only
 * re-renders when a small set of scalar fields change. This keeps
 * the dashboard cheap at 2 Hz polling.
 */
import { memo } from 'react';
import type { ReactElement } from 'react';
import type { CitySnapshot } from '@/ui/CitySnapshot';

export interface DashboardProps {
  snapshot: CitySnapshot;
}

interface Kpi {
  label: string;
  value: string;
  testId: string;
  tone: 'foreground' | 'muted' | 'citizen' | 'accent' | 'warning';
}

const TONE_CLASS: Readonly<Record<Kpi['tone'], string>> = {
  foreground: 'text-foreground',
  muted: 'text-muted',
  citizen: 'text-citizen',
  accent: 'text-accent',
  warning: 'text-warning',
};

function formatHour(hour: number, minute: number): string {
  const h = ((hour % 24) + 24) % 24;
  const m = ((minute % 60) + 60) % 60;
  const hh = h.toString().padStart(2, '0');
  const mm = m.toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatBudget(budget: number): string {
  const rounded = Math.round(budget);
  return rounded.toLocaleString('en-US');
}

function buildKpis(snapshot: CitySnapshot): Kpi[] {
  return [
    {
      label: 'Day',
      value: `${snapshot.day}`,
      testId: 'kpi-day',
      tone: 'foreground',
    },
    {
      label: 'Time',
      value: formatHour(snapshot.hour, snapshot.minute),
      testId: 'kpi-time',
      tone: 'foreground',
    },
    {
      label: 'Population',
      value: `${snapshot.population}`,
      testId: 'kpi-population',
      tone: 'citizen',
    },
    {
      label: 'Avg Needs',
      value: `${Math.round(snapshot.avgNeeds)}`,
      testId: 'kpi-needs',
      tone: 'foreground',
    },
    {
      label: 'Budget',
      value: `$${formatBudget(snapshot.budget)}`,
      testId: 'kpi-budget',
      tone: 'accent',
    },
    {
      label: 'Companies',
      value: `${snapshot.openCompanies}/${snapshot.totalCompanies}`,
      testId: 'kpi-companies',
      tone: 'foreground',
    },
    {
      label: 'Vehicles',
      value: `${snapshot.vehicleCount}`,
      testId: 'kpi-vehicles',
      tone: 'warning',
    },
  ];
}

function DashboardImpl({ snapshot }: DashboardProps): ReactElement {
  const kpis = buildKpis(snapshot);
  return (
    <section
      data-testid="city-dashboard"
      aria-label="City dashboard"
      className="rounded-md border border-border bg-surface p-3"
    >
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
        Dashboard
      </h2>
      <dl
        className="grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3"
        data-testid="city-dashboard-kpis"
      >
        {kpis.map((kpi) => (
          <div
            key={kpi.label}
            data-testid={kpi.testId}
            className="flex flex-col"
          >
            <dt className="text-[10px] uppercase tracking-wide text-muted">
              {kpi.label}
            </dt>
            <dd
              className={`text-base font-semibold ${TONE_CLASS[kpi.tone]}`}
              data-kpi-value={kpi.label}
            >
              {kpi.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function areDashboardPropsEqual(
  prev: DashboardProps,
  next: DashboardProps,
): boolean {
  const a = prev.snapshot;
  const b = next.snapshot;
  return (
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute &&
    a.population === b.population &&
    Math.round(a.avgNeeds) === Math.round(b.avgNeeds) &&
    a.budget === b.budget &&
    a.openCompanies === b.openCompanies &&
    a.totalCompanies === b.totalCompanies &&
    a.vehicleCount === b.vehicleCount
  );
}

export const Dashboard = memo(DashboardImpl, areDashboardPropsEqual);
