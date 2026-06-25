/**
 * LoadingScreen — full-screen overlay shown while the city generates
 * (spec §8 Phase 7 visual polish).
 *
 * Displays a centered "Generating city..." message with a subtle spinner.
 * Rendered above the canvas (z-50) and removed once generation completes.
 */
interface LoadingScreenProps {
  /** Whether the loading overlay is visible. */
  visible: boolean;
}

/**
 * Full-screen loading overlay. Uses data-testid="loading-screen" for E2E
 * verification (Playwright checks it appears then disappears on refresh).
 */
export default function LoadingScreen({ visible }: LoadingScreenProps) {
  if (!visible) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-50 flex flex-col items-center justify-center bg-city-bg/95"
      data-testid="loading-screen"
      role="status"
      aria-live="polite"
    >
      <div className="mb-4 h-10 w-10 animate-spin rounded-full border-4 border-white/20 border-t-white" />
      <p className="text-lg font-semibold text-white sm:text-xl md:text-2xl">
        Generating city...
      </p>
    </div>
  );
}
