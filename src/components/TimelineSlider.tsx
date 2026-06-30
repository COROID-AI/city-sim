'use client';

/**
 * TimelineSlider
 *
 * Top-aligned, keyboard-navigable control that lets the user jump between
 * the five discrete time periods (1945, 1965, 1985, 2005, 2025). Selecting a
 * stop dispatches `store.setYear`, which kicks off the cross-fade transition
 * handled by the year store. The component is presentational only — it never
 * touches the render loop.
 */
import { useCallback, useMemo } from 'react';
import { YEAR_CONFIGS, getYearConfig, type EraId } from '@/config/years';
import { useYearStore } from '@/store/yearStore';

/** Ordered list of era ids rendered as slider stops. */
const ERA_IDS = YEAR_CONFIGS.map((config) => config.id) as readonly EraId[];

export default function TimelineSlider() {
  // The display follows `targetYear` so the UI reflects the user's selection
  // immediately, even while the cross-fade transition is still animating
  // (`selectedYear` only catches up once `completeTransition()` runs).
  const targetYear = useYearStore((state) => state.targetYear);
  const setYear = useYearStore((state) => state.setYear);

  const currentIndex = useMemo(
    () => Math.max(0, ERA_IDS.indexOf(targetYear)),
    [targetYear],
  );

  const currentConfig = useMemo(
    () => getYearConfig(targetYear),
    [targetYear],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const index = Number(event.target.value);
      const era = ERA_IDS[index];
      if (era) {
        setYear(era);
      }
    },
    [setYear],
  );

  return (
    <div
      className="pointer-events-auto absolute left-1/2 top-6 z-20 w-[min(680px,92vw)] -translate-x-1/2"
      data-testid="timeline-slider"
    >
      <div className="rounded-2xl border border-white/10 bg-black/50 px-6 py-4 shadow-2xl backdrop-blur-md">
        {/* Active year display */}
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-xs font-medium uppercase tracking-[0.2em] text-gray-400">
            Year
          </span>
          <span
            className="text-3xl font-bold tabular-nums text-white"
            data-testid="timeline-current-year"
          >
            {currentConfig?.label ?? '—'}
          </span>
        </div>

        {/* Native range input for keyboard + pointer support */}
        <input
          type="range"
          min={0}
          max={ERA_IDS.length - 1}
          step={1}
          value={currentIndex}
          onChange={handleChange}
          aria-label="Timeline year selector"
          aria-valuetext={currentConfig?.label}
          aria-valuemin={0}
          aria-valuemax={ERA_IDS.length - 1}
          className="timeline-range h-2 w-full cursor-pointer appearance-none rounded-full bg-gradient-to-r from-amber-700/60 via-sky-600/60 to-indigo-600/60 accent-cyan-400"
          data-testid="timeline-range-input"
        />

        {/* Discrete year stop labels */}
        <div className="mt-2 flex justify-between">
          {YEAR_CONFIGS.map((config, index) => {
            const isActive = config.id === targetYear;
            return (
              <button
                key={config.id}
                type="button"
                onClick={() => setYear(config.id)}
                aria-pressed={isActive}
                aria-label={`Select year ${config.label}`}
                className={
                  'flex flex-col items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ' +
                  (isActive
                    ? 'text-cyan-300'
                    : 'text-gray-400 hover:text-gray-200')
                }
                data-testid={`timeline-stop-${config.label}`}
                data-active={isActive ? 'true' : 'false'}
              >
                <span
                  className={
                    'h-2 w-2 rounded-full transition-transform ' +
                    (isActive
                      ? 'scale-150 bg-cyan-300 shadow-[0_0_8px_2px_rgba(103,232,249,0.6)]'
                      : 'bg-gray-500')
                  }
                />
                <span className="tabular-nums">{config.label}</span>
                <span className="sr-only">{index}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
