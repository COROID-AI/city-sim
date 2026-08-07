import { TimelineSlider } from './components/TimelineSlider';
import { CityScene } from './components/CityScene';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">City Time Period Timelapse</h1>
        <TimelineSlider />
      </header>
      <main className="app-main">
        <CityScene />
      </main>
    </div>
  );
}
