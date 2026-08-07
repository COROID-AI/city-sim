import { useEffect, useState } from 'react';
import { TimelineSlider } from './components/TimelineSlider';
import { CityScene } from './components/CityScene';
import { AudioController } from './components/AudioController';
import { AudioControls } from './components/AudioControls';
import { QualityToggle } from './components/QualityToggle';
import { CameraHud } from './components/CameraHud';
import { OnboardingHint } from './components/OnboardingHint';
import { HelpOverlay } from './components/HelpOverlay';
import { isInteractiveTarget } from './store/flyInput';
import './App.css';

const ONBOARDING_STORAGE_KEY = 'city-onboarding-dismissed';

export default function App() {
  const [sceneReady, setSceneReady] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try {
      return !localStorage.getItem(ONBOARDING_STORAGE_KEY);
    } catch {
      return true;
    }
  });

  // "?" toggles the controls help overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '?' || isInteractiveTarget(e.target)) return;
      setHelpOpen((open) => !open);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dismissOnboarding = () => {
    setShowOnboarding(false);
    try {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
    } catch {
      /* storage unavailable */
    }
  };

  const openHelp = () => setHelpOpen(true);

  return (
    <div className="app">
      <AudioController />
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <div className="app-header-controls">
          <TimelineSlider />
          <AudioControls />
          <QualityToggle />
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
        <CityScene onReady={() => setSceneReady(true)} />
        {showOnboarding && <OnboardingHint onDismiss={dismissOnboarding} onOpenHelp={openHelp} />}
        <CameraHud onOpenHelp={openHelp} />
        {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
      </main>
    </div>
  );
}
