import { useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { CityCanvas } from './components/CityCanvas';
import { AudioControls } from './components/AudioControls';
import { AudioManagerBridge } from './components/AudioManagerBridge';
import { HelpOverlay } from './components/HelpOverlay';
import { OnboardingHint } from './components/OnboardingHint';
import { ERA_REGISTRY } from './contracts';
import { useEraStore } from './store/useEraStore';
import { useQualityStore } from './store/useQualityStore';
import { useNavStore } from './store/useNavStore';

export default function App() {
  const currentEra = useEraStore((s) => s.currentEra);
  const descriptor = ERA_REGISTRY[currentEra];
  const quality = useQualityStore((s) => s.quality);
  const toggleQuality = useQualityStore((s) => s.toggleQuality);
  const navMode = useNavStore((s) => s.mode);
  const toggleNavMode = useNavStore((s) => s.toggleMode);
  const [sceneReady, setSceneReady] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

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
            className="nav-mode-toggle"
            aria-pressed={navMode === 'fly'}
            aria-label={`Camera navigation: ${navMode === 'fly' ? 'Fly' : 'Orbit'} mode`}
            onClick={toggleNavMode}
          >
            {navMode === 'fly' ? 'Fly' : 'Orbit'}
          </button>
          <button
            type="button"
            className="help-toggle"
            aria-haspopup="dialog"
            aria-expanded={helpOpen}
            aria-label="Open controls and help"
            onClick={() => setHelpOpen(true)}
          >
            Help
          </button>
          <button
            type="button"
            className="quality-toggle"
            aria-pressed={quality === 'high'}
            onClick={toggleQuality}
          >
            Effects: {quality === 'high' ? 'High' : 'Low'}
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
        <OnboardingHint onDismiss={() => undefined} />
      </main>
      <footer className="app-footer">
        <span className="era-pill">{descriptor.label}</span>
        <span>{descriptor.mood}</span>
      </footer>
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
