import { useCallback, useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { Scene } from './components/Scene';
import { AudioControls } from './components/AudioControls';
import { AudioBridge } from './components/AudioBridge';
import type { EffectsQuality } from './effects';
import { NavigationControls } from './components/NavigationControls';
import { OnboardingHint } from './components/OnboardingHint';

/**
 * Top-level app.
 *
 * Composes the timeline, audio controls, the composed 3D scene (which owns
 * era-transition orchestration), the on-canvas navigation controls and the
 * audio bridge. A brief loading overlay covers the first paint while the
 * procedural scene mounts, then fades away.
 *
 * A quality toggle (High / Low) lets users trade the heavy screen-space
 * ambient-occlusion pass for a lighter render on weaker devices, so the scene
 * degrades gracefully instead of dropping frames. Once the overlay fades, a
 * dismissible onboarding hint explains the camera navigation.
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);
  const [quality, setQuality] = useState<EffectsQuality>('high');
  const [hintDismissed, setHintDismissed] = useState(false);

  // Called once the canvas has been created — the procedural city is authored
  // synchronously, so this is the "assets ready" signal for the loading state.
  const handleReady = useCallback(() => {
    setReady(true);
    window.setTimeout(() => setGone(true), 600);
  }, []);

  const toggleQuality = useCallback(() => {
    setQuality((q) => (q === 'high' ? 'low' : 'high'));
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <TimelineSlider />
        <div className="quality-controls" aria-label="Effects quality">
          <span className="quality-label">Quality</span>
          <button
            type="button"
            className={`quality-toggle${quality === 'low' ? ' is-low' : ''}`}
            onClick={toggleQuality}
            aria-pressed={quality === 'low'}
            title={`Effects quality: ${quality === 'high' ? 'High' : 'Low'}`}
          >
            {quality === 'high' ? 'High' : 'Low'}
          </button>
        </div>
        <AudioControls />
      </header>
      <main className="app-stage">
        <Scene onReady={handleReady} quality={quality} />
        <NavigationControls />
        {gone && !hintDismissed && (
          <OnboardingHint onDismiss={() => setHintDismissed(true)} />
        )}
      </main>
      <AudioBridge />
      {!gone && (
        <div className={`loading-overlay${ready ? ' is-fading' : ''}`}>
          <div className="loading-spinner" />
          <p className="loading-text">Preparing the city…</p>
        </div>
      )}
    </div>
  );
}
