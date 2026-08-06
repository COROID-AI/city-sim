import { useCallback, useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { Scene } from './components/Scene';
import { AudioControls } from './components/AudioControls';
import { AudioBridge } from './components/AudioBridge';
import { NavigationControls } from './components/NavigationControls';
import { OnboardingHint } from './components/OnboardingHint';

/**
 * Top-level app.
 *
 * Composes the timeline, audio controls, the composed 3D scene (which owns
 * era-transition orchestration), the on-canvas navigation controls and the
 * audio bridge. A loading overlay covers the first paint while the procedural
 * scene mounts, then fades away and reveals a dismissible onboarding hint.
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);
  const [hintDismissed, setHintDismissed] = useState(false);

  // Called once the canvas has been created — the procedural city is authored
  // synchronously, so this is the "assets ready" signal for the loading state.
  const handleReady = useCallback(() => {
    setReady(true);
    window.setTimeout(() => setGone(true), 600);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <TimelineSlider />
        <AudioControls />
      </header>
      <main className="app-stage">
        <Scene onReady={handleReady} />
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
