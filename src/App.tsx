import { useCallback, useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { Scene } from './components/Scene';
import { AudioControls } from './components/AudioControls';
import { AudioBridge } from './components/AudioBridge';

/**
 * Top-level app.
 *
 * Composes the timeline, audio controls, the composed 3D scene (which owns
 * era-transition orchestration) and the audio bridge. A brief loading overlay
 * covers the first paint while the procedural scene mounts, then fades away.
 */
export default function App() {
  const [ready, setReady] = useState(false);
  const [gone, setGone] = useState(false);

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