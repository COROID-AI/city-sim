import { TimelineSlider } from './components/TimelineSlider';
import { CityCanvas } from './components/CityCanvas';
import { ERA_REGISTRY } from './contracts';
import { useEraStore } from './store/useEraStore';

export default function App() {
  const currentEra = useEraStore((s) => s.currentEra);
  const descriptor = ERA_REGISTRY[currentEra];

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <TimelineSlider />
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
