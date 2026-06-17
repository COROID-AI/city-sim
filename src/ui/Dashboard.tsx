/**
 * Dashboard — top status bar overlay.
 *
 * Polls the engine state at 2 Hz (via `useInterval`) and renders:
 *  - City name
 *  - Sim time: `Day N · HH:00`
 *  - Population
 *  - Employment ratio (employed / adult population)
 *  - City treasury with a delta indicator vs. the previous tick
 *
 * All values are read from refs in the SimUiContext handle bag, so
 * the underlying canvas is not re-rendered when the dashboard
 * updates. The component is purely additive — it does not mutate
 * the simulation.
 *
 * Layer rule: this is `'use client'` React 19 code, lives in
 * `src/ui/`, and may import from `@/hooks`, `@/ui/SimUiContext`,
 * and engine / systems types.
 */

'use client';

import { useEffect, useState } from 'react';
import { useInterval } from '@/hooks/useInterval';
import { useSimUi } from './SimUiContext';

const POLL_HZ = 2;
const POLL_DELAY_MS = Math.round(1000 / POLL_HZ);

interface DashboardSnapshot {
  readonly cityName: string;
  readonly day: number;
  readonly hour: number;
  readonly population: number;
  readonly employment: {
    readonly employed: number;
    readonly total: number;
    /** 0..1 ratio. `null` when total is 0. */
    readonly ratio: number | null;
  };
  readonly treasury: number;
  readonly treasuryDelta: number;
}

function readSnapshot(
  handles: ReturnType<typeof useSimUi>,
  prevTreasury: number | null,
): DashboardSnapshot | null {
  const { world, time, economy, cityName } = handles;
  if (!world || !time || !economy) return null;
  const t = time.getTime();
  // Population is the citizen roster size; we treat all citizens as
  // adult population. Employment is the number of citizens with a
  // `workId` set.
  let population = 0;
  let employed = 0;
  for (const c of world.citizens_()) {
    population += 1;
    if (c.workId !== null) employed += 1;
  }
  const treasury = economy.getTreasury();
  return {
    cityName,
    day: t.day,
    hour: t.hour,
    population,
    employment: {
      employed,
      total: population,
      ratio: population > 0 ? employed / population : null,
    },
    treasury,
    treasuryDelta: prevTreasury === null ? 0 : treasury - prevTreasury,
  };
}

function formatHour(hour: number): string {
  const wholeHour = Math.floor(hour) % 24;
  return wholeHour.toString().padStart(2, '0');
}

function formatCurrency(n: number): string {
  if (Number.isNaN(n)) return '$0';
  const rounded = Math.round(n);
  if (Math.abs(rounded) >= 1_000_000) {
    return `$${(rounded / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(rounded) >= 1_000) {
    return `$${(rounded / 1_000).toFixed(1)}k`;
  }
  return `$${rounded.toLocaleString('en-US')}`;
}

function formatDelta(delta: number): string {
  if (delta === 0) return '±$0';
  const sign = delta > 0 ? '+' : '−';
  return `${sign}${formatCurrency(Math.abs(delta))}`;
}

/**
 * A small chip used for the treasury delta — green for a positive
 * delta, red for a negative one. Uses CSS custom properties so it
 * follows the dark HUD aesthetic without hardcoding colors that
 * should live in the palette.
 */
function DeltaChip({ delta }: { delta: number }): React.ReactElement {

  const color = delta > 0
    ? 'var(--accent, #3aa0ff)'
    : delta < 0
      ? 'var(--warning, #ff5577)'
      : 'var(--text-dim, #6b7a90)';
  return (
    <span
      style={{
        marginLeft: 8,
        fontSize: 12,
        fontVariantNumeric: 'tabular-nums',
        color,
        opacity: 0.9,
      }}
      aria-label={delta === 0 ? 'no change' : delta > 0 ? 'treasury increased' : 'treasury decreased'}
    >
      {formatDelta(delta)}
    </span>
  );
}

/**
 * Dashboard component — call it with no props; it pulls all state
 * from the SimUiContext.
 */
export function Dashboard(): React.ReactElement {
  const handles = useSimUi();
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const prevTreasuryRef = useState<{ value: number | null }>({ value: null })[0];

  const tick = (): void => {
    const next = readSnapshot(handles, prevTreasuryRef.value);
    if (next) {
      prevTreasuryRef.value = next.treasury;
      setSnapshot(next);
    }
  };

  useInterval(tick, POLL_DELAY_MS);

  // Read once on mount / when handles change so the dashboard shows
  // non-empty content even before the first 500 ms tick.
  useEffect(() => {
    tick();
    // tick reads from `handles`; we re-run when the handle bag
    // identity changes (only on remount in practice).
  }, [handles]);

  if (!snapshot) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={containerStyle}
        data-testid="dashboard"
      >
        <span style={titleStyle}>City</span>
        <span style={placeholderStyle}>Loading…</span>
      </div>
    );
  }

  const { cityName, day, hour, population, employment, treasury, treasuryDelta } = snapshot;
  const employmentPct = employment.ratio === null
    ? '—'
    : `${Math.round(employment.ratio * 100)}%`;

  return (
    <div
      role="status"
      aria-live="polite"
      style={containerStyle}
      data-testid="dashboard"
    >
      <span style={titleStyle} data-testid="dashboard-city-name">{cityName}</span>
      <span style={statStyle} data-testid="dashboard-time">
        Day {day} · {formatHour(hour)}:00
      </span>
      <span style={statStyle} data-testid="dashboard-population">
        Pop {population.toLocaleString('en-US')}
      </span>
      <span style={statStyle} data-testid="dashboard-employment">
        Jobs {employment.employed}/{employment.total} ({employmentPct})
      </span>
      <span style={statStyle} data-testid="dashboard-treasury">
        {formatCurrency(treasury)}
        <DeltaChip delta={treasuryDelta} />
      </span>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  right: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '10px 16px',
  background: 'rgba(11, 18, 32, 0.78)',
  color: '#e6edf6',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: 8,
  fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  fontSize: 14,
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  pointerEvents: 'none',
  zIndex: 10,
  userSelect: 'none',
};

const titleStyle: React.CSSProperties = {
  fontWeight: 600,
  letterSpacing: 0.4,
};

const statStyle: React.CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  color: '#cfd6e0',
};

const placeholderStyle: React.CSSProperties = {
  color: '#8a98ac',
  fontStyle: 'italic',
};

export default Dashboard;
