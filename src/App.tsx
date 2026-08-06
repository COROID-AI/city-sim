import { TimelineSlider } from './components/TimelineSlider';
import { Scene } from './components/Scene';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <TimelineSlider />
      </header>
      <main className="app-stage">
        <Scene />
      </main>
    </div>
  );
}
