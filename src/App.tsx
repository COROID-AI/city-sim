import { TimelineSlider } from './components/TimelineSlider';
import { CityCanvas } from './components/CityCanvas';
import { ERA_REGISTRY } from './contracts';
import { useEraStore } from './store/useEraStore';
import { useQualityStore } from './store/useQualityStore';

export default function App() {
  const currentEra = useEraStore((s) => s.currentEra);
  const descriptor = ERA_REGISTRY[currentEra];
  const quality = useQualityStore((s) => s.quality);
  const toggleQuality = useQualityStore((s) => s.toggleQuality);

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <div className="app-header-controls">
          <TimelineSlider />
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
        <CityCanvas />
      </main>
      <footer className="app-footer">
        <span className="era-pill">{descriptor.label}</span>
        <span>{descriptor.mood}</span>
      </footer>
    </div>
  );
}
