import { TimelineSlider } from './components/TimelineSlider';
import { CityScene } from './components/CityScene';
import { QualityToggle } from './components/QualityToggle';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <QualityToggle />
        <TimelineSlider />
      </header>
      <main className="app-main">
        <CityScene />
      </main>
    </div>
  );
}
