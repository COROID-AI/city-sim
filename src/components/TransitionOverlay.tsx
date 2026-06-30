'use client';

/**
 * TransitionOverlay
 *
 * A lightweight DOM overlay shown only while a year transition is in flight.
 * It surfaces three pieces of affordance required by the polish spec:
 *
 *  1. A loading indicator (animated progress bar driven by `transitionProgress`).
 *  2. The current (target) year label so the user knows where they are headed.
 *  3. A short help tooltip explaining what is happening.
 *
 * The component subscribes to the store via selectors, so it only re-renders
 * when the relevant slices change — not on every animation frame. The progress
 * bar width is driven by `transitionProgress`, but because the store updates
 * are throttled to the rAF cadence this is cheap (a single style mutation per
 * frame on a tiny DOM node).
 */
import { useMemo, type FC } from 'react';
import { getYearConfig } from '@/config/years';
import { useYearStore } from '@/store/yearStore';

const TransitionOverlay: FC = () => {
  const isTransitioning = useYearStore((s) => s.transitionProgress < 1);
  const targetYear = useYearStore((s) => s.targetYear);
  const progress = useYearStore((s) => s.transitionProgress);

  const targetLabel = useMemo(
    () => getYearConfig(targetYear)?.label ?? '—',
    [targetYear],
  );

  if (!isTransitioning) return null;

  // Percentage for the progress bar (0–100).
  const percent = Math.round(progress * 100);

  return (
    <div
      className="pointer-events-none absolute bottom-8 left-1/2 z-20 -translate-x-1/2"
      role="status"
      aria-live="polite"
      data-testid="transition-overlay"
    >
      <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-black/60 px-6 py-3 shadow-xl backdrop-blur-md">
        {/* Year info */}
        <div className="flex items-center gap-2 text-sm text-gray-200">
          <span
            className="inline-block h-3 w-3 animate-pulse rounded-full bg-cyan-400"
            aria-hidden="true"
          />
          <span>
            Travelling to <span className="font-semibold text-cyan-300">{targetLabel}</span>
          </span>
        </div>

        {/* Progress bar */}
        <div
          className="h-1.5 w-56 overflow-hidden rounded-full bg-white/10"
          data-testid="transition-progress-track"
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400 transition-[width] duration-75 ease-linear"
            style={{ width: `${percent}%` }}
            data-testid="transition-progress-bar"
          />
        </div>

        {/* Help tooltip */}
        <p className="text-xs text-gray-400">
          Morphing the city across eras…
        </p>
      </div>
    </div>
  );
};

export default TransitionOverlay;
