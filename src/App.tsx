import { useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { CityCanvas } from './components/CityCanvas';
import { AudioControls } from './components/AudioControls';
import { AudioManagerBridge } from './components/AudioManagerBridge';
import { ControlsHelp } from './components/ControlsHelp';
import { OnboardingOverlay } from './components/OnboardingOverlay';
import { hasSeenOnboarding } from './components/onboarding';
import { PerformanceHud } from './components/PerformanceHud';
import { ERA_REGISTRY } from './contracts';
import { useEraStore } from './store/useEraStore';
import { useQualityStore } from './store/useQualityStore';
import { useCameraStore } from './store/useCameraStore';

export default function App() {
  const currentEra = useEraStore((s) => s.currentEra);
  const descriptor = ERA_REGISTRY[currentEra];
  const quality = useQualityStore((s) => s.quality);
  const toggleQuality = useQualityStore((s) => s.toggleQuality);
  const cameraMode = useCameraStore((s) => s.mode);
  const toggleCameraMode = useCameraStore((s) => s.toggleMode);
  const [sceneReady, setSceneReady] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => !hasSeenOnboarding());

  return (
    <div className="app">
      <AudioManagerBridge />
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <div className="app-header-controls">
          <TimelineSlider />
          <AudioControls />
          <button
            type="button"
            className="camera-toggle"
            aria-pressed={cameraMode === 'fly'}
            onClick={toggleCameraMode}
          >
            Camera: {cameraMode === 'fly' ? 'Fly' : 'Orbit'}
          </button>
          <button
            type="button"
            className="quality-toggle"
            aria-pressed={quality === 'high'}
            onClick={toggleQuality}
          >
            Effects: {quality === 'high' ? 'High' : 'Low'}
          </button>
          <button
            type="button"
            className="help-toggle"
            aria-expanded={showHelp}
            onClick={() => setShowHelp(true)}
          >
            ?
          </button>
        </div>
      </header>
      <main className="app-stage">
        {!sceneReady && (
          <div className="scene-loader" role="status" aria-label="Loading city scene">
            <span className="scene-loader-spinner" aria-hidden="true" />
            <span>Composing the city&hellip;</span>
          </div>
        )}
        <CityCanvas onReady={() => setSceneReady(true)} />
      </main>
      <footer className="app-footer">
        <span className="era-pill">{descriptor.label}</span>
        <span>{descriptor.mood}</span>
        <span className="footer-spacer" aria-hidden="true" />
        <PerformanceHud />
      </footer>

      {showOnboarding && <OnboardingOverlay onDismiss={() => setShowOnboarding(false)} />}
      {showHelp && <ControlsHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}
