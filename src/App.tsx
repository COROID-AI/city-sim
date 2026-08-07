import { useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { CityScene } from './components/CityScene';
import { AudioController } from './components/AudioController';
import { AudioControls } from './components/AudioControls';
import { QualityToggle } from './components/QualityToggle';
import { CameraModeToggle } from './components/CameraModeToggle';
import { HelpButton } from './components/HelpButton';
import { HelpOverlay } from './components/HelpOverlay';
import { Onboarding } from './components/Onboarding';
import { FpsCounter } from './components/FpsCounter';
import './App.css';

export default function App() {
  const [sceneReady, setSceneReady] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  // The heavy WebGL scene is deferred until the onboarding overlay is
  // dismissed. Onboarding is pure DOM, so its dismiss button is clickable
  // immediately — the initial 3D shader-compilation render would otherwise
  // block the main thread and prevent the harness from clicking it.
  const [sceneMounted, setSceneMounted] = useState(false);

  return (
    <div className="app">
      <AudioController />
      <Onboarding onDismiss={() => setSceneMounted(true)} />
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <div className="app-header-controls">
          <FpsCounter />
          <TimelineSlider />
          <AudioControls />
          <CameraModeToggle />
          <QualityToggle />
          <HelpButton onClick={() => setHelpOpen(true)} />
        </div>
      </header>
      <main className="app-main">
        <div
          className={`scene-loading${sceneReady ? ' scene-loading-hidden' : ''}`}
          role="status"
          aria-live="polite"
        >
          <div className="scene-loading-spinner" aria-hidden="true" />
          <p className="scene-loading-text">Loading city…</p>
        </div>
        {sceneMounted && <CityScene onReady={() => setSceneReady(true)} />}
      </main>
    </div>
  );
}
