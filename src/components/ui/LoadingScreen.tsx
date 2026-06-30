'use client';

/**
 * LoadingScreen
 *
 * Full-screen overlay shown while the 3D scene and its assets initialise.
 * Displays a spinner, a progress message, and fades out smoothly once the
 * `ready` flag flips to true. The component is purely presentational — the
 * parent controls readiness.
 */
import { useEffect, useState, type FC } from 'react';

interface LoadingScreenProps {
  /** When true, the scene is ready and the overlay begins its fade-out. */
  readonly ready: boolean;
  /** Optional progress fraction in [0, 1] for a progress bar. */
  readonly progress?: number;
  /** Optional message shown beneath the spinner. */
  readonly message?: string;
}

const LoadingScreen: FC<LoadingScreenProps> = ({
  ready,
  progress = 0,
  message = 'Loading the city…',
}) => {
  // Keep the overlay mounted during the fade-out transition, then unmount.
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (ready) {
      // Wait for the CSS transition to finish before removing from the DOM.
      const timer = setTimeout(() => setMounted(false), 600);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [ready]);

  if (!mounted) return null;

  const pct = Math.round(Math.max(0, Math.min(1, progress)) * 100);

  return (
    <div
      className={
        'fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#0a0a0a] transition-opacity duration-500 ' +
        (ready ? 'pointer-events-none opacity-0' : 'opacity-100')
      }
      role="status"
      aria-live="polite"
      aria-label="Loading city scene"
      data-testid="loading-screen"
      data-ready={ready ? 'true' : 'false'}
    >
      {/* Animated spinner */}
      <div
        className="h-12 w-12 animate-spin rounded-full border-4 border-white/10 border-t-cyan-400"
        data-testid="loading-spinner"
      />

      {/* Message */}
      <p className="text-sm font-medium tracking-wide text-gray-300">
        {message}
      </p>

      {/* Progress bar */}
      <div
        className="h-1.5 w-48 overflow-hidden rounded-full bg-white/10"
        data-testid="loading-progress-track"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-indigo-400 transition-all duration-300"
          style={{ width: `${pct}%` }}
          data-testid="loading-progress-fill"
        />
      </div>
      <span className="text-xs tabular-nums text-gray-500">{pct}%</span>
    </div>
  );
};

export default LoadingScreen;
