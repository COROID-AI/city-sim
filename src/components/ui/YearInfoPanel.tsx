'use client';

/**
 * YearInfoPanel
 *
 * Left-side info card that displays the historical blurb for the currently
 * selected era. Positioned below the effects controls and above the bottom
 * edge; collapses gracefully on small screens so it never overlaps the
 * top-centred timeline slider.
 */
import { useMemo, type FC } from 'react';
import { useYearStore } from '@/store/yearStore';
import { getYearConfig } from '@/config/years';
import { getHistoricalBlurb } from '@/config/historicalBlurbs';

const YearInfoPanel: FC = () => {
  // Follow `targetYear` so the panel updates immediately on selection, even
  // mid-transition.
  const targetYear = useYearStore((s) => s.targetYear);
  const isTransitioning = useYearStore((s) => s.transitionProgress < 1);

  const config = useMemo(() => getYearConfig(targetYear), [targetYear]);
  const blurb = useMemo(() => getHistoricalBlurb(targetYear), [targetYear]);

  return (
    <div
      className={
        'pointer-events-none absolute bottom-24 left-6 z-20 w-[min(320px,88vw)] rounded-2xl border border-white/10 bg-black/50 p-5 shadow-2xl backdrop-blur-md transition-opacity duration-300 sm:bottom-6 ' +
        (isTransitioning ? 'opacity-60' : 'opacity-100')
      }
      data-testid="year-info-panel"
    >
      {/* Year + era title header */}
      <div className="mb-2 flex items-baseline gap-3">
        <span className="text-3xl font-bold tabular-nums text-white">
          {config?.label ?? '—'}
        </span>
        <span
          className="text-xs font-medium uppercase tracking-[0.15em] text-cyan-300"
          data-testid="year-info-era"
        >
          {blurb.title}
        </span>
      </div>

      {/* Historical blurb body */}
      <p
        className="text-sm leading-relaxed text-gray-300"
        data-testid="year-info-body"
      >
        {blurb.body}
      </p>

      {/* Highlight detail */}
      <p className="mt-3 border-t border-white/5 pt-2 text-xs italic leading-relaxed text-gray-400">
        ✦ {blurb.highlight}
      </p>
    </div>
  );
};

export default YearInfoPanel;
