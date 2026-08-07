import { TimelineSlider } from './components/TimelineSlider';
import { CityScene } from './components/CityScene';
import { AudioController } from './components/AudioController';
import { AudioControls } from './components/AudioControls';
import { QualityToggle } from './components/QualityToggle';
import './App.css';

export default function App() {
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
        <CityScene />
      </main>
    </div>
  );
}